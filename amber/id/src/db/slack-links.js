/**
 * Slack -> phone identity link store (Chunk 4d; was Firestore).
 *
 * Backed by the amber `slack_links` table, PK (team, slack_user) — the natural
 * Slack key, NOT amber_id. The full link doc lives in the `data` jsonb column;
 * status/person_id/phone_e164 are mirrored as columns for ops. getLink returns
 * the full doc, so consumers (Slack transport, oauth-slack callback) are
 * unchanged.
 *
 * person_id derivation is deliberately identical to the iMessage side:
 *   person_id = sha256(toE164(phone)).slice(0, 32)
 * so a Slack-linked user's facts collide with existing iMessage history for the
 * same phone — that collision is the whole point.
 *
 * Doc shape (unchanged): { team_id, user_id, person_id, phone_e164, status,
 *   tenant_did, source_email, bind_method, channel, prompted_at, created_at,
 *   updated_at, linked_at }.
 */

import { createHash } from "node:crypto";
import { query } from "./sql.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(p) {
  const s = String(p || "").trim();
  if (!s) return null;
  return s.startsWith("+") ? s : `+${s}`;
}

/**
 * Match medha-imessage's iMessage person_id derivation so Slack and iMessage
 * history for the same phone end up on the same record.
 */
export function derivePersonIdFromPhone(phoneE164) {
  const normalized = normalizePhone(phoneE164);
  if (!normalized) return null;
  return createHash("sha256")
    .update(normalized.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

// Read the stored doc for (team, user), or null. Internal helper.
async function _readData(team, user) {
  const { rows } = await query(
    `SELECT data FROM slack_links WHERE team = $1 AND slack_user = $2`,
    [team, user],
  );
  return rows[0]?.data ?? null;
}

// Write the full merged doc, mirroring status/person_id/phone_e164 columns.
async function _writeData(team, user, data) {
  await query(
    `INSERT INTO slack_links (team, slack_user, status, person_id, phone_e164, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (team, slack_user) DO UPDATE
       SET status     = EXCLUDED.status,
           person_id  = EXCLUDED.person_id,
           phone_e164 = EXCLUDED.phone_e164,
           data       = EXCLUDED.data,
           updated_at = now()`,
    [
      team,
      user,
      data.status ?? null,
      data.person_id ?? null,
      data.phone_e164 ?? null,
      JSON.stringify(data),
    ],
  );
}

/** Look up an existing link. Returns the full doc or null if no row exists. */
export async function getLink(team, user) {
  if (!team || !user) return null;
  return _readData(team, user);
}

/**
 * Register (or refresh) a pending link. Idempotent — repeated calls for the
 * same (team, user) only touch updated_at. Never overwrites a row that has
 * already reached `linked` status.
 */
export async function upsertPending(team, user, extras = {}) {
  if (!team || !user) return;
  const existing = await _readData(team, user);
  if (existing?.status === "linked") return; // don't roll back a real binding
  const now = nowIso();
  const merged = {
    ...(existing || {}),
    team_id: team,
    user_id: user,
    status: "pending",
    person_id: null,
    phone_e164: null,
    channel: extras.channel || existing?.channel || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    linked_at: null,
  };
  await _writeData(team, user, merged);
}

/**
 * Has this (team, user) already been shown the one-time link offer?
 * True when `prompted_at` is set.
 */
export async function wasPrompted(team, user) {
  if (!team || !user) return false;
  const link = await _readData(team, user);
  return Boolean(link?.prompted_at);
}

/**
 * Stamp `prompted_at` so subsequent inbound messages don't re-offer the link.
 * Creates a minimal pending row if none exists yet.
 */
export async function markPrompted(team, user) {
  if (!team || !user) return;
  const existing = await _readData(team, user);
  const now = nowIso();
  if (!existing) {
    await _writeData(team, user, {
      team_id: team,
      user_id: user,
      status: "pending",
      person_id: null,
      phone_e164: null,
      created_at: now,
      updated_at: now,
      linked_at: null,
      prompted_at: now,
    });
    return;
  }
  await _writeData(team, user, {
    ...existing,
    prompted_at: now,
    updated_at: now,
  });
}

/**
 * System-initiated bind from an email match (Slack Option B). Same end-state as
 * completeLink (status="linked", person_id from sha256(phone)) plus provenance
 * (tenant_did, source_email, bind_method="auto_email") and a prompted_at stamp
 * so the soft P.S. offer never fires. Returns { personId, phone } or null.
 */
export async function autoBind(
  team,
  user,
  { tenantDid, phone: phoneRaw, sourceEmail } = {},
) {
  if (!team || !user) return null;
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const personId = derivePersonIdFromPhone(phone);
  if (!personId) return null;
  const existing = await _readData(team, user);
  const now = nowIso();
  await _writeData(team, user, {
    ...(existing || {}),
    team_id: team,
    user_id: user,
    person_id: personId,
    phone_e164: phone,
    status: "linked",
    tenant_did: tenantDid || null,
    source_email:
      typeof sourceEmail === "string" ? sourceEmail.toLowerCase() : null,
    bind_method: "auto_email",
    prompted_at: now,
    linked_at: now,
    updated_at: now,
    created_at: existing?.created_at || now,
  });
  return { personId, phone };
}

/**
 * Bind (team, user) -> personId directly, without phone derivation (Slack OAuth
 * callback: we know the installing user's session DID = person_id, not their
 * phone). phone_e164 stays unset so a later completeLink/autoBind with a real
 * phone wins. Returns { personId } or null.
 */
export async function linkByPersonId(team, user, personId, method = "oauth") {
  if (!team || !user || !personId) return null;
  const existing = await _readData(team, user);
  const now = nowIso();
  await _writeData(team, user, {
    ...(existing || {}),
    team_id: team,
    user_id: user,
    person_id: personId,
    status: "linked",
    bind_method: method,
    prompted_at: now,
    linked_at: now,
    updated_at: now,
    created_at: existing?.created_at || now,
  });
  return { personId };
}

/**
 * Bind (team, user) -> phone. Derives person_id from sha256(phone) so the id
 * matches the iMessage transport's person_id for the same number.
 * Returns { personId, phone } or null.
 */
export async function completeLink(team, user, phoneRaw) {
  if (!team || !user) return null;
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const personId = derivePersonIdFromPhone(phone);
  if (!personId) return null;
  const existing = await _readData(team, user);
  const now = nowIso();
  await _writeData(team, user, {
    ...(existing || {}),
    team_id: team,
    user_id: user,
    person_id: personId,
    phone_e164: phone,
    status: "linked",
    linked_at: now,
    updated_at: now,
    created_at: existing?.created_at || now,
  });
  return { personId, phone };
}
