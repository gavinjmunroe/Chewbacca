/**
 * Tests for lib/writing/* — Tab 4 (newsletter section templates + Sagar voice
 * seed + Shirley's 4 rules in assembled prompts).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/writing-section-templates.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BMA_SECTIONS,
  AUTHOR_VOICES,
  SHIRLEY_RULES,
  getSectionTemplate,
  getAuthorVoice,
  assembleNewsletterPrompt,
  buildNewsletterDoctrine,
} from "../writing/index.js";
import {
  NEWSLETTER_TOOLS,
  executeNewsletterTool,
} from "../tools/newsletter.js";

// ── BMA_SECTIONS seed ─────────────────────────────────────────────────────

test("BMA_SECTIONS has hypothesis / stories_watching / talking_tables", () => {
  assert.ok(BMA_SECTIONS.hypothesis, "hypothesis section present");
  assert.ok(BMA_SECTIONS.stories_watching, "stories_watching section present");
  assert.ok(BMA_SECTIONS.talking_tables, "talking_tables section present");
});

test("hypothesis section has 300-400 word target and platform tones", () => {
  const h = BMA_SECTIONS.hypothesis;
  assert.equal(h.word_count_min, 300);
  assert.equal(h.word_count_max, 400);
  assert.match(h.structure, /hook/i);
  assert.match(h.structure, /bet/i);
  assert.ok(h.platform_tone.newsletter);
  assert.ok(h.platform_tone.substack);
});

test("getSectionTemplate resolves platform tone modifier", () => {
  const s = getSectionTemplate("bma", "default", "hypothesis", "newsletter");
  assert.ok(s, "template resolved");
  assert.equal(s.resolved_tone, s.platform_tone.newsletter);
  assert.equal(s.platform, "newsletter");
});

test("getSectionTemplate returns null for unknown org / section", () => {
  assert.equal(getSectionTemplate("unknown", "default", "hypothesis"), null);
  assert.equal(getSectionTemplate("bma", "default", "made_up_section"), null);
});

// ── AUTHOR_VOICES seed ────────────────────────────────────────────────────

test("AUTHOR_VOICES seeds Sagar with voice tells from draft #2", () => {
  const sagar = AUTHOR_VOICES["sagar-tiwari"];
  assert.ok(sagar, "sagar-tiwari present");
  assert.equal(sagar.org, "bma");
  assert.match(sagar.voice_tells.openers, /scene-first/i);
  assert.match(sagar.voice_tells.closers, /bet/i);
  assert.ok(
    sagar.voice_tells.jargon_blacklist.includes("leverage"),
    "leverage is blacklisted",
  );
  assert.ok(
    sagar.what_they_dont_say.some((p) => /I think maybe/i.test(p)),
    "'I think maybe' phrase excluded",
  );
});

test("AUTHOR_VOICES has placeholders for Caleb, Shirley, Emily", () => {
  assert.equal(AUTHOR_VOICES["caleb-newton"], null);
  assert.equal(AUTHOR_VOICES["shirley-park"], null);
  assert.equal(AUTHOR_VOICES.emily, null);
});

test("getAuthorVoice is case-insensitive", () => {
  assert.ok(getAuthorVoice(null, "Sagar-Tiwari"));
  assert.ok(getAuthorVoice(null, "SAGAR-TIWARI"));
  assert.equal(getAuthorVoice(null, "not-a-real-author"), null);
});

// ── assembleNewsletterPrompt ──────────────────────────────────────────────

test("assembleNewsletterPrompt embeds all 4 of Shirley's rules", () => {
  const section_template = getSectionTemplate(
    "bma",
    "default",
    "hypothesis",
    "newsletter",
  );
  const author_voice = getAuthorVoice(null, "sagar-tiwari");
  const prompt = assembleNewsletterPrompt({
    section_template,
    author_voice,
    platform: "newsletter",
  });
  assert.match(prompt, /SHIRLEY'S 4 RULES/);
  assert.match(prompt, /1\..*author's perspective/i);
  assert.match(prompt, /2\..*stands alone/i);
  assert.match(prompt, /3\..*can't land/i);
  assert.match(prompt, /4\..*general audience/i);
});

test("assembleNewsletterPrompt embeds section word count and voice tells", () => {
  const section_template = getSectionTemplate(
    "bma",
    "default",
    "hypothesis",
    "newsletter",
  );
  const author_voice = getAuthorVoice(null, "sagar-tiwari");
  const prompt = assembleNewsletterPrompt({
    section_template,
    author_voice,
    platform: "newsletter",
  });
  assert.match(prompt, /300-400 words/);
  assert.match(prompt, /scene-first/i);
  assert.match(prompt, /bet/i);
  assert.match(prompt, /Never use:.*leverage/i);
});

test("assembleNewsletterPrompt degrades cleanly when voice profile missing", () => {
  const section_template = getSectionTemplate(
    "bma",
    "default",
    "hypothesis",
    "newsletter",
  );
  const prompt = assembleNewsletterPrompt({
    section_template,
    author_voice: null,
    platform: "newsletter",
  });
  assert.match(prompt, /No voice profile registered/i);
  assert.match(prompt, /samples before drafting/i);
});

test("buildNewsletterDoctrine returns null for unknown section", () => {
  const result = buildNewsletterDoctrine({
    sectionKey: "not_a_section",
    authorSlug: "sagar-tiwari",
  });
  assert.equal(result, null);
});

test("buildNewsletterDoctrine returns assembled prompt for Sagar hypothesis", () => {
  const result = buildNewsletterDoctrine({
    sectionKey: "hypothesis",
    authorSlug: "sagar-tiwari",
    platform: "newsletter",
  });
  assert.ok(result);
  assert.match(result.doctrine, /SHIRLEY'S 4 RULES/);
  assert.equal(result.section_template.word_count_min, 300);
  assert.equal(result.author_voice.author_slug, "sagar-tiwari");
  assert.match(result.prompt, /SHIRLEY'S 4 RULES/);
  assert.match(result.prompt, /300-400 words/);
});

// ── SHIRLEY_RULES constant ────────────────────────────────────────────────

test("SHIRLEY_RULES constant contains all 4 numbered rules", () => {
  assert.match(SHIRLEY_RULES, /^SHIRLEY'S 4 RULES/);
  for (const n of [1, 2, 3, 4]) {
    assert.match(SHIRLEY_RULES, new RegExp(`^${n}\\.`, "m"));
  }
});

// ── get_newsletter_brief tool ─────────────────────────────────────────────

test("NEWSLETTER_TOOLS exposes get_newsletter_brief with correct schema", () => {
  assert.equal(NEWSLETTER_TOOLS.length, 1);
  const tool = NEWSLETTER_TOOLS[0];
  assert.equal(tool.name, "get_newsletter_brief");
  assert.equal(tool.input_schema.required.includes("author_slug"), true);
  assert.equal(tool.input_schema.required.includes("section"), true);
});

test("get_newsletter_brief returns brief for Sagar hypothesis", async () => {
  const result = await executeNewsletterTool(
    "get_newsletter_brief",
    {
      author_slug: "sagar-tiwari",
      section: "hypothesis",
      platform: "newsletter",
    },
    { tenant: null },
  );
  assert.equal(result.ok, true);
  assert.match(result.doctrine, /SHIRLEY'S 4 RULES/);
  assert.equal(result.section_template.word_count_min, 300);
  assert.equal(result.author_voice.author_slug, "sagar-tiwari");
  assert.match(result.assembled_prompt, /scene-first/i);
  assert.match(result.next_step, /Draft the section/);
});

test("get_newsletter_brief flags missing voice profile in next_step", async () => {
  const result = await executeNewsletterTool(
    "get_newsletter_brief",
    { author_slug: "caleb-newton", section: "hypothesis" },
    { tenant: null },
  );
  assert.equal(result.ok, true);
  assert.equal(result.author_voice, null);
  assert.match(result.next_step, /No voice profile registered/i);
});

test("get_newsletter_brief rejects unknown section", async () => {
  const result = await executeNewsletterTool(
    "get_newsletter_brief",
    { author_slug: "sagar-tiwari", section: "made_up" },
    { tenant: null },
  );
  assert.ok(result.error);
  assert.ok(Array.isArray(result.supported_sections));
});

test("get_newsletter_brief rejects missing author_slug", async () => {
  const result = await executeNewsletterTool(
    "get_newsletter_brief",
    { section: "hypothesis" },
    { tenant: null },
  );
  assert.ok(result.error);
});
