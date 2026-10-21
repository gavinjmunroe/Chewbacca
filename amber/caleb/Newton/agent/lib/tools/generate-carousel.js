/**
 * generate-carousel.js — Tab 28: multi-image carousels for LinkedIn.
 *
 * Shirley asked for a 6-page Clay infographic; single-image flows can't
 * deliver that. `generate_carousel` takes a list of slides plus a shared
 * style + palette and produces N coordinated images by firing N parallel
 * `generate_image` calls — each prompt carries the same visual language
 * (palette, typography hint, slide framing) so the slides read as one
 * cohesive deck instead of N unrelated pictures.
 *
 * Output contract: the tool returns `image_urls` (an array of public
 * image-host URLs). The agent loop (agent.js) scans tool results for
 * `image_urls` and accumulates them up to 6, then spills anything past
 * the Loop 3-attachment-per-send cap across follow-up bubbles so a full
 * 6-slide carousel actually lands in iMessage / Slack.
 *
 * Pinecone: each slide rides the exact same generate_image path, so the
 * Tab 15 `generated_image` memory write happens per slide automatically.
 * No extra indexing here — that keeps one source of truth for the
 * generated-image memory shape.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { registerCapability } from "../capabilities.js";
import { generateImage } from "./image-gen.js";

registerCapability("_tools_GenerateCarousel", [
  "Generate a multi-slide image carousel for LinkedIn (generate_carousel)",
]);

// Loop caps a single outbound send at 3 attachments; the agent loop spills
// past that across bubbles, but we still bound a carousel so one turn can't
// fan out into an unbounded pile of paid image generations.
const MAX_SLIDES = 6;
const MIN_SLIDES = 2;

const VALID_SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"];
const VALID_QUALITY = ["low", "medium", "high", "auto"];

/**
 * Build the per-slide prompt for one carousel slide. Pure + exported so the
 * style-consistency contract is unit-tested without any network call.
 *
 * The consistency hints (shared palette, shared style, "slide K of N",
 * matching typography, consistent margins) are what make the slides read
 * as one deck. Each slide's own title / body / visual_direction is layered
 * on top of that shared frame.
 */
export function buildSlidePrompt({
  slide,
  index,
  total,
  style = "",
  palette = "",
}) {
  const slideNo = index + 1;
  const title = (slide?.title || "").trim();
  const body = (slide?.body || "").trim();
  const visual = (slide?.visual_direction || "").trim();

  const lines = [
    `LinkedIn carousel slide ${slideNo} of ${total}, designed as part of one cohesive deck.`,
    "Portrait 4:5 social composition with generous margins and clear visual hierarchy.",
  ];
  if (style) lines.push(`Overall style: ${style}.`);
  if (palette)
    lines.push(
      `Color palette (keep identical across every slide): ${palette}.`,
    );
  lines.push(
    "Consistent typography, consistent layout grid, and consistent color treatment with the other slides in the set.",
  );
  if (title) lines.push(`Headline text on the slide: "${title}".`);
  if (body) lines.push(`Supporting copy: ${body}.`);
  if (visual) lines.push(`Visual direction: ${visual}.`);
  lines.push(
    "Render any on-slide text crisply and legibly. No watermarks, no logos unless specified.",
  );

  return lines.join(" ");
}

/**
 * Normalize + validate the slides array. Returns { slides } on success or
 * { error } when the input can't make a carousel.
 */
export function normalizeSlides(rawSlides) {
  if (!Array.isArray(rawSlides)) {
    return { error: "slides must be an array" };
  }
  const slides = rawSlides
    .map((s) => {
      if (typeof s === "string") return { title: "", body: s };
      if (s && typeof s === "object") return s;
      return null;
    })
    .filter(
      (s) =>
        s &&
        ((s.title && String(s.title).trim()) ||
          (s.body && String(s.body).trim()) ||
          (s.visual_direction && String(s.visual_direction).trim())),
    );

  if (slides.length < MIN_SLIDES) {
    return { error: `a carousel needs at least ${MIN_SLIDES} slides` };
  }
  if (slides.length > MAX_SLIDES) {
    return {
      error: `too many slides (max ${MAX_SLIDES}); split into multiple carousels`,
    };
  }
  return { slides };
}

async function generateCarousel(input, tenant, contact = null) {
  const { slides: rawSlides, style, palette, size, quality } = input || {};

  const norm = normalizeSlides(rawSlides);
  if (norm.error) return { error: norm.error };
  const slides = norm.slides;

  const chosenSize = VALID_SIZES.includes(size) ? size : "1024x1536";
  const chosenQuality = VALID_QUALITY.includes(quality) ? quality : "medium";
  const styleStr = typeof style === "string" ? style.trim() : "";
  const paletteStr = typeof palette === "string" ? palette.trim() : "";

  // Fire every slide in parallel — they're independent generations and the
  // count is bounded at MAX_SLIDES, so a single Promise.all is safe.
  const results = await Promise.all(
    slides.map((slide, index) => {
      const prompt = buildSlidePrompt({
        slide,
        index,
        total: slides.length,
        style: styleStr,
        palette: paletteStr,
      });
      return generateImage(
        { prompt, size: chosenSize, quality: chosenQuality },
        tenant,
        contact,
      ).catch((err) => ({
        error: `slide ${index + 1} failed: ${String(err).slice(0, 160)}`,
      }));
    }),
  );

  const imageUrls = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r && typeof r.image_url === "string") {
      imageUrls.push(r.image_url);
    } else {
      errors.push(r?.error || `slide ${i + 1} returned no image`);
    }
  });

  if (imageUrls.length === 0) {
    return {
      error: `carousel generation failed: ${errors.slice(0, 3).join("; ")}`,
    };
  }

  return {
    image_urls: imageUrls,
    count: imageUrls.length,
    requested: slides.length,
    size: chosenSize,
    quality: chosenQuality,
    style: styleStr || null,
    palette: paletteStr || null,
    model: "gpt-image-1",
    // Surface partial failures so the model can tell the user a slide or
    // two didn't render rather than silently shipping a short deck.
    partial_failures: errors.length ? errors : undefined,
  };
}

// ── Tool schema ──────────────────────────────────────────────────────────────

export const CAROUSEL_TOOLS = [
  {
    name: "generate_carousel",
    description:
      "Generate a multi-slide image carousel (2-6 coordinated slides) for LinkedIn or other social posts. Each slide shares the same style and color palette so the deck reads as one cohesive set. Returns { image_urls } — the agent loop auto-attaches them to the outbound message, spilling past the 3-per-bubble cap across follow-up bubbles. Use this instead of calling generate_image repeatedly when the user wants a carousel, an N-slide infographic, or a coordinated set of images. Say what you made in one short sentence; do NOT paste the URLs into the text.",
    input_schema: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          minItems: MIN_SLIDES,
          maxItems: MAX_SLIDES,
          description:
            "The slides, in order. Each slide is an object with the text and art direction for that slide.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Headline text to render on the slide.",
              },
              body: {
                type: "string",
                description: "Supporting copy or the key point for the slide.",
              },
              visual_direction: {
                type: "string",
                description:
                  "Art direction for this slide's imagery (e.g. 'isometric workflow diagram', 'bold stat with a chart').",
              },
            },
          },
        },
        style: {
          type: "string",
          description:
            "Shared visual style applied to every slide (e.g. 'clean modern flat illustration, dark indigo background').",
        },
        palette: {
          type: "string",
          description:
            "Shared color palette kept identical across all slides (e.g. 'zinc-950 background, indigo-500 accent, white text').",
        },
        size: {
          type: "string",
          enum: VALID_SIZES,
          description:
            "Output dimensions for every slide. Default '1024x1536' (portrait 4:5, the LinkedIn carousel format).",
        },
        quality: {
          type: "string",
          enum: VALID_QUALITY,
          description: "Image quality for every slide. Default 'medium'.",
        },
      },
      required: ["slides"],
    },
  },
];

export async function executeCarouselTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  const contact = ctx.contact || null;
  switch (toolName) {
    case "generate_carousel":
      return generateCarousel(input, tenant, contact);
    default:
      return { error: `unknown carousel tool: ${toolName}` };
  }
}
