/**
 * Personal-life memory storage.
 *
 * Three first-class object kinds, all scoped to a Privy DID:
 *
 *   brand_decision    long-lived branding calls (e.g. "rytual newsletter = the rave")
 *   teammate_pursuit  what Shirley / Alinna / Emily are working on personally
 *   journal_entry     freeform yapping about creative conversations
 *
 * Storage lives in the existing agent_data namespace so backups, RLS, and
 * lifecycle hooks already wired to agent_data automatically cover these
 * collections too:
 *
 *   agent_data/{tenantDid}/brand_decisions/{id}
 *   agent_data/{tenantDid}/teammate_pursuits/{id}
 *   agent_data/{tenantDid}/journal_entries/{id}
 *
 * Vector indexing into Pinecone is handled by ../knowledge/personal-life-index.js
 * once Tab 7's pinecone client lands; this module is the source of truth for
 * the structured row and the normalize/validate logic.
 */

import crypto from "node:crypto";
import {
  agentDataGet,
  agentDataUpsert,
  agentDataQuery,
  agentDataDelete,
} from "./agent-data.js";

export const BRAND_DECISIONS_TABLE = "brand_decisions";
export const TEAMMATE_PURSUITS_TABLE = "teammate_pursuits";
export const JOURNAL_ENTRIES_TABLE = "journal_entries";

export const BRANDS = ["rytual", "bma", "medha", "togari", "amber"];
export const PURSUIT_KINDS = [
  "art",
  "music",
  "writing",
  "fitness",
  "business",
  "other",
];
export const PURSUIT_STATUSES = ["active", "dormant", "shipped"];
export const DIMENSIONS = [
  "social",
  "spiritual",
  "emotional",
  "physical",
  "financial",
  "intellectual",
];

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function badRequest(code, message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  return err;
}

function slugifyForId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// ─── brand decisions ────────────────────────────────────────────────────────

export function normalizeBrandDecision(body, { privyDid }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "Brand decision body must be an object");
  }
  const brand = String(body.brand || "").toLowerCase();
  if (!BRANDS.includes(brand)) {
    throw badRequest(
      "invalid_brand",
      `brand must be one of ${BRANDS.join(", ")}`,
    );
  }
  const key = String(body.key || "").trim();
  if (!key) throw badRequest("missing_key", "key is required");
  if (key.length > 80) throw badRequest("key_too_long", "key max length is 80");
  const value = String(body.value || "").trim();
  if (!value) throw badRequest("missing_value", "value is required");
  if (value.length > 2000) {
    throw badRequest("value_too_long", "value max length is 2000");
  }
  const rationale = body.rationale != null ? String(body.rationale) : "";
  if (rationale.length > 4000) {
    throw badRequest("rationale_too_long", "rationale max length is 4000");
  }
  let decidedAt = body.decided_at || nowIso();
  if (typeof decidedAt !== "string" || decidedAt.length > 64) {
    throw badRequest("invalid_decided_at", "decided_at must be an ISO string");
  }
  const decidedWith = Array.isArray(body.decided_with)
    ? body.decided_with
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 20)
    : [];

  // Deterministic id: brand + key collapse to one row per (brand, key).
  // Re-posts overwrite history instead of creating duplicates.
  const id = `brand_${slugifyForId(brand)}_${slugifyForId(key)}`;
  return {
    id,
    privy_did: privyDid,
    kind: "brand_decision",
    brand,
    key,
    value,
    rationale,
    decided_at: decidedAt,
    decided_with: decidedWith,
  };
}

export async function upsertBrandDecision(privyDid, row, deps = {}) {
  const upsert = deps.agentDataUpsert || agentDataUpsert;
  const now = nowIso();
  const stored = { ...row, created_at: row.created_at || now, updated_at: now };
  await upsert({
    tenantDid: privyDid,
    table: BRAND_DECISIONS_TABLE,
    rowKey: row.id,
    row: stored,
  });
  return stored;
}

export async function listBrandDecisions(
  privyDid,
  { brand, limit = 100 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  const filters = [];
  if (brand) {
    if (!BRANDS.includes(brand)) {
      throw badRequest(
        "invalid_brand",
        `brand must be one of ${BRANDS.join(", ")}`,
      );
    }
    filters.push({ col: "brand", op: "eq", value: brand });
  }
  return query({
    tenantDid: privyDid,
    table: BRAND_DECISIONS_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit,
  });
}

// ─── teammate pursuits ──────────────────────────────────────────────────────

export function normalizeTeammatePursuit(body, { privyDid }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "Teammate pursuit body must be an object");
  }
  const teammateName = String(body.teammate_name || "").trim();
  if (!teammateName) {
    throw badRequest("missing_teammate_name", "teammate_name is required");
  }
  if (teammateName.length > 120) {
    throw badRequest(
      "teammate_name_too_long",
      "teammate_name max length is 120",
    );
  }
  const pursuitName = String(body.pursuit_name || "").trim();
  if (!pursuitName) {
    throw badRequest("missing_pursuit_name", "pursuit_name is required");
  }
  if (pursuitName.length > 200) {
    throw badRequest("pursuit_name_too_long", "pursuit_name max length is 200");
  }
  const kind = String(body.kind || "other").toLowerCase();
  if (!PURSUIT_KINDS.includes(kind)) {
    throw badRequest(
      "invalid_kind",
      `kind must be one of ${PURSUIT_KINDS.join(", ")}`,
    );
  }
  const status = String(body.status || "active").toLowerCase();
  if (!PURSUIT_STATUSES.includes(status)) {
    throw badRequest(
      "invalid_status",
      `status must be one of ${PURSUIT_STATUSES.join(", ")}`,
    );
  }
  const notes = body.notes != null ? String(body.notes) : "";
  if (notes.length > 4000) {
    throw badRequest("notes_too_long", "notes max length is 4000");
  }
  const contactHandle =
    body.contact_handle != null
      ? String(body.contact_handle).slice(0, 120)
      : null;
  const lastMentionedAt = body.last_mentioned_at || nowIso();
  if (typeof lastMentionedAt !== "string" || lastMentionedAt.length > 64) {
    throw badRequest(
      "invalid_last_mentioned_at",
      "last_mentioned_at must be an ISO string",
    );
  }
  // One pursuit per (teammate, pursuit_name) keeps repeat upserts idempotent.
  const id = `pursuit_${slugifyForId(teammateName)}_${slugifyForId(pursuitName)}`;
  return {
    id,
    privy_did: privyDid,
    kind: "teammate_pursuit",
    teammate_name: teammateName,
    teammate_slug: slugifyForId(teammateName),
    contact_handle: contactHandle,
    pursuit_name: pursuitName,
    pursuit_kind: kind,
    status,
    notes,
    last_mentioned_at: lastMentionedAt,
  };
}

export async function upsertTeammatePursuit(privyDid, row, deps = {}) {
  const upsert = deps.agentDataUpsert || agentDataUpsert;
  const now = nowIso();
  const stored = { ...row, created_at: row.created_at || now, updated_at: now };
  await upsert({
    tenantDid: privyDid,
    table: TEAMMATE_PURSUITS_TABLE,
    rowKey: row.id,
    row: stored,
  });
  return stored;
}

export async function listTeammatePursuits(
  privyDid,
  { teammate, status, limit = 100 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  const filters = [];
  if (teammate) {
    filters.push({
      col: "teammate_slug",
      op: "eq",
      value: slugifyForId(teammate),
    });
  }
  if (status) {
    if (!PURSUIT_STATUSES.includes(status)) {
      throw badRequest(
        "invalid_status",
        `status must be one of ${PURSUIT_STATUSES.join(", ")}`,
      );
    }
    filters.push({ col: "status", op: "eq", value: status });
  }
  return query({
    tenantDid: privyDid,
    table: TEAMMATE_PURSUITS_TABLE,
    filters,
    order: { col: "last_mentioned_at", dir: "desc" },
    limit,
  });
}

// ─── journal entries ────────────────────────────────────────────────────────

export function normalizeJournalEntry(body, { privyDid }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "Journal entry body must be an object");
  }
  const topic = String(body.topic || "").trim();
  if (!topic) throw badRequest("missing_topic", "topic is required");
  if (topic.length > 200) {
    throw badRequest("topic_too_long", "topic max length is 200");
  }
  const bodyText = String(body.body || "").trim();
  if (!bodyText) throw badRequest("missing_body_text", "body is required");
  if (bodyText.length > 16000) {
    throw badRequest("body_too_long", "body max length is 16000");
  }
  const writtenAt = body.written_at || nowIso();
  if (typeof writtenAt !== "string" || writtenAt.length > 64) {
    throw badRequest("invalid_written_at", "written_at must be an ISO string");
  }
  const withList = Array.isArray(body.with)
    ? body.with
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 20)
    : [];
  let dimension = null;
  if (body.dimension != null) {
    const d = String(body.dimension).toLowerCase();
    if (!DIMENSIONS.includes(d)) {
      throw badRequest(
        "invalid_dimension",
        `dimension must be one of ${DIMENSIONS.join(", ")}`,
      );
    }
    dimension = d;
  }
  const withSlugs = withList.map(slugifyForId);
  const id = newId("journal");
  return {
    id,
    privy_did: privyDid,
    kind: "journal_entry",
    written_at: writtenAt,
    topic,
    body: bodyText,
    with: withList,
    with_slugs: withSlugs,
    dimension,
  };
}

export async function upsertJournalEntry(privyDid, row, deps = {}) {
  const upsert = deps.agentDataUpsert || agentDataUpsert;
  const now = nowIso();
  const stored = { ...row, created_at: row.created_at || now, updated_at: now };
  await upsert({
    tenantDid: privyDid,
    table: JOURNAL_ENTRIES_TABLE,
    rowKey: row.id,
    row: stored,
  });
  return stored;
}

export async function listJournalEntries(
  privyDid,
  { withWhom, dimension, limit = 100 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  const filters = [];
  if (withWhom) {
    filters.push({
      col: "with_slugs",
      op: "array-contains",
      value: slugifyForId(withWhom),
    });
  }
  if (dimension) {
    if (!DIMENSIONS.includes(dimension)) {
      throw badRequest(
        "invalid_dimension",
        `dimension must be one of ${DIMENSIONS.join(", ")}`,
      );
    }
    filters.push({ col: "dimension", op: "eq", value: dimension });
  }
  return query({
    tenantDid: privyDid,
    table: JOURNAL_ENTRIES_TABLE,
    filters,
    order: { col: "written_at", dir: "desc" },
    limit,
  });
}

// ─── shared lookups ─────────────────────────────────────────────────────────

export async function getPersonalLifeRow(privyDid, table, id, deps = {}) {
  const get = deps.agentDataGet || agentDataGet;
  return get({ tenantDid: privyDid, table, rowKey: id });
}

export async function deletePersonalLifeRow(privyDid, table, id, deps = {}) {
  const del = deps.agentDataDelete || agentDataDelete;
  await del({ tenantDid: privyDid, table, rowKey: id });
}

// Convenience helper for search routes that need to fall back from the
// vector store to a plain Firestore listing when Pinecone is not yet wired.
export async function listAllForSearch(privyDid, kind, deps = {}) {
  const query = deps.agentDataQuery || agentDataQuery;
  const table =
    kind === "brand_decision"
      ? BRAND_DECISIONS_TABLE
      : kind === "teammate_pursuit"
        ? TEAMMATE_PURSUITS_TABLE
        : kind === "journal_entry"
          ? JOURNAL_ENTRIES_TABLE
          : null;
  if (!table) return [];
  return query({
    tenantDid: privyDid,
    table,
    filters: [],
    order: { col: "updated_at", dir: "desc" },
    limit: 500,
  });
}

// ─── person recall ──────────────────────────────────────────────────────────
//
// Given a name, gather everything Medha has on that person across the
// personal-life namespace: their teammate_pursuits and any journal entries
// that mention them. Used by /v1/personal/recall-person so the agent can
// answer "what is Shirley working on?" with both structured pursuits and
// recent journal context, even when Sagar didn't explicitly tag her in
// the entry's `with` array.
//
// Live first-name matching against journal bodies happens in the route
// layer via lib/person-mentions.js; this function does the Firestore
// fan-out.

/**
 * Walk every teammate_pursuit for the tenant and return the ones whose
 * teammate_slug equals any of the supplied slugs. We don't push the slug
 * filter into the Firestore query because Sagar's pursuits collection is
 * small enough (tens, not thousands) that an in-memory filter is faster
 * than firing N separate index hits.
 */
export async function listTeammatePursuitsBySlugs(
  privyDid,
  slugs,
  { limit = 200 } = {},
  deps = {},
) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  const query = deps.agentDataQuery || agentDataQuery;
  const rows = await query({
    tenantDid: privyDid,
    table: TEAMMATE_PURSUITS_TABLE,
    filters: [],
    order: { col: "last_mentioned_at", dir: "desc" },
    limit: 500,
  });
  const want = new Set(slugs.map((s) => slugifyForId(s)).filter(Boolean));
  return rows.filter((r) => want.has(r.teammate_slug)).slice(0, limit);
}

/**
 * Pull recent journal entries for the tenant, capped at `limit`. The route
 * layer then runs lib/person-mentions over the bodies to surface the entries
 * that actually reference the person. Doing the topic/body scan in the route
 * layer (not Firestore) means a Shirley mention buried inside the body
 * still surfaces even when `with` is empty.
 */
export async function listRecentJournalEntries(
  privyDid,
  { limit = 200 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  return query({
    tenantDid: privyDid,
    table: JOURNAL_ENTRIES_TABLE,
    filters: [],
    order: { col: "written_at", dir: "desc" },
    limit,
  });
}

export { slugifyForId };

// ─── author voices ──────────────────────────────────────────────────────────
//
// A per-tenant catalog of authors Medha can ghost-write for, keyed by a
// stable `author_slug` (lowercase-hyphenated). Each row carries voice tells
// (sentence rhythm, openers, closers, jargon blacklist, signature phrases),
// what the author would never say, sample pieces (full text), and optional
// social handles. The shape is deliberately narrow and editorial-focused so
// the draft tool in medha-platform can interpolate it into a prompt without
// fishing through metadata.
//
// Storage path: agent_data/{tenantDid}/author_voices/{author_slug}
// Deterministic id (the author_slug) means re-posting the same author
// overwrites instead of creating duplicates.

export const AUTHOR_VOICES_TABLE = "author_voices";

export const AUTHOR_ORGS = ["bma", "rytual", "personal", "amber"];

function stringArray(value, { maxItems, maxLen, name }) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw badRequest(`invalid_${name}`, `${name} must be an array of strings`);
  }
  return value
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function normalizeVoiceTells(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(
      "invalid_voice_tells",
      "voice_tells must be an object of string fields",
    );
  }
  const allowed = [
    "sentence_rhythm",
    "vocabulary_tells",
    "opener_patterns",
    "closer_patterns",
    "signature_phrases",
    "jargon_blacklist",
  ];
  const out = {};
  for (const key of allowed) {
    if (value[key] == null) continue;
    if (key === "signature_phrases" || key === "jargon_blacklist") {
      out[key] = stringArray(value[key], {
        maxItems: 40,
        maxLen: 120,
        name: key,
      });
      continue;
    }
    if (typeof value[key] !== "string") {
      throw badRequest(`invalid_${key}`, `${key} must be a string`);
    }
    if (value[key].length > 1000) {
      throw badRequest(`${key}_too_long`, `${key} max length is 1000`);
    }
    out[key] = value[key].trim();
  }
  return out;
}

function normalizeSamplePieces(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw badRequest(
      "invalid_sample_pieces",
      "sample_pieces must be an array of {title, url?, body} objects",
    );
  }
  return value.slice(0, 10).map((piece, idx) => {
    if (!piece || typeof piece !== "object") {
      throw badRequest(
        "invalid_sample_piece",
        `sample_pieces[${idx}] must be an object`,
      );
    }
    const title = String(piece.title || "").trim();
    if (!title) {
      throw badRequest(
        "missing_sample_title",
        `sample_pieces[${idx}].title is required`,
      );
    }
    if (title.length > 200) {
      throw badRequest(
        "sample_title_too_long",
        `sample_pieces[${idx}].title max length is 200`,
      );
    }
    const url = piece.url != null ? String(piece.url).slice(0, 500) : null;
    const body = String(piece.body || "");
    if (body.length > 16000) {
      throw badRequest(
        "sample_body_too_long",
        `sample_pieces[${idx}].body max length is 16000`,
      );
    }
    return { title, url, body };
  });
}

export function normalizeAuthorVoice(body, { privyDid }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "Author voice body must be an object");
  }
  const slugSource = body.author_slug || body.display_name;
  const authorSlug = slugifyForId(slugSource);
  if (!authorSlug) {
    throw badRequest(
      "missing_author_slug",
      "author_slug or display_name is required",
    );
  }
  const displayName = String(body.display_name || "").trim();
  if (!displayName) {
    throw badRequest("missing_display_name", "display_name is required");
  }
  if (displayName.length > 120) {
    throw badRequest("display_name_too_long", "display_name max length is 120");
  }
  const roleAtOrg =
    body.role_at_org != null ? String(body.role_at_org).slice(0, 200) : null;
  let org = null;
  if (body.org != null) {
    const candidate = String(body.org).toLowerCase();
    if (!AUTHOR_ORGS.includes(candidate)) {
      throw badRequest(
        "invalid_org",
        `org must be one of ${AUTHOR_ORGS.join(", ")}`,
      );
    }
    org = candidate;
  }
  const voiceTells = normalizeVoiceTells(body.voice_tells);
  const samplePieces = normalizeSamplePieces(body.sample_pieces);
  const whatTheyDontSay = stringArray(body.what_they_dont_say, {
    maxItems: 40,
    maxLen: 200,
    name: "what_they_dont_say",
  });
  const substackHandle =
    body.substack_handle != null
      ? String(body.substack_handle).slice(0, 120)
      : null;
  const linkedinHandle =
    body.linkedin_handle != null
      ? String(body.linkedin_handle).slice(0, 120)
      : null;

  return {
    id: authorSlug,
    privy_did: privyDid,
    kind: "author_voice",
    author_slug: authorSlug,
    display_name: displayName,
    role_at_org: roleAtOrg,
    org,
    voice_tells: voiceTells,
    what_they_dont_say: whatTheyDontSay,
    sample_pieces: samplePieces,
    substack_handle: substackHandle,
    linkedin_handle: linkedinHandle,
  };
}

export async function upsertAuthorVoice(privyDid, row, deps = {}) {
  const upsert = deps.agentDataUpsert || agentDataUpsert;
  const now = nowIso();
  const stored = { ...row, created_at: row.created_at || now, updated_at: now };
  await upsert({
    tenantDid: privyDid,
    table: AUTHOR_VOICES_TABLE,
    rowKey: row.id,
    row: stored,
  });
  return stored;
}

export async function getAuthorVoice(privyDid, authorSlug, deps = {}) {
  const get = deps.agentDataGet || agentDataGet;
  const slug = slugifyForId(authorSlug);
  if (!slug) return null;
  return get({
    tenantDid: privyDid,
    table: AUTHOR_VOICES_TABLE,
    rowKey: slug,
  });
}

export async function listAuthorVoices(
  privyDid,
  { org, limit = 100 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  const filters = [];
  if (org) {
    if (!AUTHOR_ORGS.includes(org)) {
      throw badRequest(
        "invalid_org",
        `org must be one of ${AUTHOR_ORGS.join(", ")}`,
      );
    }
    filters.push({ col: "org", op: "eq", value: org });
  }
  return query({
    tenantDid: privyDid,
    table: AUTHOR_VOICES_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit,
  });
}

export async function deleteAuthorVoice(privyDid, authorSlug, deps = {}) {
  const del = deps.agentDataDelete || agentDataDelete;
  const slug = slugifyForId(authorSlug);
  if (!slug) return;
  await del({
    tenantDid: privyDid,
    table: AUTHOR_VOICES_TABLE,
    rowKey: slug,
  });
}
