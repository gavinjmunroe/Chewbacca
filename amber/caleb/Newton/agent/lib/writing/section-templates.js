/**
 * writing/section-templates.js — hardcoded BMA newsletter section configs.
 *
 * Newsletter sections (per Emily, owner): Stories We're Watching, The Hypothesis,
 * Talking in Tables. Cadence is Tuesdays 9am PT. First issue 2026-06-02.
 *
 * Word counts and structure derived from Sagar's "Ignoring the Hype" draft #2
 * (the version that survived Shirley's edit) and Emily's published structure.
 *
 * Promote to Firestore in Tab 11 once author voice models land.
 */

export const BMA_SECTIONS = {
  hypothesis: {
    slug: "hypothesis",
    display_name: "The Hypothesis",
    word_count_min: 300,
    word_count_max: 400,
    structure:
      "hook (scene or specific moment) -> idea (the contrarian read) -> bet (what you're personally doing about it)",
    default_tone: "first-person, confident, no hedging",
    platform_tone: {
      newsletter: "professional polished, conviction up front, no jargon",
      substack: "open-ended narrative, scene-first, longer paragraphs",
      linkedin: "tighter cadence, one sentence per line, easier to scan",
    },
    reference_sample:
      "Sagar Tiwari, 'Ignoring the Hype Is Its Own Kind of Edge', 2026-05-27 draft #2",
  },
  stories_watching: {
    slug: "stories_watching",
    display_name: "Stories We're Watching",
    word_count_min: 250,
    word_count_max: 350,
    structure:
      "3 hits, each ~80-110 words, takeaway up front per hit, then the why-it-matters line",
    default_tone: "editorial-brief cadence, plain language, no hype",
    platform_tone: {
      newsletter: "tight, scannable, no filler between hits",
      substack: "slightly longer takeaway per hit",
      linkedin: "single hit pulled out, expanded into one post",
    },
    reference_sample: null,
  },
  talking_tables: {
    slug: "talking_tables",
    display_name: "Talking in Tables",
    word_count_min: 200,
    word_count_max: 300,
    structure:
      "BMA update or internal data point first, then adjacent commentary on what it means for the broader market",
    default_tone: "specific, numerical where possible, no platitudes",
    platform_tone: {
      newsletter: "data-led, paragraph cadence, sourced",
      substack: "more storytelling around the numbers",
      linkedin: "lead with the table or stat, one-line takeaway",
    },
    reference_sample: null,
  },
};

/**
 * Look up a section template for the given org + section.
 * Returns null if unknown so callers can degrade gracefully.
 */
export function getSectionTemplate(
  orgKey,
  newsletterKey,
  sectionKey,
  platform,
) {
  const orgs = { bma: BMA_SECTIONS };
  const org = orgs[orgKey];
  if (!org) return null;
  const section = org[sectionKey];
  if (!section) return null;
  if (!platform) return section;
  const tone =
    (section.platform_tone && section.platform_tone[platform]) ||
    section.default_tone;
  return { ...section, resolved_tone: tone, platform };
}
