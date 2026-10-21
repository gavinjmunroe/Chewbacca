/**
 * image-gen.js — Generate images via OpenAI gpt-image-1.
 *
 * gpt-image-1 produces photorealistic and stylized images with excellent
 * text rendering and instruction following. The OpenAI API returns the
 * PNG as base64 (~1.4MB encoded). We decode it, stash the bytes in the
 * ephemeral image-host (lib/image-host.js), and return a short public
 * URL — the agent loop scans tool results for `image_url` and auto-
 * attaches it to the outbound Loop send.
 *
 * Why a URL instead of base64: the tool-output-sanitizer caps every
 * tool result at 16000 chars. Returning raw base64 silently truncated
 * the image to garbage and the model rationalized the half-failure.
 *
 * Per-user secret: OPENAI_API_KEY via lib/secrets.js.
 * Fallback: process.env.OPENAI_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { storeImage } from "../image-host.js";
import { saveMemory } from "../memory.js";

registerCapability("_tools_ImageGen", [
  "Generate images from text prompts (generate_image)",
]);

const IMAGES_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_TIMEOUT_MS = 120_000;

async function getKey(tenant) {
  return getSecret(tenant, "OPENAI_API_KEY", {
    fallbackEnv: "OPENAI_API_KEY",
  });
}

function resolvePublicBase() {
  // Same resolution order voice.js uses for the audio host (agent.js
  // lines 2410-2415). MEDHA_PUBLIC_AUDIO_BASE_URL acts as the project's
  // canonical "where am I publicly reachable" knob; reuse it here
  // rather than introducing a parallel _IMAGE_ variant.
  return (
    process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null)
  );
}

/**
 * Tab 15 — build the Pinecone memory record for a generated image so
 * "find the cat picture I made last week" recalls the prompt + the URL.
 * The embedded text is the prompt plus the model's revised prompt; the
 * source is the public image URL so recall can re-attach it. Pure +
 * exported so the metadata shape is unit-tested without any network.
 */
export function buildGeneratedImageMemory({
  prompt,
  revisedPrompt = null,
  imageUrl,
  contact = null,
  filename = null,
  generatedAt = null,
}) {
  const content = revisedPrompt
    ? `${prompt}\n\nrevised: ${revisedPrompt}`
    : prompt;
  return {
    content,
    category: "generated_image",
    dimensions: ["intellectual"],
    source: imageUrl,
    handle: contact || undefined,
    tags: ["generated_image"],
    extra: {
      tool: "gpt-image-1",
      sourceUrl: imageUrl,
      filename: filename || null,
      contact: contact || null,
      generatedAt: generatedAt || null,
    },
  };
}

// Exported so generate_carousel (Tab 28) can reuse the exact same
// generation path — OpenAI call, image-host store, and the Tab 15
// Pinecone write — for each slide instead of duplicating the contract.
export async function generateImage(input, tenant, contact = null) {
  const { prompt, size, quality } = input || {};
  if (!prompt || typeof prompt !== "string") {
    return { error: "prompt is required" };
  }
  if (prompt.length > 4000) {
    return { error: "prompt too long (max 4000 chars)" };
  }

  const key = await getKey(tenant);
  if (!key) return { error: "OPENAI_API_KEY not configured for tenant" };

  const validSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
  const chosenSize = validSizes.includes(size) ? size : "1024x1024";
  const validQuality = ["low", "medium", "high", "auto"];
  const chosenQuality = validQuality.includes(quality) ? quality : "medium";

  const publicBase = resolvePublicBase();
  if (!publicBase) {
    return {
      error:
        "no public base URL — set MEDHA_PUBLIC_AUDIO_BASE_URL or PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: chosenSize,
        quality: chosenQuality,
        n: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `openai images ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const first = (data.data || [])[0];
    if (!first || !first.b64_json) {
      return { error: "openai returned no image" };
    }
    const buf = Buffer.from(first.b64_json, "base64");
    const id = storeImage(buf, "image/png");
    if (!id) return { error: "image-host store failed" };
    const imageUrl = `${publicBase}/image/${id}.png`;

    // Tab 15 — index the generated image into the tenant's Pinecone so it
    // is recallable later. Best-effort: never let a memory write break the
    // tool result (saveMemory is a no-op when amber-id is unconfigured).
    saveMemory(
      buildGeneratedImageMemory({
        prompt,
        revisedPrompt: first.revised_prompt || null,
        imageUrl,
        contact,
        filename: `${id}.png`,
        generatedAt: new Date().toISOString(),
      }),
      tenant,
    ).catch((err) =>
      console.error("[image-gen] saveMemory failed:", err?.message || err),
    );

    return {
      image_url: imageUrl,
      revised_prompt: first.revised_prompt || null,
      size: chosenSize,
      quality: chosenQuality,
      model: "gpt-image-1",
      mime_type: "image/png",
    };
  } catch (err) {
    clearTimeout(timer);
    return { error: `image gen failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const IMAGE_GEN_TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate a single image from a text prompt using OpenAI gpt-image-1. Returns { image_url } — a short public URL the agent loop auto-attaches to the outbound iMessage. Say what you made in one short sentence in your reply; do NOT paste the URL into the text. Good for illustrations, product shots, social media assets, concept art. For photorealistic people or brand logos, be very specific.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image to generate (≤4000 chars).",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1024x1536", "1536x1024", "auto"],
          description:
            "Output dimensions. Default '1024x1024'. Use '1024x1536' for portrait, '1536x1024' for landscape.",
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high", "auto"],
          description:
            "Image quality. Default 'medium'. 'high' costs more but renders fine detail better.",
        },
      },
      required: ["prompt"],
    },
  },
];

export async function executeImageGenTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  const contact = ctx.contact || null;
  switch (toolName) {
    case "generate_image":
      return generateImage(input, tenant, contact);
    default:
      return { error: `unknown image-gen tool: ${toolName}` };
  }
}
