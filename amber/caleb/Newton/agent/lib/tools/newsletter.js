/**
 * newsletter.js — `get_newsletter_brief` agent tool.
 *
 * Returns the section template, author voice profile, reference samples, and
 * Shirley's 4 rules for a newsletter section before the model drafts. The
 * model should call this BEFORE attempting any newsletter writing so its
 * draft is shape-correct (word count, structure, tone) on the first pass.
 */

import {
  getSectionTemplate,
  getAuthorVoice,
  assembleNewsletterPrompt,
  SHIRLEY_RULES,
} from "../writing/index.js";

const SUPPORTED_SECTIONS = ["hypothesis", "stories_watching", "talking_tables"];

export const NEWSLETTER_TOOLS = [
  {
    name: "get_newsletter_brief",
    description:
      "Return the section template, author voice profile, reference samples, and Shirley's 4 rules for a BMA newsletter section. Call this BEFORE drafting any newsletter section. Returns word count target, structure, platform-specific tone, and the author's voice tells so the first draft hits shape without iteration.",
    input_schema: {
      type: "object",
      properties: {
        author_slug: {
          type: "string",
          description:
            "Author identifier in lowercase-hyphenated form, e.g. 'sagar-tiwari', 'caleb-newton'. The author whose voice the draft should match.",
        },
        section: {
          type: "string",
          enum: SUPPORTED_SECTIONS,
          description:
            "Newsletter section. 'hypothesis' = The Hypothesis (300-400 words). 'stories_watching' = Stories We're Watching (250-350). 'talking_tables' = Talking in Tables (200-300).",
        },
        platform: {
          type: "string",
          enum: ["newsletter", "substack", "linkedin"],
          description:
            "Target platform. Adjusts tone modifier. Defaults to 'newsletter'.",
        },
        org: {
          type: "string",
          enum: ["bma"],
          description:
            "Organization owning the newsletter. Currently only 'bma' is configured. Defaults to 'bma'.",
        },
      },
      required: ["author_slug", "section"],
    },
  },
];

export async function executeNewsletterTool(name, input, ctx) {
  if (name !== "get_newsletter_brief") {
    return { error: `unknown newsletter tool: ${name}` };
  }
  const author_slug = String(input?.author_slug || "").toLowerCase();
  const section = String(input?.section || "").toLowerCase();
  const platform = String(input?.platform || "newsletter").toLowerCase();
  const org = String(input?.org || "bma").toLowerCase();

  if (!author_slug) {
    return {
      error:
        "author_slug is required. Use the lowercase-hyphenated form, e.g. 'sagar-tiwari'.",
    };
  }
  if (!SUPPORTED_SECTIONS.includes(section)) {
    return {
      error: `section must be one of: ${SUPPORTED_SECTIONS.join(", ")}.`,
      supported_sections: SUPPORTED_SECTIONS,
    };
  }

  const section_template = getSectionTemplate(
    org,
    "default",
    section,
    platform,
  );
  if (!section_template) {
    return {
      error: `no section template registered for org='${org}', section='${section}'.`,
    };
  }

  const author_voice = getAuthorVoice(ctx?.tenant, author_slug);
  const reference_samples = section_template.reference_sample
    ? [section_template.reference_sample]
    : [];

  return {
    ok: true,
    doctrine: SHIRLEY_RULES,
    section_template,
    author_voice,
    reference_samples,
    assembled_prompt: assembleNewsletterPrompt({
      section_template,
      author_voice,
      reference_samples,
      platform,
    }),
    next_step: author_voice
      ? "Draft the section now. Follow the 4 rules and match the author's voice tells exactly."
      : `No voice profile registered for '${author_slug}'. Ask the user for 2-3 representative samples (link or paste) before drafting.`,
  };
}
