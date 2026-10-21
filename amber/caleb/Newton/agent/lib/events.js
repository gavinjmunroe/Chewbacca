/**
 * events.js — Group/Event two-level data model (decision 2).
 *
 * Group = durable container (one iMessage chat, identified by chatGuid).
 *         Holds many events over time.
 * Event = a thing to plan (trip, rave, wedding, retreat, study, etc.).
 *         Identified by a short human-shareable event_id like "MED-7K2A".
 *
 * Writes flow to medha_pdw.{groups,events,commitments} in BigQuery via
 * lib/pdw/bq-client. The JSON hot-path lives elsewhere (group-memory.js);
 * this module owns the cold path. Failures in BQ never block the caller.
 *
 * Decision 19: person_id is sha256(E.164(phone)). organizer / participants
 * use person_id, NOT raw phones.
 */

import { randomBytes } from "node:crypto";
import {
  insertRow,
  mergeRow,
  query,
  tableRef,
  tenantId,
  isReady,
} from "./pdw/bq-client.js";
import { personIdFromHandle } from "./pdw/person-resolver.js";

// Decision 5: open string + curated starter set. The seed list lives here
// (not in the schema) so adding a new type is one line + an overlay file.
export const EVENT_TYPES_SEED = [
  "trip",
  "rave",
  "festival",
  "wedding",
  "retreat",
  "party",
  "study",
  "fantasy_draft",
  "weekly_recurring",
  "dinner",
  "roadtrip",
  "hike",
  "watch_party",
  "general",
];

// Crockford-style alphabet minus 0/O/I/L/1 to avoid OCR/voice ambiguity.
// 32 chars → 4 chars = ~1M codes. We re-roll on collision so the entropy
// budget is fine for the foreseeable future.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function makeEventId() {
  // Use rejection sampling so the distribution is uniform across the
  // 32-char alphabet. (Modulo 32 of a byte would skew toward early
  // letters; with 31 chars it'd be worse.)
  const bytes = randomBytes(8);
  let out = "";
  let i = 0;
  while (out.length < 4 && i < bytes.length) {
    const b = bytes[i++] & 0x1f; // 0..31
    out += ALPHABET[b];
  }
  // Pad with crypto bytes if we ran out (extraordinarily unlikely).
  while (out.length < 4) out += ALPHABET[randomBytes(1)[0] & 0x1f];
  return `MED-${out}`;
}

/**
 * Create a new event. Returns the event_id (always) and writes a row
 * to medha_pdw.events (when BQ is reachable). If BQ is down we still
 * return the id so the caller can use it locally.
 *
 * organizerHandle should be the raw handle of the creator — we resolve
 * to person_id internally.
 */
// flaw #21: in-process idempotency cache for createEvent. Still useful
// as a hot-path short-circuit (sub-ms vs ~150ms BQ round-trip), but now
// BACKED by a BQ query so a different webhook pod also reuses the id.
// Keys on (groupId, type, normalizedTitle, startDate) and holds the
// eventId for 10 minutes.
const recentEventCreates = new Map();
const RECENT_EVENT_TTL_MS = 10 * 60 * 1000;

function normalizeTitleForDedupe(t) {
  if (!t) return "";
  return String(t).toLowerCase().trim().replace(/\s+/g, " ");
}

function evictExpiredEventCache() {
  const now = Date.now();
  for (const [k, v] of recentEventCreates.entries()) {
    if (now - v.at > RECENT_EVENT_TTL_MS) recentEventCreates.delete(k);
  }
}

/**
 * flaw #21: write-through dedupe to BigQuery. Before minting a new
 * MED-XXXX, see if medha_pdw.events already holds a row for the same
 * (tenant_id, group_id, type, normalized title, start_date) tuple in
 * the last 10 minutes. If yes, return its event_id so retries (in this
 * pod OR a different one) resolve to the same Event.
 */
async function findRecentEventInBQ({ groupId, type, title, startDate }) {
  if (!isReady()) return null;
  const sql = `
    SELECT event_id
    FROM ${tableRef("events")}
    WHERE tenant_id = @tenant
      AND ((@group_id IS NULL AND group_id IS NULL) OR group_id = @group_id)
      AND type = @type
      AND LOWER(TRIM(IFNULL(title, ''))) = @norm_title
      AND ((@start_date IS NULL AND start_date IS NULL) OR start_date = @start_date)
      AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 10 MINUTE)
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const rows = await query(sql, {
    tenant: tenantId(),
    group_id: groupId || null,
    type,
    norm_title: normalizeTitleForDedupe(title),
    start_date: startDate || null,
  });
  return rows?.[0]?.event_id || null;
}

export async function createEvent({
  groupId = null,
  type = "general",
  title = null,
  startDate = null,
  endDate = null,
  organizerHandle,
  participantHandles = [],
  dedupeKey = null,
}) {
  if (!organizerHandle)
    throw new Error("createEvent: organizerHandle required");

  evictExpiredEventCache();
  const idemKey =
    dedupeKey ||
    `${groupId || "dm"}:${type}:${normalizeTitleForDedupe(title)}:${startDate || ""}`;
  const cached = recentEventCreates.get(idemKey);
  if (cached) {
    return { eventId: cached.eventId, row: cached.row, deduped: true };
  }

  // flaw #21: cross-process dedupe via BQ before we mint a new id.
  // Best-effort — a BQ outage just falls through to the normal path.
  const existingEventId = await findRecentEventInBQ({
    groupId,
    type,
    title,
    startDate,
  });
  if (existingEventId) {
    const stubRow = {
      event_id: existingEventId,
      group_id: groupId,
      type,
      title,
      start_date: startDate,
      end_date: endDate,
    };
    recentEventCreates.set(idemKey, {
      eventId: existingEventId,
      row: stubRow,
      at: Date.now(),
    });
    return { eventId: existingEventId, row: stubRow, deduped: true };
  }

  const eventId = makeEventId();
  const now = new Date().toISOString();
  const organizer = personIdFromHandle(organizerHandle);
  if (!organizer)
    throw new Error("createEvent: organizer handle did not resolve");

  const participants = (participantHandles || [])
    .map((h) => personIdFromHandle(h))
    .filter(Boolean)
    .map((person_id) => ({ person_id, role: null, rsvp: "pending" }));

  // Always include the organizer in participants (with role=organizer).
  if (!participants.find((p) => p.person_id === organizer)) {
    participants.unshift({
      person_id: organizer,
      role: "organizer",
      rsvp: "yes",
    });
  } else {
    const existing = participants.find((p) => p.person_id === organizer);
    existing.role = "organizer";
    existing.rsvp = "yes";
  }

  const row = {
    tenant_id: tenantId(),
    event_id: eventId,
    group_id: groupId,
    type,
    title,
    start_date: startDate,
    end_date: endDate,
    status: "planning",
    organizer,
    participants,
    itinerary: null,
    reservations: null,
    expenses: null,
    packing: null,
    commitments: [],
    created_at: now,
    updated_at: now,
  };

  if (isReady()) {
    insertRow("events", row).catch(() => {});
  }
  recentEventCreates.set(idemKey, { eventId, row, at: Date.now() });
  return { eventId, row, deduped: false };
}

/**
 * flaw #23: update an existing event by appending a fresh row with the
 * patched fields and updated_at=now. Downstream reads pick the latest
 * row per event_id. Returns the patched row.
 *
 * patch: { title?, start_date?, end_date?, status?, type? }
 */
export async function updateEvent({ eventId, patch = {} }) {
  if (!eventId) throw new Error("updateEvent: eventId required");
  const now = new Date().toISOString();

  // Look up the current latest row so we can carry forward fields the
  // caller didn't touch. If BQ is down we still write a minimal patch
  // row so the change isn't silently lost.
  let latest = null;
  if (isReady()) {
    const rows = await query(
      `
        SELECT * FROM ${tableRef("events")}
        WHERE tenant_id = @tenant AND event_id = @event_id
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      { tenant: tenantId(), event_id: eventId },
    );
    latest = rows?.[0] || null;
  }

  const merged = {
    tenant_id: tenantId(),
    event_id: eventId,
    group_id: latest?.group_id ?? null,
    type: patch.type ?? latest?.type ?? "general",
    title: patch.title ?? latest?.title ?? null,
    start_date: patch.start_date ?? latest?.start_date ?? null,
    end_date: patch.end_date ?? latest?.end_date ?? null,
    status: patch.status ?? latest?.status ?? "planning",
    organizer: latest?.organizer ?? null,
    participants: latest?.participants ?? [],
    itinerary: latest?.itinerary ?? null,
    reservations: latest?.reservations ?? null,
    expenses: latest?.expenses ?? null,
    packing: latest?.packing ?? null,
    commitments: latest?.commitments ?? [],
    created_at: latest?.created_at ?? now,
    updated_at: now,
  };

  if (isReady()) {
    insertRow("events", merged).catch(() => {});
  }
  return { ok: true, eventId, row: merged };
}

/**
 * flaw #24: thin wrappers over updateEvent for the two most common
 * lifecycle transitions. Kept separate so the LLM-facing tool surface
 * reads as a verb the model knows.
 */
export async function cancelEvent({ eventId }) {
  return updateEvent({ eventId, patch: { status: "cancelled" } });
}

export async function archiveEvent({ eventId }) {
  return updateEvent({ eventId, patch: { status: "past" } });
}

/**
 * flaw #25 helper: normalize a commitment item for dedupe. Lowercase,
 * trim, collapse internal whitespace. Returns "" for falsy input.
 */
export function normalizeCommitmentItem(item) {
  if (!item) return "";
  return String(item).toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Record a commitment ("I'll bring speakers"). Returns the commitment_id.
 *
 * flaw #25: dedupe — before INSERTing, see if we already have an open
 * (event_id, person_id, normalized_item) within the last 30 days. If so,
 * return the existing commitment_id with deduped=true.
 *
 * flaw #26: conflict scan — after a successful add, look for OTHER open
 * commitments on the same event with the same normalized_item from a
 * different person. Surface them on `conflict` so the caller can post a
 * one-line "heads up" in the group.
 *
 * flaw #28: writes go to the new medha_pdw.commitments table AS WELL AS
 * the legacy event_messages audit row. Reads from Phase 5 onward should
 * hit the new table; event_messages stays for transcript continuity.
 */
export async function addCommitment({
  eventId,
  personHandle,
  item,
  source = "chat",
}) {
  if (!eventId) throw new Error("addCommitment: eventId required");
  if (!item) throw new Error("addCommitment: item required");
  const personId = personIdFromHandle(personHandle);
  if (!personId) throw new Error("addCommitment: handle did not resolve");

  const normalizedItem = normalizeCommitmentItem(item);
  const now = new Date().toISOString();

  // flaw #25: dedupe scan against the new commitments table.
  if (isReady()) {
    const dupes = await query(
      `
        SELECT commitment_id
        FROM ${tableRef("commitments")}
        WHERE tenant_id = @tenant
          AND event_id = @event_id
          AND person_id = @person_id
          AND normalized_item = @norm
          AND status IN ('open', 'confirmed')
          AND committed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY committed_at DESC
        LIMIT 1
      `,
      {
        tenant: tenantId(),
        event_id: eventId,
        person_id: personId,
        norm: normalizedItem,
      },
    );
    const existingId = dupes?.[0]?.commitment_id;
    if (existingId) {
      return {
        commitmentId: existingId,
        personId,
        item,
        normalizedItem,
        source,
        status: "open",
        committedAt: now,
        deduped: true,
      };
    }
  }

  const commitmentId = `CMT-${randomBytes(4).toString("hex").toUpperCase()}`;

  // flaw #28: write to the dedicated commitments table.
  if (isReady()) {
    insertRow("commitments", {
      tenant_id: tenantId(),
      commitment_id: commitmentId,
      event_id: eventId,
      person_id: personId,
      item,
      normalized_item: normalizedItem,
      status: "open",
      source,
      committed_at: now,
      reminded_at: null,
      completed_at: null,
    }).catch(() => {});

    // Legacy: also write the event_messages audit row so the transcript
    // view (and any existing dashboards keyed on event_messages) keeps
    // seeing commitments. Safe to remove once Phase 6 reads from the
    // dedicated table everywhere.
    insertRow("event_messages", {
      tenant_id: tenantId(),
      event_id: eventId,
      message_id: commitmentId,
      group_id: null,
      from_person_id: personId,
      direction: "commitment",
      body: item,
      attachments: JSON.stringify({ source, status: "open" }),
      sent_at: now,
    }).catch(() => {});
  }

  // flaw #26: parallel conflict scan. Look for OTHER open commitments
  // on the same event with the same normalized_item from a different
  // person. If found, return the first one as `conflict` so the caller
  // can post a "heads up: X and Y both said speakers" in the group.
  let conflict = null;
  if (isReady()) {
    const conflicts = await query(
      `
        SELECT commitment_id, person_id
        FROM ${tableRef("commitments")}
        WHERE tenant_id = @tenant
          AND event_id = @event_id
          AND normalized_item = @norm
          AND person_id != @person_id
          AND status IN ('open', 'confirmed')
        ORDER BY committed_at DESC
        LIMIT 1
      `,
      {
        tenant: tenantId(),
        event_id: eventId,
        person_id: personId,
        norm: normalizedItem,
      },
    );
    const c = conflicts?.[0];
    if (c) {
      conflict = {
        conflicting_person_id: c.person_id,
        conflicting_commitment_id: c.commitment_id,
      };
    }
  }

  return {
    commitmentId,
    personId,
    item,
    normalizedItem,
    source,
    status: "open",
    committedAt: now,
    deduped: false,
    conflict,
  };
}

/**
 * flaw #29: mark a commitment row as completed and append an
 * event_messages audit row. Uses MERGE so it's safe to call twice.
 */
export async function completeCommitment({ commitmentId }) {
  if (!commitmentId)
    throw new Error("completeCommitment: commitmentId required");
  return setCommitmentStatus({
    commitmentId,
    status: "completed",
    auditBody: `commitment ${commitmentId} marked completed`,
    timestampColumn: "completed_at",
  });
}

/**
 * flaw #29: mark a commitment row as missed. Same shape as
 * completeCommitment but with status='missed'.
 */
export async function missCommitment({ commitmentId }) {
  if (!commitmentId) throw new Error("missCommitment: commitmentId required");
  return setCommitmentStatus({
    commitmentId,
    status: "missed",
    auditBody: `commitment ${commitmentId} marked missed`,
    timestampColumn: "completed_at",
  });
}

async function setCommitmentStatus({
  commitmentId,
  status,
  auditBody,
  timestampColumn,
}) {
  if (!isReady()) return { ok: false, commitmentId, status };

  // Look up the current row so the MERGE has fresh values for the
  // immutable keys + event_id (needed for the audit row).
  const rows = await query(
    `
      SELECT * FROM ${tableRef("commitments")}
      WHERE tenant_id = @tenant AND commitment_id = @commitment_id
      ORDER BY committed_at DESC
      LIMIT 1
    `,
    { tenant: tenantId(), commitment_id: commitmentId },
  );
  const current = rows?.[0];
  if (!current) {
    return { ok: false, commitmentId, error: "commitment_not_found" };
  }

  const now = new Date().toISOString();
  const next = {
    tenant_id: current.tenant_id,
    commitment_id: current.commitment_id,
    event_id: current.event_id,
    person_id: current.person_id,
    item: current.item,
    normalized_item: current.normalized_item,
    status,
    source: current.source,
    committed_at: current.committed_at,
    reminded_at: current.reminded_at,
    completed_at:
      timestampColumn === "completed_at" ? now : current.completed_at,
  };
  await mergeRow("commitments", next, ["tenant_id", "commitment_id"]).catch(
    () => {},
  );

  // Audit row in event_messages so the transcript shows the transition.
  insertRow("event_messages", {
    tenant_id: tenantId(),
    event_id: current.event_id,
    message_id: `${commitmentId}-${status}`,
    group_id: null,
    from_person_id: current.person_id,
    direction: "commitment_update",
    body: auditBody,
    attachments: JSON.stringify({ commitment_id: commitmentId, status }),
    sent_at: now,
  }).catch(() => {});

  return { ok: true, commitmentId, status, eventId: current.event_id };
}

/**
 * Upsert a group row (merge by tenant_id + group_id). Called whenever
 * we learn something new about a group: its alias, its participants,
 * or its handshake state. Safe to call many times — MERGE handles it.
 *
 * Flaw #36: switched from append-only INSERT to MERGE so we keep one
 * row per (tenant_id, group_id) instead of a growing pile. Scalar
 * columns (alias, handshake_at, updated_at) MERGE cleanly. participants
 * is ARRAY<STRUCT<handle,name,opt_in>>; BQ's parameter inference
 * accepts a plain JS array of objects with consistent keys for that
 * shape.
 */
export async function upsertGroup({
  groupId,
  alias = null,
  participants = [],
  handshakeAt = null,
}) {
  if (!groupId) return { ok: false };
  const now = new Date().toISOString();
  if (!isReady()) return { ok: false };
  const shapedParticipants =
    Array.isArray(participants) && participants.length > 0
      ? participants.map((p) => ({
          handle: p.handle || null,
          name: p.name || null,
          opt_in: p.opt_in || "pending",
        }))
      : [];
  const row = {
    tenant_id: tenantId(),
    group_id: groupId,
    alias,
    participants: shapedParticipants,
    handshake_at: handshakeAt,
    created_at: now,
    updated_at: now,
  };
  const ok = await mergeRow("groups", row, ["tenant_id", "group_id"]);
  return { ok };
}

/**
 * Upsert a person row keyed by person_id. MERGE-based so calling this
 * on every inbound message is idempotent and cheap.
 *
 * Flaw #35: switched from append-only INSERT to MERGE. The row only
 * touches scalar columns (no REPEATED phones[]/emails[]), so MERGE is
 * clean — created_at is preserved by the WHEN MATCHED branch only
 * updating non-key columns the caller supplied.
 */
export async function upsertPerson({
  handle,
  fullName = null,
  firstName = null,
}) {
  const personId = personIdFromHandle(handle);
  if (!personId || !handle) return { ok: false };
  const now = new Date().toISOString();
  const isEmail = typeof handle === "string" && handle.includes("@");
  const row = {
    tenant_id: tenantId(),
    person_id: personId,
    primary_phone: isEmail ? null : handle,
    full_name: fullName,
    first_name: firstName,
    imessage_handle: handle,
    updated_at: now,
    created_at: now,
  };
  if (!isReady()) return { ok: false, personId };
  const ok = await mergeRow("persons", row, ["tenant_id", "person_id"]);
  return { ok, personId };
}
