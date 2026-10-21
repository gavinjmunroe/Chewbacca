/**
 * image-edit.js — Refine an existing image via OpenAI gpt-image-1 edit mode.
 *
 * Tab 27. generate_image (image-gen.js) produces a first pass, but the
 * first pass is rarely final: "make it more blue", "remove the text",
 * "try a vertical version". This tool takes the source image the model
 * already has in the conversation (the image_url a prior generate_image
 * or an inbound attachment produced) plus an edit prompt and returns a
 * refined variant.
 *
 * Mechanism: the OpenAI images/edits endpoint takes multipart/form-data
 * (the source bytes as a file part, the prompt, an optional mask) and
 * returns the edited PNG as base64 — same shape as generations. We decode
 * it, stash the bytes in the ephemeral image-host (lib/image-host.js), and
 * return a short public URL. The agent loop scans tool results for
 * `image_url` and auto-attaches it to the outbound send, exactly like
 * generate_image.
 *
 * Source resolution: when source_url points at our own image-host
 * (/image/<id>.<ext>) we read the buffer straight out of the in-process
 * store via getImage(id) — no network hop, and it works in tests without
 * a live server. Any other URL (e.g. an inbound attachment the user sent)
 * is fetched over HTTP.
 *
 * Per-user secret: OPENAI_API_KEY via lib/secrets.js.
 * Fallback: process.env.OPENAI_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { storeImage, getImage } from "../image-host.js";
import { saveMemory } from "../memory.js";
import { buildGeneratedImageMemory } from "./image-gen.js";

registerCapability("_tools_ImageEdit", [
  "Refine / iterate on an existing image (edit_image)",
]);

const IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_TIMEOUT_MS = 120_000;
// gpt-image-1 edit input limit. Same image-host TTL window means the
// source is almost always still warm in memory when the edit fires.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 25MB — OpenAI's edit cap

async function getKey(tenant) {
  return getSecret(tenant, "OPENAI_API_KEY", {
    fallbackEnv: "OPENAI_API_KEY",
  });
}

function resolvePublicBase() {
  // Same resolution order image-gen.js uses (which mirrors voice.js).
  // MEDHA_PUBLIC_AUDIO_BASE_URL is the project's canonical "where am I
  // publicly reachable" knob; reuse it rather than a parallel variant.
  return (
    process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null)
  );
}

const EXT_TO_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Pull the image-host id + extension out of a /image/<id>.<ext> URL.
 * Returns null for any URL that isn't one of our hosted images.
 * Exported for unit tests.
 */
export function parseHostedImageRef(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/image\/([a-f0-9]+)\.(png|jpe?g|webp)(?:[?#].*)?$/i);
  if (!m) return null;
  return { id: m[1], ext: m[2].toLowerCase() };
}

/**
 * Load the source image bytes. Prefers the in-process image-host (no
 * network) when the URL is one we minted; otherwise fetches over HTTP.
 * Returns { buffer, mimeType } or { error }.
 */
async function loadSourceImage(sourceUrl) {
  const ref = parseHostedImageRef(sourceUrl);
  if (ref) {
    const stored = getImage(ref.id);
    if (stored && stored.buffer && stored.buffer.length) {
      return {
        buffer: stored.buffer,
        mimeType: stored.mimeType || EXT_TO_MIME[ref.ext] || "image/png",
      };
    }
    // Fell out of the host's 10-minute TTL — tell the model plainly so it
    // re-generates instead of silently editing the wrong thing.
    return {
      error:
        "source image expired from the host; regenerate it before editing",
    };
  }

  let res;
  try {
    res = await fetch(sourceUrl);
  } catch (err) {
    return {
      error: `failed to fetch source image: ${String(err).slice(0, 160)}`,
    };
  }
  if (!res.ok) {
    return { error: `failed to fetch source image: HTTP ${res.status}` };
  }
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (!buffer.length) return { error: "source image was empty" };
  if (buffer.length > MAX_SOURCE_BYTES) {
    return { error: "source image too large to edit (max 25MB)" };
  }
  const mimeType =
    (res.headers && res.headers.get && res.headers.get("content-type")) ||
    "image/png";
  return { buffer, mimeType: mimeType.split(";")[0].trim() };
}

function extForMime(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function editImage(input, tenant, contact = null) {
  const { source_url, prompt, mask, size, quality } = input || {};
  if (!source_url || typeof source_url !== "string") {
    return { error: "source_url is required" };
  }
  if (!prompt || typeof prompt !== "string") {
    return { error: "prompt is required" };
  }
  if (prompt.length > 4000) {
    return { error: "prompt too long (max 4000 chars)" };
  }

  const key = await getKey(tenant);
  if (!key) return { error: "OPENAI_API_KEY not configured for tenant" };

  const publicBase = resolvePublicBase();
  if (!publicBase) {
    return {
      error:
        "no public base URL — set MEDHA_PUBLIC_AUDIO_BASE_URL or PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN",
    };
  }

  const validSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
  const chosenSize = validSizes.includes(size) ? size : "auto";
  const validQuality = ["low", "medium", "high", "auto"];
  const chosenQuality = validQuality.includes(quality) ? quality : "auto";

  const src = await loadSourceImage(source_url);
  if (src.error) return { error: src.error };

  // Optional mask: a transparent-where-editable PNG. Same source-loading
  // path (host-first, fetch-fallback). A bad mask is non-fatal — we drop
  // it and edit the whole image rather than failing the call.
  let maskPart = null;
  if (mask && typeof mask === "string") {
    const loadedMask = await loadSourceImage(mask);
    if (!loadedMask.error && loadedMask.buffer) {
      maskPart = loadedMask;
    }
  }

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", chosenSize);
  form.append("quality", chosenQuality);
  form.append("n", "1");
  form.append(
    "image",
    new Blob([src.buffer], { type: src.mimeType }),
    `source.${extForMime(src.mimeType)}`,
  );
  if (maskPart) {
    form.append(
      "mask",
      new Blob([maskPart.buffer], { type: "image/png" }),
      "mask.png",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    // No Content-Type header: fetch sets the multipart boundary itself.
    const res = await fetch(IMAGES_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `openai edits ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const first = (data.data || [])[0];
    if (!first || !first.b64_json) {
      return { error: "openai returned no edited image" };
    }
    const buf = Buffer.from(first.b64_json, "base64");
    const id = storeImage(buf, "image/png");
    if (!id) return { error: "image-host store failed" };
    const imageUrl = `${publicBase}/image/${id}.png`;

    // Tab 15 pattern — index the edited image so it is recallable later.
    // Reuse the generated-image memory shape; the prompt notes the edit +
    // its source so "find the bluer version of the cat" resolves.
    saveMemory(
      buildGeneratedImageMemory({
        prompt: `edit: ${prompt} (source: ${source_url})`,
        revisedPrompt: first.revised_prompt || null,
        imageUrl,
        contact,
        filename: `${id}.png`,
        generatedAt: new Date().toISOString(),
      }),
      tenant,
    ).catch((err) =>
      console.error("[image-edit] saveMemory failed:", err?.message || err),
    );

    return {
      image_url: imageUrl,
      source_url,
      revised_prompt: first.revised_prompt || null,
      size: chosenSize,
      quality: chosenQuality,
      model: "gpt-image-1",
      mime_type: "image/png",
    };
  } catch (err) {
    clearTimeout(timer);
    return { error: `image edit failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const IMAGE_EDIT_TOOLS = [
  {
    name: "edit_image",
    description:
      "Refine or iterate on an image that already exists in the conversation using OpenAI gpt-image-1 edit mode. Use this for follow-ups like 'make it more blue', 'remove the text', 'add a hat', or 'try a vertical version' instead of generating a brand-new image from scratch. Set source_url to the most recent image_url in the conversation (from a prior generate_image, or an image the user sent). Returns { image_url } — a short public URL the agent loop auto-attaches to the outbound message. Say what you changed in ONE short sentence; do NOT paste the URL into the reply.",
    input_schema: {
      type: "object",
      properties: {
        source_url: {
          type: "string",
          description:
            "URL of the image to edit. Use the most recent image_url from the conversation (a prior generated image or an inbound attachment).",
        },
        prompt: {
          type: "string",
          description:
            "What to change, described as the desired end state (e.g. 'the same cat but with bright orange fur on a blue background'). Be specific about what stays and what changes. <=4000 chars.",
        },
        mask: {
          type: "string",
          description:
            "Optional URL of a PNG mask. Transparent (alpha=0) regions are the areas to edit; opaque regions are preserved. Omit to let the model edit the whole image.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1024x1536", "1536x1024", "auto"],
          description:
            "Output dimensions. Default 'auto' (keeps the source aspect). Use '1024x1536' for portrait, '1536x1024' for landscape.",
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high", "auto"],
          description: "Render quality. Default 'auto'.",
        },
      },
      required: ["source_url", "prompt"],
    },
  },
];

export async function executeImageEditTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  const contact = ctx.contact || null;
  switch (toolName) {
    case "edit_image":
      return editImage(input, tenant, contact);
    default:
      return { error: `unknown image-edit tool: ${toolName}` };
  }
}
