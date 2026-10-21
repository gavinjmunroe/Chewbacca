/**
 * newsletter-editor.js — `edit_for_newsletter` tool.
 *
 * Tab 12 of the 2026-05-28 Medha parallel-tabs dispatch.
 *
 * Flow: draft (Sonnet 4.6) -> critique (Haiku 4.5, scores against Shirley's
 * 4 rules) -> revise (Sonnet 4.6) up to 2 times. Catches the same failure
 * mode Caleb caught manually on Sagar's "Ignoring the Hype" piece (rule 2
 * violation: assumed BMA-insider context, half-told Juan story).
 *
 * Pattern: mirrors `tools/content-loop.js` `callClaudeForIdeas` — direct
 * Anthropic REST, AbortController + 25s timeout, JSON-match-and-parse
 * fallback. No SDK dependency on the agent's preferred surface.
 */

import {
  SHIRLEY_RULES,
  CRITIQUE_RUBRIC,
  MIN_PASS_SCORE,
  MAX_REVISIONS,
  DRAFT_SYSTEM_PROMPT_TEMPLATE,
  REVISION_PROMPT_TEMPLATE,
  critiquePasses,
} from "../doctrine/newsletter.js";
import { loadVoiceCard } from "../doctrine/voices/index.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DRAFT_MODEL =
  process.env.NEWSLETTER_DRAFT_MODEL ||
  process.env.CLAUDE_MODEL ||
  "claude-sonnet-4-6";
const CRITIQUE_MODEL =
  process.env.NEWSLETTER_CRITIQUE_MODEL ||
  process.env.ANTHROPIC_FAST_MODEL ||
  "claude-haiku-4-5-20251001";
const CALL_TIMEOUT_MS = Number(
  process.env.NEWSLETTER_EDITOR_TIMEOUT_MS || 25_000,
);

export const NEWSLETTER_EDITOR_TOOLS = [
  {
    name: "edit_for_newsletter",
    description:
      "Ghost-write a newsletter-grade long-form piece for a named author. " +
      "Runs draft -> hostile-stranger critique against Shirley's 4 rules -> " +
      "revise loop (up to 2 revisions). Use this for ANY long-form ghost-" +
      "writing (newsletter sections, essays, opinion posts, LinkedIn long-" +
      "form) when the author is known. Pass source as the raw notes, " +
      "transcript, or rough draft; the tool returns the final piece plus " +
      "the critique log so you can show your work if the user asks.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "Raw material to base the piece on: notes, transcript, an " +
            "earlier draft, or a brief. Required.",
        },
        author_slug: {
          type: "string",
          description:
            "Lowercase-hyphenated author slug, e.g. 'sagar-tiwari'. The " +
            "voice card is loaded from Firestore (Tab 11) or the bundled " +
            "doctrine/voices/<slug>.md.",
        },
        target_word_count: {
          type: "number",
          description:
            "Optional. Hard cap on word count. Defaults: hypothesis 400, " +
            "stories_watching 350, talking_tables 300, linkedin_post 300, " +
            "twitter_thread 240. Unknown sections default to 400.",
        },
        format: {
          type: "string",
          enum: ["newsletter", "linkedin", "twitter", "blog", "essay", "memo"],
          description:
            "Optional. Format tag drives tone. Defaults to 'newsletter'.",
        },
      },
      required: ["source", "author_slug"],
    },
  },
];

const NEWSLETTER_EDITOR_TOOL_NAMES = new Set(
  NEWSLETTER_EDITOR_TOOLS.map((t) => t.name),
);

/**
 * Dispatcher entry point. Routes by exact tool name.
 */
export async function executeNewsletterEditorTool(name, input, ctx = {}) {
  if (!NEWSLETTER_EDITOR_TOOL_NAMES.has(name)) {
    return { error: `Unknown newsletter-editor tool: ${name}` };
  }
  if (name === "edit_for_newsletter") {
    return editForNewsletter(input || {}, ctx);
  }
  return { error: `Unhandled tool: ${name}` };
}

async function editForNewsletter(input, ctx) {
  const source = String(input.source || "").trim();
  const authorSlug = String(input.author_slug || "").trim();
  const format = input.format || "newsletter";
  const targetWords =
    Number.isFinite(input.target_word_count) && input.target_word_count > 0
      ? Math.floor(input.target_word_count)
      : 400;

  if (!source) {
    return {
      error:
        "source is required. Paste the raw notes, transcript, or rough draft.",
    };
  }
  if (!authorSlug) {
    return {
      error:
        "author_slug is required (lowercase-hyphenated, e.g. 'sagar-tiwari').",
    };
  }

  let voiceCard;
  try {
    voiceCard = await loadVoiceCard(authorSlug, ctx);
  } catch (e) {
    return { error: e.message };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      error:
        "ANTHROPIC_API_KEY is not set on this service. Wire it via Railway " +
        "to enable edit_for_newsletter.",
    };
  }

  const critiqueLog = [];
  let draft = await callClaudeForDraft({
    source,
    voiceCard,
    targetWords,
    format,
    apiKey,
    callClaudeText: ctx?.callClaudeText,
  });
  if (draft.error) return { error: draft.error };

  let currentDraft = draft.text;

  for (let pass = 0; pass <= MAX_REVISIONS; pass++) {
    const critique = await callClaudeForCritique({
      draft: currentDraft,
      apiKey,
      callClaudeJson: ctx?.callClaudeJson,
    });
    critiqueLog.push({ pass: pass + 1, ...critique });

    if (critique.error) {
      return {
        final_draft: currentDraft,
        critique_log: critiqueLog,
        passes: false,
        note:
          `Critique pass ${pass + 1} failed: ${critique.error}. ` +
          "Returning best-available draft.",
      };
    }

    if (critiquePasses(critique)) {
      return {
        final_draft: currentDraft,
        critique_log: critiqueLog,
        passes: true,
        author_slug: authorSlug,
        format,
      };
    }

    if (pass === MAX_REVISIONS) {
      return {
        final_draft: currentDraft,
        critique_log: critiqueLog,
        passes: false,
        note:
          `Critique did not pass after ${MAX_REVISIONS} revisions ` +
          `(min ${MIN_PASS_SCORE} per dimension). Returning the best of ` +
          `${MAX_REVISIONS + 1} drafts. Review critique_log for what's still off.`,
        author_slug: authorSlug,
        format,
      };
    }

    const revised = await callClaudeForRevision({
      draft: currentDraft,
      critique,
      voiceCard,
      apiKey,
      callClaudeText: ctx?.callClaudeText,
    });
    if (revised.error) {
      return {
        final_draft: currentDraft,
        critique_log: critiqueLog,
        passes: false,
        note:
          `Revision pass ${pass + 1} failed: ${revised.error}. ` +
          "Returning the last good draft.",
      };
    }
    currentDraft = revised.text;
  }

  return {
    final_draft: currentDraft,
    critique_log: critiqueLog,
    passes: false,
    note: "Unreachable terminal: loop fell through.",
  };
}

async function callClaudeForDraft({
  source,
  voiceCard,
  targetWords,
  format,
  apiKey,
  callClaudeText,
}) {
  const system = DRAFT_SYSTEM_PROMPT_TEMPLATE({
    voiceCard,
    targetWords,
    format,
  });
  const user = ["SOURCE BRIEF / DRAFT:", "", source].join("\n");
  if (callClaudeText) {
    return callClaudeText({ system, user, model: DRAFT_MODEL });
  }
  return anthropicText({
    apiKey,
    model: DRAFT_MODEL,
    system,
    user,
    maxTokens: 2048,
  });
}

async function callClaudeForCritique({ draft, apiKey, callClaudeJson }) {
  const system = CRITIQUE_RUBRIC;
  const user = ["DRAFT TO CRITIQUE:", "", draft].join("\n");
  if (callClaudeJson) {
    return callClaudeJson({ system, user, model: CRITIQUE_MODEL });
  }
  return anthropicJson({
    apiKey,
    model: CRITIQUE_MODEL,
    system,
    user,
    maxTokens: 1536,
  });
}

async function callClaudeForRevision({
  draft,
  critique,
  voiceCard,
  apiKey,
  callClaudeText,
}) {
  const user = REVISION_PROMPT_TEMPLATE({
    draft,
    critiqueJson: critique,
    voiceCard,
  });
  const system = [
    "You revise drafts to meet a hostile-stranger editor's bar.",
    SHIRLEY_RULES,
  ].join("\n");
  if (callClaudeText) {
    return callClaudeText({ system, user, model: DRAFT_MODEL });
  }
  return anthropicText({
    apiKey,
    model: DRAFT_MODEL,
    system,
    user,
    maxTokens: 2048,
  });
}

/**
 * Text-out Anthropic call. Returns `{ text }` or `{ error }`.
 */
async function anthropicText({ apiKey, model, system, user, maxTokens }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        error: `Claude ${model} failed (${res.status}): ${body.slice(0, 240)}`,
      };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    if (!text) return { error: `Claude ${model} returned empty text.` };
    return { text: text.trim() };
  } catch (e) {
    clearTimeout(timer);
    return { error: `Claude ${model} call error: ${e.message}` };
  }
}

/**
 * JSON-out Anthropic call. Tries to parse the first {...} block from the
 * response. Returns the parsed object merged with the raw text, or `{ error }`.
 */
async function anthropicJson({ apiKey, model, system, user, maxTokens }) {
  const out = await anthropicText({ apiKey, model, system, user, maxTokens });
  if (out.error) return { error: out.error };
  const match = out.text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { error: `Claude ${model} returned no parseable JSON.` };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return parsed;
  } catch (e) {
    return { error: `Claude ${model} JSON parse failed: ${e.message}` };
  }
}
