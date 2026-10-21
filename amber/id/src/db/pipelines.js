/**
 * Pipeline objects: investor, event (Rytual 3-events framework), and
 * multi-thread relationships. Each lives as a row under the tenant's
 * agent_data namespace so existing Firestore tooling (export, deletion,
 * tenant teardown) covers it for free.
 *
 * Tables:
 *   agent_data/{tenantDid}/pipeline_investors/{investor_id}
 *   agent_data/{tenantDid}/pipeline_events/{event_id}
 *   agent_data/{tenantDid}/pipeline_relationships/{relationship_id}
 *
 * Why a separate "pipeline_events" table even though /v1/me/events
 * already exists: the Rave Master event card is logistics-heavy
 * (ticket ledger, transport, lodging). The pipeline_event row models
 * the Rytual 3-events framework (vipassana, everything-night,
 * lightning-in-a-bottle) plus attendee lists and dimension tags. The
 * two concepts overlap on the word "event" but not in shape, so we
 * keep them in distinct tables and let the agent decide which surface
 * to use.
 */

import {
  agentDataGet,
  agentDataUpsert,
  agentDataQuery,
  agentDataDelete,
} from "./agent-data.js";

export const INVESTORS_TABLE = "pipeline_investors";
export const EVENTS_TABLE = "pipeline_events";
export const RELATIONSHIPS_TABLE = "pipeline_relationships";

export const INVESTOR_STAGES = new Set([
  "lead",
  "intro",
  "in_discussion",
  "term_sheet",
  "closed",
  "passed",
]);

export const EVENT_TYPES = new Set([
  "vipassana",
  "everything-night",
  "lightning-in-a-bottle",
  "rave",
  "custom",
]);

export const DIMENSIONS = new Set([
  "social",
  "spiritual",
  "emotional",
  "physical",
  "financial",
  "intellectual",
]);

export const RELATIONSHIP_PIPELINES = new Set([
  "investor",
  "customer",
  "partner",
  "friend",
  "mentor",
  "advisor",
]);

function randomId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

// ── Investor ──────────────────────────────────────────────────────────────

export async function upsertInvestor(tenantDid, investor) {
  const id = investor.id || randomId("inv");
  const now = new Date().toISOString();
  const existing = await agentDataGet({
    tenantDid,
    table: INVESTORS_TABLE,
    rowKey: id,
  });
  const row = {
    id,
    privy_did: tenantDid,
    name: investor.name,
    contact_email: investor.contact_email || null,
    contact_phone: investor.contact_phone || null,
    stage: investor.stage,
    thesis_fit_note: investor.thesis_fit_note || "",
    last_touch_at: investor.last_touch_at || now,
    threads: Array.isArray(investor.threads) ? investor.threads : [],
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await agentDataUpsert({
    tenantDid,
    table: INVESTORS_TABLE,
    rowKey: id,
    row,
  });
  return row;
}

export async function getInvestor(tenantDid, id) {
  return agentDataGet({ tenantDid, table: INVESTORS_TABLE, rowKey: id });
}

export async function listInvestors(tenantDid, { stage, limit = 100 } = {}) {
  const filters = [];
  if (stage) filters.push({ col: "stage", op: "eq", value: stage });
  return agentDataQuery({
    tenantDid,
    table: INVESTORS_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit,
  });
}

export async function deleteInvestor(tenantDid, id) {
  await agentDataDelete({ tenantDid, table: INVESTORS_TABLE, rowKey: id });
}

// ── Event (Rytual 3-events framework) ─────────────────────────────────────

export async function upsertEvent(tenantDid, event) {
  const id = event.id || randomId("evt");
  const now = new Date().toISOString();
  const existing = await agentDataGet({
    tenantDid,
    table: EVENTS_TABLE,
    rowKey: id,
  });
  const row = {
    id,
    privy_did: tenantDid,
    name: event.name,
    type: event.type,
    date_start: event.date_start,
    date_end: event.date_end || null,
    location: event.location || null,
    attendees: Array.isArray(event.attendees) ? event.attendees : [],
    dimension: event.dimension,
    notes: event.notes || "",
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await agentDataUpsert({
    tenantDid,
    table: EVENTS_TABLE,
    rowKey: id,
    row,
  });
  return row;
}

export async function getEvent(tenantDid, id) {
  return agentDataGet({ tenantDid, table: EVENTS_TABLE, rowKey: id });
}

export async function listEvents(
  tenantDid,
  { from, to, type, dimension, limit = 100 } = {},
) {
  const filters = [];
  if (type) filters.push({ col: "type", op: "eq", value: type });
  if (dimension) filters.push({ col: "dimension", op: "eq", value: dimension });
  // Date range filtering happens in-memory because Firestore inequality
  // queries would force ordering on date_start, breaking the
  // updated_at-desc list order callers expect.
  const rows = await agentDataQuery({
    tenantDid,
    table: EVENTS_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit: 500,
  });
  let filtered = rows;
  if (from)
    filtered = filtered.filter((r) => !r.date_start || r.date_start >= from);
  if (to)
    filtered = filtered.filter((r) => !r.date_start || r.date_start <= to);
  return filtered.slice(0, limit);
}

export async function deleteEvent(tenantDid, id) {
  await agentDataDelete({ tenantDid, table: EVENTS_TABLE, rowKey: id });
}

// ── Multi-thread relationship ─────────────────────────────────────────────
//
// Carlo is the canonical example: one human, two threads.
//   { pipeline: "partner",  context: "Clay sales contract" }
//   { pipeline: "investor", context: "IRA/BBB tax-credit unlock" }
//
// The single relationship doc keeps the threads array contiguous so we
// can render Sagar's "all the ways I know this person" view without a
// join. Updates either replace the relationship wholesale (upsert) or
// append a new thread (addThread) without rewriting the existing ones.

export async function upsertRelationship(tenantDid, relationship) {
  const id = relationship.id || randomId("rel");
  const now = new Date().toISOString();
  const existing = await agentDataGet({
    tenantDid,
    table: RELATIONSHIPS_TABLE,
    rowKey: id,
  });
  const row = {
    id,
    privy_did: tenantDid,
    person_name: relationship.person_name,
    contact_email: relationship.contact_email || null,
    threads: Array.isArray(relationship.threads) ? relationship.threads : [],
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await agentDataUpsert({
    tenantDid,
    table: RELATIONSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return row;
}

export async function addThreadToRelationship(tenantDid, id, thread) {
  const existing = await agentDataGet({
    tenantDid,
    table: RELATIONSHIPS_TABLE,
    rowKey: id,
  });
  if (!existing) return null;
  const now = new Date().toISOString();
  const threadId = thread.thread_id || randomId("thr");
  const newThread = {
    thread_id: threadId,
    pipeline: thread.pipeline,
    context: thread.context || "",
    status: thread.status || "open",
    last_event_at: thread.last_event_at || now,
  };
  const threads = [...(existing.threads || []), newThread];
  const row = {
    ...existing,
    threads,
    updated_at: now,
  };
  await agentDataUpsert({
    tenantDid,
    table: RELATIONSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return row;
}

export async function findRelationships(
  tenantDid,
  { person_name, limit = 100 } = {},
) {
  // Firestore lacks case-insensitive contains. We load recent rows and
  // filter in memory; the per-tenant volume is small (tens to a few
  // hundred relationships) so this is fine for now.
  const rows = await agentDataQuery({
    tenantDid,
    table: RELATIONSHIPS_TABLE,
    filters: [],
    order: { col: "updated_at", dir: "desc" },
    limit: 500,
  });
  if (!person_name) return rows.slice(0, limit);
  const needle = String(person_name).trim().toLowerCase();
  return rows
    .filter((r) =>
      String(r.person_name || "")
        .toLowerCase()
        .includes(needle),
    )
    .slice(0, limit);
}

export async function deleteRelationship(tenantDid, id) {
  await agentDataDelete({ tenantDid, table: RELATIONSHIPS_TABLE, rowKey: id });
}
