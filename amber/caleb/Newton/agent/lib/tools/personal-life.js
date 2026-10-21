/**
 * personal-life.js — agent-side wrappers for amber-id's /v1/personal/* routes.
 *
 * Companion to Tab 8 (medha-id PR #103) which shipped:
 *   POST /v1/personal/brand-decision
 *   POST /v1/personal/teammate-pursuit
 *   POST /v1/personal/journal
 *   POST /v1/personal/search
 *
 * Tab 8 landed the storage layer but no agent tools called it, so Medha's
 * first end-to-end self-test answered "no track_brand_decision tool wired
 * yet" for two of the writes (#19 newsletter name, #20 Shirley's
 * photography). This file closes that gap.
 *
 * Sagar's canonical prompts this unblocks:
 *
 *   "rytual's newsletter should be called the rave. rave means realizing
 *    alternate versions of earth. see what ideas come from that"
 *   "I want to know all about shirley/alinna/emily's own creative pursuits
 *    and how I can best support them"
 *   "[Medha is] the canvas upon which I yap about creative conversations I
 *    have with the girls, kind of like my journal"
 *
 * Tools exposed to Claude:
 *   track_brand_decision   — long-lived brand calls (Rytual newsletter name, etc)
 *   track_teammate_pursuit — what Shirley/Alinna/Emily are working on personally
 *   add_journal_entry      — Sagar yapping about creative conversations
 *   recall_journal         — semantic recall over the personal-life corpus
 *                            (journal entries by default; can scope to
 *                            brand decisions or teammate pursuits too)
 *
 * Auth: service x-api-key + x-amber-phone (no Privy JWT needed in the
 * agent backend). Tenant phone is sourced from ctx.tenant.phoneNumber.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { registerCapability } from "../capabilities.js";
import { loadAuthorVoice } from "../writing/author-voices.js";
import { humanize } from "../voice-guard.js";

registerCapability("_tools_PersonalLife", [
  "Record brand identity decisions (track_brand_decision)",
  "Track teammates' personal creative pursuits (track_teammate_pursuit)",
  "Journal creative conversations as the user yaps (add_journal_entry)",
  "Recall past journal entries / brand decisions / teammate pursuits by semantic query (recall_journal)",
  "Recall everything on file about a person (recall_person)",
  "Capture an author's writing voice (track_author_voice)",
  "Recall a stored author voice profile (recall_author_voice)",
  "Ghost-write in an author's voice from a brief (draft_in_author_voice)",
]);

const BRANDS = ["rytual", "bma", "medha", "togari", "amber"];
const PURSUIT_KINDS = [
  "art",
  "music",
  "writing",
  "fitness",
  "business",
  "other",
];
const PURSUIT_STATUSES = ["active", "dormant", "shipped"];
const DIMENSIONS = [
  "social",
  "spiritual",
  "emotional",
  "physical",
  "financial",
  "intellectual",
];
const PERSONAL_LIFE_KINDS = [
  "journal_entry",
  "brand_decision",
  "teammate_pursuit",
];
const DEFAULT_RECALL_TOP_K = 8;
const MAX_RECALL_TOP_K = 25;

const AUTHOR_ORGS = ["bma", "rytual", "personal", "amber"];
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DRAFT_MODEL_DEFAULT = "claude-sonnet-4-6";
const DRAFT_TIMEOUT_MS = 30_000;
const DRAFT_MAX_TOKENS = 2048;

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantPhone(tenant) {
  return tenant?.phoneNumber || tenant?.phone || null;
}

function notConfiguredError() {
  return {
    error: "amber_id_not_configured",
    message:
      "amber-id is not configured for this environment (AMBER_ID_API_URL / AMBER_ID_API_KEY missing). Cannot persist personal-life objects.",
  };
}

function noPhoneError() {
  return {
    error: "tenant_phone_missing",
    message:
      "Tenant phoneNumber is required to call amber-id /v1/personal/* but was not present on the resolved tenant.",
  };
}

async function callAmberId(method, path, { phone, body } = {}) {
  const url = `${AMBER_ID_API_URL}${path}`;
  const headers = {
    "x-api-key": AMBER_ID_API_KEY,
    "x-amber-phone": phone,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `network: ${err?.message || err}`,
    };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: json,
      error:
        json?.error ||
        json?.message ||
        `amber-id ${path} returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: json };
}

// ── track_brand_decision ─────────────────────────────────────────────────────

async function handleTrackBrandDecision(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const body = {
    brand: input.brand,
    key: input.key,
    value: input.value,
    ...(input.rationale ? { rationale: input.rationale } : {}),
    ...(input.decided_at ? { decided_at: input.decided_at } : {}),
    ...(Array.isArray(input.decided_with) && input.decided_with.length > 0
      ? { decided_with: input.decided_with }
      : {}),
  };
  const r = await callAmberId("POST", "/v1/personal/brand-decision", {
    phone,
    body,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  return { success: true, brand_decision: r.data };
}

// ── track_teammate_pursuit ───────────────────────────────────────────────────

async function handleTrackTeammatePursuit(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const body = {
    teammate_name: input.teammate_name,
    pursuit_name: input.pursuit_name,
    ...(input.contact_handle ? { contact_handle: input.contact_handle } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.last_mentioned_at
      ? { last_mentioned_at: input.last_mentioned_at }
      : {}),
  };
  const r = await callAmberId("POST", "/v1/personal/teammate-pursuit", {
    phone,
    body,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  return { success: true, teammate_pursuit: r.data };
}

// ── add_journal_entry ────────────────────────────────────────────────────────

async function handleAddJournalEntry(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const body = {
    topic: input.topic,
    body: input.body,
    ...(input.written_at ? { written_at: input.written_at } : {}),
    ...(Array.isArray(input.with) && input.with.length > 0
      ? { with: input.with }
      : {}),
    ...(input.dimension ? { dimension: input.dimension } : {}),
  };
  const r = await callAmberId("POST", "/v1/personal/journal", {
    phone,
    body,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  return { success: true, journal_entry: r.data };
}

// ── recall_journal ───────────────────────────────────────────────────────────

function clampTopK(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RECALL_TOP_K;
  return Math.min(Math.max(Math.floor(n), 1), MAX_RECALL_TOP_K);
}

async function handleRecallJournal(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const query = String(input?.query || "").trim();
  if (!query) {
    return {
      error: "query_required",
      message: "recall_journal needs a non-empty `query` string.",
    };
  }
  const kind = PERSONAL_LIFE_KINDS.includes(input?.kind)
    ? input.kind
    : "journal_entry";
  const body = {
    query: query.slice(0, 2000),
    kind,
    topK: clampTopK(input?.topK),
  };
  const r = await callAmberId("POST", "/v1/personal/search", { phone, body });
  if (!r.ok) return { error: r.error, status: r.status };
  const matches = Array.isArray(r.data?.matches) ? r.data.matches : [];
  return {
    success: true,
    kind,
    query: body.query,
    count: matches.length,
    matches,
  };
}

// ── recall_person ────────────────────────────────────────────────────────────

async function handleRecallPerson(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const body = {
    name: input.name,
    ...(Number.isInteger(input.lookback_days)
      ? { lookback_days: input.lookback_days }
      : {}),
    ...(Number.isInteger(input.journal_limit)
      ? { journal_limit: input.journal_limit }
      : {}),
    ...(Number.isInteger(input.pursuit_limit)
      ? { pursuit_limit: input.pursuit_limit }
      : {}),
  };
  const r = await callAmberId("POST", "/v1/personal/recall-person", {
    phone,
    body,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  // Pass through the structured response. The model can format it for
  // the user; nothing here should fabricate when found === false.
  return {
    success: true,
    found: r.data?.found ?? false,
    query: r.data?.query || { name: input.name },
    matched_contacts: r.data?.matched_contacts || [],
    pursuits: r.data?.pursuits || [],
    journal_entries: r.data?.journal_entries || [],
  };
}

// ── track_author_voice ───────────────────────────────────────────────────────

async function handleTrackAuthorVoice(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  const body = {
    display_name: input.display_name,
    ...(input.author_slug ? { author_slug: input.author_slug } : {}),
    ...(input.role_at_org ? { role_at_org: input.role_at_org } : {}),
    ...(input.org ? { org: input.org } : {}),
    ...(input.voice_tells ? { voice_tells: input.voice_tells } : {}),
    ...(Array.isArray(input.what_they_dont_say)
      ? { what_they_dont_say: input.what_they_dont_say }
      : {}),
    ...(Array.isArray(input.sample_pieces)
      ? { sample_pieces: input.sample_pieces }
      : {}),
    ...(input.substack_handle
      ? { substack_handle: input.substack_handle }
      : {}),
    ...(input.linkedin_handle
      ? { linkedin_handle: input.linkedin_handle }
      : {}),
  };
  const r = await callAmberId("POST", "/v1/personal/author-voice", {
    phone,
    body,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  return { success: true, author_voice: r.data?.author_voice || r.data };
}

// ── recall_author_voice ──────────────────────────────────────────────────────

async function handleRecallAuthorVoice(input, ctx) {
  const phone = tenantPhone(ctx.tenant);
  const slug = String(input?.author_slug || input?.display_name || "").trim();
  if (!slug) {
    return {
      error: "author_slug_required",
      message:
        "recall_author_voice needs an `author_slug` (e.g. 'sagar-tiwari').",
    };
  }
  const profile = await loadAuthorVoice({ phone, authorSlug: slug });
  if (!profile) {
    return {
      success: true,
      found: false,
      author_slug: slug,
      message:
        "No voice profile on file for this author. Capture one with track_author_voice and Medha can ghost-write from there.",
    };
  }
  return {
    success: true,
    found: true,
    source: profile.source || "firestore",
    author_voice: profile,
  };
}

// ── draft_in_author_voice ────────────────────────────────────────────────────

function buildAuthorVoicePromptBlock(profile) {
  const tells = profile.voice_tells || {};
  const lines = [
    `AUTHOR: ${profile.display_name}${profile.role_at_org ? ` (${profile.role_at_org})` : ""}.`,
    profile.org ? `ORG CONTEXT: ${profile.org}.` : null,
    tells.sentence_rhythm ? `SENTENCE RHYTHM: ${tells.sentence_rhythm}.` : null,
    tells.vocabulary_tells
      ? `VOCABULARY TELLS: ${tells.vocabulary_tells}.`
      : null,
    tells.opener_patterns ? `OPENER PATTERNS: ${tells.opener_patterns}` : null,
    tells.closer_patterns ? `CLOSER PATTERNS: ${tells.closer_patterns}` : null,
    Array.isArray(tells.signature_phrases) && tells.signature_phrases.length
      ? `SIGNATURE PHRASES: ${tells.signature_phrases.join(", ")}.`
      : null,
    Array.isArray(tells.jargon_blacklist) && tells.jargon_blacklist.length
      ? `NEVER USE: ${tells.jargon_blacklist.join(", ")}.`
      : null,
    Array.isArray(profile.what_they_dont_say) &&
    profile.what_they_dont_say.length
      ? `NEVER WRITES PHRASES LIKE: ${profile.what_they_dont_say.join(" / ")}.`
      : null,
  ].filter(Boolean);
  return lines.join("\n");
}

const SHIRLEY_WRITING_DOCTRINE = [
  "SHIRLEY'S 4 RULES (editorial review 2026-05-27, apply to every long-form piece):",
  "1. Write from the author's perspective. First person, in their voice. Not Medha's voice.",
  "2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one.",
  "3. If a story can't land fully, cut it. Never half-tell it.",
  "4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued.",
].join("\n");

async function callClaudeForDraft({ system, userPrompt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "anthropic_api_key_missing",
      message:
        "ANTHROPIC_API_KEY is not set on this service. draft_in_author_voice needs it to call Claude.",
    };
  }
  const model = process.env.ANTHROPIC_DRAFT_MODEL || DRAFT_MODEL_DEFAULT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
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
        max_tokens: DRAFT_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `claude_${res.status}`,
        message: text.slice(0, 400),
      };
    }
    const data = await res.json();
    const text = (data?.content || [])
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) {
      return { ok: false, error: "empty_completion" };
    }
    return { ok: true, text, model };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      error: "claude_call_failed",
      message: e?.message || String(e),
    };
  }
}

async function handleDraftInAuthorVoice(input, ctx) {
  const phone = tenantPhone(ctx.tenant);
  const slug = String(input?.author_slug || "").trim();
  if (!slug) {
    return {
      error: "author_slug_required",
      message:
        "draft_in_author_voice needs `author_slug`. Use recall_author_voice first if you're unsure.",
    };
  }
  const source = String(
    input?.source_brief || input?.source_draft || "",
  ).trim();
  if (!source) {
    return {
      error: "source_required",
      message:
        "Pass either `source_brief` (notes / transcript to write from) or `source_draft` (existing draft to rewrite).",
    };
  }
  const profile = await loadAuthorVoice({ phone, authorSlug: slug });
  if (!profile) {
    return {
      error: "author_voice_not_found",
      message: `No voice profile on file for '${slug}'. Capture one with track_author_voice first.`,
    };
  }

  const voiceBlock = buildAuthorVoicePromptBlock(profile);
  const lengthHint = input?.length
    ? String(input.length).slice(0, 80)
    : "around 300-400 words";
  const formatHint = input?.format
    ? String(input.format).slice(0, 80)
    : "newsletter section";

  const system = [
    SHIRLEY_WRITING_DOCTRINE,
    "",
    voiceBlock,
    "",
    `TARGET LENGTH: ${lengthHint}.`,
    `TARGET FORMAT: ${formatHint}.`,
    "",
    "After the draft, on a new line, write 'WHAT I CUT AND WHY:' followed by a short list of stories or paragraphs you removed under Rule 3, and why each cut serves the piece. If you cut nothing, write 'WHAT I CUT AND WHY: nothing — every story landed fully.'",
  ].join("\n");

  const userPrompt = input?.source_draft
    ? `Rewrite the following draft in the author's voice while obeying Shirley's 4 rules. Keep the argument; change the voice, structure, and any half-told stories.\n\nDRAFT:\n${source}`
    : `Write a first-person piece in the author's voice from the brief below. Obey Shirley's 4 rules.\n\nBRIEF:\n${source}`;

  const result = await callClaudeForDraft({ system, userPrompt });
  if (!result.ok) {
    return {
      error: result.error,
      message: result.message || "Claude draft call failed.",
    };
  }

  const raw = result.text;
  const cutMarker = /\bWHAT I CUT AND WHY:\s*/i;
  let draft = raw;
  let cutNotes = null;
  const match = raw.split(cutMarker);
  if (match.length >= 2) {
    draft = match[0].trim();
    cutNotes = match.slice(1).join("WHAT I CUT AND WHY:").trim();
  }

  // Voice-guard: strip botty filler + em-dashes from the draft itself.
  // The "what I cut" trailer is editorial commentary, leave it alone.
  const cleanedDraft = humanize(draft);

  return {
    success: true,
    author_slug: profile.author_slug || slug,
    source_kind: profile.source || "firestore",
    model: result.model,
    draft: cleanedDraft,
    cut_notes: cutNotes,
  };
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const PERSONAL_LIFE_TOOLS = [
  {
    name: "track_brand_decision",
    description:
      "Record a long-lived brand identity decision (e.g. 'rytual newsletter name = the rave', tagline pick, voice rule). Use when the user makes or recalls a deliberate brand call. Pair value + rationale so the WHY survives.",
    input_schema: {
      type: "object",
      required: ["brand", "key", "value"],
      properties: {
        brand: {
          type: "string",
          enum: BRANDS,
          description: "Which brand the decision belongs to.",
        },
        key: {
          type: "string",
          description:
            "The decision field, e.g. 'newsletter_name', 'tagline', 'voice', 'primary_color'.",
        },
        value: {
          type: "string",
          description: "The decision value, e.g. 'the rave'.",
        },
        rationale: {
          type: "string",
          description:
            "Why the decision was made — capture the meaning. e.g. 'realizing alternate versions of earth'.",
        },
        decided_at: {
          type: "string",
          description: "When it was decided. ISO 8601 if known.",
        },
        decided_with: {
          type: "array",
          items: { type: "string" },
          description:
            "Names of collaborators if the call was made with others.",
        },
      },
    },
  },
  {
    name: "track_teammate_pursuit",
    description:
      "Track a teammate's personal creative pursuit (Shirley's photography, Alinna's writing, etc) so the user can support it. Different from their professional work for BMA / Rytual; this is what they're doing for themselves.",
    input_schema: {
      type: "object",
      required: ["teammate_name", "pursuit_name"],
      properties: {
        teammate_name: { type: "string", description: "e.g. 'Shirley Park'." },
        pursuit_name: {
          type: "string",
          description: "Short label, e.g. 'photography practice'.",
        },
        contact_handle: {
          type: "string",
          description: "Optional Slack handle, email, or phone.",
        },
        kind: {
          type: "string",
          enum: PURSUIT_KINDS,
          description: "Category of pursuit.",
        },
        status: {
          type: "string",
          enum: PURSUIT_STATUSES,
          description: "Current state.",
        },
        notes: { type: "string", description: "Free-text context." },
        last_mentioned_at: {
          type: "string",
          description: "ISO 8601 of when it came up.",
        },
      },
    },
  },
  {
    name: "add_journal_entry",
    description:
      "Add a journal entry. Sagar uses Medha as the canvas to yap about creative conversations with the team. Capture what was discussed, with whom, and tag a dimension when one fits. Body is freeform — no structure required.",
    input_schema: {
      type: "object",
      required: ["topic", "body"],
      properties: {
        topic: { type: "string", description: "One-line topic." },
        body: {
          type: "string",
          description: "Freeform notes. Up to 16k chars.",
        },
        written_at: {
          type: "string",
          description: "ISO 8601 of when the conversation happened.",
        },
        with: {
          type: "array",
          items: { type: "string" },
          description: "Names of people in the conversation.",
        },
        dimension: {
          type: "string",
          enum: DIMENSIONS,
          description: "Which of the six dimensions the entry maps to.",
        },
      },
    },
  },
  {
    name: "recall_journal",
    description:
      "Recall past personal-life entries by semantic similarity. Defaults to journal entries (kind='journal_entry') so questions like 'what have I been thinking about lately?' or 'remind me what I said about Shirley's photography project' find prior reflections. Use kind='brand_decision' or kind='teammate_pursuit' to scope to those types instead. Returns matches with their stored content; the agent should weave the relevant ones into its reply rather than dumping the raw list.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of what to remember. e.g. 'creative conversations with Shirley about photography', 'the rave newsletter idea', 'how Alinna is feeling about writing'.",
        },
        kind: {
          type: "string",
          enum: PERSONAL_LIFE_KINDS,
          description:
            "Which personal-life kind to search. Defaults to journal_entry.",
        },
        topK: {
          type: "integer",
          minimum: 1,
          maximum: MAX_RECALL_TOP_K,
          description: `How many matches to return. Defaults to ${DEFAULT_RECALL_TOP_K}.`,
        },
      },
    },
  },
  {
    name: "recall_person",
    description:
      "Look up everything Medha knows about a specific person in the user's life. Returns: address-book contact info, their tracked creative pursuits (photography, writing, music, etc), and recent journal entries that mention them (both explicit `with` tags and inline body mentions). Use this BEFORE answering 'what is X working on?', 'tell me about Y', or 'what have I been talking about with Z'. When `found` is false, respond honestly that there's nothing on file yet and ask the user to share — never fabricate context.",
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description:
            "First name or full name of the person. The first whitespace-token is used for matching (e.g. 'Shirley' from 'Shirley Park').",
        },
        lookback_days: {
          type: "integer",
          description:
            "How far back to scan journal entries for mentions. Default 30.",
        },
        journal_limit: {
          type: "integer",
          description: "Max journal entries to return. Default 10.",
        },
        pursuit_limit: {
          type: "integer",
          description: "Max pursuits to return. Default 20.",
        },
      },
    },
  },
  {
    name: "track_author_voice",
    description:
      "Capture an author's writing voice so Medha can ghost-write for them. Use when the user says something like 'track Sagar's voice — here are 3 of his pieces' or 'remember Shirley writes like X'. Stores voice tells (sentence rhythm, openers, closers, jargon to avoid), what the author would never say, and sample pieces. The slug is derived from display_name when not supplied. Re-posting the same author overwrites the previous profile.",
    input_schema: {
      type: "object",
      required: ["display_name"],
      properties: {
        author_slug: {
          type: "string",
          description:
            "Optional. Lowercase-hyphenated stable id (e.g. 'sagar-tiwari'). Derived from display_name if omitted.",
        },
        display_name: {
          type: "string",
          description: "Full name as the author signs their work.",
        },
        role_at_org: {
          type: "string",
          description:
            "e.g. 'BMA partner', 'Rytual founder'. Helps frame voice.",
        },
        org: {
          type: "string",
          enum: AUTHOR_ORGS,
          description: "Which org context the author belongs to.",
        },
        voice_tells: {
          type: "object",
          description:
            "Concrete patterns from the author's writing. Strings for sentence_rhythm / vocabulary_tells / opener_patterns / closer_patterns; arrays for signature_phrases / jargon_blacklist.",
          properties: {
            sentence_rhythm: { type: "string" },
            vocabulary_tells: { type: "string" },
            opener_patterns: { type: "string" },
            closer_patterns: { type: "string" },
            signature_phrases: {
              type: "array",
              items: { type: "string" },
            },
            jargon_blacklist: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        what_they_dont_say: {
          type: "array",
          items: { type: "string" },
          description:
            "Phrases the author never writes. e.g. 'I think maybe', 'in today's fast-paced world'.",
        },
        sample_pieces: {
          type: "array",
          description:
            "Reference pieces. Each {title, url?, body?}. Up to 10. Body is optional; if pasted, max 16k chars.",
          items: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              body: { type: "string" },
            },
          },
        },
        substack_handle: { type: "string" },
        linkedin_handle: { type: "string" },
      },
    },
  },
  {
    name: "recall_author_voice",
    description:
      "Look up a stored author voice profile by slug. Use this BEFORE draft_in_author_voice if you're not sure whether the author has a profile yet. Returns `found: false` when nothing is on file — do NOT fabricate voice details in that case; ask the user to capture one with track_author_voice instead. When found, also returns the source ('firestore' for the real captured profile or 'bundled_seed' for the default).",
    input_schema: {
      type: "object",
      required: ["author_slug"],
      properties: {
        author_slug: {
          type: "string",
          description:
            "Slug or display name to look up. e.g. 'sagar-tiwari' or 'Sagar Tiwari'.",
        },
      },
    },
  },
  {
    name: "draft_in_author_voice",
    description:
      "Ghost-write a long-form piece in the author's first-person voice from a brief or by rewriting an existing draft. Always runs through Shirley's 4 rules (stand-alone, general audience, first-person, cut any half-told story). Pass either `source_brief` (raw notes / transcript) OR `source_draft` (existing copy to rewrite). The tool loads the author's voice profile, calls Claude Sonnet 4.6 with doctrine + voice + source, then strips botty filler. Returns the polished draft and a 'what I cut and why' trailer. Use when the user says 'draft Sagar's hypothesis section from these notes' or 'rewrite this in Shirley's voice'.",
    input_schema: {
      type: "object",
      required: ["author_slug"],
      properties: {
        author_slug: {
          type: "string",
          description:
            "Slug of the author whose voice to use. e.g. 'sagar-tiwari'.",
        },
        source_brief: {
          type: "string",
          description:
            "Raw notes, transcript, or talking points to write from. Either this or source_draft is required.",
        },
        source_draft: {
          type: "string",
          description:
            "Existing draft to rewrite in the author's voice. Either this or source_brief is required.",
        },
        length: {
          type: "string",
          description:
            "Free-text target length. e.g. '300-400 words' or 'one-liner'. Defaults to '300-400 words'.",
        },
        format: {
          type: "string",
          description:
            "Free-text target format. e.g. 'newsletter section', 'LinkedIn post', 'Substack essay'. Defaults to 'newsletter section'.",
        },
      },
    },
  },
];

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executePersonalLifeTool(toolName, input, ctx) {
  console.log(`[personal-life] ${toolName}`);
  try {
    switch (toolName) {
      case "track_brand_decision":
        return await handleTrackBrandDecision(input, ctx);
      case "track_teammate_pursuit":
        return await handleTrackTeammatePursuit(input, ctx);
      case "add_journal_entry":
        return await handleAddJournalEntry(input, ctx);
      case "recall_journal":
        return await handleRecallJournal(input, ctx);
      case "recall_person":
        return await handleRecallPerson(input, ctx);
      case "track_author_voice":
        return await handleTrackAuthorVoice(input, ctx);
      case "recall_author_voice":
        return await handleRecallAuthorVoice(input, ctx);
      case "draft_in_author_voice":
        return await handleDraftInAuthorVoice(input, ctx);
      default:
        return { error: `Unknown personal-life tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[personal-life] ${toolName} failed:`, err?.message);
    return { error: err?.message || "personal-life-tool-error" };
  }
}
