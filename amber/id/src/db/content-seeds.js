/**
 * Content seed storage. Mirror of personal-life.js for the polish pipeline.
 *
 * A content_seed is raw text or a source URL captured before it has been
 * polished into newsletter / LinkedIn / Twitter copy. Lifecycle:
 *
 *   raw -> polishing -> polished -> scheduled
 *
 * Storage path:
 *
 *   agent_data/{tenantDid}/content_seeds/{id}
 *
 * Companion route surface lives in ../routes/content-seeds.js. The polish
 * step is owned by the agent (Tab 12's edit_for_newsletter handles the
 * critique-and-revise loop); this module is the source of truth for the
 * structured row, normalize/validate logic, and lifecycle transitions.
 */

import crypto from "node:crypto";
import { agentDataGet, agentDataUpsert, agentDataQuery } from "./agent-data.js";

export const CONTENT_SEEDS_TABLE = "content_seeds";

export const SEED_ORGS = ["bma", "rytual", "personal", "amber"];
export const SEED_INTENTS = [
  "newsletter",
  "linkedin",
  "twitter",
  "opinion",
  "hypothesis",
  "stories_watching",
];
export const SEED_SECTIONS = [
  "hypothesis",
  "stories_watching",
  "talking_tables",
  "linkedin_post",
  "twitter_thread",
];
export const SEED_STATUSES = ["raw", "polishing", "polished", "scheduled"];

function newId() {
  return `seed_${crypto.randomBytes(8).toString("hex")}`;
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

export function normalizeContentSeed(body, { privyDid }) {
  if (!body || typeof body !== "object") {
    throw badRequest("invalid_body", "Content seed body must be an object");
  }
  const rawText = body.raw_text != null ? String(body.raw_text).trim() : "";
  const sourceUrl =
    body.source_url != null ? String(body.source_url).trim() : "";
  if (!rawText && !sourceUrl) {
    throw badRequest(
      "missing_source",
      "Either raw_text or source_url is required",
    );
  }
  if (rawText.length > 32000) {
    throw badRequest("raw_text_too_long", "raw_text max length is 32000");
  }
  if (sourceUrl.length > 2000) {
    throw badRequest("source_url_too_long", "source_url max length is 2000");
  }

  const authorSlug = slugifyForId(body.author_slug || "");
  if (!authorSlug) {
    throw badRequest(
      "missing_author_slug",
      "author_slug is required (lowercase-hyphenated, e.g. 'sagar-tiwari')",
    );
  }

  const org = String(body.org || "").toLowerCase();
  if (!SEED_ORGS.includes(org)) {
    throw badRequest(
      "invalid_org",
      `org must be one of ${SEED_ORGS.join(", ")}`,
    );
  }

  const intent = String(body.intent || "").toLowerCase();
  if (!SEED_INTENTS.includes(intent)) {
    throw badRequest(
      "invalid_intent",
      `intent must be one of ${SEED_INTENTS.join(", ")}`,
    );
  }

  let sectionHint = null;
  if (body.section_hint != null && body.section_hint !== "") {
    const s = String(body.section_hint).toLowerCase();
    if (!SEED_SECTIONS.includes(s)) {
      throw badRequest(
        "invalid_section_hint",
        `section_hint must be one of ${SEED_SECTIONS.join(", ")}`,
      );
    }
    sectionHint = s;
  }

  return {
    id: newId(),
    privy_did: privyDid,
    kind: "content_seed",
    raw_text: rawText,
    source_url: sourceUrl || null,
    author_slug: authorSlug,
    org,
    intent,
    section_hint: sectionHint,
    polished_draft: null,
    polish_score: null,
    doctrine_violations: null,
    drive_doc_url: null,
    status: "raw",
  };
}

export async function upsertContentSeed(privyDid, row, deps = {}) {
  const upsert = deps.agentDataUpsert || agentDataUpsert;
  const now = nowIso();
  const stored = { ...row, created_at: row.created_at || now, updated_at: now };
  await upsert({
    tenantDid: privyDid,
    table: CONTENT_SEEDS_TABLE,
    rowKey: row.id,
    row: stored,
  });
  return stored;
}

export async function getContentSeed(privyDid, id, deps = {}) {
  const get = deps.agentDataGet || agentDataGet;
  return get({ tenantDid: privyDid, table: CONTENT_SEEDS_TABLE, rowKey: id });
}

export async function listContentSeeds(
  privyDid,
  { authorSlug, org, intent, status, limit = 100 } = {},
  deps = {},
) {
  const query = deps.agentDataQuery || agentDataQuery;
  const filters = [];
  if (authorSlug) {
    filters.push({
      col: "author_slug",
      op: "eq",
      value: slugifyForId(authorSlug),
    });
  }
  if (org) {
    if (!SEED_ORGS.includes(org)) {
      throw badRequest(
        "invalid_org",
        `org must be one of ${SEED_ORGS.join(", ")}`,
      );
    }
    filters.push({ col: "org", op: "eq", value: org });
  }
  if (intent) {
    if (!SEED_INTENTS.includes(intent)) {
      throw badRequest(
        "invalid_intent",
        `intent must be one of ${SEED_INTENTS.join(", ")}`,
      );
    }
    filters.push({ col: "intent", op: "eq", value: intent });
  }
  if (status) {
    if (!SEED_STATUSES.includes(status)) {
      throw badRequest(
        "invalid_status",
        `status must be one of ${SEED_STATUSES.join(", ")}`,
      );
    }
    filters.push({ col: "status", op: "eq", value: status });
  }
  return query({
    tenantDid: privyDid,
    table: CONTENT_SEEDS_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit,
  });
}

export async function applyPolishResult(
  privyDid,
  id,
  {
    polished_draft,
    polish_score,
    doctrine_violations,
    drive_doc_url,
    status,
  } = {},
  deps = {},
) {
  const existing = await getContentSeed(privyDid, id, deps);
  if (!existing) return null;
  const update = {
    ...existing,
    polished_draft:
      polished_draft != null ? String(polished_draft) : existing.polished_draft,
    polish_score:
      typeof polish_score === "number" ? polish_score : existing.polish_score,
    doctrine_violations: Array.isArray(doctrine_violations)
      ? doctrine_violations
      : existing.doctrine_violations,
    drive_doc_url:
      typeof drive_doc_url === "string" && drive_doc_url
        ? drive_doc_url
        : existing.drive_doc_url,
    status: SEED_STATUSES.includes(status) ? status : existing.status,
  };
  return upsertContentSeed(privyDid, update, deps);
}

export { slugifyForId };
