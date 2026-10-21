/**
 * generate-carousel.test.mjs — Tab 28: multi-image LinkedIn carousels.
 *
 * Covers the pure, network-free core:
 *   - buildSlidePrompt bakes the shared style + palette + "slide K of N"
 *     consistency frame into every slide prompt.
 *   - normalizeSlides accepts object + string slides, drops empties, and
 *     enforces the 2-6 slide bounds.
 *   - the exported tool schema is well-formed (name, required, bounds).
 *
 * The OpenAI generation path itself is exercised by image-gen at runtime;
 * the carousel just fans out N parallel generate_image calls, so there's
 * nothing network-shaped to assert here without a live key.
 *
 * Run: cd Newton/agent && node --test lib/__tests__/generate-carousel.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildSlidePrompt, normalizeSlides, CAROUSEL_TOOLS } =
  await import("../tools/generate-carousel.js");

test("buildSlidePrompt embeds slide position, style, and palette", () => {
  const prompt = buildSlidePrompt({
    slide: {
      title: "Clay 101",
      body: "Automate your enrichment",
      visual_direction: "isometric workflow diagram",
    },
    index: 0,
    total: 6,
    style: "clean modern flat illustration",
    palette: "indigo accent on zinc-950",
  });
  assert.match(prompt, /slide 1 of 6/i);
  assert.match(prompt, /clean modern flat illustration/);
  assert.match(prompt, /indigo accent on zinc-950/);
  assert.match(prompt, /Clay 101/);
  assert.match(prompt, /Automate your enrichment/);
  assert.match(prompt, /isometric workflow diagram/);
});

test("buildSlidePrompt is stable across slides except position", () => {
  const base = { style: "flat", palette: "blue" };
  const a = buildSlidePrompt({
    ...base,
    slide: { title: "A" },
    index: 0,
    total: 3,
  });
  const b = buildSlidePrompt({
    ...base,
    slide: { title: "B" },
    index: 1,
    total: 3,
  });
  assert.match(a, /slide 1 of 3/i);
  assert.match(b, /slide 2 of 3/i);
  // Both carry the same shared style + palette so the deck stays cohesive.
  assert.match(a, /Overall style: flat/);
  assert.match(b, /Overall style: flat/);
  assert.match(a, /keep identical across every slide/i);
  assert.match(b, /keep identical across every slide/i);
});

test("normalizeSlides accepts objects and coerces bare strings", () => {
  const out = normalizeSlides([
    { title: "One", body: "first" },
    "just a string slide",
  ]);
  assert.equal(out.error, undefined);
  assert.equal(out.slides.length, 2);
  assert.equal(out.slides[1].body, "just a string slide");
});

test("normalizeSlides drops empty slides", () => {
  const out = normalizeSlides([
    { title: "Keep" },
    { title: "", body: "", visual_direction: "" },
    { body: "also keep" },
  ]);
  assert.equal(out.error, undefined);
  assert.equal(out.slides.length, 2);
});

test("normalizeSlides rejects fewer than 2 slides", () => {
  const out = normalizeSlides([{ title: "lonely" }]);
  assert.match(out.error, /at least 2/);
});

test("normalizeSlides rejects more than 6 slides", () => {
  const out = normalizeSlides(
    Array.from({ length: 7 }, (_, i) => ({ title: `slide ${i}` })),
  );
  assert.match(out.error, /max 6/);
});

test("normalizeSlides rejects a non-array", () => {
  const out = normalizeSlides("not an array");
  assert.match(out.error, /must be an array/);
});

test("CAROUSEL_TOOLS exposes a well-formed generate_carousel schema", () => {
  assert.equal(CAROUSEL_TOOLS.length, 1);
  const tool = CAROUSEL_TOOLS[0];
  assert.equal(tool.name, "generate_carousel");
  assert.deepEqual(tool.input_schema.required, ["slides"]);
  assert.equal(tool.input_schema.properties.slides.minItems, 2);
  assert.equal(tool.input_schema.properties.slides.maxItems, 6);
  assert.ok(tool.input_schema.properties.style);
  assert.ok(tool.input_schema.properties.palette);
});
