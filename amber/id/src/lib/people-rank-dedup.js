/**
 * Contact de-duplication + merge for PeopleRank (spec item 158).
 *
 * The unified people graph pulls the same human in from many sources: Apple
 * Contacts, Gmail "to" headers, LinkedIn, Slack. The result is several rows for
 * one person ("Shirley Park" from Apple, "shirley@rytual.com" from Gmail,
 * "@shirleyp" from Slack). Ranking each row separately splits a strong
 * relationship across three weak entries and shows the same face three times.
 *
 * This module collapses rows that are confidently the same person into ONE
 * ranked entry, BEFORE scoring, and merges their signals so the surviving row
 * carries the strongest evidence from every source.
 *
 * Match strategy (union-find over three exact keys):
 *   - a shared normalized phone number, or
 *   - a shared normalized email, or
 *   - an identical normalized full name AND at least one shared handle slot
 *     (so two different "John Smith"s with no shared contact info stay apart).
 *
 * Conservative on purpose: name-only collisions never merge (too many
 * namesakes). A wrong merge hides a real person; a missed merge just shows a
 * duplicate. We err toward missing.
 *
 * Merge rule for the survivor (the row with the most complete identity wins as
 * the base): take the MAX of warmth-ish numeric signals, the most RECENT
 * touchpoint, and the UNION of phones/emails/links. The survivor keeps a
 * `mergedFrom` array of the absorbed contact ids so the route can map feedback
 * or citations on any source id back to the merged entry.
 *
 * Pure: no Firestore, no network, no clock dependency.
 */

import { normalizePhone } from "./auth-session.js";

/** Lowercase+trim an email to a match key, or null. */
function emailKey(email) {
  if (typeof email !== "string") return null;
  const t = email.trim().toLowerCase();
  return t.indexOf("@") > 0 ? t : null;
}

/** Collect every normalized phone key on a contact (list field + scalar). */
function phoneKeys(contact) {
  const out = new Set();
  const push = (p) => {
    const n = normalizePhone(p);
    if (n) out.add(n);
  };
  if (Array.isArray(contact?.phoneNumbers)) contact.phoneNumbers.forEach(push);
  if (Array.isArray(contact?.phoneNumbersNormalized)) {
    contact.phoneNumbersNormalized.forEach(push);
  }
  if (contact?.phone) push(contact.phone);
  return out;
}

/** Collect every normalized email key on a contact (list field + scalar). */
function emailKeys(contact) {
  const out = new Set();
  const push = (e) => {
    const k = emailKey(e);
    if (k) out.add(k);
  };
  if (Array.isArray(contact?.emails)) contact.emails.forEach(push);
  if (Array.isArray(contact?.emailsNormalized)) {
    contact.emailsNormalized.forEach(push);
  }
  if (contact?.email) push(contact.email);
  return out;
}

/** Normalized full-name key, or null when blank. */
function nameKey(contact) {
  const n = String(contact?.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return n || null;
}

/** Epoch ms for any supported timestamp shape, else null. Local to this module. */
function tsMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") {
      try {
        return value.toMillis();
      } catch {
        return null;
      }
    }
    if (typeof value._seconds === "number") return value._seconds * 1000;
    if (typeof value.seconds === "number") return value.seconds * 1000;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Identity "completeness", how much we know about a contact. The most complete
 * row is chosen as the merge survivor so the entry that already has the richest
 * profile wins instead of an empty stub.
 */
function completeness(contact) {
  let score = 0;
  if (nameKey(contact)) score += 2;
  if (contact?.company) score += 1;
  if (contact?.title) score += 1;
  score += Math.min(phoneKeys(contact).size, 2);
  score += Math.min(emailKeys(contact).size, 2);
  if (contact?.relationshipScore) score += 1;
  if (contact?.context) score += 1;
  return score;
}

// ── union-find ────────────────────────────────────────────────────────────────

function find(parent, i) {
  let root = i;
  while (parent[root] !== root) root = parent[root];
  while (parent[i] !== root) {
    const next = parent[i];
    parent[i] = root;
    i = next;
  }
  return root;
}

function union(parent, a, b) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[ra] = rb;
}

/**
 * Merge a cluster of same-person rows into one. The most complete row is the
 * base; numeric signals take the max, the touchpoint takes the most recent, and
 * list fields union. Returns a NEW object (never mutates inputs).
 */
export function mergeContactCluster(rows) {
  const list = (rows || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return { ...list[0] };

  // Pick the survivor: most complete, ties broken by most recent touch.
  const survivor = list.slice().sort((a, b) => {
    const ca = completeness(a);
    const cb = completeness(b);
    if (cb !== ca) return cb - ca;
    return (tsMs(b.lastContactedAt) || 0) - (tsMs(a.lastContactedAt) || 0);
  })[0];

  const merged = { ...survivor };
  const mergedFrom = [];

  let maxRel = Number(survivor.relationshipScore) || 0;
  let maxFreq = Number(survivor.messageFrequency) || 0;
  let latestTouchMs = tsMs(survivor.lastContactedAt);
  const phones = new Set(
    Array.isArray(survivor.phoneNumbers) ? survivor.phoneNumbers : [],
  );
  const emails = new Set(Array.isArray(survivor.emails) ? survivor.emails : []);
  const sources = new Set(survivor.source ? [survivor.source] : []);

  for (const row of list) {
    if (row.id && row.id !== survivor.id) mergedFrom.push(row.id);
    maxRel = Math.max(maxRel, Number(row.relationshipScore) || 0);
    maxFreq = Math.max(maxFreq, Number(row.messageFrequency) || 0);
    const t = tsMs(row.lastContactedAt);
    if (t != null && (latestTouchMs == null || t > latestTouchMs)) {
      latestTouchMs = t;
    }
    if (Array.isArray(row.phoneNumbers))
      row.phoneNumbers.forEach((p) => phones.add(p));
    if (Array.isArray(row.emails)) row.emails.forEach((e) => emails.add(e));
    if (row.source) sources.add(row.source);
    // Backfill a missing scalar identity field from a sibling row.
    if (!merged.company && row.company) merged.company = row.company;
    if (!merged.title && row.title) merged.title = row.title;
    if (!merged.context && row.context) merged.context = row.context;
  }

  merged.relationshipScore = maxRel;
  merged.messageFrequency = maxFreq;
  if (latestTouchMs != null) merged.lastContactedAt = new Date(latestTouchMs);
  merged.phoneNumbers = [...phones];
  merged.emails = [...emails];
  if (sources.size > 1) merged.sources = [...sources];
  merged.mergedFrom = mergedFrom;
  return merged;
}

/**
 * De-duplicate a contact list. Returns { contacts, mergedCount, aliasMap }.
 *   contacts: the merged rows (one per real person), survivor order preserved.
 *   mergedCount: how many input rows were absorbed (input - output length).
 *   aliasMap: { [absorbedContactId]: survivorContactId } so a caller can
 *     redirect feedback / citations recorded against a duplicate id onto the
 *     surviving merged entry.
 */
export function dedupeContacts(contacts) {
  const list = Array.isArray(contacts) ? contacts.filter(Boolean) : [];
  const n = list.length;
  if (n <= 1) {
    return { contacts: list.slice(), mergedCount: 0, aliasMap: {} };
  }

  const parent = list.map((_, i) => i);
  const phoneIndex = new Map(); // phoneKey -> first row index
  const emailIndex = new Map(); // emailKey -> first row index
  const nameIndex = new Map(); // nameKey  -> [row indices]

  list.forEach((contact, i) => {
    for (const p of phoneKeys(contact)) {
      if (phoneIndex.has(p)) union(parent, i, phoneIndex.get(p));
      else phoneIndex.set(p, i);
    }
    for (const e of emailKeys(contact)) {
      if (emailIndex.has(e)) union(parent, i, emailIndex.get(e));
      else emailIndex.set(e, i);
    }
    const nk = nameKey(contact);
    if (nk) {
      const peers = nameIndex.get(nk) || [];
      // Same name only merges when a handle slot is shared with a peer.
      for (const j of peers) {
        if (sharesAnyHandle(contact, list[j])) union(parent, i, j);
      }
      peers.push(i);
      nameIndex.set(nk, peers);
    }
  });

  // Group rows by their union-find root, preserving first-seen order.
  const clusters = new Map();
  const order = [];
  list.forEach((_, i) => {
    const root = find(parent, i);
    if (!clusters.has(root)) {
      clusters.set(root, []);
      order.push(root);
    }
    clusters.get(root).push(i);
  });

  const out = [];
  const aliasMap = {};
  for (const root of order) {
    const idxs = clusters.get(root);
    const rows = idxs.map((i) => list[i]);
    const merged = mergeContactCluster(rows);
    if (!merged) continue;
    out.push(merged);
    if (Array.isArray(merged.mergedFrom)) {
      for (const absorbedId of merged.mergedFrom) {
        if (absorbedId && merged.id) aliasMap[absorbedId] = merged.id;
      }
    }
  }

  return { contacts: out, mergedCount: n - out.length, aliasMap };
}

/** True when two contacts share at least one phone or email key. */
function sharesAnyHandle(a, b) {
  const ap = phoneKeys(a);
  for (const p of phoneKeys(b)) if (ap.has(p)) return true;
  const ae = emailKeys(a);
  for (const e of emailKeys(b)) if (ae.has(e)) return true;
  return false;
}
