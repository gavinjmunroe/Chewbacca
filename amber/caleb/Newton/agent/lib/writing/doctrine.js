/**
 * writing/doctrine.js — Shirley's 4 rules + prompt assembly for newsletter drafts.
 *
 * Sourced from Shirley Park's editorial review of Sagar Tiwari's "Ignoring the
 * Hype Is Its Own Kind of Edge" draft on 2026-05-27. These rules apply to
 * every long-form ghost-writing task regardless of org.
 *
 * NOTE on duplication with Tab 3: Tab 3 introduces writing-doctrines/bma.js
 * with the same 4 rules. Until Tab 3 merges, the canonical text lives here.
 * After Tab 3 lands, this file should re-export `BMA_WRITING_DOCTRINE` from
 * writing-doctrines/bma.js to avoid forking.
 */

export const SHIRLEY_RULES = `SHIRLEY'S 4 RULES (editorial review 2026-05-27):
1. Write from the author's perspective. First person, in their voice. Not Medha's voice.
2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one.
3. If a story can't land fully, cut it. Never half-tell it.
4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued.`;

/**
 * Build the per-section target block from a section template.
 */
function formatSectionBlock(section_template, platform) {
  if (!section_template) return "";
  const { word_count_min, word_count_max, structure, platform_tone } =
    section_template;
  const tone =
    (platform && platform_tone && platform_tone[platform]) ||
    section_template.default_tone ||
    "professional, clear, first-person";
  return [
    `SECTION TARGET:`,
    `- Word count: ${word_count_min}-${word_count_max} words.`,
    `- Structure: ${structure}.`,
    `- Tone for ${platform || "newsletter"}: ${tone}.`,
  ].join("\n");
}

/**
 * Build the per-author voice block from a voice profile.
 */
function formatVoiceBlock(author_voice) {
  if (!author_voice) {
    return `AUTHOR VOICE:\n- No voice profile registered yet. Ask the user for 2-3 representative samples before drafting.`;
  }
  const tells = author_voice.voice_tells || {};
  const blacklist = (tells.jargon_blacklist || []).join(", ");
  const dont = (author_voice.what_they_dont_say || []).join("; ");
  return [
    `AUTHOR VOICE (${author_voice.display_name || author_voice.author_slug || "author"}):`,
    tells.openers ? `- Openers: ${tells.openers}.` : "",
    tells.closers ? `- Closers: ${tells.closers}.` : "",
    tells.rhythm ? `- Rhythm: ${tells.rhythm}.` : "",
    blacklist ? `- Never use: ${blacklist}.` : "",
    dont ? `- Phrases this author does not say: ${dont}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatReferenceSamples(reference_samples) {
  if (!Array.isArray(reference_samples) || reference_samples.length === 0) {
    return "";
  }
  const blocks = reference_samples
    .map((sample, i) => `--- Reference sample ${i + 1} ---\n${sample}`)
    .join("\n\n");
  return `REFERENCE SAMPLES (match cadence, not topic):\n${blocks}`;
}

/**
 * Assemble the full newsletter draft prompt from a section template, voice
 * profile, optional reference samples, and the target platform.
 *
 * @param {object} opts
 * @param {object} opts.section_template
 * @param {object|null} opts.author_voice
 * @param {string[]} [opts.reference_samples]
 * @param {string} [opts.platform]
 */
export function assembleNewsletterPrompt({
  section_template,
  author_voice,
  reference_samples,
  platform,
} = {}) {
  const blocks = [
    SHIRLEY_RULES,
    formatSectionBlock(section_template, platform),
    formatVoiceBlock(author_voice),
    formatReferenceSamples(reference_samples),
  ].filter((b) => b && b.length > 0);
  return blocks.join("\n\n");
}
