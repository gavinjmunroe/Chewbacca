/**
 * commitment-reminder.js — T-24h DM reminder cron for open commitments.
 *
 * flaw #30: For every open commitment whose event starts within the next
 * 24 hours and that has never been reminded, DM the committer once and
 * set reminded_at. 12 hours later if they still haven't responded, send
 * ONE follow-up. Hard cap: 3 outbound DMs to a person per event (decision
 * 28 in trip-planning.md).
 *
 * This module exposes runCommitmentReminderTick() so the proactive-runner
 * can call it on its existing hourly cadence — keeps the scheduler footprint
 * to one timer.
 *
 * BQ contract:
 *   SELECT commitment_id, event_id, person_id, item, reminded_at, source
 *   FROM medha_pdw.commitments JOIN medha_pdw.events USING (event_id)
 *   WHERE status='open' AND event.start_date BETWEEN now AND now+24h
 *
 * Eligibility: the committer must be opted_in for the event's group, NOT
 * stopped, and not over the 3-DM-per-event cap.
 */

import { query, tableRef, tenantId, isReady } from "./pdw/bq-client.js";
import { sendMessage } from "./transport.js";
import { listActiveTenants } from "./tenant.js";
import { loadGroupMemory } from "./group-memory.js";

const FOLLOWUP_HOURS = 12;
const MAX_DMS_PER_EVENT = 3;

/**
 * Look up the iMessage handle for a person_id. The persons table stores
 * primary_phone + imessage_handle; we prefer the phone, fall back to the
 * handle. Returns null if the person isn't in our table or BQ is down.
 */
async function handleForPersonId(personId) {
  const rows = await query(
    `
      SELECT primary_phone, imessage_handle
      FROM ${tableRef("persons")}
      WHERE tenant_id = @tenant AND person_id = @person_id
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    { tenant: tenantId(), person_id: personId },
  );
  const row = rows?.[0];
  return row?.primary_phone || row?.imessage_handle || null;
}

/**
 * Count DMs sent to a person for an event by reading the audit trail in
 * event_messages where direction='reminder'. Caps the spam at 3 per
 * decision 28.
 */
async function reminderCountForPersonOnEvent(personId, eventId) {
  const rows = await query(
    `
      SELECT COUNT(*) AS n
      FROM ${tableRef("event_messages")}
      WHERE tenant_id = @tenant
        AND event_id = @event_id
        AND from_person_id = @person_id
        AND direction = 'reminder'
    `,
    { tenant: tenantId(), event_id: eventId, person_id: personId },
  );
  return Number(rows?.[0]?.n || 0);
}

/**
 * Record that we sent a reminder DM — audit trail row + stamp the
 * commitments table's reminded_at. Best-effort.
 */
async function recordReminderSent({ commitmentId, eventId, personId, kind }) {
  const now = new Date().toISOString();
  const { insertRow, mergeRow } = await import("./pdw/bq-client.js");
  // Audit row
  await insertRow("event_messages", {
    tenant_id: tenantId(),
    event_id: eventId,
    message_id: `${commitmentId}-rem-${Date.now()}`,
    group_id: null,
    from_person_id: personId,
    direction: "reminder",
    body: kind === "followup" ? "T-12h follow-up" : "T-24h initial reminder",
    attachments: JSON.stringify({ commitment_id: commitmentId, kind }),
    sent_at: now,
  }).catch(() => {});
  // Stamp reminded_at on the commitments row so we don't pick it again.
  // Need the current row so we don't blow away the other columns.
  const rows = await query(
    `
      SELECT * FROM ${tableRef("commitments")}
      WHERE tenant_id = @tenant AND commitment_id = @commitment_id
      LIMIT 1
    `,
    { tenant: tenantId(), commitment_id: commitmentId },
  );
  const current = rows?.[0];
  if (!current) return;
  await mergeRow(
    "commitments",
    {
      tenant_id: current.tenant_id,
      commitment_id: current.commitment_id,
      event_id: current.event_id,
      person_id: current.person_id,
      item: current.item,
      normalized_item: current.normalized_item,
      status: current.status,
      source: current.source,
      committed_at: current.committed_at,
      reminded_at: now,
      completed_at: current.completed_at,
    },
    ["tenant_id", "commitment_id"],
  ).catch(() => {});
}

/**
 * Pull the candidate commitments for an initial T-24h reminder: open,
 * event starts within 24h, no reminded_at yet.
 */
async function pullInitialCandidates() {
  return query(
    `
      WITH latest_events AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            e.*,
            ROW_NUMBER() OVER (
              PARTITION BY tenant_id, event_id
              ORDER BY updated_at DESC
            ) AS rn
          FROM ${tableRef("events")} e
        )
        WHERE rn = 1
      ),
      latest_commits AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            c.*,
            ROW_NUMBER() OVER (
              PARTITION BY tenant_id, commitment_id
              ORDER BY committed_at DESC, reminded_at DESC
            ) AS rn
          FROM ${tableRef("commitments")} c
        )
        WHERE rn = 1
      )
      SELECT
        c.commitment_id, c.event_id, c.person_id, c.item, c.reminded_at,
        e.group_id, e.title, e.start_date, e.status AS event_status
      FROM latest_commits c
      JOIN latest_events e
        ON c.tenant_id = e.tenant_id AND c.event_id = e.event_id
      WHERE c.tenant_id = @tenant
        AND c.status = 'open'
        AND c.reminded_at IS NULL
        AND e.status IN ('planning', 'active')
        AND e.start_date IS NOT NULL
        AND TIMESTAMP(e.start_date) BETWEEN
          CURRENT_TIMESTAMP() AND TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      LIMIT 50
    `,
    { tenant: tenantId() },
  );
}

/**
 * Pull candidates for the T-12h follow-up: open commitments where we
 * already reminded once but never got a status change, and the initial
 * reminder is at least FOLLOWUP_HOURS old.
 */
async function pullFollowupCandidates() {
  return query(
    `
      WITH latest_events AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            e.*,
            ROW_NUMBER() OVER (
              PARTITION BY tenant_id, event_id
              ORDER BY updated_at DESC
            ) AS rn
          FROM ${tableRef("events")} e
        )
        WHERE rn = 1
      ),
      latest_commits AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            c.*,
            ROW_NUMBER() OVER (
              PARTITION BY tenant_id, commitment_id
              ORDER BY committed_at DESC, reminded_at DESC
            ) AS rn
          FROM ${tableRef("commitments")} c
        )
        WHERE rn = 1
      )
      SELECT
        c.commitment_id, c.event_id, c.person_id, c.item, c.reminded_at,
        e.group_id, e.title, e.start_date, e.status AS event_status
      FROM latest_commits c
      JOIN latest_events e
        ON c.tenant_id = e.tenant_id AND c.event_id = e.event_id
      WHERE c.tenant_id = @tenant
        AND c.status = 'open'
        AND c.reminded_at IS NOT NULL
        AND e.status IN ('planning', 'active')
        AND e.start_date IS NOT NULL
        AND TIMESTAMP(e.start_date) >= CURRENT_TIMESTAMP()
        AND c.reminded_at <= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
      LIMIT 50
    `,
    { tenant: tenantId(), hours: FOLLOWUP_HOURS },
  );
}

/**
 * For a candidate row, check the group's opt-in status. Returns true if
 * the committer is opted_in for this group and NOT stopped. Defaults to
 * false if we can't load the group or the person isn't in the opt-in map.
 */
async function isCommitterEligible(row, tenant) {
  if (!row.group_id) return false;
  const mem = await loadGroupMemory(row.group_id, tenant).catch(() => null);
  if (!mem?.optInStatus) return false;
  // optInStatus is keyed on handle, not person_id. Resolve the handle
  // first; if we can't find one, bail (better to skip than to spam).
  const handle = await handleForPersonId(row.person_id);
  if (!handle) return false;
  const status = mem.optInStatus[handle];
  return status === "opted_in";
}

function dmCopyInitial({ item, title }) {
  const ctx = title ? ` for ${title}` : "";
  return `quick heads up: you said you'd handle "${item}"${ctx} — coming up in ~24h. all set?`;
}

function dmCopyFollowup({ item, title }) {
  const ctx = title ? ` (${title})` : "";
  return `circling back on "${item}"${ctx} — let me know if it's handled or if you need help.`;
}

/**
 * Send one reminder DM and audit it. Returns true if a DM was sent.
 */
async function sendOneReminder({ row, kind, tenant }) {
  // 3-DM cap (decision 28).
  const sent = await reminderCountForPersonOnEvent(row.person_id, row.event_id);
  if (sent >= MAX_DMS_PER_EVENT) return false;

  const handle = await handleForPersonId(row.person_id);
  if (!handle) return false;

  const message =
    kind === "followup"
      ? dmCopyFollowup({ item: row.item, title: row.title })
      : dmCopyInitial({ item: row.item, title: row.title });

  try {
    // PR-I outbound audit: commitment reminders target the person whose
    // commitment is coming due. TODO(PR-H): once the dedicated reminder
    // runner shape lands, propagate the source webhookContact (the
    // person who committed) so the cross-tenant check can match.
    await sendMessage(handle, message, { tenant, auditOrigin: "reminder" });
  } catch (err) {
    console.warn(
      `[commitment-reminder] sendMessage failed for ${row.commitment_id}: ${err.message}`,
    );
    return false;
  }
  await recordReminderSent({
    commitmentId: row.commitment_id,
    eventId: row.event_id,
    personId: row.person_id,
    kind,
  });
  console.log(
    `[commitment-reminder] ${kind} → ${row.commitment_id} (${row.item}) for event ${row.event_id}`,
  );
  return true;
}

/**
 * Public entry point. Idempotent + safe to call on any cadence; the
 * reminded_at + audit-row counters keep us from double-DMing.
 *
 * Usage: extend the proactive-runner setInterval to also call this on
 * each tick. Or wire a separate timer with whatever cadence the env
 * prefers (hourly recommended per the spec).
 */
export async function runCommitmentReminderTick() {
  if (!isReady()) {
    console.log("[commitment-reminder] BQ not ready — skip");
    return { sent: 0, skipped: 0, eligible: 0 };
  }

  const tenants = await listActiveTenants(null).catch(() => []);
  // Use the first tenant for outbound DMs — the bus is shared across
  // tenants for now (single Loop org). Future per-tenant fanout can
  // join the events table with a tenant_id column.
  const dmTenant = tenants?.[0] || null;
  if (!dmTenant?.loopSenderId) {
    console.log("[commitment-reminder] no tenant with loopSenderId — skip");
    return { sent: 0, skipped: 0, eligible: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let eligible = 0;

  // Initial T-24h reminders.
  const initials = await pullInitialCandidates();
  for (const row of initials) {
    eligible++;
    const ok = await isCommitterEligible(row, dmTenant);
    if (!ok) {
      skipped++;
      continue;
    }
    const did = await sendOneReminder({
      row,
      kind: "initial",
      tenant: dmTenant,
    });
    if (did) sent++;
    else skipped++;
  }

  // T-12h follow-ups.
  const followups = await pullFollowupCandidates();
  for (const row of followups) {
    eligible++;
    const ok = await isCommitterEligible(row, dmTenant);
    if (!ok) {
      skipped++;
      continue;
    }
    const did = await sendOneReminder({
      row,
      kind: "followup",
      tenant: dmTenant,
    });
    if (did) sent++;
    else skipped++;
  }

  if (eligible > 0) {
    console.log(
      `[commitment-reminder] tick: eligible=${eligible} sent=${sent} skipped=${skipped}`,
    );
  }
  return { sent, skipped, eligible };
}
