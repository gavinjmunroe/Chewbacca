/**
 * Partnerships data layer — the long-form companion to pipeline_investors,
 * pipeline_events, and pipeline_relationships.
 *
 * A `partnership` row models one named relationship that EVOLVES OVER TIME
 * and accumulates rich context: the Perplexity enterprise partnership, the
 * Carlo / Cory tax-credit thread, an advisor relationship with Karthik, a
 * vendor onboarding with the messaging provider. Where pipeline_investors stores a single
 * stage + a short thesis_fit_note, partnerships hold a long-form `pitch`
 * plus an append-only `history` of timestamped notes plus a list of
 * `next_actions` that survive across conversations.
 *
 * Tables:
 *   agent_data/{tenantDid}/partnerships/{partnership_id}
 *
 * Pinecone indexing happens via knowledge/partnerships-index.js — each
 * partnership and each history note becomes a queryable vector so Medha
 * can answer "what did Carlo propose?" with the actual pitch text rather
 * than a generic "I don't have anything on file."
 */

import {
  agentDataGet,
  agentDataUpsert,
  agentDataQuery,
  agentDataDelete,
} from "./agent-data.js";

export const PARTNERSHIPS_TABLE = "partnerships";

export const PARTNERSHIP_KINDS = new Set([
  "investor",
  "advisor",
  "partner",
  "vendor",
  "other",
]);

export const PARTNERSHIP_STATUSES = new Set([
  "exploring",
  "active",
  "paused",
  "closed",
]);

export const NEXT_ACTION_STATUSES = new Set(["open", "done", "cancelled"]);

/**
 * Stable ID derived from the partnership name so callers can re-create the
 * same partnership by name without first looking it up. Falls back to a
 * random suffix for ambiguous names (empty after slugging).
 */
export function buildPartnershipId(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug) return `partnership_${slug}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `partnership_anon_${Date.now().toString(36)}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clampStr(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeContacts(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw) continue;
    if (typeof raw === "string") {
      const name = raw.trim();
      if (name) out.push({ name });
      continue;
    }
    if (typeof raw === "object" && raw.name) {
      out.push({
        name: clampStr(raw.name, 200),
        role: clampStr(raw.role, 200) || null,
        contact_id: clampStr(raw.contact_id, 200) || null,
        email: clampStr(raw.email, 320) || null,
      });
    }
  }
  return out;
}

function normalizeNextActions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const description = clampStr(raw.description, 1000);
    if (!description) continue;
    const status = NEXT_ACTION_STATUSES.has(raw.status) ? raw.status : "open";
    out.push({
      id:
        clampStr(raw.id, 128) ||
        `na_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      due_date: clampStr(raw.due_date, 64) || null,
      status,
      created_at: clampStr(raw.created_at, 64) || nowIso(),
      completed_at: clampStr(raw.completed_at, 64) || null,
    });
  }
  return out;
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const note = clampStr(raw.note, 8000);
    if (!note) continue;
    out.push({
      ts: clampStr(raw.ts, 64) || nowIso(),
      note,
      source: clampStr(raw.source, 200) || null,
    });
  }
  return out;
}

export async function getPartnership(tenantDid, id) {
  if (!tenantDid || !id) return null;
  return agentDataGet({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
  });
}

export async function findPartnershipByName(tenantDid, name) {
  if (!tenantDid || !name) return null;
  const id = buildPartnershipId(name);
  const direct = await getPartnership(tenantDid, id);
  if (direct) return direct;
  const rows = await agentDataQuery({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    filters: [],
    order: { col: "updated_at", dir: "desc" },
    limit: 500,
  });
  const needle = String(name).trim().toLowerCase();
  return (
    rows.find(
      (r) =>
        String(r?.name || "")
          .trim()
          .toLowerCase() === needle,
    ) || null
  );
}

export async function listPartnerships(
  tenantDid,
  { kind, status, limit = 100 } = {},
) {
  if (!tenantDid) return [];
  const filters = [];
  if (kind && PARTNERSHIP_KINDS.has(kind)) {
    filters.push({ col: "kind", op: "eq", value: kind });
  }
  if (status && PARTNERSHIP_STATUSES.has(status)) {
    filters.push({ col: "status", op: "eq", value: status });
  }
  return agentDataQuery({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    filters,
    order: { col: "updated_at", dir: "desc" },
    limit,
  });
}

/**
 * Create or update a partnership. Patch semantics: any field omitted from
 * `patch` keeps its existing value. `history` is APPEND-ONLY through
 * appendPartnershipNote; setting it via this function replaces the whole
 * array (used during seed / import). `next_actions` is replaceable so
 * callers can clear stale items in one shot.
 */
export async function upsertPartnership(tenantDid, patch) {
  if (!tenantDid || !patch?.name) {
    throw new Error("tenantDid and patch.name are required");
  }
  const id = patch.id || buildPartnershipId(patch.name);
  const existing = await getPartnership(tenantDid, id);
  const now = nowIso();
  const kind = PARTNERSHIP_KINDS.has(patch.kind)
    ? patch.kind
    : existing?.kind || "partner";
  const status = PARTNERSHIP_STATUSES.has(patch.status)
    ? patch.status
    : existing?.status || "exploring";
  const row = {
    id,
    privy_did: tenantDid,
    name: clampStr(patch.name, 200),
    kind,
    status,
    org_name: clampStr(patch.org_name, 200) || existing?.org_name || null,
    pitch: clampStr(patch.pitch, 16000) ?? existing?.pitch ?? null,
    primary_contacts:
      patch.primary_contacts !== undefined
        ? normalizeContacts(patch.primary_contacts)
        : existing?.primary_contacts || [],
    history:
      patch.history !== undefined
        ? normalizeHistory(patch.history)
        : existing?.history || [],
    next_actions:
      patch.next_actions !== undefined
        ? normalizeNextActions(patch.next_actions)
        : existing?.next_actions || [],
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await agentDataUpsert({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return row;
}

/**
 * Append a timestamped note to the partnership's history. Returns the
 * full updated partnership row. The history array is bounded to the most
 * recent 500 entries to keep the Firestore doc under 1MB; trimmed entries
 * are still searchable in Pinecone via partnerships-index.js.
 */
export async function appendPartnershipNote(
  tenantDid,
  id,
  { note, source } = {},
) {
  if (!tenantDid || !id) {
    throw new Error("tenantDid and id are required");
  }
  const cleaned = clampStr(note, 8000);
  if (!cleaned) {
    throw new Error("note is required");
  }
  const existing = await getPartnership(tenantDid, id);
  if (!existing) return null;
  const entry = {
    ts: nowIso(),
    note: cleaned,
    source: clampStr(source, 200) || null,
  };
  const history = Array.isArray(existing.history) ? [...existing.history] : [];
  history.push(entry);
  const trimmed =
    history.length > 500 ? history.slice(history.length - 500) : history;
  const row = {
    ...existing,
    history: trimmed,
    updated_at: nowIso(),
  };
  await agentDataUpsert({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return { row, entry };
}

export async function addNextAction(
  tenantDid,
  id,
  { description, due_date } = {},
) {
  if (!tenantDid || !id) {
    throw new Error("tenantDid and id are required");
  }
  const cleaned = clampStr(description, 1000);
  if (!cleaned) {
    throw new Error("description is required");
  }
  const existing = await getPartnership(tenantDid, id);
  if (!existing) return null;
  const action = {
    id: `na_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    description: cleaned,
    due_date: clampStr(due_date, 64) || null,
    status: "open",
    created_at: nowIso(),
    completed_at: null,
  };
  const next_actions = Array.isArray(existing.next_actions)
    ? [...existing.next_actions, action]
    : [action];
  const row = {
    ...existing,
    next_actions,
    updated_at: nowIso(),
  };
  await agentDataUpsert({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return { row, action };
}

export async function completeNextAction(tenantDid, id, actionId) {
  if (!tenantDid || !id || !actionId) {
    throw new Error("tenantDid, id, and actionId are required");
  }
  const existing = await getPartnership(tenantDid, id);
  if (!existing) return null;
  const list = Array.isArray(existing.next_actions)
    ? existing.next_actions
    : [];
  let touched = false;
  const next_actions = list.map((a) => {
    if (a?.id !== actionId) return a;
    touched = true;
    return { ...a, status: "done", completed_at: nowIso() };
  });
  if (!touched) return { row: existing, found: false };
  const row = {
    ...existing,
    next_actions,
    updated_at: nowIso(),
  };
  await agentDataUpsert({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
    row,
  });
  return { row, found: true };
}

export async function deletePartnership(tenantDid, id) {
  if (!tenantDid || !id) return;
  await agentDataDelete({
    tenantDid,
    table: PARTNERSHIPS_TABLE,
    rowKey: id,
  });
}
