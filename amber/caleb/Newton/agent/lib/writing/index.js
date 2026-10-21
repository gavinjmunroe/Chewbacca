/**
 * writing/index.js — public entry for newsletter section templates, author
 * voice profiles, and prompt assembly. Pure functions, no I/O. Safe to import
 * from tools, prompts, or tests.
 */

export { BMA_SECTIONS, getSectionTemplate } from "./section-templates.js";

export { AUTHOR_VOICES, getAuthorVoice } from "./author-voices.js";

export { SHIRLEY_RULES, assembleNewsletterPrompt } from "./doctrine.js";

import { getSectionTemplate } from "./section-templates.js";
import { getAuthorVoice } from "./author-voices.js";
import { assembleNewsletterPrompt, SHIRLEY_RULES } from "./doctrine.js";

/**
 * High-level convenience: build the full newsletter doctrine block given a
 * brief request. Returns null if no section template resolves so callers
 * can degrade rather than emit an empty block.
 */
export function buildNewsletterDoctrine({
  orgKey = "bma",
  newsletterKey = "default",
  sectionKey,
  platform = "newsletter",
  authorSlug,
  tenant,
  referenceSamples,
} = {}) {
  const section_template = getSectionTemplate(
    orgKey,
    newsletterKey,
    sectionKey,
    platform,
  );
  if (!section_template) return null;
  const author_voice = getAuthorVoice(tenant, authorSlug);
  return {
    doctrine: SHIRLEY_RULES,
    section_template,
    author_voice,
    reference_samples: referenceSamples || [],
    prompt: assembleNewsletterPrompt({
      section_template,
      author_voice,
      reference_samples: referenceSamples,
      platform,
    }),
  };
}
