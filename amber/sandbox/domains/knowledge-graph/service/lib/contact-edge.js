// contact-edge.js
// Tab 33 - Pure helpers for the contact-edge graph.
//
// An "edge" is an undirected relationship between two of the tenant's contacts,
// discovered from first-party memory: two people co-mentioned in a conversation
// or journal entry, sharing a calendar event, named together in a partnership
// thread, or working at the same company. The weekly relationship-snapshot job
// (Tab 32) scores how warm ONE relationship is; this layer captures the EDGES
// BETWEEN people so "mutual connections between Sagar and Carlo" and "intro path
// from me to a Stripe engineer" become answerable.
//
// Everything here is dependency-free and deterministic so it is unit-testable in
// isolation and reusable from both the discovery cron (jobs/contact-edges.js)
// and the read surface (knowledge/contact-edges-index.js). No Pinecone, no
// Firestore, no clock access beyond the timestamps the caller passes in.

import { contactIdFromName } from "./relationship-score.js";
import { nameBoundaryRegex } from "./name-boundary.js";

export const CONTACT_EDGE_KIND = "contact_edge";
export const CONTACT_EDGE_MARKER_KIND = "contact_edge_marker";

// Edges are a "social" dimension artifact per the six-dimension ontology.
export const CONTACT_EDGE_HEALTH_DIMENSION = "social";

// The relationship signals an edge can carry. `co_mentioned` and
// `shared_calendar` are derived from windowed memory; `same_org` from a shared
// company field; `introduced_by` is reserved for a future provenance pass and
// is accepted by the read filters but not yet produced by discovery.
export const EDGE_TYPES = Object.freeze([
  "co_mentioned",
  "shared_calendar",
  "same_org",
  "introduced_by",
]);

// Memory kinds whose participants can form an edge.
export const EDGE_SOURCE_KINDS = Object.freeze([
  "conversation",
  "journal_entry",
  "file_content",
  "image_content",
  "generated_image",
  "partnership",
  "calendar_event",
]);

// ---- ids (undirected -> sorted pair for a single canonical row) -------------

export function sortPair(aId, bId) {
  const a = String(aId);
  const b = String(bId);
  return a <= b ? [a, b] : [b, a];
}

// In-memory aggregation key.
export function edgeKey(aId, bId) {
  const [a, b] = sortPair(aId, bId);
  return `${a}::${b}`;
}

// Deterministic Pinecone vector id so the same pair upserts (strengthens)
// instead of duplicating across runs.
export function edgeId(aId, bId) {
  const [a, b] = sortPair(aId, bId);
  return `edge:${a}:${b}`;
}

// Per-day idempotency sentinel so a second discovery run for the same local day
// is a no-op (mirrors the consolidator's `dh-<date>-0` existence check).
export function markerId(dateStr) {
  return `edge_marker:${dateStr}`;
}

// ---- participant extraction --------------------------------------------------


/**
 * Roster entries whose display name is long enough to match safely in free
 * text. One-character names (and pure punctuation) are dropped to avoid wild
 * substring hits.
 */
function rosterMatchable(roster) {
  return (roster || []).filter((r) => {
    const name = String(r?.name || "").trim();
    return r?.id && name.replace(/[^a-z0-9]/gi, "").length >= 2;
  });
}

/**
 * Find every roster contact whose name appears in `text` on a word boundary.
 * Case-insensitive. Returns deduped [{ id, name }] in roster order.
 */
export function extractMentions(text, roster) {
  const hay = String(text || "");
  if (!hay.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const r of rosterMatchable(roster)) {
    if (seen.has(r.id)) continue;
    const re = nameBoundaryRegex(r.name, "i");
    if (!re) continue;
    if (re.test(hay)) {
      out.push({ id: r.id, name: r.name });
      seen.add(r.id);
    }
  }
  return out;
}

/**
 * The distinct contacts participating in one normalized record. Merges the
 * record's directly-attributed people, any roster names mentioned in its text,
 * and (for calendar events) its attendees. Each participant is tagged with how
 * it was found so the caller can classify the edge type.
 *
 * record: { id, kind, text, people:[{id,name}], attendees:[{id,name}] }
 * Returns a Map of contactId -> { id, name, viaAttendee:boolean }.
 */
export function participantsOf(record, roster) {
  const byId = new Map();
  const add = (p, viaAttendee) => {
    if (!p || !p.id) return;
    const prev = byId.get(p.id);
    if (prev) {
      if (viaAttendee) prev.viaAttendee = true;
      if (!prev.name && p.name) prev.name = p.name;
      return;
    }
    byId.set(p.id, {
      id: p.id,
      name: p.name || p.id,
      viaAttendee: !!viaAttendee,
    });
  };
  for (const p of record?.people || []) add(p, false);
  for (const p of record?.attendees || []) add(p, true);
  for (const m of extractMentions(record?.text, roster)) add(m, false);
  return byId;
}

// ---- edge discovery ----------------------------------------------------------

function emptyEdge(a, b) {
  const [aId, bId] = sortPair(a.id, b.id);
  const aName = aId === a.id ? a.name : b.name;
  const bName = bId === b.id ? b.name : a.name;
  return {
    key: edgeKey(aId, bId),
    contact_a_id: aId,
    contact_b_id: bId,
    contact_a_name: aName || aId,
    contact_b_name: bName || bId,
    co_mention_count: 0,
    shared_calendar_count: 0,
    same_org_count: 0,
    sources: [],
  };
}

function bumpEdge(map, a, b, type, sourceId) {
  if (a.id === b.id) return;
  const key = edgeKey(a.id, b.id);
  let edge = map.get(key);
  if (!edge) {
    edge = emptyEdge(a, b);
    map.set(key, edge);
  }
  if (type === "shared_calendar") edge.shared_calendar_count += 1;
  else if (type === "same_org") edge.same_org_count += 1;
  else edge.co_mention_count += 1;
  if (
    sourceId &&
    edge.sources.length < 50 &&
    !edge.sources.includes(sourceId)
  ) {
    edge.sources.push(sourceId);
  }
  // Keep the best display name we have seen for each side.
  const [aId] = sortPair(a.id, b.id);
  const aSide = aId === a.id ? a : b;
  const bSide = aId === a.id ? b : a;
  if (aSide.name && !aSide.name.startsWith("name:"))
    edge.contact_a_name = aSide.name;
  if (bSide.name && !bSide.name.startsWith("name:"))
    edge.contact_b_name = bSide.name;
}

/** Pick the dominant edge type from the per-type counts. */
export function dominantEdgeType(edge) {
  const ranked = [
    ["shared_calendar", edge.shared_calendar_count || 0],
    ["same_org", edge.same_org_count || 0],
    ["co_mentioned", edge.co_mention_count || 0],
  ].filter(([, n]) => n > 0);
  if (ranked.length === 0) return "co_mentioned";
  ranked.sort((x, y) => y[1] - x[1]);
  return ranked[0][0];
}

/**
 * Discover the day's edges from normalized records + an org-tagged roster.
 *
 * records: [{ id, kind, text, people, attendees }]
 * roster:  [{ id, name, org? }]
 *
 * Returns an array of day-edge aggregates (see emptyEdge shape, plus
 * evidence_count). Co-mention / shared-calendar / partnership signal comes from
 * the records; same-org signal from roster company fields.
 */
export function discoverEdges({ records = [], roster = [] } = {}) {
  const map = new Map();

  for (const rec of records) {
    if (!EDGE_SOURCE_KINDS.includes(rec?.kind)) continue;
    const parts = [...participantsOf(rec, roster).values()];
    if (parts.length < 2) continue;
    const isCalendar = rec.kind === "calendar_event";
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        // A calendar pairing only counts as shared_calendar when BOTH sides
        // were real attendees; a name merely mentioned in the event text is a
        // co-mention, not a shared meeting.
        const type =
          isCalendar && a.viaAttendee && b.viaAttendee
            ? "shared_calendar"
            : "co_mentioned";
        bumpEdge(map, a, b, type, rec.id);
      }
    }
  }

  // Same-org pass: contacts sharing a normalized company string.
  const byOrg = new Map();
  for (const r of roster) {
    const org = String(r?.org || "")
      .trim()
      .toLowerCase();
    if (!org || !r?.id) continue;
    if (!byOrg.has(org)) byOrg.set(org, []);
    byOrg.get(org).push({ id: r.id, name: r.name || r.id });
  }
  for (const [org, members] of byOrg) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        bumpEdge(map, members[i], members[j], "same_org", `org:${org}`);
      }
    }
  }

  return [...map.values()].map((e) => ({
    ...e,
    evidence_count:
      e.co_mention_count + e.shared_calendar_count + e.same_org_count,
  }));
}

// ---- strength + merge --------------------------------------------------------

/**
 * Edge strength in [0, 1]: mostly evidence volume (saturating at ~8 pieces),
 * lightly decayed by how stale the last evidence is (30-day half-ish life).
 */
export function edgeStrength({
  evidenceCount = 0,
  lastEvidenceAtMs,
  nowMs,
} = {}) {
  const volume = clamp(evidenceCount / 8, 0, 1);
  let recency = 1;
  if (typeof lastEvidenceAtMs === "number" && typeof nowMs === "number") {
    const days = Math.max(0, (nowMs - lastEvidenceAtMs) / 86400000);
    recency = Math.exp(-days / 30);
  }
  return round(0.75 * volume + 0.25 * volume * recency, 4);
}

/**
 * Merge a freshly-discovered day edge into the cumulative edge metadata already
 * stored in Pinecone (flat `extra` shape). Counts add; names and last-evidence
 * advance; sources union (capped). Returns the new cumulative metadata plus
 * derived edge_type / evidence_count / edge_strength.
 */
export function mergeEdge(existing, day, { nowMs } = {}) {
  const ex = existing || {};
  const co = (Number(ex.co_mention_count) || 0) + (day.co_mention_count || 0);
  const cal =
    (Number(ex.shared_calendar_count) || 0) + (day.shared_calendar_count || 0);
  const org = (Number(ex.same_org_count) || 0) + (day.same_org_count || 0);
  const sources = mergeSources(ex.sources, day.sources, 50);
  const lastMs =
    typeof nowMs === "number"
      ? Math.max(Number(ex.last_evidence_at_ms) || 0, nowMs)
      : Number(ex.last_evidence_at_ms) || 0;
  const evidence = co + cal + org;
  const merged = {
    contact_a_id: day.contact_a_id,
    contact_b_id: day.contact_b_id,
    contact_a_name:
      pickName(ex.contact_a_name, day.contact_a_name) || day.contact_a_id,
    contact_b_name:
      pickName(ex.contact_b_name, day.contact_b_name) || day.contact_b_id,
    co_mention_count: co,
    shared_calendar_count: cal,
    same_org_count: org,
    evidence_count: evidence,
    sources,
    last_evidence_at_ms: lastMs,
  };
  merged.edge_type = dominantEdgeType(merged);
  merged.edge_strength = edgeStrength({
    evidenceCount: evidence,
    lastEvidenceAtMs: lastMs || undefined,
    nowMs,
  });
  return merged;
}

function pickName(prev, next) {
  const p = String(prev || "");
  const n = String(next || "");
  // Prefer a real display name over a slug fallback.
  if (n && !n.startsWith("name:")) return n;
  if (p) return p;
  return n;
}

function mergeSources(prev, next, cap) {
  const out = [];
  const seen = new Set();
  for (const s of toArray(prev)) {
    if (s && !seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
    if (out.length >= cap) return out;
  }
  for (const s of next || []) {
    if (s && !seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
    if (out.length >= cap) break;
  }
  return out;
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [v];
    } catch {
      return [v];
    }
  }
  return [];
}

// ---- content -----------------------------------------------------------------

/** Natural-language description embedded as the edge vector's content. */
export function edgeContent(meta) {
  const a = meta.contact_a_name || meta.contact_a_id;
  const b = meta.contact_b_name || meta.contact_b_id;
  const bits = [];
  if (meta.co_mention_count > 0) {
    bits.push(
      `${meta.co_mention_count} co-mentioned item${meta.co_mention_count === 1 ? "" : "s"}`,
    );
  }
  if (meta.shared_calendar_count > 0) {
    bits.push(
      `${meta.shared_calendar_count} shared calendar event${meta.shared_calendar_count === 1 ? "" : "s"}`,
    );
  }
  if (meta.same_org_count > 0) bits.push("same organization");
  const detail = bits.length ? bits.join(", ") : "no recorded evidence";
  return `Edge between ${a} and ${b}: ${detail}.`;
}

// ---- read-side helpers (pure graph ops over fetched edge rows) ---------------

/**
 * Given the edges touching a node and that node's id, return the other endpoint
 * of each edge as a neighbor { id, name, edge_type, edge_strength, evidence_count }.
 */
export function neighborsFromEdges(edges, nodeId) {
  const out = [];
  for (const e of edges || []) {
    if (e.contact_a_id === nodeId) {
      out.push(neighbor(e, e.contact_b_id, e.contact_b_name));
    } else if (e.contact_b_id === nodeId) {
      out.push(neighbor(e, e.contact_a_id, e.contact_a_name));
    }
  }
  return out;
}

function neighbor(edge, id, name) {
  return {
    id,
    name: name || id,
    edge_type: edge.edge_type,
    edge_strength: Number(edge.edge_strength) || 0,
    evidence_count: Number(edge.evidence_count) || 0,
  };
}

/**
 * Resolve a caller-supplied contact reference to a contact_id, scanning known
 * edge endpoints for a name match (exact then substring, case-insensitive)
 * before falling back to the deterministic name slug.
 */
export function resolveFromEdges(edges, { contactId, contactName } = {}) {
  if (contactId) return contactId;
  if (!contactName) return null;
  const needle = String(contactName).toLowerCase().trim();
  const pool = [];
  for (const e of edges || []) {
    pool.push({ id: e.contact_a_id, name: e.contact_a_name });
    pool.push({ id: e.contact_b_id, name: e.contact_b_name });
  }
  const exact = pool.find((p) => (p.name || "").toLowerCase() === needle);
  if (exact) return exact.id;
  const partial = pool.find((p) =>
    (p.name || "").toLowerCase().includes(needle),
  );
  if (partial) return partial.id;
  return contactIdFromName(contactName);
}

// ---- small utils -------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}
