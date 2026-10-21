/**
 * polish-draft.js — Tab 13: content seed Firestore object + polish pipeline.
 *
 * Two tools that turn raw newsletter/LinkedIn/Twitter material into clean
 * first-person drafts and write them to Drive so Alinna / Emily can grab
 * without copy-paste:
 *
 *   capture_content_seed   — typed Firestore capture in medha-id. Holds raw
 *                            text + author + org + intent. Returns seed_id.
 *   polish_content_seed    — runs the critique-and-revise loop (Tab 12's
 *                            edit_for_newsletter when present, direct
 *                            Anthropic fallback otherwise), writes the
 *                            polished result back to the seed, and creates a
 *                            Drive doc if Google docs is connected.
 *
 * Doctrine the polish prompt enforces:
 *   1. First person, in the author's voice. Not Medha's voice.
 *   2. Every piece stands alone. No assumed BMA-insider context.
 *   3. If a story can't land fully, cut it. Never half-tell it.
 *   4. The argument is clear and compelling to a general audience.
 *
 * Tab dependencies are best-effort imports — this PR ships independently of
 * Tabs 3/4/11/12 by inlining the doctrine + section templates + falling
 * back to a direct Anthropic call when newsletter-editor.js / author-voices
 * are unavailable.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { registerCapability } from "../capabilities.js";
import { getGoogleAccessToken } from "./google-oauth.js";

registerCapability("_tools_PolishDraft", [
  "Capture raw newsletter / LinkedIn / Twitter drafts as typed seeds (capture_content_seed)",
  "Polish a captured seed into a clean first-person draft and emit it to Drive (polish_content_seed)",
  "List the caller's content seeds across raw / polished / shipped states (list_content_seeds)",
]);

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DOCS_BASE = "https://docs.googleapis.com/v1/documents";

const ORGS = ["bma", "rytual", "personal", "amber"];
const INTENTS = [
  "newsletter",
  "linkedin",
  "twitter",
  "opinion",
  "hypothesis",
  "stories_watching",
];
const SECTIONS = [
  "hypothesis",
  "stories_watching",
  "talking_tables",
  "linkedin_post",
  "twitter_thread",
];

// Tab 4 fallback — inline section templates so polish works before Tab 4
// merges. When Tab 4 ships, this constant can be replaced with an import.
const SECTION_TEMPLATES = {
  hypothesis: {
    word_count_min: 300,
    word_count_max: 400,
    structure: "hook -> idea -> bet",
  },
  stories_watching: {
    word_count_min: 250,
    word_count_max: 350,
    structure: "3 hits, takeaway up front per hit",
  },
  talking_tables: {
    word_count_min: 200,
    word_count_max: 300,
    structure: "BMA update + adjacent commentary",
  },
  linkedin_post: {
    word_count_min: 120,
    word_count_max: 240,
    structure: "hook line, body, one-line close",
  },
  twitter_thread: {
    word_count_min: 80,
    word_count_max: 280,
    structure: "8 to 12 tweets, each under 280 chars",
  },
};

// Tab 3 fallback — Shirley's 4 rules inlined verbatim. Sourced from Part 0.10
// of the dispatch doc so when Tab 3 lands the text matches exactly.
const SHIRLEY_RULES = `SHIRLEY'S 4 RULES (editorial review 2026-05-27):
1. Write from the author's perspective. First person, in their voice. Not Medha's voice.
2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one.
3. If a story can't land fully, cut it. Never half-tell it.
4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued.`;

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
      "amber-id is not configured for this environment (AMBER_ID_API_URL / AMBER_ID_API_KEY missing).",
  };
}

function noPhoneError() {
  return {
    error: "tenant_phone_missing",
    message:
      "Tenant phoneNumber is required to call amber-id /v1/content-seeds/* but was not present on the resolved tenant.",
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

// ── capture_content_seed ─────────────────────────────────────────────────────

async function handleCaptureContentSeed(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();

  const rawText = input?.raw_text ? String(input.raw_text).trim() : "";
  const sourceUrl = input?.source_url ? String(input.source_url).trim() : "";
  if (!rawText && !sourceUrl) {
    return {
      error: "missing_source",
      message: "Either raw_text or source_url is required.",
    };
  }

  const body = {
    author_slug: input.author_slug,
    org: input.org,
    intent: input.intent,
    ...(rawText ? { raw_text: rawText } : {}),
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    ...(input.section_hint ? { section_hint: input.section_hint } : {}),
  };
  const r = await callAmberId("POST", "/v1/content-seeds", { phone, body });
  if (!r.ok) return { error: r.error, status: r.status };
  const seed = r.data?.content_seed;
  return {
    success: true,
    seed_id: seed?.id,
    ack: `Captured ${input.intent} seed for ${input.author_slug} (${input.org}). Polish when ready.`,
    content_seed: seed,
  };
}

// ── polish_content_seed ──────────────────────────────────────────────────────

async function callAnthropicDirect(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      polished_draft: null,
      note: "ANTHROPIC_API_KEY is not set on this service. Wire it via Railway to enable polish fallback.",
    };
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
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
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        polished_draft: null,
        note: `Anthropic call failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    if (!text.trim()) {
      return {
        polished_draft: null,
        note: "Anthropic returned empty response.",
      };
    }
    return { polished_draft: text.trim() };
  } catch (e) {
    clearTimeout(timer);
    return { polished_draft: null, note: `Anthropic call error: ${e.message}` };
  }
}

function buildPolishFallbackPrompt(seed, sectionTemplate) {
  const target =
    sectionTemplate?.word_count_max || (seed.intent === "twitter" ? 280 : 400);
  const structure = sectionTemplate?.structure || "lead, body, close";
  const sourceBlock = seed.raw_text
    ? `SOURCE DRAFT:\n${seed.raw_text}`
    : `SOURCE URL: ${seed.source_url}\n(Read this in the source draft.)`;
  return [
    `You are ghost-writing for ${seed.author_slug} (org: ${seed.org}). Produce a clean, polished ${seed.intent} draft.`,
    "",
    SHIRLEY_RULES,
    "",
    `TARGET: ${target} words. STRUCTURE: ${structure}.`,
    "",
    sourceBlock,
    "",
    "OUTPUT: the polished draft only. No preamble, no commentary, no markdown headers. Just the prose.",
  ].join("\n");
}

async function tryNewsletterEditor(seed, sectionTemplate, ctx) {
  // Tab 12's edit_for_newsletter, if shipped. Soft-import so we degrade.
  try {
    const mod = await import("./newsletter-editor.js");
    const fn = mod?.executeNewsletterEditorTool;
    if (typeof fn !== "function") {
      return { available: false };
    }
    const target = sectionTemplate?.word_count_max || 400;
    const result = await fn(
      "edit_for_newsletter",
      {
        author_slug: seed.author_slug,
        source: seed.raw_text || `Fetch and polish: ${seed.source_url}`,
        target_word_count: target,
        format: seed.intent,
      },
      ctx,
    );
    if (result?.error) return { available: true, error: result.error, result };
    return {
      available: true,
      polished_draft: result?.final_draft || result?.draft || null,
      polish_score: typeof result?.score === "number" ? result.score : null,
      doctrine_violations: Array.isArray(result?.violations)
        ? result.violations
        : null,
      critique_log: result?.critique_log || null,
    };
  } catch (err) {
    // Module doesn't exist (Tab 12 unmerged). Fall back.
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      return { available: false };
    }
    return {
      available: true,
      error: err?.message || "newsletter-editor failed",
    };
  }
}

async function maybeCreateDriveDoc(seed, polishedText, ctx) {
  try {
    const token = await getGoogleAccessToken(ctx.tenant, "docs");
    const today = new Date().toISOString().slice(0, 10);
    const title = `${seed.author_slug}-${seed.intent}-${today}`;

    const createRes = await fetch(DOCS_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!createRes.ok) {
      return {
        drive_doc_url: null,
        drive_doc_error: `docs create failed (${createRes.status})`,
      };
    }
    const doc = await createRes.json();
    const documentId = doc.documentId;

    // Insert content at index 1 (start of body)
    await fetch(`${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: { location: { index: 1 }, text: polishedText },
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    return {
      drive_doc_url: `https://docs.google.com/document/d/${documentId}/edit`,
    };
  } catch (err) {
    return {
      drive_doc_url: null,
      drive_doc_error: err?.message || "google docs not connected",
    };
  }
}

async function handlePolishContentSeed(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();
  if (!input?.seed_id) {
    return { error: "missing_seed_id", message: "seed_id is required." };
  }

  // 1. Fetch the seed
  const fetched = await callAmberId(
    "GET",
    `/v1/content-seeds/${encodeURIComponent(input.seed_id)}`,
    { phone },
  );
  if (!fetched.ok) return { error: fetched.error, status: fetched.status };
  const seed = fetched.data?.content_seed;
  if (!seed) {
    return {
      error: "seed_not_found",
      message: `No seed at id ${input.seed_id}.`,
    };
  }

  // Mark polishing in flight
  await callAmberId(
    "POST",
    `/v1/content-seeds/${encodeURIComponent(seed.id)}/polish`,
    { phone, body: { status: "polishing" } },
  );

  const section = input.target_section || seed.section_hint;
  const sectionTemplate = section ? SECTION_TEMPLATES[section] : null;

  // 2. Try Tab 12's editor, fall back to direct Anthropic call.
  let polishedDraft = null;
  let polishScore = null;
  let doctrineViolations = null;
  let critiqueLog = null;
  let fallbackUsed = false;
  let fallbackReason = null;

  const editor = await tryNewsletterEditor(seed, sectionTemplate, ctx);
  if (editor.available && editor.polished_draft) {
    polishedDraft = editor.polished_draft;
    polishScore = editor.polish_score;
    doctrineViolations = editor.doctrine_violations;
    critiqueLog = editor.critique_log;
  } else {
    fallbackUsed = true;
    fallbackReason = editor.available
      ? editor.error || "editor returned no draft"
      : "newsletter-editor (Tab 12) not installed";
    const prompt = buildPolishFallbackPrompt(seed, sectionTemplate);
    const direct = await callAnthropicDirect(prompt);
    polishedDraft = direct.polished_draft;
    if (!polishedDraft) {
      // Mark back to raw so it can be retried
      await callAmberId(
        "POST",
        `/v1/content-seeds/${encodeURIComponent(seed.id)}/polish`,
        { phone, body: { status: "raw" } },
      );
      return {
        error: "polish_failed",
        message: direct.note || "Polish fallback returned no draft.",
        seed_id: seed.id,
      };
    }
  }

  // 3. Optionally emit Drive doc (best-effort; not blocking).
  const driveResult = await maybeCreateDriveDoc(seed, polishedDraft, ctx);

  // 4. Write the result back to medha-id
  const writeback = await callAmberId(
    "POST",
    `/v1/content-seeds/${encodeURIComponent(seed.id)}/polish`,
    {
      phone,
      body: {
        polished_draft: polishedDraft,
        ...(typeof polishScore === "number"
          ? { polish_score: polishScore }
          : {}),
        ...(Array.isArray(doctrineViolations)
          ? { doctrine_violations: doctrineViolations }
          : {}),
        ...(driveResult.drive_doc_url
          ? { drive_doc_url: driveResult.drive_doc_url }
          : {}),
        status: "polished",
      },
    },
  );
  if (!writeback.ok) {
    return {
      error: writeback.error,
      status: writeback.status,
      message: "Polish completed but writeback to medha-id failed.",
      polished_draft: polishedDraft,
    };
  }

  return {
    success: true,
    seed_id: seed.id,
    polished_draft: polishedDraft,
    polish_score: polishScore,
    doctrine_violations: doctrineViolations,
    critique_log: critiqueLog,
    drive_doc_url: driveResult.drive_doc_url,
    drive_doc_error: driveResult.drive_doc_error || null,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
  };
}

// ── list_content_seeds ───────────────────────────────────────────────────────

async function handleListContentSeeds(input, ctx) {
  if (!configured()) return notConfiguredError();
  const phone = tenantPhone(ctx.tenant);
  if (!phone) return noPhoneError();

  const status = input?.status ? String(input.status) : "all";
  const authorSlug = input?.author_slug ? String(input.author_slug) : "";
  const limit =
    typeof input?.limit === "number" && input.limit > 0 ? input.limit : 20;

  const params = new URLSearchParams();
  params.set("status", status);
  if (authorSlug) params.set("author_slug", authorSlug);
  params.set("limit", String(limit));

  const r = await callAmberId("GET", `/v1/content-seeds?${params.toString()}`, {
    phone,
  });
  if (!r.ok) return { error: r.error, status: r.status };
  const rawList =
    (Array.isArray(r.data?.data) && r.data.data) ||
    (Array.isArray(r.data?.content_seeds) && r.data.content_seeds) ||
    (Array.isArray(r.data) && r.data) ||
    [];
  const seeds = rawList.map((s) => {
    const rawText = s?.raw_text || s?.rawText || "";
    const opener = rawText
      ? String(rawText).trim().slice(0, 140)
      : s?.source_url || s?.sourceUrl || "";
    return {
      seed_id: s?.id || s?.seed_id || null,
      intent: s?.intent || null,
      status: s?.status || null,
      opener,
      author_slug: s?.author_slug || s?.authorSlug || null,
      created_at: s?.created_at || s?.createdAt || null,
      polished_at: s?.polished_at || s?.polishedAt || null,
    };
  });
  return { ok: true, seeds, count: seeds.length };
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const POLISH_DRAFT_TOOLS = [
  {
    name: "capture_content_seed",
    description:
      "Capture raw writing (paste or URL) as a typed content_seed in Firestore BEFORE polishing. Use when the user explicitly asks to polish / clean up / ready a draft for the newsletter / LinkedIn / Twitter. Casual pastes without explicit polish intent are NOT seeds — they're journal entries.",
    input_schema: {
      type: "object",
      required: ["author_slug", "org", "intent"],
      properties: {
        raw_text: {
          type: "string",
          description: "The raw draft text. Provide this OR source_url.",
        },
        source_url: {
          type: "string",
          description:
            "URL to the source draft (Substack, Google Doc, etc). Provide this OR raw_text.",
        },
        author_slug: {
          type: "string",
          description:
            "Lowercase-hyphenated author slug, e.g. 'sagar-tiwari', 'caleb-newton'.",
        },
        org: {
          type: "string",
          enum: ORGS,
          description: "Which org this piece belongs to.",
        },
        intent: {
          type: "string",
          enum: INTENTS,
          description:
            "What this seed is intended to become. 'newsletter', 'linkedin', 'twitter', 'opinion', 'hypothesis', 'stories_watching'.",
        },
        section_hint: {
          type: "string",
          enum: SECTIONS,
          description:
            "Optional hint at the BMA newsletter section (hypothesis, stories_watching, talking_tables) or platform shape (linkedin_post, twitter_thread).",
        },
      },
    },
  },
  {
    name: "polish_content_seed",
    description:
      "Polish a captured seed into a clean first-person draft and emit it to Drive. Runs Tab 12's edit_for_newsletter critique-and-revise loop when present; falls back to a direct Anthropic call with Shirley's 4 rules if the editor isn't installed yet. Writes polished_draft, polish_score, and drive_doc_url back to the seed. Returns the polished text so the agent can preview it inline.",
    input_schema: {
      type: "object",
      required: ["seed_id"],
      properties: {
        seed_id: {
          type: "string",
          description:
            "The id returned by capture_content_seed (format seed_<hex>).",
        },
        target_section: {
          type: "string",
          enum: SECTIONS,
          description:
            "Override the seed's section_hint with a different section target.",
        },
        target_format: {
          type: "string",
          enum: INTENTS,
          description: "Override the seed's intent for this polish run only.",
        },
      },
    },
  },
  {
    name: "list_content_seeds",
    description:
      "List the caller's content seeds (raw drafts, polished pieces, shipped). Use when the user asks 'show me my content pipeline', 'what am I working on', 'what's in flight', 'what have I polished'. Returns seed_id, intent, status, opener, author_slug, created_at, polished_at.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["raw", "polished", "shipped", "all"],
          default: "all",
          description:
            "Filter by seed status. 'raw' = captured but not polished, 'polished' = polished_draft set, 'shipped' = marked shipped, 'all' = no filter.",
        },
        author_slug: {
          type: "string",
          description:
            "Optional. Lowercase-hyphenated author slug to scope to one author.",
        },
        limit: {
          type: "number",
          default: 20,
          description: "Max seeds to return. Defaults to 20.",
        },
      },
    },
  },
];

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executePolishDraftTool(toolName, input, ctx) {
  console.log(`[polish-draft] ${toolName}`);
  try {
    switch (toolName) {
      case "capture_content_seed":
        return await handleCaptureContentSeed(input, ctx);
      case "polish_content_seed":
        return await handlePolishContentSeed(input, ctx);
      case "list_content_seeds":
        return await handleListContentSeeds(input, ctx);
      default:
        return { error: `Unknown polish-draft tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[polish-draft] ${toolName} failed:`, err?.message);
    return { error: err?.message || "polish-draft-tool-error" };
  }
}
