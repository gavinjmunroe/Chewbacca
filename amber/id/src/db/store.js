/**
 * SECURITY INVARIANT: every read in this file is scoped by owner_id (or phone,
 * which maps 1:1 to a single owner). No function may return rows across owners.
 * Functions that touch user data REQUIRE an owner_id or phone argument and
 * always filter by it in the WHERE clause — never skip that filter.
 */

import { query, withTransaction } from "./sql.js";
import { captureMergeSnapshot, recordMerge } from "./contact-merge-undo.js";
import { referencingColumns } from "./contact-refs.js";
import { resolveField, trustOf } from "../lib/source-trust.js";
import { contactDisplayName } from "../lib/contact-display-name.js";
import { phoneHash, KEY_TYPE } from "../lib/identity-keys.js";
import { nameBoundaryRegex } from "../lib/name-boundary.js";
import { normalizePhone } from "../lib/auth-session.js";
import { personIdFromHandle } from "../pdw/person-resolver.js";
import { deriveTags, deriveFacts } from "../enrichment/tag-from-enrichment.js";
import {
  applyContactUnion,
  applyContactUnionBatch,
  claimIdentityKeys,
  claimsForRecord,
  invalidateIdentityIndex,
  loadIdentityIndex,
  mergedColumnValues,
  noteContactWrite,
  planPayload,
  recordReviewCandidates,
  repointIdentityKeys,
  resolveContactIdentity,
  serializeSnapshot,
} from "./contact-identity.js";
import { unionEmailStrings, unionPhoneStrings } from "../lib/contact-identity.js";
// IMPORTED, not just re-exported. `export { x } from "./y.js"` forwards the name
// to importers and creates NO local binding, so calling insertContactFact()
// inside this file after only re-exporting it is a ReferenceError at runtime --
// the same shape as the _filedSoundex bug, and check:undef does not catch it
// either, because tsc treats a bare call in a .js file as an implicit global.
import { insertContactFact } from "./observations-compat.js";

// ─── helpers for the three functions below, ported to observations ───────────
//
// _mentionRows used to hit contact_notes and contact_experiences separately,
// each with a retry that ran the query twice — once with created_at and once
// without — because neither table reliably had the column. One table now, and
// observed_at is always there, so the retry and the second round-trip are gone.
async function _mentionRows(ownerId, { kind } = {}) {
  const { rows } = await query(
    `SELECT o.observation_id AS id, o.body AS mention_text, o.observed_at, o.kind,
            COALESCE((SELECT array_agg(p.contact_id) FROM observation_participants p
                       WHERE p.observation_id = o.observation_id), '{}') AS participant_ids
       FROM observations o
      WHERE o.owner_id = $1 AND o.deleted_at IS NULL AND o.status = 'resolved'
        AND ($2::text IS NULL OR o.kind = $2)
        AND EXISTS (SELECT 1 FROM observation_participants p
                     WHERE p.observation_id = o.observation_id)
      ORDER BY o.observed_at DESC
      LIMIT 500`,
    [ownerId, kind ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    participantIds: Array.isArray(r.participant_ids) ? r.participant_ids : [],
    text: r.mention_text ?? null,
    at: r.observed_at ? new Date(r.observed_at).getTime() : null,
    kind: r.kind,
  }));
}

// occurred_at and location were columns on contact_experiences. observed_at
// carries the first; location is resolved through places when it resolves at
// all, and is null until then rather than a free-text string nothing could use.
const _EXPERIENCE_SELECT = `
  SELECT o.observation_id AS id, o.body AS experience_text,
         o.observed_at AS occurred_at, NULL::text AS location, o.created_at,
         COALESCE((SELECT array_agg(p.contact_id) FROM observation_participants p
                    WHERE p.observation_id = o.observation_id), '{}') AS participant_ids,
         -- c.full_name and c.id, not c.display_name and c.contact_id. Neither of
         -- those two columns exists on contacts, so this whole SELECT threw and
         -- every experience came back with no participant names at all. The
         -- owner-scoped join is kept: contacts.id is unique on its own, but
         -- matching owner_id as well is what makes a cross-owner name impossible
         -- rather than merely unlikely.
         (SELECT array_agg(c.full_name ORDER BY c.full_name)
            FROM observation_participants p
            JOIN contacts c ON c.id = p.contact_id AND c.owner_id = p.owner_id
           WHERE p.observation_id = o.observation_id AND c.deleted_at IS NULL
         ) AS participant_names
    FROM observations o
   WHERE o.owner_id = $1 AND o.deleted_at IS NULL AND o.status = 'resolved'
     AND o.kind = 'experience'`;

function _mapExperienceRow(r) {
  return {
    id: String(r.id),
    text: r.experience_text ?? "",
    occurredAt: r.occurred_at ?? null,
    location: r.location ?? null,
    createdAt: r.created_at ?? null,
    participantIds: Array.isArray(r.participant_ids) ? r.participant_ids.map(String) : [],
    participantNames: Array.isArray(r.participant_names) ? r.participant_names.filter(Boolean) : [],
  };
}

// ─── PORTED TO observations ──────────────────────────────────────────────────
//
// Twenty-nine functions used to live here, reading and writing contact_facts,
// contact_notes, contact_experiences, user_facts, pending_fact_context,
// contact_name_memory and app_conversation_messages. They now live in
// observations-compat.js with their names, arguments and return shapes
// unchanged, so every route importing them from store.js keeps working and
// nothing here needs to know the storage changed.
//
// Re-exported rather than reimplemented, so the two versions cannot coexist.
export {
  insertContactFact, getResolvedFactsForContacts, getContactContentForContacts,
  getPendingFactsByName,
  getFactsForContact, getFactById, updateFactContact, appendFactDetail,
  insertUserFact, getUserFacts,
  insertContactNote, insertContactExperience,
  appendParticipantToNote, appendParticipantToExperience,
  setNoteParticipants, setExperienceParticipants,
  getNoteById, getExperienceById, getFiledPeopleForConversation,
  setPendingFactContext, updatePendingFactContext, getPendingFactContext,
  listPendingFactContext, getPendingFactContextById,
  clearPendingFactContextById, clearPendingFactContext,
  getContactNameMemory, upsertContactNameMemory, NAME_MEMORY_TRUST_STREAK,
  loadRecentMessages, appendMessage,
} from "./observations-compat.js";

// A RE-EXPORT CREATES NO LOCAL BINDING. The two that other code in this file
// still calls have to be imported as well -- without this the first call is a
// ReferenceError at runtime, which is exactly the class of bug the check:undef
// gate was added for.
import {
  getResolvedFactsForContacts as _getResolvedFactsForContacts,
  getContactNameMemory as _getContactNameMemory,
} from "./observations-compat.js";


// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUserByPhone(phone) {
  try {
    const { rows } = await query(
      `SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function createUser({ phone, fullName = null, status = "active" }) {
  try {
    const { rows: inserted } = await query(
      `INSERT INTO users (phone, full_name, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO NOTHING
       RETURNING *`,
      [phone, fullName, status],
    );
    if (inserted.length > 0) return inserted[0];
    // Conflict: row already exists — fetch and return it.
    const { rows: existing } = await query(
      `SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return existing[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Create an account FROM an inbound text, with the channel already armed.
 *
 * One statement rather than createUser-then-link, because the two-call version
 * has a failure mode with no way out: the insert lands, the link write does
 * not, and the number now has an account it can never reach -- every later text
 * is told to open the app and turn on a switch for an account whose only
 * existence is that text thread. Arming at birth is also the honest reading of
 * what happened; the message IS the consent, and there is no prior owner whose
 * account could be taken, because without the message there is no account.
 */
export async function enrollImessageUser({ phone, status = "awaiting_name" }) {
  try {
    const { rows: inserted } = await query(
      `INSERT INTO users (phone, status, imessage_linked_at, imessage_linked_phone)
       VALUES ($1, $2, now(), $1)
       ON CONFLICT (phone) DO NOTHING
       RETURNING *`,
      [phone, status],
    );
    if (inserted.length > 0) return inserted[0];
    const { rows: existing } = await query(
      `SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return existing[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Arm the iMessage channel for an account, for one exact number.
 *
 * The phone is never caller-supplied: every call site passes the phone off the
 * verified session, because a route that accepted a number in a request body
 * would be a way to point somebody else's texts at your account, which is a
 * larger hole than the one this whole change closes.
 */
export async function linkImessageChannel(amberId, phone) {
  try {
    const { rows } = await query(
      `UPDATE users
          SET imessage_linked_at = now(), imessage_linked_phone = $2, updated_at = now()
        WHERE amber_id = $1 AND deleted_at IS NULL
        RETURNING imessage_linked_at, imessage_linked_phone`,
      [amberId, phone],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Disarm it. Both columns move together or the CHECK refuses the row. */
export async function unlinkImessageChannel(amberId) {
  try {
    const { rowCount } = await query(
      `UPDATE users
          SET imessage_linked_at = NULL, imessage_linked_phone = NULL, updated_at = now()
        WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rowCount > 0;
  } catch {
    return false;
  }
}

/** What the settings screen reads. null when the account cannot be read at all. */
export async function getImessageLink(amberId) {
  try {
    const { rows } = await query(
      `SELECT phone, imessage_linked_at, imessage_linked_phone
         FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Canonical app-identity → Cloud SQL owner resolver: maps a verified E.164 phone to amber_id.
export async function resolveAmberIdByPhone(phone) {
  try {
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    if (rows[0]) return rows[0].amber_id;
    // User not yet in Cloud SQL — create them as active (authenticated app users
    // are active). Stamp the deterministic person_id (sha256 of the E.164 phone)
    // so iOS / medha-auth sessions (sub = 32-hex person_id) resolve to this row.
    // ON CONFLICT DO NOTHING means an existing row's person_id is never touched.
    const personId = personIdFromHandle(phone);
    const { rows: inserted } = await query(
      `INSERT INTO users (phone, status, person_id)
       VALUES ($1, 'active', $2)
       ON CONFLICT (phone) DO NOTHING
       RETURNING amber_id`,
      [phone, personId],
    );
    if (inserted.length > 0) {
      // A BRAND-NEW ACCOUNT CLAIMS ITS INVITES. Everyone who already had this
      // number in their address book gets their contact row linked to it now, so a
      // circle or a note shared before they signed up is visible on first launch
      // instead of never. Awaited rather than fire-and-forget: it runs exactly once
      // per account, and the first thing the app does after this is ask what has
      // been shared with them.
      await linkContactsToAmberUserByPhone(inserted[0].amber_id, phone);
      return inserted[0].amber_id;
    }
    // Conflict race: another request inserted first — fetch the winner.
    const { rows: existing } = await query(
      `SELECT amber_id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return existing[0]?.amber_id ?? null;
  } catch {
    return null;
  }
}

// Universal DID→amber_id resolver. Accepts four identifier shapes and returns
// the matching amber_id (verified to exist and not soft-deleted), else null:
//   1. did:amber:<uuid>  — synthetic DID minted for OTP/app-only users
//   2. bare <uuid>       — a raw amber_id passed through as a DID
//   3. 32-hex person_id  — iOS / medha-auth session sub (sha256 of E.164 phone)
//   4. real Privy DID    — matched against the backfilled privy_did column
// Purely additive: real Privy DIDs still resolve exactly as before; the amber/
// uuid/person_id branches only add resolution paths that previously returned null.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSON_ID_RE = /^[0-9a-f]{32}$/i;

export async function resolveAmberIdByPrivyDid(privyDid) {
  if (!privyDid) return null;
  try {
    const raw = String(privyDid);
    const amberMatch = /^did:amber:(.+)$/i.exec(raw);
    if (amberMatch && UUID_RE.test(amberMatch[1])) {
      const { rows } = await query(
        `SELECT amber_id FROM users WHERE amber_id = $1::uuid AND deleted_at IS NULL`,
        [amberMatch[1]],
      );
      return rows[0]?.amber_id ?? null;
    }
    if (UUID_RE.test(raw)) {
      const { rows } = await query(
        `SELECT amber_id FROM users WHERE amber_id = $1::uuid AND deleted_at IS NULL`,
        [raw],
      );
      return rows[0]?.amber_id ?? null;
    }
    // A bare uuid (36 chars, with dashes) never matches this 32-hex pattern, so
    // this branch is unambiguous vs. the amber_id branch above.
    if (PERSON_ID_RE.test(raw)) {
      const { rows } = await query(
        `SELECT amber_id FROM users WHERE person_id = $1 AND deleted_at IS NULL`,
        [raw],
      );
      return rows[0]?.amber_id ?? null;
    }
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE privy_did = $1 AND deleted_at IS NULL`,
      [raw],
    );
    return rows[0]?.amber_id ?? null;
  } catch {
    return null;
  }
}

// ── Tenant identity writes (Chunk 2b) ──────────────────────────────────────
// These replace the Privy customMetadata write path. tenant_metadata is a real
// jsonb blob (nested objects stored natively — no __json__: marker), so the
// merge happens SQL-side with `||` and callers pass raw nested objects.

/**
 * Get-or-create the user for `phone`, then merge `metadata` into their
 * tenant_metadata jsonb and set loop_sender_id from metadata.loopSenderId.
 * "never clobber a non-null with null": a null/absent metadata.loopSenderId
 * leaves an existing loop_sender_id untouched; a non-null value wins.
 * Returns the full users row (RETURNING *), or null on failure.
 */
export async function upsertTenant({ phone, metadata = {} }) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  try {
    const amberId = await resolveAmberIdByPhone(e164);
    if (!amberId) return null;
    const loopSenderId = metadata.loopSenderId ?? null;
    const { rows } = await query(
      `UPDATE users
          SET tenant_metadata = COALESCE(tenant_metadata, '{}'::jsonb) || $2::jsonb,
              loop_sender_id  = COALESCE($3, loop_sender_id),
              updated_at      = now()
        WHERE amber_id = $1
        RETURNING *`,
      [amberId, JSON.stringify(metadata), loopSenderId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Merge `patch` into a tenant's tenant_metadata (and loop_sender_id when
 * patch.loopSenderId is present). Resolves the identifier to an amber_id first
 * — accepts a `did:amber:<uuid>`, a Privy DID (via privy_did), or a bare
 * amber_id uuid. The metadata merge is done SQL-side (`||`), so there is no
 * read-modify-write race on the jsonb contents. Returns the row, or null.
 */
export async function setTenantMetadata(didOrAmberId, patch = {}) {
  if (!didOrAmberId) return null;
  try {
    const raw = String(didOrAmberId);
    const bare = raw.replace(/^did:amber:/, "");
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        bare,
      );
    // Resolve to a stable amber_id (immutable), then write. The cast to ::uuid
    // is guarded by isUuid so a non-uuid Privy DID never triggers a cast error.
    const { rows: found } = await query(
      `SELECT amber_id FROM users
        WHERE deleted_at IS NULL
          AND (privy_did = $1${isUuid ? " OR amber_id = $2::uuid" : ""})
        LIMIT 1`,
      isUuid ? [raw, bare] : [raw],
    );
    const amberId = found[0]?.amber_id ?? null;
    if (!amberId) return null;
    const loopSenderId = patch.loopSenderId ?? null;
    const { rows } = await query(
      `UPDATE users
          SET tenant_metadata = COALESCE(tenant_metadata, '{}'::jsonb) || $2::jsonb,
              loop_sender_id  = COALESCE($3, loop_sender_id),
              updated_at      = now()
        WHERE amber_id = $1
        RETURNING *`,
      [amberId, JSON.stringify(patch), loopSenderId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Reverse lookup: amber_id → phone. Used to resolve a linked Amber user's
// canonical phone for contact dedup (e.g. /v1/me/contacts/create with amberId).
export async function getUserPhoneByAmberId(amberId) {
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT phone FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rows[0]?.phone ?? null;
  } catch {
    return null;
  }
}

export async function setUserName(amberId, fullName) {
  try {
    const { rows } = await query(
      `UPDATE users
       SET full_name = $2, status = 'active', updated_at = now()
       WHERE amber_id = $1
       RETURNING *`,
      [amberId, fullName],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Partial-update all profile fields on the Cloud SQL users row. Only columns
// with a defined (non-undefined) value are included in the SET clause so a
// partial PATCH never nulls out fields that weren't sent.
export async function setUserProfileFields({
  amberId,
  fullName,
  currentCity,
  occupation,
  bio,
  mbti,
  school,
  hometown,
  horoscope,
  avatarUrl,
  privacyTier,
  onboardingCompletedAt,
  username,
}) {
  if (!amberId) return null;
  const sets = [];
  const params = [amberId];

  if (fullName !== undefined) {
    params.push(fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (currentCity !== undefined) {
    params.push(currentCity);
    sets.push(`current_city = $${params.length}`);
  }
  if (occupation !== undefined) {
    params.push(occupation);
    sets.push(`occupation = $${params.length}`);
  }
  if (bio !== undefined) {
    params.push(bio);
    sets.push(`bio = $${params.length}`);
  }
  if (mbti !== undefined) {
    params.push(mbti);
    sets.push(`mbti = $${params.length}`);
  }
  if (school !== undefined) {
    params.push(school);
    sets.push(`school = $${params.length}`);
  }
  if (hometown !== undefined) {
    params.push(hometown);
    sets.push(`hometown = $${params.length}`);
  }
  if (horoscope !== undefined) {
    params.push(horoscope);
    sets.push(`horoscope = $${params.length}`);
  }
  if (avatarUrl !== undefined) {
    params.push(avatarUrl);
    sets.push(`avatar_url = $${params.length}`);
  }
  if (privacyTier !== undefined) {
    params.push(privacyTier);
    sets.push(`privacy_tier = $${params.length}`);
  }
  if (onboardingCompletedAt !== undefined) {
    params.push(onboardingCompletedAt);
    sets.push(`onboarding_completed_at = $${params.length}`);
  }
  if (username !== undefined) {
    const uname = typeof username === "string" ? username.trim().toLowerCase() : null;
    if (uname && !/^[a-z0-9_]{3,20}$/.test(uname)) {
      return { error: "invalid_username" };
    }
    params.push(uname);
    sets.push(`username = $${params.length}`);
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = now()");

  try {
    const { rows } = await query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE amber_id = $1 AND deleted_at IS NULL
       RETURNING amber_id`,
      params,
    );
    return rows[0] ?? null;
  } catch (e) {
    if (e?.code === "23505") return { error: "username_taken" };
    return null;
  }
}

// ── Conversation history ───────────────────────────────────────────────────────

export async function getActiveUsers() {
  try {
    const { rows } = await query(
      `SELECT amber_id, phone, full_name
       FROM users
       WHERE status = 'active' AND full_name IS NOT NULL AND deleted_at IS NULL`,
      [],
    );
    return rows;
  } catch {
    return [];
  }
}

// ── Cloud SQL contact write (app identity path, owner-keyed by amber_id) ─────

// Strips all non-digit characters — same transform as the migration backfill's
// regexp_replace(phone_primary, '\D', '', 'g'). Keeps new writes consistent with
// the backfilled phone_primary_normalized values already in the DB.
function _digitsOnly(raw) {
  if (!raw || typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  return d.length ? d : null;
}

// Rows per statement. 500 × 12 params = 6k bind params, well under Postgres's
// 65535-parameter ceiling, and small enough that one failed chunk only costs a
// bounded per-row retry.
const CONTACT_CHUNK_SIZE = 500;

function _chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// "($1, $2, …), ($13, $14, …)" for a multi-row VALUES clause. `casts` maps a
// 0-based column index to a cast suffix (e.g. { 8: "::jsonb" }).
function _valuesPlaceholders(rowCount, colCount, casts = {}) {
  const groups = [];
  let n = 0;
  for (let r = 0; r < rowCount; r += 1) {
    const cols = [];
    for (let c = 0; c < colCount; c += 1) {
      n += 1;
      cols.push(casts[c] ? `$${n}${casts[c]}` : `$${n}`);
    }
    groups.push(`(${cols.join(", ")})`);
  }
  return groups.join(", ");
}

// The single source of truth for contact → column mapping. Identical to what
// the old per-contact path wrote, including the _digitsOnly normalization.
function _contactColumnValues(contact) {
  const phonePrimary = contact.phoneNumbers?.[0] ?? null;
  return {
    externalId: contact.externalId ?? null,
    fullName: contact.name,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    phonePrimary,
    phonesAll: (contact.phoneNumbers || []).join(", ") || null,
    emails: (contact.emails || []).join(", ") || null,
    company: contact.company ?? null,
    source: contact.source ?? "apple",
    phoneNormalized: _digitsOnly(phonePrimary),
    nickname: contact.nickname ?? null,
    // "YYYY-MM-DD" or nothing. The client drops a year-less Apple birthday
    // rather than inventing a year -- see birthdayForCard on the app side.
    birthday: contact.birthday ?? null,
  };
}

const CONTACTS_UPSERT_COLUMNS = `(owner_id, owner_phone, external_id, full_name, first_name, last_name,
              phone_primary, phones_all, emails, company, source,
              phone_primary_normalized, nickname, birthday, sync_snapshot)`;

/**
 * THE COLLISION TAIL, AND WHAT A COLLISION ACTUALLY MEANS HERE.
 *
 * This statement only ever runs for a cluster the planner decided was NEW. If it
 * collides on (owner_id, external_id) then the planner was WRONG -- the identity
 * index missed a card it should have matched -- and a wrong planner is the last
 * thing that should be trusted to overwrite a field. The old tail was
 * `full_name = EXCLUDED.full_name`, so a planner miss renamed a person Amber
 * already had, inside a statement whose entire premise was that she did not
 * exist. That is one of the paths that reset names edited by hand.
 *
 * So: FILL ONLY. A blank column takes the incoming value, a populated one is
 * left exactly as it is, and the baseline advances so the NEXT sync -- which
 * resolves this row through the identity index and the real three-way merge --
 * has something to compare against. A genuine upstream change on a colliding
 * card lands one sync late, which is the correct price for not trusting a
 * statement already proven wrong about this row.
 *
 * NULLIF, NOT BARE COALESCE: COALESCE('', x) is '', so an empty string written
 * by an older path would block the fill permanently and look like real data.
 *
 * DO UPDATE, NOT DO NOTHING, and RETURNING unchanged: DO NOTHING returns no row,
 * and the caller maps rows back by external_id and positionally for unkeyed
 * ones -- so every colliding contact would be counted as a failure.
 */
const CONTACTS_UPSERT_TAIL = `ON CONFLICT (owner_id, external_id)
             WHERE external_id IS NOT NULL AND deleted_at IS NULL
           DO UPDATE SET
             full_name                = COALESCE(NULLIF(contacts.full_name, ''),                EXCLUDED.full_name),
             first_name               = COALESCE(NULLIF(contacts.first_name, ''),               EXCLUDED.first_name),
             last_name                = COALESCE(NULLIF(contacts.last_name, ''),                EXCLUDED.last_name),
             phone_primary            = COALESCE(NULLIF(contacts.phone_primary, ''),            EXCLUDED.phone_primary),
             phones_all               = COALESCE(NULLIF(contacts.phones_all, ''),               EXCLUDED.phones_all),
             emails                   = COALESCE(NULLIF(contacts.emails, ''),                   EXCLUDED.emails),
             company                  = COALESCE(NULLIF(contacts.company, ''),                  EXCLUDED.company),
             source                   = COALESCE(NULLIF(contacts.source, ''),                   EXCLUDED.source),
             phone_primary_normalized = COALESCE(NULLIF(contacts.phone_primary_normalized, ''), EXCLUDED.phone_primary_normalized),
             nickname                 = COALESCE(NULLIF(contacts.nickname, ''),                 EXCLUDED.nickname),
             birthday                 = COALESCE(contacts.birthday,                             EXCLUDED.birthday),
             sync_snapshot            = COALESCE(EXCLUDED.sync_snapshot, contacts.sync_snapshot),
             updated_at               = now()
           RETURNING id, external_id`;


/**
 * THE INSERT-ONLY CONFLICT CLAUSE, and it is not a detail.
 *
 * The tail above is `DO UPDATE SET full_name = EXCLUDED.full_name, …`. Skipping
 * the merge in JavaScript is therefore only HALF of insert-only: if a cluster is
 * planned as an insert and then collides with an existing row on
 * (owner_id, external_id) -- which happens whenever the identity index missed a
 * card it should have matched -- this statement overwrites the name anyway. The
 * promise "nothing from Apple changes Amber" cannot rest on the planner never
 * being wrong.
 *
 * `DO UPDATE SET external_id = contacts.external_id` is a self-assignment: every
 * column keeps its value, updated_at is not touched, and -- unlike DO NOTHING --
 * the row is still RETURNED, so the caller can map it back to its input and does
 * not count a perfectly fine contact as a failure.
 */
const CONTACTS_INSERT_ONLY_TAIL = `ON CONFLICT (owner_id, external_id)
             WHERE external_id IS NOT NULL AND deleted_at IS NULL
           DO UPDATE SET external_id = contacts.external_id
           RETURNING id, external_id`;

// owner_id / owner_phone lead every row — owner scoping is structural here, the
// same as in the single-row path.
function _upsertRowParams(ownerId, ownerPhone, v) {
  return [
    ownerId, ownerPhone, v.externalId,
    v.fullName, v.firstName, v.lastName,
    v.phonePrimary, v.phonesAll, v.emails,
    v.company, v.source,
    v.phoneNormalized,
    v.nickname ?? null,
    v.birthday ?? null,
    // A FRESH ROW'S BASELINE IS WHAT WE ARE WRITING RIGHT NOW. Recorded at
    // insert so the very first re-sync has something to compare against;
    // without it every new contact would need one throwaway sync before an
    // upstream change could reach it.
    serializeSnapshot({
      full_name: v.fullName ?? null,
      first_name: v.firstName ?? null,
      last_name: v.lastName ?? null,
      company: v.company ?? null,
      phone_primary: v.phonePrimary ?? null,
      phones_all: v.phonesAll ?? null,
      emails: v.emails ?? null,
      nickname: v.nickname ?? null,
      birthday: v.birthday ?? null,
    }),
  ];
}

/**
 * Fold a payload cluster (one person, possibly several incoming cards) into a
 * single record to write. Scalars take the first non-empty value in payload
 * order; phones and emails UNION, so collapsing two duplicate cards cannot lose
 * the number that only one of them carried.
 */
/**
 * SHAPE BOUNDARY: this reads the SERVER shape only (phoneNumbers / company /
 * externalId), never the device shape (phones / organization / id). Mapping the
 * device shape is the route normalizer's job (normalizeIncomingContact), and
 * `_contactColumnValues` stays the single source of truth for what reaches a
 * column. Identity MATCHING is tolerant of both shapes (extractFacts) because it
 * also has to read stored rows — but a tolerant matcher must not turn into a
 * second, divergent write mapping.
 */
function _clusterRecord(cluster) {
  const records = cluster.records.map((r) => r.record);
  const first = records[0] || {};
  let phones = [];
  let emails = [];
  for (const r of records) {
    phones = unionPhoneStrings(phones, _displayValues(r.phoneNumbers));
    emails = unionEmailStrings(emails, _displayValues(r.emails));
  }
  const pick = (key) => {
    for (const r of records) {
      const v = r?.[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  return {
    ...first,
    name: pick("name") || first.name,
    firstName: pick("firstName"),
    lastName: pick("lastName"),
    company: pick("company"),
    phoneNumbers: phones,
    emails,
    source: first.source ?? null,
    // `externalId` only — NOT a fallback to `.id`. _contactColumnValues is the
    // single source of truth for contact → column mapping and it never read
    // `.id`; the route's normalizer is what maps a device-shape `id` onto
    // `externalId` (see normalizeIncomingContact), and folding that in here would
    // quietly give this function a second, divergent mapping.
    externalId: first.externalId ?? null,
  };
}

function _displayValues(...vals) {
  const out = [];
  for (const v of vals) {
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string" && item.trim()) out.push(item.trim());
    } else if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
    }
  }
  return out;
}

/**
 * Bulk contact upsert for one owner — the Apple-sync path, and the only writer
 * that handles whole address books.
 *
 * WRITE-TIME DEDUP (this is the point of the function now). Every incoming
 * record is resolved to a PERSON, not to a source identifier:
 *
 *   1. the payload is clustered against itself, which collapses the duplicate
 *      cards a single Apple sync ships (one owner sent 190 excess rows that way);
 *   2. each cluster is resolved against the owner's identity index — source key,
 *      then any phone (last-10), then any email, then a corroborated name;
 *   3. clusters that resolved become batched field-UNION updates, clusters that
 *      did not become inserts, and every touched row claims its identity keys.
 *
 * That makes a re-sync idempotent even when the client's external ids have all
 * rotated — the failure that took one owner's book from 2,245 to 4,162 rows.
 *
 * COST. Two extra queries per sync (the index load), then the same chunked
 * 500-row statement budget as before: a 4,000-contact sync is ~2 + 8 + 8 + 8
 * statements, not 8,000 round trips.
 *
 * FAIL-CLOSED. If the index cannot be loaded the error propagates instead of
 * falling back to blind inserts — writing a duplicate copy of an entire address
 * book is worse than a failed sync the client will retry.
 *
 * Preserved from the previous implementation: owner_id on every row and in every
 * WHERE; one transaction per chunk (committed independently); a failed chunk is
 * retried row-by-row so one bad contact never costs the others; provenance is
 * best-effort and can never fail the contact write.
 *
 * Returns { upserted, failed, inserted, merged, updated, deduped, reviewLinked }.
 * `upserted` counts input contacts (not rows) so the response the app parses is
 * unchanged in meaning.
 */
/** At most this many failures are described individually; the count is always exact. */
const FAILURE_DETAIL_CAP = 25;

/**
 * WHY A CONTACT DID NOT LAND, IN WORDS, ATTACHED TO WHICH CONTACT.
 *
 * `failed` was a bare integer and every path that incremented it swallowed the
 * error that caused it. The route logged "[contacts] some contacts failed to
 * upsert" with a count -- which appeared twice in his logs on a sync where
 * contacts he had just added did not show up in Amber, and told us nothing about
 * either of them. A number with no name and no reason is not a diagnostic; it is
 * an acknowledgment that something is wrong.
 *
 * Detail is capped so a wholly broken sync cannot write a thousand log lines,
 * but the COUNT is never capped.
 */
function _noteContactFailure(failures, record, reason, count = 1) {
  if (failures.length < FAILURE_DETAIL_CAP) {
    failures.push({
      name: record?.name ? String(record.name).slice(0, 60) : "(no name)",
      externalId: record?.externalId != null ? String(record.externalId).slice(0, 60) : null,
      source: record?.source ? String(record.source) : null,
      reason: String(reason || "unknown").slice(0, 200),
      count,
    });
  }
}

/** Postgres errors carry the useful part in code/constraint/detail, not in message. */
function _errText(e) {
  if (!e) return "unknown error";
  return [e.code, e.constraint, e.message || String(e), e.detail]
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
}

export async function upsertContactsForOwner({
  ownerId,
  ownerPhone,
  contacts,
  mode = "merge",
}) {
  // INSERT-ONLY: A RE-SYNC ADDS PEOPLE AND CHANGES NOBODY.
  //
  // "I noticed that when I did the refresh, it reset the names of the contacts I
  //  had edited in my Amber contact book... It should not change anything in
  //  Amber. Nothing from Apple should change Amber after the initial sync. It
  //  should only provide inserts, no edits, only inserts."
  //
  // He is right and the old behavior was indefensible. An Apple re-sync resolves
  // by rule 1 -- same source, same external id, the source restating a card it
  // owns -- which mergedColumnValues treats as AUTHORITATIVE, so the phone's
  // name overwrote the name he had typed. Every refresh silently undid his
  // editing. Nothing warned him and nothing recorded it.
  //
  // In this mode a cluster that resolves to an existing contact is left
  // completely alone: no column union, no rename, no re-primary-ing of the phone
  // list. Only clusters with no existing match are inserted.
  //
  // WHAT IS STILL WRITTEN, and why it is not an edit: identity keys
  // (contact_identity_keys) and provenance (contact_sources). Neither is a field
  // anybody can see or type; they are the index that makes a card resolve to an
  // Amber account, which is what lets a circle or a shared note reach the person.
  // Skipping them would mean a re-sync could never repair resolution, and no name
  // he has touched is involved.
  const insertOnly = mode === "insert_only";
  let upserted = 0;
  let failed = 0;
  let unchanged = 0;
  // Named, reasoned failures. See _noteContactFailure.
  const failures = [];
  if (!ownerId || !Array.isArray(contacts) || contacts.length === 0) {
    return {
      upserted,
      failed,
      failures,
      inserted: 0,
      merged: 0,
      updated: 0,
      unchanged: 0,
      deduped: 0,
      reviewLinked: 0,
    };
  }

  // Drop malformed records up front, exactly as the old per-contact catch did.
  const valid = [];
  for (const contact of contacts) {
    try {
      _contactColumnValues(contact);
      valid.push(contact);
    } catch (e) {
      failed += 1;
      _noteContactFailure(failures, contact, `rejected before the write: ${_errText(e)}`);
    }
  }

  // `fresh` on purpose: a whole-address-book sync must plan against a snapshot it
  // read itself, never against another request's cached one.
  const { index, rowsById } = await loadIdentityIndex(ownerId, { fresh: true });
  const { decisions } = planPayload(valid, index);

  const provenance = []; // { contactId, entry } for contact_sources
  const claims = []; // identity keys to claim
  const reviewLinks = [];
  const unions = []; // batched field-union updates
  const inserts = []; // { record, cluster, vals }
  let mergedCount = 0;
  let updatedCount = 0;
  let dedupedCount = 0;

  const addRecordArtifacts = (contactId, cluster) => {
    for (const { record } of cluster.records) {
      claims.push(...claimsForRecord(contactId, record));
      let vals;
      try {
        vals = _contactColumnValues(record);
      } catch {
        continue;
      }
      if (vals.externalId != null && vals.source) {
        provenance.push({ contactId, entry: { vals, contact: record, absorbed: 1 } });
      }
    }
  };

  // Insert rows must not collide on the legacy (owner_id, external_id) conflict
  // target inside one statement. Two DIFFERENT people can carry the same
  // external_id string from two different sources; identity now lives in
  // contact_identity_keys, so the later row's legacy column is left NULL rather
  // than fighting for the arbiter index.
  const seenExternalIds = new Set();

  for (const decision of decisions) {
    const { cluster, contactId, action, rule } = decision;
    const record = _clusterRecord(cluster);
    dedupedCount += cluster.records.length - 1;

    for (const link of decision.reviewLinks) {
      // A refused merge for a row we are about to create is recorded after the
      // insert (we need its id); links against an existing target are queued
      // with the resolved id below.
      reviewLinks.push({ pending: contactId == null, link, cluster });
    }

    if (contactId) {
      const row = rowsById.get(String(contactId));
      // A rule-1 hit is the source restating its own card → authoritative
      // (a device-side rename must propagate). An identity merge only fills.
      //
      // NOT IN INSERT-ONLY MODE. This branch is the one that reset his names:
      // an Apple re-sync is a rule-1 hit on every card he has ever synced, and
      // authoritative means the phone's name wins. In insert-only the row is
      // left exactly as it is and nothing is queued for it.
      const authoritative = rule === "source";
      const merged =
        row && !insertOnly
          ? mergedColumnValues(row, record, {
              authoritative,
              // THE THREE-WAY MERGE, and only on the path that owns this row.
              // An identity merge from a different card still fills only.
              snapshotAware: authoritative,
            })
          : null;
      if (merged) unions.push(merged);
      // `updated` used to increment even when mergedColumnValues returned null,
      // so it over-reported on every sync. A row that did not change, or whose
      // only change was the baseline advancing, is unchanged.
      if (insertOnly || !merged || merged._touch === false) {
        unchanged += cluster.records.length;
      } else if (action === "merge") mergedCount += 1;
      else updatedCount += 1;
      upserted += cluster.records.length;
      addRecordArtifacts(contactId, cluster);
      decision.resolvedId = String(contactId);
      continue;
    }

    let vals;
    try {
      vals = _contactColumnValues(record);
    } catch (e) {
      failed += cluster.records.length;
      _noteContactFailure(
        failures,
        record,
        `unusable columns: ${_errText(e)}`,
        cluster.records.length,
      );
      continue;
    }
    if (vals.externalId != null) {
      const key = String(vals.externalId);
      if (seenExternalIds.has(key)) vals = { ...vals, externalId: null };
      else seenExternalIds.add(key);
    }
    inserts.push({ decision, cluster, record, vals });
  }

  // ── Merges / updates: batched UNION statements ─────────────────────────────
  if (unions.length) {
    try {
      await applyContactUnionBatch(ownerId, unions);
    } catch {
      // One bad row must not cost the rest — same resilience as the insert path.
      for (const u of unions) {
        await applyContactUnionBatch(ownerId, [u]).catch(() => {});
      }
    }
  }

  // ── Inserts: the existing chunked multi-row upsert ─────────────────────────
  for (const chunk of _chunk(inserts, CONTACT_CHUNK_SIZE)) {
    const params = [];
    for (const entry of chunk) {
      params.push(..._upsertRowParams(ownerId, ownerPhone, entry.vals));
    }
    const sql = `INSERT INTO contacts
             ${CONTACTS_UPSERT_COLUMNS}
           VALUES ${_valuesPlaceholders(chunk.length, 15, { 13: "::timestamptz", 14: "::jsonb" })}
           ${insertOnly ? CONTACTS_INSERT_ONLY_TAIL : CONTACTS_UPSERT_TAIL}`;
    let rows = null;
    let chunkError = null;
    try {
      rows = await withTransaction(async (client) => {
        const res = await client.query(sql, params);
        return res.rows;
      });
    } catch (e) {
      // KEPT, not swallowed. The row-by-row retry below usually rescues the
      // chunk, but when it does not, this is the only description of what went
      // wrong with the whole statement -- and it used to be discarded on the
      // line where it was caught.
      chunkError = e;
      rows = null;
    }

    if (rows) {
      const idByExternalId = new Map(
        (rows || []).map((r) => [String(r.external_id), r.id]),
      );
      // RETURNING order is not guaranteed for the keyed rows; rows whose
      // external_id is NULL are matched positionally against what is left.
      const unkeyed = (rows || []).filter((r) => r.external_id == null).map((r) => r.id);
      let unkeyedAt = 0;
      for (const entry of chunk) {
        const id =
          entry.vals.externalId != null
            ? idByExternalId.get(String(entry.vals.externalId))
            : unkeyed[unkeyedAt++];
        if (id == null) {
          failed += entry.cluster.records.length;
          _noteContactFailure(
            failures,
            entry.record,
            "the insert returned no id for this row (RETURNING did not match it back)",
            entry.cluster.records.length,
          );
          continue;
        }
        upserted += entry.cluster.records.length;
        entry.decision.resolvedId = String(id);
        addRecordArtifacts(String(id), entry.cluster);
      }
    } else {
      const retry = await _upsertContactsRowByRow(ownerId, ownerPhone, chunk, {
        failures,
        chunkError,
        insertOnly,
      });
      upserted += retry.upserted;
      failed += retry.failed;
      provenance.push(...retry.provenance);
      claims.push(...retry.claims);
    }
  }

  const insertedCount = inserts.filter((i) => i.decision.resolvedId).length;

  // ── Identity keys: claim AFTER the rows are committed ─────────────────────
  // A conflict here means another contact already holds the key — including a
  // CONCURRENT sync that inserted first. Collapsing our row into the winner is
  // what keeps two simultaneous syncs from leaving a twin behind.
  const { conflicts } = await claimIdentityKeys(ownerId, claims).catch(() => ({
    conflicts: [],
  }));
  const collapseInto = new Map(); // winnerId → Set(loserIds)
  const freshIds = new Set(
    inserts.map((i) => i.decision.resolvedId).filter(Boolean),
  );
  for (const c of conflicts) {
    // Only collapse rows this sync created. An older row losing a key claim is a
    // pre-existing duplicate and belongs to the backfill/sweep, not to a request.
    if (!freshIds.has(String(c.contactId))) continue;
    if (String(c.winnerContactId) === String(c.contactId)) continue;
    if (!collapseInto.has(c.winnerContactId)) collapseInto.set(c.winnerContactId, new Set());
    collapseInto.get(c.winnerContactId).add(String(c.contactId));
  }
  for (const [winner, losers] of collapseInto) {
    await collapseContactGroup(ownerId, winner, [...losers]).catch(() => {});
  }

  // ── Provenance (contact_sources) — batched, best-effort ───────────────────
  await _insertContactSourcesBatch(ownerId, provenance).catch(() => {});

  // ── Review candidates for the pairs we refused to merge ───────────────────
  const links = [];
  for (const { pending, link, cluster } of reviewLinks) {
    const decision = decisions.find((d) => d.cluster === cluster);
    const selfId = decision?.resolvedId;
    if (!selfId) continue;
    if (pending || selfId) {
      links.push({
        contactId: selfId,
        candidateContactId: link.candidateContactId,
        reason: link.reason,
      });
    }
  }
  const reviewLinked = await recordReviewCandidates(ownerId, links).catch(() => 0);

  // The cached index is now stale by construction (this sync inserted and merged
  // rows); the next single-record caller must reload rather than plan against it.
  invalidateIdentityIndex(ownerId);

  return {
    upserted,
    failed,
    failures,
    inserted: insertedCount,
    merged: mergedCount,
    updated: updatedCount,
    // Cards that were already here and were deliberately not touched. Only ever
    // non-zero in insert-only mode, and the number the app should report: "12
    // new, 1,119 already here" is the honest description of a refresh.
    unchanged,
    deduped: dedupedCount,
    reviewLinked,
  };
}

/**
 * Resolve the live contact ids for a set of external ids under one owner.
 *
 * Used by the API-key (Clay) ingest path to map the deterministic external ids
 * it computed (synthesizeExternalId) back to the rows upsertContactsForOwner
 * just wrote, so it can apply extra columns (title / city / notes), return the
 * contact ids, and trigger re-embedding. Owner-scoped + parameterized.
 * Returns { [externalId]: contactId }.
 */
export async function getContactIdsByExternalIds(ownerId, externalIds) {
  if (!ownerId || !Array.isArray(externalIds) || externalIds.length === 0) return {};
  const ids = [...new Set(externalIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0) return {};
  try {
    const { rows } = await query(
      `SELECT id, external_id FROM contacts
        WHERE owner_id = $1 AND external_id = ANY($2::text[]) AND deleted_at IS NULL`,
      [ownerId, ids],
    );
    const map = {};
    for (const r of rows) map[String(r.external_id)] = String(r.id);
    return map;
  } catch {
    return {};
  }
}

/**
 * Per-row fallback for a chunk whose multi-row statement failed — one bad row
 * (bad encoding, constraint violation) then costs only itself, which is the
 * resilience the old per-contact loop had. Same statement, one row each.
 *
 * Takes the insert entries built by upsertContactsForOwner
 * ({ decision, cluster, record, vals }) and returns the provenance + identity-key
 * claims for the rows that made it, so a degraded chunk still ends up deduped on
 * the next sync.
 */
async function _upsertContactsRowByRow(ownerId, ownerPhone, chunk, opts = {}) {
  let upserted = 0;
  let failed = 0;
  const provenance = [];
  const claims = [];
  const failures = opts.failures;
  // What killed the batched statement, if anything. A row that fails again on
  // its own is usually failing for the same reason, and knowing the batch's
  // reason is often the only way to see it.
  const chunkWhy = opts.chunkError ? ` (batch also failed: ${_errText(opts.chunkError)})` : "";
  for (const entry of chunk) {
    const count = entry.cluster?.records?.length ?? 1;
    try {
      const { rows } = await query(
        `INSERT INTO contacts
           ${CONTACTS_UPSERT_COLUMNS}
         VALUES ${_valuesPlaceholders(1, 15, { 13: "::timestamptz", 14: "::jsonb" })}
         ${opts.insertOnly ? CONTACTS_INSERT_ONLY_TAIL : CONTACTS_UPSERT_TAIL}`,
        _upsertRowParams(ownerId, ownerPhone, entry.vals),
      );
      const contactId = rows[0]?.id;
      if (contactId == null) {
        failed += count;
        if (failures) {
          _noteContactFailure(
            failures,
            entry.record,
            `the insert returned no row${chunkWhy}`,
            count,
          );
        }
        continue;
      }
      upserted += count;
      if (entry.decision) entry.decision.resolvedId = String(contactId);
      for (const { record } of entry.cluster?.records ?? []) {
        claims.push(...claimsForRecord(String(contactId), record));
        let vals;
        try {
          vals = _contactColumnValues(record);
        } catch {
          continue;
        }
        if (vals.externalId != null && vals.source) {
          provenance.push({ contactId, entry: { vals, contact: record, absorbed: 1 } });
        }
      }
    } catch (e) {
      failed += count;
      if (failures) {
        _noteContactFailure(failures, entry.record, `${_errText(e)}${chunkWhy}`, count);
      }
    }
  }
  return { upserted, failed, provenance, claims };
}

/**
 * Batched contact_sources upsert. Same rows and same conflict semantics as
 * upsertContactSource (one live row per owner/source/external_id, raw stored
 * losslessly as jsonb), just many rows per statement. Best-effort throughout:
 * every chunk is independently swallowed so a provenance problem never
 * propagates to the caller.
 */
async function _insertContactSourcesBatch(ownerId, provenance) {
  if (!ownerId || provenance.length === 0) return;

  // Dedupe on the provenance idempotency key for the same reason the contacts
  // upsert dedupes: one statement cannot hit a conflict target twice.
  const rows = new Map();
  for (const { contactId, entry } of provenance) {
    const contact = entry.contact;
    const source = entry.vals.source;
    const externalId = entry.vals.externalId;
    if (!contactId || !source || !externalId) continue; // upsertContactSource's guard
    let rawJson;
    try {
      rawJson = contact != null ? JSON.stringify(contact) : null;
    } catch {
      rawJson = null; // unserializable payload — keep the provenance row anyway
    }
    rows.set(`${source}\0${externalId}`, [
      ownerId,
      contactId,
      source,
      externalId,
      entry.vals.fullName ?? null,
      Array.isArray(contact?.emails) ? contact.emails.join(", ") || null : null,
      Array.isArray(contact?.phoneNumbers)
        ? contact.phoneNumbers.join(", ") || null
        : null,
      entry.vals.company ?? null,
      rawJson,
    ]);
  }

  for (const chunk of _chunk([...rows.values()], CONTACT_CHUNK_SIZE)) {
    const params = chunk.flat();
    const sql = `INSERT INTO contact_sources
       (owner_id, contact_id, source, external_id, raw_full_name, raw_emails, raw_phones, raw_company, raw)
     VALUES ${_valuesPlaceholders(chunk.length, 9, { 8: "::jsonb" })}
     ON CONFLICT (owner_id, source, external_id) WHERE deleted_at IS NULL
     DO UPDATE SET
       contact_id    = EXCLUDED.contact_id,
       raw_full_name = EXCLUDED.raw_full_name,
       raw_emails    = EXCLUDED.raw_emails,
       raw_phones    = EXCLUDED.raw_phones,
       raw_company   = EXCLUDED.raw_company,
       raw           = EXCLUDED.raw,
       updated_at    = now()`;
    await withTransaction((client) => client.query(sql, params)).catch(() => {});
  }
}

// ── Canonical-contact dedup / merge (multi-source) ───────────────────────────

function _splitList(s) {
  return typeof s === "string" && s
    ? s.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
}

// Union phone display strings, deduped by digits-only form.
function _unionPhones(existing, incoming) {
  const out = [...existing];
  const seen = new Set(existing.map((p) => _digitsOnly(p)).filter(Boolean));
  for (const p of incoming) {
    const d = _digitsOnly(p);
    if (d) {
      if (!seen.has(d)) { seen.add(d); out.push(p); }
    } else if (p && !out.includes(p)) {
      out.push(p);
    }
  }
  return out;
}

// Union email strings, deduped case-insensitively (preserving first spelling).
function _unionEmails(existing, incoming) {
  const out = [...existing];
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  for (const e of incoming) {
    const lc = e.toLowerCase();
    if (!seen.has(lc)) { seen.add(lc); out.push(e); }
  }
  return out;
}

// NOTE: the old private phone/email matchers that lived here were removed with
// the write-time-dedup change. They were mergeContact's only matching rules and
// are now subsumed by the ONE shared cascade in db/contact-identity.js — keeping
// a second implementation is how the Apple path and the Google path drifted into
// disagreeing about who a person is in the first place.

// Upsert a contact_sources provenance row (idempotent on owner/source/external_id).
// No-op when source or externalId is missing (nothing to key on).
export async function upsertContactSource(ownerId, contactId, record) {
  if (!ownerId || !contactId || !record?.source || !record?.externalId) return;
  const rawEmails = Array.isArray(record.emails) ? record.emails.join(", ") || null : null;
  const rawPhones = Array.isArray(record.phones) ? record.phones.join(", ") || null : null;
  // Full original source payload, stored losslessly as jsonb.
  const rawJson = record.raw != null ? JSON.stringify(record.raw) : null;
  await query(
    `INSERT INTO contact_sources
       (owner_id, contact_id, source, external_id, raw_full_name, raw_emails, raw_phones, raw_company, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (owner_id, source, external_id) WHERE deleted_at IS NULL
     DO UPDATE SET
       contact_id    = EXCLUDED.contact_id,
       raw_full_name = EXCLUDED.raw_full_name,
       raw_emails    = EXCLUDED.raw_emails,
       raw_phones    = EXCLUDED.raw_phones,
       raw_company   = EXCLUDED.raw_company,
       raw           = EXCLUDED.raw,
       updated_at    = now()`,
    [
      ownerId,
      contactId,
      record.source,
      record.externalId,
      record.fullName ?? null,
      rawEmails,
      rawPhones,
      record.company ?? null,
      rawJson,
    ],
  );
}

/**
 * Collapse a source contact record into ONE canonical `contacts` row for the
 * owner, recording provenance in contact_sources. Owner-scoped, parameterized.
 *
 * record = { source, externalId, fullName, firstName, lastName, emails[],
 *            phones[], company }
 *
 * Resolution now runs through the ONE shared cascade (db/contact-identity.js), so
 * this path and the bulk Apple path can no longer disagree about who a person is:
 *   1) source key: (source, external_id), with the two Google id namespaces
 *      folded together, plus the legacy contact_sources / contacts lookups for
 *      rows that predate contact_identity_keys                       → 'updated'
 *   2) any phone (last-10)                                            → 'merged'
 *   3) any email (lowercased)                                         → 'merged'
 *   4) folded name + a corroborating signal                           → 'merged'
 *   —) no match                                                       → 'created'
 * A bare name match still never merges; the refused pair is logged to
 * contact_review_candidates instead. Every merge is field-UNION (invariant I3).
 *
 * Returns { contactId, action: 'created'|'merged'|'updated' } or null on error.
 */
export async function mergeContact(ownerId, record) {
  if (!ownerId || !record || !record.source) return null;
  const externalId = record.externalId ?? null;
  const recPhones = Array.isArray(record.phones) ? record.phones.filter(Boolean) : [];
  const recEmails = Array.isArray(record.emails)
    ? record.emails.map((e) => String(e).trim()).filter(Boolean)
    : [];

  try {
    const resolved = await resolveContactIdentity(ownerId, record);
    let contactId = resolved.contactId;
    let action = resolved.action === "update" ? "updated" : "merged";

    // Legacy fallbacks for owners whose rows predate contact_identity_keys AND
    // whose provenance is the only record of the source id. contact_sources
    // coverage is partial in prod (one owner: 2,286 rows for 4,162 contacts), so
    // both lookups stay.
    if (!contactId && externalId) {
      const { rows } = await query(
        `SELECT contact_id FROM contact_sources
          WHERE owner_id = $1 AND source = $2 AND external_id = $3 AND deleted_at IS NULL
          LIMIT 1`,
        [ownerId, record.source, externalId],
      );
      if (rows[0]) { contactId = rows[0].contact_id; action = "updated"; }
    }

    if (contactId) {
      // Web discoveries are enrichment, never authority over user-edited fields.
      const authoritative = action === "updated" && record.source !== "web_search";
      const ok = await applyContactUnion(ownerId, contactId, record, { authoritative });
      if (!ok) return null;
      await claimIdentityKeys(ownerId, claimsForRecord(String(contactId), record)).catch(
        () => null,
      );
      // Fold this write into the cached index. Without it a per-record importer
      // re-resolves against a snapshot that predates its own writes, so the NEXT
      // run misses, inserts, loses the key claim and has to collapse — churning
      // a row on every import instead of updating in place.
      noteContactWrite(ownerId, contactId, record);
      await upsertContactSource(ownerId, contactId, record);
      await recordReviewCandidates(
        ownerId,
        resolved.reviewLinks.map((l) => ({
          contactId: String(contactId),
          candidateContactId: l.candidateContactId,
          reason: l.reason,
        })),
      ).catch(() => 0);
      return { contactId: String(contactId), action };
    }

    // No match → create a new canonical contact, then claim its keys.
    const phonePrimary = recPhones[0] || null;
    const { rows: ins } = await query(
      // `title` IS IN THIS LIST BECAUSE IT WAS NOT, and Google supplies it.
      // normalizePerson reads organizations[0].title, carried it all the way
      // here, and this INSERT dropped it on the floor -- so every job title in a
      // Google address book was lost, and "any orthodontists" found nobody in a
      // book full of them. company was in the list; title simply had never been
      // added beside it.
      `INSERT INTO contacts
         (owner_id, external_id, full_name, first_name, last_name,
          phone_primary, phones_all, emails, company, title, source, phone_primary_normalized)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        ownerId,
        externalId,
        record.fullName ?? null,
        record.firstName ?? null,
        record.lastName ?? null,
        phonePrimary,
        recPhones.join(", ") || null,
        recEmails.join(", ") || null,
        record.company ?? null,
        record.title ?? null,
        record.source,
        _digitsOnly(phonePrimary),
      ],
    );
    const newId = ins[0].id;
    const { conflicts } = await claimIdentityKeys(
      ownerId,
      claimsForRecord(String(newId), record),
    ).catch(() => ({ conflicts: [] }));
    // A concurrent writer won a key between our resolve and our insert: collapse
    // into the winner rather than leaving a twin behind.
    //
    // BUT NEVER INTO SOMEBODY THE RESOLVER JUST REFUSED.
    //
    // That reasoning holds for a RACE -- a row that appeared after we looked, so
    // our resolve never had the chance to judge it. It is exactly wrong for a row
    // the resolver DID see and deliberately declined to merge with. Two different
    // people who share one phone number -- a household line, a shared office
    // line, a couple with one mobile -- resolve to `action: insert` with a review
    // link, because canMerge returns `name_conflict` and keeping both rows is the
    // documented behavior (see I2 in lib/contact-identity.js, and "two people
    // sharing ONE landline -> two rows, forever" in the acceptance tests).
    //
    // Then the insert claimed the shared phone, lost it to the row we had just
    // refused, and this collapsed the new person into them. Anna Whitfield and
    // Ben Kowalski, one office line: one row, named Anna, and Ben gone. Silently,
    // reported as `merged`, on the Google import, the signup path and any sync
    // that hits a key conflict.
    //
    // So a conflict against a REFUSED candidate is not a race and must not
    // collapse -- BUT ONLY WHEN THE CONFLICTING KEY IS A PHONE.
    //
    // The two identifiers are not equally personal, and the acceptance tests
    // already say so in both directions:
    //
    //   a shared PHONE   "two people sharing ONE landline -> two rows, forever"
    //                    Households, front desks and couples share a line. A name
    //                    conflict on a shared phone is two people, and the
    //                    refusal is right.
    //
    //   a shared EMAIL   "a shared email alone merges across sources, no name
    //                    needed" -- Venkat Ram and V. Ram on one address are one
    //                    person whose name the fold could not reconcile. Here the
    //                    identifier is stronger than the name check, and
    //                    collapsing is the correct repair.
    //
    // Blocking both broke the email case, which is how this distinction was
    // found: the first version of this guard turned that acceptance test from
    // merged to created.
    const refusedIds = new Set((resolved.reviewLinks ?? []).map((l) => String(l.candidateContactId)));
    const winner = conflicts.find((c) => {
      if (String(c.winnerContactId) === String(newId)) return false;
      const knownDifferentPerson =
        refusedIds.has(String(c.winnerContactId)) && String(c.keyType) === "phone";
      return !knownDifferentPerson;
    });
    if (winner) {
      await collapseContactGroup(ownerId, winner.winnerContactId, [String(newId)]).catch(
        () => null,
      );
      await upsertContactSource(ownerId, winner.winnerContactId, record);
      noteContactWrite(ownerId, winner.winnerContactId, record);
      return { contactId: String(winner.winnerContactId), action: "merged" };
    }
    noteContactWrite(ownerId, newId, record);
    await upsertContactSource(ownerId, newId, record);
    await recordReviewCandidates(
      ownerId,
      resolved.reviewLinks.map((l) => ({
        contactId: String(newId),
        candidateContactId: l.candidateContactId,
        reason: l.reason,
      })),
    ).catch(() => 0);
    return { contactId: String(newId), action: "created" };
  } catch {
    return null;
  }
}

/**
 * Collapse a dedup group into one survivor contact -- losslessly, atomically, and
 * across EVERY table that hangs off a contact id.
 *
 * For the owner's `survivorId`, absorb `absorbedIds[]`: union phones_all + emails
 * and fill blank scalars on the survivor, repoint every child row off the absorbed
 * ids onto the survivor, then SOFT-delete the absorbed contacts so it stays
 * reversible.
 *
 * IT USED TO REPOINT TWO CHILDREN OUT OF SEVENTEEN, and that was the bug.
 * contact_sources and contact_identity_keys moved; observations, favorites,
 * circle memberships, name memories, dimension state, scores, interaction stats,
 * the embedding, intro requests, voice vocabulary, media, events and contact-scoped
 * shares all stayed pointed at the absorbed row -- which was then soft-deleted.
 * Every query that joins live contacts stopped seeing them. So a merge silently
 * took away the absorbed card's notes, its place in your circles and the fact you
 * had favorited them, while reporting success. This runs on the SIGNUP path
 * (_claimKeysForNewContact) and on every contact sync that hits a key conflict, so
 * it was not a rare path.
 *
 * SOFT DELETE IS WHY THE CASCADE DOES NOT SAVE US. Migration 018 gave every child
 * `(owner_id, contact_id) REFERENCES contacts(owner_id, id) ON DELETE CASCADE`, and
 * that is exactly what makes deleteContactCascade a single statement. But a
 * collapse sets deleted_at; it deletes no row, so no cascade fires and nothing is
 * moved for us. Each child has to be repointed by hand, and each one has to be
 * repointed in a way that respects ITS OWN unique key.
 *
 * THREE KINDS OF CHILD, because a blind `UPDATE ... SET contact_id` is wrong for
 * two of them:
 *
 *   PLAIN -- contact_id is in no unique key, so every row can simply move.
 *
 *   DEDUPED -- contact_id is half of a unique key with a sibling column
 *   (observation_participants on observation_id, circle_members on circle_id,
 *   intro_requests on requester within the pending partial index). If the survivor
 *   is already in that circle, or already a participant on that observation, moving
 *   the absorbed row raises 23505 and rolls back the whole merge. The extra row is
 *   also meaningless -- one person cannot be two participants. So duplicates are
 *   dropped first, keeping the survivor's own row where it exists and otherwise the
 *   oldest, and the survivor is ordered first explicitly rather than by luck. This
 *   also covers TWO ABSORBED ROWS colliding with each other, which a
 *   survivor-versus-absorbed check alone would miss.
 *
 *   DERIVED -- contact_scores, contact_interaction_stats, contact_dimension_state
 *   and contact_embedding are computed FROM the observations we just moved. Merging
 *   them arithmetically would invent numbers; the absorbed rows are dropped and the
 *   next rollup recomputes the survivor's from the merged truth. The survivor's own
 *   rows are deliberately LEFT IN PLACE rather than deleted: stale until the next
 *   rollup is a slightly low score, whereas absent would drop the contact out of
 *   every ranked list until then. contact_embedding self-heals without any help --
 *   contact-vectors.js re-embeds when content_hash stops matching the card, and the
 *   card's content just changed.
 *
 * FAVORITES ARE MERGED, NOT PICKED. tags is user-entered, so the survivor's row
 * ends up holding the union of every tag on every card in the group, and the
 * earliest position and created_at. Dropping the absorbed row's tags would be
 * exactly the "useful info" this function is supposed to retain.
 *
 * REVIEW CANDIDATES ARE DROPPED, and that is not information loss: a review
 * candidate is a SUGGESTION that two cards might be the same person. Merging them
 * is the answer to that question, so a row naming an absorbed card is a resolved
 * suggestion, and repointing it would leave rows claiming the survivor is a
 * possible duplicate of itself.
 *
 * ONE TRANSACTION. The previous version ran five statements on five pooled
 * connections and ended in `catch { return { ok: false } }`, so a failure halfway
 * left provenance moved, keys not moved, and the contact not deleted -- with the
 * caller told only "not ok". Now the whole collapse commits or none of it does, and
 * a failure is logged with its SQLSTATE instead of being swallowed. The return
 * shape is unchanged for the seven existing callers, which check `res.ok`.
 */

/** contact_id is in no unique key on these: every row can simply move. */
const _COLLAPSE_PLAIN = [
  ["observations", null],
  ["contact_name_memory", null],
  ["voice_vocabulary", null],
  ["people_rank_feedback", null],
  ["media_assets", null],
  ["events", null],
  // contact_sources' unique key is (owner_id, source, external_id) -- contact_id
  // is not part of it, so provenance always moves in full. Nothing is dropped.
  ["contact_sources", "updated_at = now()"],
];

/**
 * contact_id is half of a unique key. [table, sibling column, tiebreak column]:
 * duplicates within each sibling group are dropped, survivor first then oldest.
 */
const _COLLAPSE_DEDUPED = [
  ["observation_participants", "observation_id", "created_at"],
  ["circle_members", "circle_id", "added_at"],
];

/** Recomputed from the observations we just moved. Absorbed rows are dropped. */
/**
 * EVERY TABLE THIS FUNCTION NAMES OUT LOUD.
 *
 * The lists above and the explicit blocks below handle these by hand, because
 * each one needs something a generic repoint cannot do: a unique key to
 * dedupe against, a tag union, a partial index, a cache to drop rather than
 * move. Everything else that carries a foreign key to contacts is repointed
 * generically after them, discovered from pg_constraint.
 *
 * THIS SET IS THE BUG THAT MADE IT NECESSARY. event_participants shipped on
 * 2026-09-03 with an FK to contacts and was added to none of these lists, so
 * every collapse since then left its rows pointing at a card that was then
 * soft-deleted. The FK is ON DELETE CASCADE, but a soft delete does not
 * cascade, so nothing complained -- the rows simply stopped being reachable
 * and people dropped off meetings they had attended. A list written by hand
 * fails exactly this way, silently and later, so the list is now the
 * exception and discovery is the rule.
 */
const _COLLAPSE_HANDLED = new Set([
  "observations",
  "contact_name_memory",
  "voice_vocabulary",
  "people_rank_feedback",
  "media_assets",
  "events",
  "contact_sources",
  "observation_participants",
  "circle_members",
  "intro_requests",
  "contact_favorites",
  "contact_scores",
  "contact_interaction_stats",
  "contact_dimension_state",
  "contact_embedding",
  "contact_review_candidates",
  // Moved last, on this transaction's client, by repointIdentityKeys().
  "contact_identity_keys",
]);

const _COLLAPSE_DERIVED = [
  "contact_scores",
  "contact_interaction_stats",
  "contact_dimension_state",
  "contact_embedding",
];

export async function collapseContactGroup(
  ownerId,
  survivorId,
  absorbedIds,
  // Who asked. The resolver collapsing duplicates during a sync is "auto"; a
  // person tapping Merge is "user". It lands in contact_merges and is the
  // difference between "we did this to your address book" and "you did this",
  // which is the first thing anyone wants to know when reviewing an undo.
  { origin = "auto", rule = "collapse" } = {},
) {
  if (
    !ownerId ||
    !survivorId ||
    !Array.isArray(absorbedIds) ||
    absorbedIds.length === 0
  ) {
    return { ok: false, reason: "missing_args", collapsed: 0 };
  }
  // A group that names the survivor among the absorbed would soft-delete the row
  // everything was just repointed onto.
  const losers = absorbedIds.map(String).filter((id) => id !== String(survivorId));
  if (losers.length === 0) return { ok: false, reason: "survivor_only", collapsed: 0 };

  const survivor = String(survivorId);
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, full_name, first_name, last_name, phone_primary,
                phones_all, emails, company, avatar_url,
                title, city, linkedin_url, external_id, source,
                source_tier, field_sources
           FROM contacts
          WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [ownerId, [survivor, ...losers]],
      );
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      const surv = byId.get(survivor);
      if (!surv) return { ok: false, reason: "survivor_not_found", collapsed: 0 };

      // THE PHOTOGRAPH. This function is the destructive one -- below it deletes
      // duplicate rows outright in observation_participants, circle_members,
      // intro_requests and contact_favorites, drops colliding identity keys, and
      // overwrites the survivor's scalars. None of that is recoverable after the
      // commit, so it is captured first, on this client, inside this transaction.
      //
      // Best-effort: a failed snapshot must not fail a merge the resolver already
      // decided on. It is logged with snapshot null instead, which reads as "not
      // undoable" rather than an undo button that quietly does nothing.
      let _snapshot = null;
      try {
        _snapshot = await captureMergeSnapshot(client, ownerId, survivor, losers);
      } catch (e) {
        console.error(
          `CONTACT_COLLAPSE_SNAPSHOT_FAILED owner=${ownerId} survivor=${survivor} ` +
            `${e?.code || ""} ${e?.message || e}`,
        );
      }

      // WHERE A FIELD CAME FROM. field_sources is a {column: source_label} map
      // written beside the value it describes. A row without one falls back to
      // its own `source` label standing in for all of its fields, which is the
      // honest answer for every row written before per-field provenance existed.
      const _fieldSource = (row, field) => {
        const fs = row?.field_sources;
        const named = fs && typeof fs === "object" ? fs[field] : null;
        return named || row?.source || null;
      };

      // THE SURVIVOR IS NOT AUTOMATICALLY RIGHT. Which card survives is decided
      // by how much is attached to it, which says nothing about whether its
      // spelling of a name is better than the one the user typed by hand on the
      // other card. So each contested field is settled by the trust of the
      // source that wrote it -- owner-stated over owner-synced over
      // amber-derived over vendor -- and the survivor wins only ties. Blanks and
      // identical values are not contests, so this still fills gaps exactly the
      // way the old `keeper || loser` did.
      const _SCALARS = [
        "full_name", "first_name", "last_name", "company", "title", "city",
        "linkedin_url", "avatar_url", "phone_primary", "source",
      ];
      // external_id is deliberately NOT here. It is half of an identity key
      // (source + external_id is how the next sync finds this row again), not a
      // display field, so it fills a blank and is otherwise left alone. Letting
      // trust move it would hand the survivor a key its own source will never
      // send again, and the next sync would rebuild the duplicate we just merged.
      const _FILL_ONLY = ["external_id"];

      const _field = {};
      const _fieldSrc = {};
      for (const f of [..._SCALARS, ..._FILL_ONLY]) {
        _field[f] = surv[f] ?? null;
        _fieldSrc[f] = _fieldSource(surv, f);
      }

      let phones = _splitList(surv.phones_all).length
        ? _splitList(surv.phones_all)
        : surv.phone_primary
          ? [surv.phone_primary]
          : [];
      let emails = _splitList(surv.emails);

      for (const absId of losers) {
        const a = byId.get(absId);
        if (!a) continue; // already gone -- the repoints below still run (idempotent)
        // Phones and emails are never contested. A person having two numbers is
        // not two cards disagreeing about one number, so both lists are kept
        // whole and deduped rather than one replacing the other.
        const aPhones = _splitList(a.phones_all).length
          ? _splitList(a.phones_all)
          : a.phone_primary
            ? [a.phone_primary]
            : [];
        phones = _unionPhones(phones, aPhones);
        emails = _unionEmails(emails, _splitList(a.emails));

        for (const f of _SCALARS) {
          const r = resolveField(
            { value: a[f] ?? null, source: _fieldSource(a, f) },
            { value: _field[f], source: _fieldSrc[f] },
          );
          if (r.winner === "incoming") {
            _field[f] = r.value;
            _fieldSrc[f] = _fieldSource(a, f);
          }
        }
        for (const f of _FILL_ONLY) {
          const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
          if (blank(_field[f]) && !blank(a[f])) {
            _field[f] = a[f];
            _fieldSrc[f] = _fieldSource(a, f);
          }
        }
      }

      // The card is labeled by its most authoritative contributor, and the tier
      // column is derived from that label so the two cannot drift apart. This
      // cannot relabel an Apple card as a Clay one: vendor is the bottom tier,
      // so `source` does not move and the per-source breakdown is untouched.
      const _survSource = _field.source;
      const _survTier = trustOf(_survSource);
      const _phonePrimary = _field.phone_primary;
      const _mergedSources = Object.fromEntries(
        Object.entries(_fieldSrc).filter(([, v]) => v != null),
      );

      await client.query(
        `UPDATE contacts SET
           full_name = $3, first_name = $4, last_name = $5, company = $6,
           avatar_url = $7, phone_primary = $8, phone_primary_normalized = $9,
           phones_all = $10, emails = $11,
           title = $12, city = $13, linkedin_url = $14, external_id = $15,
           source = $16, source_tier = $17,
           field_sources = COALESCE(field_sources, '{}'::jsonb) || $18::jsonb,
           updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [
          survivor,
          ownerId,
          _field.full_name,
          _field.first_name,
          _field.last_name,
          _field.company,
          _field.avatar_url,
          _phonePrimary,
          _digitsOnly(_phonePrimary),
          phones.join(", ") || null,
          emails.join(", ") || null,
          _field.title,
          _field.city,
          _field.linkedin_url,
          _field.external_id,
          _survSource,
          _survTier,
          JSON.stringify(_mergedSources),
        ],
      );

      // $1 owner, $2 survivor, $3 absorbed. A statement that does not reference
      // $2 cannot be given this array: Postgres infers a parameter's type from
      // where it is used, and an unreferenced one raises 42P18 "could not
      // determine data type of parameter $2". Those statements take PL instead.
      const P = [ownerId, survivor, losers];
      const PL = [ownerId, losers];
      const moved = {};
      const note = (label, n) => {
        if (n > 0) moved[label] = (moved[label] ?? 0) + n;
      };

      for (const [table, extra] of _COLLAPSE_PLAIN) {
        const r = await client.query(
          `UPDATE ${table} SET contact_id = $2::uuid${extra ? `, ${extra}` : ""}
            WHERE owner_id = $1 AND contact_id = ANY($3::uuid[])`,
          P,
        );
        note(table, r.rowCount ?? 0);
      }

      for (const [table, sibling, tiebreak] of _COLLAPSE_DEDUPED) {
        // ctid because these tables have composite primary keys and no surrogate
        // id to name a row by. `contact_id = survivor DESC` puts the survivor's own
        // row first so it is the one kept; otherwise the oldest wins, which is
        // deterministic and identical on a re-run.
        const dropped = await client.query(
          `DELETE FROM ${table}
            WHERE ctid IN (
              SELECT ctid FROM (
                SELECT ctid, row_number() OVER (
                         PARTITION BY ${sibling}
                         ORDER BY (contact_id = $2::uuid) DESC, ${tiebreak} ASC, ctid ASC
                       ) AS rn
                  FROM ${table}
                 WHERE owner_id = $1
                   AND (contact_id = $2::uuid OR contact_id = ANY($3::uuid[]))
              ) ranked WHERE ranked.rn > 1
            )`,
          P,
        );
        note(`${table}:dropped`, dropped.rowCount ?? 0);
        const r = await client.query(
          `UPDATE ${table} SET contact_id = $2::uuid
            WHERE owner_id = $1 AND contact_id = ANY($3::uuid[])`,
          P,
        );
        note(table, r.rowCount ?? 0);
      }

      // intro_requests: the unique index is PARTIAL (pending and not deleted), so
      // only live pending requests from the same requester can collide. Anything
      // answered or withdrawn moves untouched, which keeps the history.
      const introDropped = await client.query(
        `DELETE FROM intro_requests
          WHERE id IN (
            SELECT id FROM (
              SELECT id, row_number() OVER (
                       PARTITION BY requester_amber_id
                       ORDER BY (contact_id = $2::uuid) DESC, created_at ASC, id ASC
                     ) AS rn
                FROM intro_requests
               WHERE owner_id = $1 AND status = 'pending' AND deleted_at IS NULL
                 AND (contact_id = $2::uuid OR contact_id = ANY($3::uuid[]))
            ) ranked WHERE ranked.rn > 1
          )`,
        P,
      );
      note("intro_requests:dropped", introDropped.rowCount ?? 0);
      const intros = await client.query(
        `UPDATE intro_requests SET contact_id = $2::uuid
          WHERE owner_id = $1 AND contact_id = ANY($3::uuid[])`,
        P,
      );
      note("intro_requests", intros.rowCount ?? 0);

      // FAVORITES: union the tags, keep the earliest position and created_at.
      const { rows: favRows } = await client.query(
        `SELECT contact_id, tags, position, created_at FROM contact_favorites
          WHERE owner_id = $1 AND (contact_id = $2::uuid OR contact_id = ANY($3::uuid[]))`,
        P,
      );
      if (favRows.length > 0) {
        const tags = [...new Set(favRows.flatMap((r) => r.tags ?? []))];
        const positions = favRows.map((r) => r.position).filter((p) => p != null);
        const position = positions.length ? Math.min(...positions) : null;
        const createdAt = favRows
          .map((r) => r.created_at)
          .filter(Boolean)
          .sort((a, b) => new Date(a) - new Date(b))[0];
        await client.query(
          `DELETE FROM contact_favorites WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
          PL,
        );
        await client.query(
          `INSERT INTO contact_favorites (owner_id, contact_id, tags, position, created_at)
           VALUES ($1, $2::uuid, $3::text[], $4::int, COALESCE($5::timestamptz, now()))
           ON CONFLICT (owner_id, contact_id)
           DO UPDATE SET tags = EXCLUDED.tags,
                         position = COALESCE(contact_favorites.position, EXCLUDED.position)`,
          [ownerId, survivor, tags, position, createdAt ?? null],
        );
        note("contact_favorites", favRows.length);
      }

      for (const table of _COLLAPSE_DERIVED) {
        const r = await client.query(
          `DELETE FROM ${table} WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
          PL,
        );
        note(`${table}:recompute`, r.rowCount ?? 0);
      }

      // Shares TARGETED at an absorbed card follow it onto the survivor. scope_ref
      // is a uuid that holds a CONTACT id or a CIRCLE id depending on scope_type
      // (and NULL for 'network'), so the scope_type filter is not cosmetic: without
      // it this would rewrite circle shares whose id happened to match.
      const sh = await client.query(
        `UPDATE shares SET scope_ref = $2::uuid
          WHERE owner_id = $1 AND scope_type = 'contact'
            AND scope_ref = ANY($3::uuid[])`,
        P,
      );
      note("shares", sh.rowCount ?? 0);

      // Resolved suggestions, not data. See the header.
      const rc = await client.query(
        `DELETE FROM contact_review_candidates
          WHERE owner_id = $1
            AND (contact_id = ANY($2::uuid[]) OR candidate_contact_id = ANY($2::uuid[]))`,
        PL,
      );
      note("contact_review_candidates:resolved", rc.rowCount ?? 0);

      // EVERY OTHER TABLE THAT POINTS AT A CONTACT -- discovered, not listed.
      // The blocks above handle the tables that need judgment. This handles the
      // rest, and more to the point it handles the ones that do not exist yet:
      // the next table somebody adds with a contacts FK is moved by a merge
      // without anyone remembering to come back here.
      //
      // A SAVEPOINT PER TABLE, because Postgres aborts the whole transaction on
      // a unique violation and a violation here is not an error -- it means the
      // survivor already carries the row this one would have become.
      let _refs = [];
      try {
        _refs = await referencingColumns();
      } catch (e) {
        // Discovery failing must not fail a merge: everything named above has
        // already moved. It is logged loudly because a collapse that skipped
        // this tail is precisely the silent loss the tail exists to prevent.
        console.error(
          `CONTACT_COLLAPSE_REFS_FAILED owner=${ownerId} survivor=${survivor} ` +
            `${e?.code || ""} ${e?.message || e}`,
        );
      }
      for (const { table, column } of _refs) {
        if (_COLLAPSE_HANDLED.has(table)) continue;
        await client.query("SAVEPOINT collapse_ref");
        try {
          const r = await client.query(
            `UPDATE ${table} SET ${column} = $2::uuid
              WHERE owner_id = $1 AND ${column} = ANY($3::uuid[])`,
            P,
          );
          await client.query("RELEASE SAVEPOINT collapse_ref");
          note(table, r.rowCount ?? 0);
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT collapse_ref");
          if (e?.code !== "23505" && e?.code !== "23514") throw e;
          // ONE ROW AT A TIME, so only the rows that genuinely collide are
          // dropped. The cruder answer -- delete everything the loser had in
          // this table -- loses rows that never conflicted with anything: a
          // loser who attended two meetings and the survivor one would lose
          // both. ctid identifies a row in a table with no surrogate key, and
          // the ctids read here stay valid for the rows this loop has not yet
          // touched, because nothing compacts a heap mid-transaction.
          const { rows: _stuck } = await client.query(
            `SELECT ctid FROM ${table} WHERE owner_id = $1 AND ${column} = ANY($2::uuid[])`,
            PL,
          );
          for (const _row of _stuck) {
            await client.query("SAVEPOINT collapse_row");
            try {
              const one = await client.query(
                `UPDATE ${table} SET ${column} = $2::uuid
                  WHERE owner_id = $1 AND ctid = $3::tid`,
                [ownerId, survivor, _row.ctid],
              );
              await client.query("RELEASE SAVEPOINT collapse_row");
              note(table, one.rowCount ?? 0);
            } catch (e2) {
              await client.query("ROLLBACK TO SAVEPOINT collapse_row");
              if (e2?.code !== "23505" && e2?.code !== "23514") throw e2;
              const gone = await client.query(
                `DELETE FROM ${table} WHERE owner_id = $1 AND ctid = $2::tid`,
                [ownerId, _row.ctid],
              );
              await client.query("RELEASE SAVEPOINT collapse_row");
              note(`${table}:dropped`, gone.rowCount ?? 0);
            }
          }
          await client.query("RELEASE SAVEPOINT collapse_ref");
        }
      }

      // Identity keys last, on THIS client so it joins the transaction: calling it
      // through the module-level query() would take a different pooled connection
      // and commit outside the merge.
      const keyMoves = await repointIdentityKeys(ownerId, survivor, losers, { client });

      const { rowCount } = await client.query(
        `UPDATE contacts SET deleted_at = now()
          WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        PL,
      );

      const _logged = await recordMerge(client, {
        ownerId,
        survivorId: survivor,
        absorbedIds: losers,
        origin,
        rule,
        snapshot: _snapshot,
      });

      return {
        ok: true,
        collapsed: rowCount ?? 0,
        mergeId: _logged?.id ?? null,
        undoable: Boolean(_snapshot && _logged),
        moved,
        // Returned so a migration manifest can undo the key moves as precisely as
        // it undoes the field changes.
        keysRepointed: keyMoves.repointed,
        keysDropped: keyMoves.dropped,
      };
    });
  } catch (err) {
    // NOT swallowed. The whole transaction rolled back, so nothing is half-done --
    // but a merge that failed is a duplicate that is still there, and the only way
    // anyone finds out is this line.
    console.error(
      `CONTACT_COLLAPSE_FAILED owner=${ownerId} survivor=${survivor} ` +
        `absorbed=${losers.length} code=${err?.code || "?"} ${err?.message || err}`,
    );
    return { ok: false, reason: "collapse_failed", collapsed: 0 };
  }
}

/**
 * Live contact counts for one owner, grouped by source.
 *
 * The shape is stable: `apple` and `google` are always present (0 when the owner
 * has none) so a client can render the breakdown without existence checks, and
 * any other source that has rows is added alongside. `total` is the same number
 * GET /v1/me/contacts returns rows for — both count live rows only, so a sync
 * response and a subsequent list cannot disagree.
 *
 * Rows with a NULL source are reported under `unknown` rather than silently
 * dropped, so the parts always add up to `total`.
 */
export async function countLiveContactsBySource(ownerId) {
  const out = { apple: 0, google: 0, total: 0 };
  if (!ownerId) return out;
  try {
    const { rows } = await query(
      `SELECT coalesce(source, 'unknown') AS source, count(*)::int AS n
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL
        GROUP BY 1`,
      [ownerId],
    );
    for (const row of rows || []) {
      const key = String(row.source);
      const n = Number(row.n) || 0;
      out[key] = (out[key] ?? 0) + n;
      out.total += n;
    }
    return out;
  } catch {
    // A failed count must never fail a sync that already committed.
    return out;
  }
}

// ── Contacts (owner-scoped, drop-in shape for listContactsForPeople) ──────────

// Returns Cloud SQL contacts in the app-facing shape GET /v1/me/contacts expects.
export async function listContactsForOwnerAppShape(ownerId) {
  try {
    // Keep resolved account IDs/avatar metadata alongside source-owned names.
    const { rows } = await query(
      `SELECT c.id, c.external_id, c.full_name, c.first_name, c.last_name,
              c.nickname, c.contact_tags,
              c.phone_primary, c.phones_all, c.emails, c.company, c.title, c.city,
              c.source, c.linkedin_url,
              c.enrichment, c.enrichment_status, c.enriched_at, c.enrichment_candidates,
              c.linked_amber_id,
              u.username        AS linked_username,
              u.full_name       AS linked_name,
              u.avatar_url      AS linked_avatar_url
       FROM contacts c
       LEFT JOIN users u
         ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE c.owner_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.id`,
      [ownerId],
    );
    // Keep the owner's recorded real-world name. Linked IDs enrich identity;
    // they must not replace a full name with a username or a single first name.
    return rows.map((row) => {
      return {
      id: String(row.id),
      externalId: row.external_id ?? null,
      name: contactDisplayName(row),
      tags: row.contact_tags ?? [],
      // Null unless the card is linked. The app shows the Amber identity and
      // routes to a profile only when amberId is present, so a half-resolved
      // contact can never render as a dead link.
      amberId: row.linked_amber_id ? String(row.linked_amber_id) : null,
      username: row.linked_username ?? null,
      avatarUrl: row.linked_avatar_url ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      phoneNumbers: row.phones_all
        ? row.phones_all.split(",").map((s) => s.trim()).filter(Boolean)
        : row.phone_primary
          ? [row.phone_primary]
          : [],
      emails: row.emails
        ? row.emails.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      company: row.company ?? null,
      title: row.title ?? null,
      city: row.city ?? null,
      source: row.source ?? null,
      linkedinUrl: row.linkedin_url ?? null,
      enrichment: row.enrichment ?? null,
      enrichmentStatus: row.enrichment_status ?? null,
      enrichedAt: row.enriched_at ?? null,
      enrichmentCandidates: row.enrichment_candidates ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function getContactById(ownerId, contactId) {
  if (!ownerId || !contactId) return null;
  try {
    const { rows } = await query(
      `SELECT id, external_id, full_name, first_name, last_name,
              phone_primary, phones_all, emails, company, title, city, apple_notes AS notes, source,
              -- WHO THEY ARE ON AMBER, when the linker has proved it. Added
              -- because /v1/me/dms/open resolved a card to an account by PHONE
              -- only, so a contact saved with just an email answered
              -- "not_on_amber" and the app said "Couldn't open chat" about
              -- somebody who plainly has an account. This is the same field
              -- circles, note sharing and the DM candidate list already read.
              linked_amber_id,
              linkedin_url, enrichment, enrichment_status, enriched_at, enrichment_candidates
       FROM contacts
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [contactId, ownerId],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      externalId: row.external_id ?? null,
      name: row.full_name ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      linkedAmberId: row.linked_amber_id ? String(row.linked_amber_id) : null,
      phoneNumbers: row.phones_all
        ? row.phones_all.split(",").map((s) => s.trim()).filter(Boolean)
        : row.phone_primary
          ? [row.phone_primary]
          : [],
      phone: row.phone_primary ?? null,
      emails: row.emails
        ? row.emails.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      email: row.emails
        ? (row.emails.split(",")[0] ?? "").trim() || null
        : null,
      company: row.company ?? null,
      title: row.title ?? null,
      city: row.city ?? null,
      notes: row.notes ?? null,
      source: row.source ?? null,
      linkedinUrl: row.linkedin_url ?? null,
      enrichment: row.enrichment ?? null,
      enrichmentStatus: row.enrichment_status ?? null,
      enrichedAt: row.enriched_at ?? null,
      enrichmentCandidates: row.enrichment_candidates ?? null,
    };
  } catch {
    return null;
  }
}

// ── Enrichment lifecycle (owner-scoped, parameterized) ──────────────────────
// Resolvable dedicated columns an enrichment may write. Keys are matched
// against this whitelist before being interpolated as column names, so a
// caller-supplied `fields` object can never inject SQL.
const _ENRICHMENT_COLUMNS = new Set([
  "full_name",
  "first_name",
  "last_name",
  "company",
  "title",
  "city",
  "location",
  "avatar_url",
  "linkedin_url",
  "twitter_url",
  "github_url",
  "website",
  "relationship_type",
  "relationship_score",
  "tags",
]);

// Append `col = $n` SET fragments for whitelisted keys of `fields` (mutating
// `sets`/`params`). Unknown keys are ignored.
function _pushEnrichmentFields(fields, sets, params) {
  for (const [k, v] of Object.entries(fields || {})) {
    if (!_ENRICHMENT_COLUMNS.has(k)) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
}

/**
 * Write a resolved enrichment onto a contact: dedicated columns present in
 * `fields`, a jsonb-merge of `enrichment`, and enrichment_status + enriched_at.
 * Owner-scoped. Returns { contactId } or null.
 */
export async function setContactEnrichment(
  ownerId,
  contactId,
  { fields = {}, enrichment = null, status = null, enrichedAt = null } = {},
) {
  if (!ownerId || !contactId) return null;
  const sets = [];
  const params = [contactId, ownerId];
  _pushEnrichmentFields(fields, sets, params);
  if (enrichment != null) {
    params.push(JSON.stringify(enrichment));
    sets.push(`enrichment = COALESCE(enrichment, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  if (status != null) {
    params.push(status);
    sets.push(`enrichment_status = $${params.length}`);
  }
  params.push(enrichedAt ?? new Date());
  sets.push(`enriched_at = $${params.length}`);
  sets.push("updated_at = now()");
  try {
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(", ")}
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      params,
    );
    return rows[0] ? { contactId: String(rows[0].id) } : null;
  } catch {
    return null;
  }
}

/**
 * Store the ranked ambiguous-profile array and flip status to 'ambiguous'.
 * Owner-scoped. Returns { contactId } or null.
 */
export async function setContactEnrichmentCandidates(ownerId, contactId, candidates) {
  if (!ownerId || !contactId) return null;
  try {
    const { rows } = await query(
      `UPDATE contacts SET
         enrichment_candidates = $3::jsonb,
         enrichment_status = 'ambiguous',
         updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [contactId, ownerId, candidates != null ? JSON.stringify(candidates) : null],
    );
    return rows[0] ? { contactId: String(rows[0].id) } : null;
  } catch {
    return null;
  }
}

/**
 * Dismiss an ambiguous enrichment as "no match": clear enrichment_candidates
 * and set status back to 'unenriched'. Owner-scoped. Returns { contactId } or
 * null. (The swipe-confirm { none:true } path.)
 */
export async function clearContactEnrichmentCandidates(ownerId, contactId) {
  if (!ownerId || !contactId) return null;
  try {
    const { rows } = await query(
      `UPDATE contacts SET
         enrichment_candidates = NULL,
         enrichment_status = 'unenriched',
         updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [contactId, ownerId],
    );
    return rows[0] ? { contactId: String(rows[0].id) } : null;
  } catch {
    return null;
  }
}

/**
 * Owner-scoped enrichment overview: total non-deleted contacts, counts grouped
 * by source, and counts grouped by enrichment_status (NULL → 'unenriched').
 * Returns { total, bySource, byStatus }. Two grouped queries.
 */
export async function getContactEnrichmentSummary(ownerId) {
  const empty = { total: 0, bySource: {}, byStatus: {} };
  if (!ownerId) return empty;
  try {
    const [srcRes, statRes] = await Promise.all([
      query(
        `SELECT COALESCE(source, 'unknown') AS k, count(*)::int AS n
           FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL
          GROUP BY 1`,
        [ownerId],
      ),
      query(
        `SELECT COALESCE(enrichment_status, 'unenriched') AS k, count(*)::int AS n
           FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL
          GROUP BY 1`,
        [ownerId],
      ),
    ]);
    const bySource = {};
    for (const r of srcRes.rows) bySource[r.k] = r.n;
    const byStatus = {};
    let total = 0;
    for (const r of statRes.rows) {
      byStatus[r.k] = r.n;
      total += r.n;
    }
    return { total, bySource, byStatus };
  } catch {
    return empty;
  }
}

/**
 * Resolve an ambiguous enrichment with the chosen profile: write chosen
 * `fields` + `enrichment`, set status='resolved', enriched_at=now(), and CLEAR
 * enrichment_candidates. `chosen` = { fields, enrichment }. Owner-scoped.
 * Returns { contactId } or null.
 */
export async function resolveContactEnrichment(ownerId, contactId, chosen = {}) {
  if (!ownerId || !contactId) return null;
  const sets = [];
  const params = [contactId, ownerId];
  _pushEnrichmentFields(chosen?.fields || {}, sets, params);
  if (chosen?.enrichment != null) {
    params.push(JSON.stringify(chosen.enrichment));
    sets.push(`enrichment = COALESCE(enrichment, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  sets.push("enrichment_status = 'resolved'");
  sets.push("enriched_at = now()");
  sets.push("enrichment_candidates = NULL");
  sets.push("updated_at = now()");
  try {
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(", ")}
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      params,
    );
    return rows[0] ? { contactId: String(rows[0].id) } : null;
  } catch {
    return null;
  }
}

/**
 * Synthesize verified tags + facts from RESOLVED enrichment `fields`
 * ({ title, company, city, industry }) onto a contact, feeding PeopleRank's
 * contact_facts consumer. Owner-scoped. IDEMPOTENT: it soft-deletes this
 * contact's existing source='enrichment' facts before inserting the fresh set,
 * so re-running never duplicates. CALLERS MUST ONLY pass confident/resolved
 * enrichment — never ambiguous candidates. Returns { tags, factCount } or null.
 */
/**
 * Set a contact's tags directly, from the user rather than from enrichment.
 *
 * Distinct from tagContactFromEnrichment, which DERIVES tags from resolved
 * enrichment fields and owns the whole array. These are the words the user chose
 * ("work", "friend", "reach out"), so they are merged in rather than replacing what
 * enrichment put there — losing an enrichment tag because someone typed "friend"
 * would quietly degrade PeopleRank.
 *
 * Normalized the same way favorites normalize theirs: trimmed, lowercased, deduped,
 * capped. Lowercase matters because "Work" and "work" must be one tag when something
 * later asks "who do I know from work".
 */
export async function addContactTags(ownerId, contactId, tags) {
  if (!ownerId || !contactId) return [];
  const clean = Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  ).slice(0, 12);
  if (clean.length === 0) return [];
  try {
    const { rows } = await query(
      `UPDATE contacts
          SET tags = (
                SELECT array_agg(DISTINCT t)
                  FROM unnest(COALESCE(tags, '{}'::text[]) || $3::text[]) AS t
              ),
              updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING tags`,
      [contactId, ownerId, clean],
    );
    return rows[0]?.tags ?? [];
  } catch (e) {
    console.error(`ADD_CONTACT_TAGS_ERR ${e?.message || e}`);
    return [];
  }
}

export async function tagContactFromEnrichment(ownerId, contactId, fields = {}) {
  if (!ownerId || !contactId) return null;
  const tags = deriveTags(fields);
  const facts = deriveFacts(fields);
  try {
    await query(
      `UPDATE contacts SET tags = $3::text[], updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [contactId, ownerId, tags],
    );
    // Idempotent: retire prior enrichment facts, then insert the fresh set.
    await query(
      `UPDATE observations SET deleted_at = now()
        WHERE owner_id = $1 AND contact_id = $2 AND source = 'enrichment'
          AND deleted_at IS NULL`,
      [ownerId, contactId],
    );
    // Through insertContactFact rather than a raw INSERT, so an enrichment fact
    // gets dimension-classified like every other fact. A direct INSERT here
    // would be the one write path in the service that skips it.
    for (const f of facts) {
      await insertContactFact({
        ownerId,
        contactId,
        factText: f.fact_text,
        category: f.category ?? null,
        source: "enrichment",
        status: "resolved",
        weight: f.weight ?? null,
      });
    }
    return { tags, factCount: facts.length };
  } catch {
    return null;
  }
}

// Phone-match dedup used by the create-contact endpoint.
// Primary: exact match on indexed phone_primary_normalized (digits-only).
// Fallback: last-10-digit suffix match to reconcile country-code present-vs-absent
// (e.g. "+12133175238" → "2133175238" matches "2133175238" stored without country code).
// Both queries are owner-scoped; never cross owner boundaries.
export async function getContactByPhone(ownerId, inputPhone) {
  if (!ownerId || !inputPhone) return null;
  const norm = _digitsOnly(inputPhone);
  if (!norm) return null;
  try {
    // Primary: indexed exact match.
    const { rows } = await query(
      `SELECT id, full_name FROM contacts
       WHERE owner_id = $1 AND phone_primary_normalized = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerId, norm],
    );
    if (rows[0]) return { id: rows[0].id, full_name: rows[0].full_name };

    // Fallback: last-10-digit suffix — handles country-code mismatch.
    const last10 = norm.length >= 10 ? norm.slice(-10) : norm;
    const { rows: fb } = await query(
      `SELECT id, full_name FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND phone_primary_normalized IS NOT NULL
         AND right(phone_primary_normalized, 10) = $2
       LIMIT 1`,
      [ownerId, last10],
    );
    return fb[0] ? { id: fb[0].id, full_name: fb[0].full_name } : null;
  } catch {
    return null;
  }
}

// Returns Cloud SQL contacts in the shape rankViaTogariSearch's toContactIn expects.
// Includes `notes` (unlike listContactsForOwnerAppShape) so the apple company→notes
// fold in toContactIn fires correctly for apple-sourced contacts.
// Returns the four PeopleRank warmth-term fields from Cloud SQL keyed by amber_id.
// Shaped so buildMe's firstString lookups hit on all alias keys it checks.
export async function getUserProfileByAmberId(amberId) {
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT full_name, current_city, occupation, bio,
              mbti, school, hometown, horoscope,
              avatar_url, privacy_tier, onboarding_completed_at, timezone, username
       FROM users
       WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      // Aliases so buildMe's firstString lookups hit on both key variants.
      name: r.full_name ?? null,
      displayName: r.full_name ?? null,
      currentCity: r.current_city ?? null,
      city: r.current_city ?? null,
      occupation: r.occupation ?? null,
      bio: r.bio ?? null,
      mbti: r.mbti ?? null,
      school: r.school ?? null,
      hometown: r.hometown ?? null,
      horoscope: r.horoscope ?? null,
      avatarUrl: r.avatar_url ?? null,
      privacyTier: r.privacy_tier ?? null,
      onboardingCompletedAt: r.onboarding_completed_at ?? null,
      timezone: r.timezone ?? null,
      username: r.username ?? null,
    };
  } catch {
    return null;
  }
}

// Profile overflow (Chunk 4a): fields with no discrete users column live in
// users.profile_extra jsonb. Read returns the object ({} when null/absent);
// merge does an SQL-side jsonb `||` so a partial patch never drops sibling keys.
export async function getUserProfileExtraByAmberId(amberId) {
  if (!amberId) return {};
  try {
    const { rows } = await query(
      `SELECT profile_extra FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    const pe = rows[0]?.profile_extra;
    return pe && typeof pe === "object" ? pe : {};
  } catch {
    return {};
  }
}

export async function mergeUserProfileExtra(amberId, patch) {
  if (!amberId || !patch || typeof patch !== "object") return null;
  if (Object.keys(patch).length === 0) return null;
  try {
    const { rows } = await query(
      `UPDATE users
          SET profile_extra = COALESCE(profile_extra, '{}'::jsonb) || $2::jsonb,
              updated_at    = now()
        WHERE amber_id = $1 AND deleted_at IS NULL
        RETURNING amber_id`,
      [amberId, JSON.stringify(patch)],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getUserByUsername(username) {
  if (!username) return null;
  try {
    const { rows } = await query(
      `SELECT amber_id, username, full_name, avatar_url, occupation, current_city
       FROM users
       WHERE lower(username) = lower($1) AND deleted_at IS NULL`,
      [username],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function isUsernameAvailable(username) {
  if (!username) return false;
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(uname)) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM users WHERE lower(username) = $1 AND deleted_at IS NULL LIMIT 1`,
      [uname],
    );
    return rows.length === 0;
  } catch {
    return false;
  }
}

/**
 * THE ADDRESS BOOK AS THE CARDS ACTUALLY HOLD IT, plus how much is written on
 * each person.
 *
 * listContactsForRankingByAmberId is next door and cannot be used for this: it
 * projects `full_name` and drops `first_name` / `last_name`, and those two are
 * the entire basis for telling a tagline from a name (see src/lib/address-book.js).
 * Without them "Shirley Park BTG USC" is four indistinguishable words.
 *
 * `fact_count` rides along in the same pass so the summary can say "and there is
 * no personal information on any of them yet" -- which for a new user is the
 * true and the useful half of the answer, and costs one LATERAL rather than a
 * second query over the same rows.
 */
export async function listAddressBookRows(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT c.id, c.full_name, c.first_name, c.last_name,
              c.company, c.title, c.city,
              c.phone_primary, c.phone_primary_normalized, c.phones_all, c.emails,
              COALESCE(f.n, 0)::int AS fact_count
         FROM contacts c
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n
             FROM observations o
            WHERE o.owner_id = c.owner_id
              AND o.contact_id = c.id
              AND o.status = 'resolved'
              AND o.deleted_at IS NULL
         ) f ON TRUE
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL`,
      [ownerId],
    );
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  } catch {
    return [];
  }
}

export async function listContactsForRankingByAmberId(amberId) {
  if (!amberId) return [];
  try {
    const { rows } = await query(
      `SELECT id, full_name, phone_primary, phones_all, emails,
              company, title, city, apple_notes AS notes, source
       FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: row.full_name ?? null,
      source: row.source ?? null,
      company: row.company ?? null,
      title: row.title ?? null,
      city: row.city ?? null,
      notes: row.notes ?? null,
      phoneNumbers: row.phones_all
        ? row.phones_all.split(",").map((s) => s.trim()).filter(Boolean)
        : row.phone_primary
          ? [row.phone_primary]
          : [],
      phone: row.phone_primary ?? null,
      emails: row.emails
        ? row.emails.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      email: row.emails
        ? (row.emails.split(",")[0] ?? "").trim() || null
        : null,
    }));
  } catch {
    return [];
  }
}

export async function loadContactsByOwnerId(ownerId) {
  try {
    const { rows } = await query(
      `SELECT id, full_name, company, title, city, apple_notes AS notes, phone_primary
       FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    );
    return rows
      .filter((r) => r.id && r.full_name)
      .map((r) => ({
        id: String(r.id),
        name: r.full_name,
        company: r.company || null,
        title: r.title || null,
        city: r.city || null,
        notes: r.notes || null,
        phone: r.phone_primary || null,
        source: null,
      }));
  } catch {
    return [];
  }
}

// ── Contact facts ─────────────────────────────────────────────────────────────

// Returns contacts with interaction_count = number of existing non-deleted
// contact_facts for each contact. Used by name resolution to break first-name
// ties by picking the most-interacted match.
// Fast address-book name search for the Ask lookup. Matches contacts whose name
// starts with the query, or has a word that starts with it. Returns light rows
// (no facts join), so it is cheap to run on every ask.
export async function searchContactsByName(ownerId, name, limit = 8) {
  if (!ownerId || !name) return [];
  const q = String(name).trim().toLowerCase();
  if (!q) return [];
  try {
    const { rows } = await query(
      // EVERYTHING THE CARD HOLDS, not just the job.
      //
      // This selected id, name, title, company and phone. The route that asks
      // "what do you know about <name>" then decided whether it had anything to
      // SAY about the person from the title and the company alone -- so a
      // contact whose only content was the note the user typed into their own
      // phone, or their city, or their nickname, was answered in 84ms with "they
      // are in your contacts, but you have nothing saved about them yet".
      //
      // The note in particular gets worse the moment the Apple notes entitlement
      // lands, because then a large share of cards have a note and nothing else.
      `SELECT id, full_name, title, company, phone_primary, linked_amber_id,
              city, region, nickname, birthday, contact_tags,
              left(apple_notes, 600) AS apple_notes
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL
          AND (lower(full_name) LIKE $2 OR lower(full_name) LIKE $3)
        ORDER BY (lower(full_name) = $4) DESC, length(full_name) ASC
        LIMIT $5`,
      [ownerId, `${q}%`, `% ${q}%`, q, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.full_name || "Unknown",
      title: r.title || null,
      company: r.company || null,
      phone: r.phone_primary || null,
      linkedAmberId: r.linked_amber_id || null,
      city: r.city || null,
      region: r.region || null,
      nickname: r.nickname || null,
      birthday: r.birthday || null,
      tags: r.contact_tags || [],
      apple_notes: r.apple_notes || null,
    }));
  } catch {
    return [];
  }
}

// ── Ask agent: network overview + attribute search ───────────────────────────
// Narrow-first data for the Ask tab. Overview answers any large-scale question
// about the network with real aggregates; attribute search answers "who works at
// X / lives in Y". Both owner-scoped, both a bounded, cheap read.

// A real snapshot of the whole network: total, provenance breakdown, how many
// have notes, and who you hold the most on. Returns null on error.
export async function getNetworkOverview(ownerId) {
  if (!ownerId) return null;
  try {
    const [totalR, sourcesR, notedR, topR] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
        [ownerId],
      ),
      query(
        `SELECT s.source AS source, COUNT(DISTINCT s.contact_id)::int AS n
           FROM contact_sources s
           JOIN contacts c ON c.id = s.contact_id AND c.owner_id = $1 AND c.deleted_at IS NULL
          GROUP BY s.source
          ORDER BY n DESC`,
        [ownerId],
      ),
      query(
        `SELECT COUNT(DISTINCT contact_id)::int AS n
           FROM observations
          WHERE owner_id = $1 AND status = 'resolved' AND deleted_at IS NULL
            AND contact_id IS NOT NULL`,
        [ownerId],
      ),
      query(
        `SELECT c.id, c.full_name, c.title, c.company, COUNT(f.observation_id)::int AS notes
           FROM contacts c
           JOIN observations f
             ON f.contact_id = c.id AND f.owner_id = $1
            AND f.status = 'resolved' AND f.deleted_at IS NULL
          WHERE c.owner_id = $1 AND c.deleted_at IS NULL
          GROUP BY c.id, c.full_name, c.title, c.company
          ORDER BY notes DESC, c.full_name ASC
          LIMIT 5`,
        [ownerId],
      ),
    ]);
    return {
      total: totalR.rows[0]?.n ?? 0,
      bySource: sourcesR.rows.map((r) => ({ source: r.source, count: r.n })),
      withNotes: notedR.rows[0]?.n ?? 0,
      topNoted: topR.rows.map((r) => ({
        id: String(r.id),
        name: r.full_name || "Unknown",
        title: r.title || null,
        company: r.company || null,
        notes: r.notes,
      })),
    };
  } catch {
    return null;
  }
}

// The names the user talks about most, for biasing voice transcription so proper
// nouns spell right. Ordered by how much is saved on them, then recency.
export async function getTopContactNames(ownerId, limit = 60) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT c.full_name, COUNT(f.observation_id)::int AS notes
         FROM contacts c
         LEFT JOIN observations f
           ON f.contact_id = c.id AND f.owner_id = $1
          AND f.status = 'resolved' AND f.deleted_at IS NULL
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL
          AND c.full_name IS NOT NULL AND length(trim(c.full_name)) > 1
        GROUP BY c.id, c.full_name, c.updated_at
        ORDER BY notes DESC, c.updated_at DESC NULLS LAST
        LIMIT $2`,
      [ownerId, limit],
    );
    return rows.map((r) => String(r.full_name).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Filtered people search over structured fields. Any subset of
// { company, title, city, name } is ANDed as case-insensitive contains.
export async function searchPeopleByAttributes(ownerId, filters = {}) {
  if (!ownerId) return [];
  const clauses = ["owner_id = $1", "deleted_at IS NULL"];
  const params = [ownerId];
  const like = (col, val) => {
    if (!val || typeof val !== "string" || !val.trim()) return;
    params.push(`%${val.trim().toLowerCase()}%`);
    clauses.push(`lower(${col}) LIKE $${params.length}`);
  };
  like("company", filters.company);
  like("title", filters.title);
  like("city", filters.city);
  like("full_name", filters.name);
  // Nothing to filter on beyond owner — refuse rather than dump the whole book.
  if (clauses.length <= 2) return [];
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 25;
  params.push(limit);
  try {
    const { rows } = await query(
      `SELECT id, full_name, title, company, city, phone_primary
         FROM contacts
        WHERE ${clauses.join(" AND ")}
        ORDER BY full_name ASC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.full_name || "Unknown",
      title: r.title || null,
      company: r.company || null,
      city: r.city || null,
      phone: r.phone_primary || null,
    }));
  } catch {
    return [];
  }
}

/**
 * THE WHOLE ADDRESS BOOK, IN THE SHAPE THE SEARCH BOX RANKS ON.
 *
 * getContactsForResolution returns names and a count, which is all the
 * reconciliation flow needs. A search box needs more: the fields a person
 * actually types (company, title, city, emails, phone numbers) and the two
 * rolled-up numbers that say who this person is to the owner.
 *
 * ONE QUERY, NO PER-ROW FANOUT. The stats are already materialised by the
 * rollup, so this is a left join onto a table with one row per contact rather
 * than an aggregate over the observation stream -- the earlier reader's
 * COUNT(observations) is why it could not afford to carry more columns.
 *
 * A contact with no interactions still comes back, with nulls in the stats
 * columns. Leaving it out would mean a freshly imported address book is
 * unsearchable until the first rollup runs, which is precisely the day
 * somebody is most likely to try.
 */
export async function getContactsForSearch(ownerId) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.full_name, c.first_name, c.last_name,
              c.company, c.title, c.city, c.emails,
              c.phone_primary, c.phone_primary_normalized, c.phones_all,
              s.last_interaction_at, s.count_90d,
              (f.contact_id IS NOT NULL) AS is_favorite
         FROM contacts c
         LEFT JOIN contact_interaction_stats s
           ON s.owner_id = c.owner_id AND s.contact_id = c.id
         LEFT JOIN contact_favorites f
           ON f.owner_id = c.owner_id AND f.contact_id = c.id
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL`,
      [ownerId],
    );
    return rows;
  } catch {
    return [];
  }
}

export async function getContactsForResolution(ownerId) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.full_name, c.first_name, c.last_name,
              COUNT(cf.observation_id) AS interaction_count
       FROM contacts c
       LEFT JOIN observations cf
         ON cf.contact_id = c.id AND cf.owner_id = c.owner_id
        AND cf.deleted_at IS NULL
       WHERE c.owner_id = $1 AND c.deleted_at IS NULL
       GROUP BY c.id, c.full_name, c.first_name, c.last_name`,
      [ownerId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      full_name: r.full_name || null,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      interaction_count: Number(r.interaction_count) || 0,
    }));
  } catch {
    return [];
  }
}

// ── Pending fact context ──────────────────────────────────────────────────────
// Multi-track pending: N pending items can coexist per owner, each addressed by
// its surrogate id (bigint PK). owner_id is NOT unique in the DB — every read,
// update, and delete scopes by owner_id for security even when targeting by id.

export async function createContactForOwner({ ownerId, ownerPhone, fullName, phonePrimary = null, source }) {
  try {
    const parts = (fullName || "").trim().split(/\s+/);
    const firstName = parts[0] || null;
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

    const record = {
      name: fullName,
      firstName,
      lastName,
      phoneNumbers: phonePrimary ? [phonePrimary] : [],
      source: source ?? null,
    };
    const resolved = await resolveContactIdentity(ownerId, record).catch(() => null);
    if (resolved?.contactId) {
      await applyContactUnion(ownerId, resolved.contactId, record).catch(() => false);
      await claimIdentityKeys(
        ownerId,
        claimsForRecord(String(resolved.contactId), record),
      ).catch(() => null);
      noteContactWrite(ownerId, resolved.contactId, record);
      await deriveLabelsAndAreaCodes(ownerId);
      return { id: resolved.contactId };
    }

    const { rows } = await query(
      `INSERT INTO contacts
         (owner_id, owner_phone, full_name, first_name, last_name,
          phone_primary, phones_all, source, phone_primary_normalized)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [ownerId, ownerPhone, fullName, firstName, lastName,
       phonePrimary ?? null, phonePrimary ?? null, source,
       _digitsOnly(phonePrimary)],
    );
    const created = rows[0] ?? null;
    if (created?.id != null) {
      await claimIdentityKeys(ownerId, claimsForRecord(String(created.id), record)).catch(
        () => null,
      );
      noteContactWrite(ownerId, created.id, record);
      await recordReviewCandidates(
        ownerId,
        (resolved?.reviewLinks ?? []).map((l) => ({
          contactId: String(created.id),
          candidateContactId: l.candidateContactId,
          reason: l.reason,
        })),
      ).catch(() => 0);
    }
    await deriveLabelsAndAreaCodes(ownerId);
    return created;
  } catch (e) {
    console.error(`PHOTON_FACT_NEWCONTACT_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

/**
 * DERIVE THE LABELS AND AREA CODES, ON EVERY PATH THAT ADDS A PERSON.
 *
 * retagAddressBook was called from exactly ONE place: the Apple contacts sync
 * route. Which meant contact_tags, area_code and area_metro -- the columns the
 * whole labeled and implied retrieval reads, and the ones bookShape reports as
 * "30 tagged USC, 101 in New York" -- were derived for Apple users and for
 * nobody else. A Google-only user, a CSV import, a contact saved from a web
 * profile, a contact created by the iMessage agent, a contact typed into Amber
 * by hand: all of them landed with those columns NULL, so "who do I know that
 * goes to USC" and "do I know anyone in New York" came back empty for those
 * users no matter how their book was labeled.
 *
 * That is the same defect as everything else this month, in a different place:
 * the derivation existed, was correct, was tested, and was reachable from one
 * route out of six.
 *
 * It lives HERE, next to the write, rather than in the six callers, because a
 * seventh ingest path is going to be added and it will forget. Safe to call
 * unconditionally: it reads the book, recomputes, and writes only the rows whose
 * derived values actually moved -- 38ms and ZERO writes on a 4,000-contact book
 * where nothing changed -- and it deliberately does not touch updated_at, so it
 * cannot reshuffle a contacts list ordered by it.
 *
 * The BATCH path is different and stays with its callers: upsertContactsForOwner
 * is called once per 200-contact chunk, so retagging inside it would redo the
 * whole book six times for one sync. Its callers retag once, after the last
 * chunk.
 *
 * Never allowed to fail a write that has already landed.
 */
async function deriveLabelsAndAreaCodes(ownerId) {
  if (!ownerId) return;
  try {
    const { retagAddressBook } = await import("./address-book-store.js");
    await retagAddressBook(ownerId);
  } catch (err) {
    console.warn(`DERIVE_LABELS_FAILED owner=${ownerId} ${(err?.message || err).toString().slice(0, 160)}`);
  }
}

// Links a contact row to a verified Amber user DID. owner_id in the WHERE clause
// prevents cross-owner linkage — a caller can only link contacts they own.
/**
 * Link every owner's contact row that holds this phone number to this Amber account.
 *
 * WHY THIS EXISTS — it is the missing half of every "someone shared this with you"
 * feature. Inbound circles, shared notes and shared contacts all decide "is this
 * contact row actually ME?" with the same predicate:
 *
 *     contacts.linked_amber_id = <viewer> OR <a contact_identity_keys phone match>
 *
 * and NOTHING in the app ever wrote the first half. `setContactLinkedAmberId` is
 * only reachable from POST /v1/me/contacts/create with an explicit amberId, which
 * the iOS client never calls — contacts arrive through the bulk sync, which does not
 * set it. So `linked_amber_id` was NULL on every row in practice, the whole
 * predicate rested on the identity-key leg, and that leg fails silently whenever the
 * key landed on a different contact row (two contacts sharing a number), the contact
 * has no phone at all (a Google/LinkedIn-scraped, email-only row), or the key claim
 * aborted mid-sync. That is why a member of a brand-new circle "did not see
 * anything": the circle existed, they were in it, and no query could tell.
 *
 * Called on signup (so an invite that predates the account resolves the moment they
 * register) and when a member is added to a circle (so it resolves immediately for
 * accounts that already exist). Deliberately CROSS-OWNER: it updates other people's
 * contact rows, which is exactly the point — they are the ones who need to know that
 * their contact "Sagar" is this account. It writes nothing but that link, and only
 * on rows whose number already matches, so it reveals nothing to anybody.
 *
 * Matching is on the last 10 digits, the same convention as phoneKey() and the
 * deterministic matcher. Returns the number of rows linked, or 0.
 */
// A helper the store.js splice orphaned: mergeFiledWithStoredPeople still
// called it, its definition sat inside the removed region, and check:undef did
// not flag it -- tsc resolves a bare call as an implicit global, so TS2304 never
// fires. Fourth casualty of that splice; the gate wants to be a no-undef lint.
// Small phonetic key (Soundex, with the same leading-homophone normalisation as
// the capture matcher) so "Bo"/"Beau" and "mural"/"Muriel" collapse to one key.
function _filedSoundex(s) {
  let str = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!str) return "";
  str = str
    .replace(/^PH/, "F").replace(/^KN/, "N").replace(/^GN/, "N")
    .replace(/^WR/, "R").replace(/^X/, "S").replace(/^Q/, "K")
    .replace(/^C(?=[EIY])/, "S").replace(/^C/, "K");
  const code = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = str[0];
  let prev = code[str[0]] || 0;
  for (let i = 1; i < str.length && out.length < 4; i++) {
    const c = code[str[i]] || 0;
    if (c !== 0 && c !== prev) out += c;
    if (str[i] !== "H" && str[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

/**
 * A BRAND-NEW ACCOUNT CLAIMS ITS INVITES. Everyone who already had this number in
 * their address book gets their contact row pointed at the new account, so a
 * circle or a note shared before they signed up is visible on first launch
 * instead of never.
 *
 * WHY THIS IS NOW AN INDEX LOOKUP. The previous version asked every contact row
 * in the database whether its phone matched:
 *
 *   right(regexp_replace(coalesce(phone_primary_normalized, phone_primary, ''),
 *                        '\D', '', 'g'), 10) = $2
 *   OR EXISTS (SELECT 1 FROM unnest(string_to_array(phones_all, ',')) ...)
 *
 * Neither leg can use an index -- a function of a column is not the column, and
 * the second one unnests a comma-joined string per row. That is a sequential scan
 * with a regex per row, per signup. At a hundred users holding two thousand
 * contacts each it is two hundred thousand regexes and nobody notices; at the
 * scale this schema is being built for it is the slowest query in the system, on
 * the most latency-sensitive path there is, and it runs while somebody stares at
 * a launch screen.
 *
 * contact_identity_keys already holds every phone as a hashed key with a global
 * index on it. This is one index lookup and an update of the rows it names.
 *
 * IT ALSO RECORDS THE ACCOUNT'S OWN KEY. discovery_keys is what proves, later,
 * that this account owns this number -- the share-reach predicate resolves circle
 * membership through it rather than trusting a number a caller hands it. Written
 * here because signup is the moment the number is verified, and writing it
 * anywhere else would mean trusting an unverified one.
 *
 * REQUIRES contact_identity_keys TO BE POPULATED. A contact card written before
 * the keys table existed, or by a writer that skipped claimIdentityKeys, has no
 * key row and will not be found -- scripts/backfill-identity-keys.js exists for
 * exactly that. Failing to link is the safe direction: the person sees nothing
 * until a re-sync claims the key, rather than seeing somebody else's circle.
 *
 * Returns the number of contact cards linked, unchanged.
 */
export async function linkContactsToAmberUserByPhone(amberId, phone) {
  if (!amberId || !phone) return 0;
  let keyHash = null;
  try {
    keyHash = phoneHash(phone);
  } catch (e) {
    // A missing pepper is a configuration failure, not a data failure, and it
    // must not be mistaken for "this person had no invites waiting".
    console.error(`LINK_CONTACTS_PEPPER_ERR ${e?.message || e}`);
    return 0;
  }
  if (!keyHash) return 0; // too short to identify a person

  // FIRST CLAIM WINS, and a contested key stops this function dead.
  //
  // This was `ON CONFLICT (key_hash) DO UPDATE SET amber_id = EXCLUDED.amber_id`,
  // so a new signup TOOK the key from whoever held it. Combined with phoneKey
  // normalizing to the last ten digits -- +33612345678 and +13612345678 hash the
  // same -- that is an identity takeover reachable by registering a colliding
  // number: the displaced user stops being findable, loses the circles they were
  // in, and stops seeing notes shared to them, silently.
  //
  // AND THE LINKING BELOW MUST NOT RUN ON A CONTESTED KEY. It sets
  // linked_amber_id on every contact card holding this hash. If the hash belongs
  // to somebody else, those cards are for THAT person, and pointing them at this
  // account hands their invitations, circles and shared notes to a stranger. So a
  // conflict returns 0 rather than falling through, which is the opposite of what
  // the old comment said to do.
  try {
    await query(
      `INSERT INTO discovery_keys (key_hash, key_type, amber_id)
       VALUES ($1, ${KEY_TYPE.PHONE}, $2)
       ON CONFLICT (key_hash) DO NOTHING`,
      [keyHash, amberId],
    );
    const { rows: holder } = await query(
      `SELECT amber_id FROM discovery_keys WHERE key_hash = $1`,
      [keyHash],
    );
    const heldBy = holder[0]?.amber_id ?? null;
    if (heldBy && heldBy !== amberId) {
      console.error(
        `DISCOVERY_KEY_CONFLICT signup=${amberId} key already held by ${heldBy} ` +
          `— refusing to link contact cards`,
      );
      return 0;
    }
  } catch (e) {
    // A write failure here means we do not know who owns the key, and linking on
    // an unknown owner is the thing above. Stop.
    console.error(`DISCOVERY_KEY_WRITE_ERR ${e?.message || e}`);
    return 0;
  }

  try {
    const { rowCount } = await query(
      `UPDATE contacts c
          SET linked_amber_id = $1, updated_at = now()
        WHERE c.deleted_at IS NULL
          AND c.linked_amber_id IS DISTINCT FROM $1
          -- Never point somebody's card at their own account. A card for
          -- yourself is a duplicate of you, not a link to you.
          AND c.owner_id <> $1
          AND EXISTS (
            SELECT 1 FROM contact_identity_keys k
             WHERE k.owner_id = c.owner_id AND k.contact_id = c.id
               AND k.key_type = ${KEY_TYPE.PHONE} AND k.key_hash = $2
          )`,
      [amberId, keyHash],
    );
    return rowCount || 0;
  } catch (e) {
    // Never fatal: a failure here must not stop a signup or a circle add. Logged,
    // because a silent failure here is precisely the bug this function was
    // written to end.
    console.error(`LINK_CONTACTS_BY_PHONE_ERR ${e?.message || e}`);
    return 0;
  }
}

export async function setContactLinkedAmberId({ ownerId, contactId, linkedAmberId }) {
  if (!ownerId || !contactId || !linkedAmberId) return null;
  try {
    const { rows } = await query(
      `UPDATE contacts
          SET linked_amber_id = $3, updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [contactId, ownerId, linkedAmberId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function updateContactFields({ ownerId, contactId, fullName, firstName, lastName, title, company, city, phone, email, notes }) {
  if (!ownerId || !contactId) return null;
  const sets = [];
  const params = [contactId, ownerId];

  if (fullName !== undefined) {
    params.push(fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (firstName !== undefined) {
    params.push(firstName);
    sets.push(`first_name = $${params.length}`);
  }
  if (lastName !== undefined) {
    params.push(lastName);
    sets.push(`last_name = $${params.length}`);
  }
  if (title !== undefined) {
    params.push(title);
    sets.push(`title = $${params.length}`);
  }
  if (company !== undefined) {
    params.push(company);
    sets.push(`company = $${params.length}`);
  }
  if (city !== undefined) {
    params.push(city);
    sets.push(`city = $${params.length}`);
  }
  if (phone !== undefined) {
    params.push(phone);
    sets.push(`phone_primary = $${params.length}`);
    params.push(phone);
    sets.push(`phones_all = $${params.length}`);
    params.push(_digitsOnly(phone));
    sets.push(`phone_primary_normalized = $${params.length}`);
  }
  if (email !== undefined) {
    params.push(email);
    sets.push(`emails = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    sets.push(`apple_notes = $${params.length}`);
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = now()");

  try {
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(", ")}
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      params,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function listRecentlyMentionedContacts(ownerId, { limit = 10 } = {}) {
  if (!ownerId) return [];
  const n = Math.max(1, Math.min(Number(limit) || 10, 50));

  const [notes, experiences] = await Promise.all([
    _mentionRows(ownerId, { kind: "note" }),
    _mentionRows(ownerId, { kind: "experience" }),
  ]);
  if (notes.length === 0 && experiences.length === 0) return [];

  // Fold to one entry per contact: their newest mention, plus a total count.
  const best = new Map(); // contactId -> { at, id, text, kind, count }
  for (const row of [...notes, ...experiences]) {
    for (const pid of row.participantIds) {
      if (pid == null) continue;
      const key = String(pid);
      const prev = best.get(key);
      if (!prev) {
        best.set(key, { at: row.at, id: row.id, text: row.text, kind: row.kind, count: 1 });
        continue;
      }
      prev.count += 1;
      // Newer wins. A row WITH a timestamp always beats one without, because an
      // unknown time cannot be shown to be more recent than a known one.
      const newer =
        row.at != null && prev.at != null
          ? row.at > prev.at
          : row.at != null
            ? true
            : prev.at != null
              ? false
              : row.kind === prev.kind && row.id > prev.id;
      if (newer) {
        prev.at = row.at;
        prev.id = row.id;
        prev.text = row.text;
        prev.kind = row.kind;
      }
    }
  }
  if (best.size === 0) return [];

  const ordered = Array.from(best.entries()).sort((a, b) => {
    const [, x] = a;
    const [, y] = b;
    if (x.at != null && y.at != null) return y.at - x.at;
    if (x.at != null) return -1; // timestamped rows first
    if (y.at != null) return 1;
    return y.id - x.id;
  });

  // Resolve names for only the page being returned, and let the join drop anyone
  // whose contact row is gone or belongs to someone else — owner_id is checked
  // here, so a stale participant id cannot leak another account's contact.
  const page = ordered.slice(0, n);
  let contactRows = [];
  try {
    ({ rows: contactRows } = await query(
      `SELECT id, full_name, company, title
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [ownerId, page.map(([id]) => id)],
    ));
  } catch (e) {
    console.error(`RECENTLY_MENTIONED_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
  const byId = new Map(contactRows.map((r) => [String(r.id), r]));

  return page
    .filter(([id]) => byId.has(id))
    .map(([id, m]) => {
      const c = byId.get(id);
      return {
        contactId: id,
        name: c.full_name ?? null,
        company: c.company ?? null,
        title: c.title ?? null,
        kind: m.kind,
        // Trimmed hard: this is a one-line reminder of what was said, not the note.
        // The note itself lives on the person's own screen.
        excerpt:
          typeof m.text === "string" ? m.text.replace(/\s+/g, " ").trim().slice(0, 180) : null,
        mentionedAt: m.at != null ? new Date(m.at).toISOString() : null,
        mentionCount: m.count,
      };
    });
}

export function mergeFiledWithStoredPeople(filedPeople, storedPeople) {
  const filed = (Array.isArray(filedPeople) ? filedPeople : []).filter(
    (p) => p && p.contactId != null,
  );
  const stored = (Array.isArray(storedPeople) ? storedPeople : []).filter(
    (p) => p && p.contactId != null,
  );
  const seen = new Set(filed.map((p) => String(p.contactId)));
  const filedSounds = new Set(
    filed.map((p) => _filedSoundex(String(p.name || "").trim().split(/\s+/)[0])).filter(Boolean),
  );
  const out = filed.map((p) => ({
    contactId: String(p.contactId),
    name: p.name ?? null,
    score: 0,
  }));
  for (const p of stored) {
    const id = String(p.contactId);
    if (seen.has(id)) continue;
    const sound = _filedSoundex(String(p.name || "").trim().split(/\s+/)[0]);
    // Superseded by a correction — drop it.
    if (sound && filedSounds.has(sound)) continue;
    seen.add(id);
    out.push({ contactId: id, name: p.name ?? null, score: 0 });
  }
  return out;
}

export async function listExperiencesForOwner(ownerId, { limit = 100 } = {}) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `${_EXPERIENCE_SELECT}
       ORDER BY COALESCE(o.observed_at, o.created_at) DESC
       LIMIT $2`,
      [ownerId, limit],
    );
    return rows.map(_mapExperienceRow);
  } catch {
    return [];
  }
}

/** The owner's experiences that involve one contact. For the person profile. */
export async function listExperiencesForContact(ownerId, contactId, { limit = 100 } = {}) {
  if (!ownerId || !contactId) return [];
  try {
    const { rows } = await query(
      `${_EXPERIENCE_SELECT}
         AND $2 = ANY(e.participant_ids)
       ORDER BY COALESCE(o.observed_at, o.created_at) DESC
       LIMIT $3`,
      [ownerId, contactId, limit],
    );
    return rows.map(_mapExperienceRow);
  } catch {
    return [];
  }
}

/**
 * The columns a web save is allowed to fill, so the writer can fill only what is
 * EMPTY. getContactById does not select the link columns and changing its shape
 * would ripple through every caller, so this is its own narrow read.
 *
 * Filling only blanks is the whole safety property here: a contact saved from
 * the web may already exist (createContactForOwner dedupes and merges), and
 * overwriting a real phone number or a company the user typed with something a
 * model read off a page would be destructive and silent.
 */
export async function getContactWebFields(ownerId, contactId) {
  if (!ownerId || !contactId) return null;
  try {
    const { rows } = await query(
      `SELECT id, full_name, phone_primary, emails, company, title, city, location,
              linkedin_url, twitter_url, github_url, website, avatar_url
       FROM contacts
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [contactId, ownerId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      fullName: r.full_name ?? null,
      phone: r.phone_primary ?? null,
      emails: r.emails ?? null,
      company: r.company ?? null,
      title: r.title ?? null,
      city: r.city ?? null,
      location: r.location ?? null,
      linkedin_url: r.linkedin_url ?? null,
      twitter_url: r.twitter_url ?? null,
      github_url: r.github_url ?? null,
      website: r.website ?? null,
      avatar_url: r.avatar_url ?? null,
    };
  } catch (err) {
    console.error(`[store] getContactWebFields failed: ${err?.message || err}`);
    return null;
  }
}

/** Columns setContactLinkFields may write. Anything else in `fields` is ignored,
 *  so a caller can hand it a whole extraction result without it becoming an
 *  injection surface or clobbering something it has no business touching. */
const _LINK_COLUMNS = new Set([
  "linkedin_url",
  "twitter_url",
  "github_url",
  "website",
  "avatar_url",
  "location",
]);

/**
 * Write the link columns on a contact, and ONLY those.
 *
 * setContactEnrichment can also write these, but it always stamps enriched_at
 * and can set enrichment_status — which would tell the person card that the
 * Perplexity/PeopleRank enrichment had run when all that happened is that we
 * stored the URL you saved someone from. Different claim, different writer.
 *
 * Returns { contactId, updated: [columns] } or null.
 */
export async function setContactLinkFields(ownerId, contactId, fields = {}) {
  if (!ownerId || !contactId) return null;
  const sets = [];
  const params = [contactId, ownerId];
  for (const [k, v] of Object.entries(fields || {})) {
    if (!_LINK_COLUMNS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (sets.length === 0) return { contactId: String(contactId), updated: [] };
  sets.push("updated_at = now()");
  try {
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(", ")}
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      params,
    );
    if (!rows[0]) return null;
    return { contactId: String(rows[0].id), updated: Object.keys(fields).filter((k) => _LINK_COLUMNS.has(k)) };
  } catch (err) {
    console.error(`[store] setContactLinkFields failed: ${err?.message || err}`);
    return null;
  }
}

// ── Contact search that tells the truth about how much it found ──────────────
//
// searchPeopleByAttributes (above) is kept for its existing callers, but it has
// two properties that produced visibly wrong answers:
//
//   1. It returns a PAGE and nothing else. The caller passed limit: 25, handed
//      `Matches (25)` to the model, and the model reported 25 as the total for a
//      user with far more than 25. A cap the model cannot see is a lie the model
//      repeats. searchContacts returns { rows, total } — total is the count
//      BEFORE the limit, from the same query.
//
//   2. It only LIKEs full_name, company, title and city. "All my USC
//      connections" therefore missed everyone with USC in their notes, their
//      tags or their occupation. `q` is a free-text term matched across all of
//      those, including the contact's notes rows.

const _SEARCH_FIELD_CLAUSES = [
  "c.full_name ILIKE $Q",
  "c.company ILIKE $Q",
  "c.title ILIKE $Q",
  "c.city ILIKE $Q",
  "c.location ILIKE $Q",
  "c.apple_notes ILIKE $Q",
  "EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}'::text[])) tg WHERE tg ILIKE $Q)",
  // ONE CLAUSE WHERE THERE WERE TWO. contact_notes matched on
  // participant_ids and contact_facts on contact_id; observations records the
  // subject as a participant row as well, so a single join through
  // observation_participants covers both -- a fact about this person and a note
  // that merely mentions them.
  `EXISTS (SELECT 1 FROM observations o
             JOIN observation_participants op
               ON op.observation_id = o.observation_id
            WHERE o.owner_id = c.owner_id
              AND o.deleted_at IS NULL
              AND op.contact_id = c.id
              AND o.body ILIKE $Q)`,
];

// The narrow set, used only if the wide query hits a column this deployment does
// not have. Degrading is fine; degrading SILENTLY is not, so it logs.
const _SEARCH_FIELD_CLAUSES_NARROW = [
  "c.full_name ILIKE $Q",
  "c.company ILIKE $Q",
  "c.title ILIKE $Q",
  "c.city ILIKE $Q",
];

const _MISSING_SCHEMA = new Set(["42P01", "42703"]);

export function _buildSearchSql({ filters, wide }) {
  const clauses = ["c.owner_id = $1", "c.deleted_at IS NULL"];
  const params = [filters.ownerId];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const like = (col, val) => {
    if (typeof val !== "string" || !val.trim()) return false;
    clauses.push(`${col} ILIKE ${push(`%${val.trim()}%`)}`);
    return true;
  };
  let used = false;
  used = like("c.company", filters.company) || used;
  used = like("c.title", filters.title) || used;
  used = like("c.city", filters.city) || used;
  used = like("c.full_name", filters.name) || used;

  let qParam = null;
  if (typeof filters.q === "string" && filters.q.trim()) {
    qParam = push(`%${filters.q.trim()}%`);
    const set = wide ? _SEARCH_FIELD_CLAUSES : _SEARCH_FIELD_CLAUSES_NARROW;
    clauses.push(`(${set.map((c) => c.replaceAll("$Q", qParam)).join(" OR ")})`);
    used = true;
  }
  if (!used) return null; // never dump the whole address book

  // Relevance, so the most explanatory match is on the first page rather than
  // whoever happens to sort first alphabetically. A name/company/title hit is a
  // stronger answer to "my USC people" than the word appearing in a long note.
  const rel = qParam
    ? `(CASE WHEN c.full_name ILIKE ${qParam} THEN 3 ELSE 0 END
        + CASE WHEN c.company ILIKE ${qParam} OR c.title ILIKE ${qParam} THEN 3 ELSE 0 END
        + CASE WHEN c.apple_notes ILIKE ${qParam} THEN 2 ELSE 0 END)`
    : "0";

  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? Math.min(filters.limit, 500) : 50;
  const offset = Number.isInteger(filters.offset) && filters.offset > 0 ? filters.offset : 0;
  const limP = push(limit);
  const offP = push(offset);

  return {
    sql: `SELECT c.id, c.full_name, c.title, c.company, c.city, c.phone_primary,
                 c.tags, ${rel} AS rel, count(*) OVER () AS total
            FROM contacts c
           WHERE ${clauses.join(" AND ")}
           ORDER BY rel DESC, c.full_name ASC
           LIMIT ${limP} OFFSET ${offP}`,
    params,
  };
}

/**
 * Attribute + free-text contact search.
 *
 *   searchContacts(ownerId, { q: "usc", limit: 60 })
 *     -> { rows: [{ id, name, title, company, city, phone, tags }], total, narrowed }
 *
 * `total` is the number of matching contacts, NOT the number returned — that is
 * the whole point of it. `narrowed` is true when the wide search could not run
 * and only the four core columns were searched, so a caller can say so instead
 * of quietly under-reporting.
 */
export async function searchContacts(ownerId, filters = {}) {
  const empty = { rows: [], total: 0, narrowed: false };
  if (!ownerId) return empty;
  for (const wide of [true, false]) {
    const built = _buildSearchSql({ filters: { ...filters, ownerId }, wide });
    if (!built) return empty;
    try {
      const { rows } = await query(built.sql, built.params);
      return {
        rows: rows.map((r) => ({
          id: String(r.id),
          name: r.full_name || "Unknown",
          title: r.title || null,
          company: r.company || null,
          city: r.city || null,
          phone: r.phone_primary || null,
          tags: Array.isArray(r.tags) ? r.tags : [],
        })),
        total: rows[0] ? Number(rows[0].total) || rows.length : 0,
        narrowed: !wide,
      };
    } catch (err) {
      if (wide && _MISSING_SCHEMA.has(err?.code)) {
        console.error(
          `[store] searchContacts wide query unavailable (${err.code}: ${err.message}) — falling back to name/company/title/city only`,
        );
        continue;
      }
      console.error(`[store] searchContacts failed: ${err?.message || err}`);
      return empty;
    }
  }
  return empty;
}

/**
 * Every contact's name and the few fields a suggestion card needs, for in-JS
 * fuzzy matching when an exact name search finds nobody.
 *
 * This reads the whole book on purpose. Trigram or Levenshtein in Postgres would
 * be tidier but both need an extension (pg_trgm / fuzzystrmatch) that may not be
 * installed, and silently returning nothing because an extension is missing is
 * exactly the class of bug being fixed here. Names are small; a 5,000-contact
 * book is a few hundred KB and the match runs in single-digit milliseconds.
 */
export async function listContactNamesForOwner(ownerId, { limit = 20000 } = {}) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT id, full_name, title, company, city, phone_primary
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL AND full_name IS NOT NULL
        LIMIT $2`,
      [ownerId, Math.min(Math.max(1, limit), 50000)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.full_name,
      title: r.title || null,
      company: r.company || null,
      city: r.city || null,
      phone: r.phone_primary || null,
    }));
  } catch (err) {
    console.error(`[store] listContactNamesForOwner failed: ${err?.message || err}`);
    return [];
  }
}

/**
 * Rewrite a misheard name inside a note or experience's own text.
 *
 * When a voice note says "Sagar and Raj are coming over" and the transcript hears
 * "Roger", the ambiguous participant gets a "who did you mean" card. Answering it
 * used to append the RIGHT contact to participant_ids and leave the text saying
 * "Roger" forever — so the card on the feed still read the wrong name, and the
 * user's correction looked like it had not been taken. The tag and the words have
 * to agree, or the correction is only half applied.
 *
 * Replaces whole-word occurrences only, so correcting "Raj" never mangles
 * "Rajesh" elsewhere in the same sentence. Owner-scoped. Never throws.
 *
 *   correctNameInContent({ ownerId, contentType: "experience", contentId, fromName: "Roger", toName: "Raj Patel" })
 *     -> { updated: true, text: "Sagar and Raj coming over tomorrow." }
 */
/**
 * Rewrite a misheard name inside a conversation TRANSCRIPT.
 *
 * correctNameInContent (below) repairs contact_notes and contact_experiences — the
 * derived records. It never touched app_conversation_messages, which IS the voice
 * note: the thing rendered on the Today card and reopened in Voice Chat. So picking
 * the right person in the disambiguation flow fixed the person card and left the note
 * still saying "Roger", which reads as the app not having understood after all.
 *
 * USER TURNS ONLY. An assistant turn is Amber's own prose and may legitimately
 * mention the misheard string while explaining the correction; rewriting that would
 * make the explanation incoherent.
 *
 * Scoped to one conversation, and to this owner. Whole-word, case-insensitive, with
 * the name escaped — a transcript is arbitrary user text and can contain regex
 * metacharacters.
 *
 * @returns {Promise<{ updated: number }>}
 */
export async function correctNameInTranscript({
  ownerId,
  conversationId,
  fromName,
  toName,
} = {}) {
  if (!ownerId || !conversationId || !fromName || !toName) return { updated: 0 };
  const from = String(fromName).trim();
  const full = String(toName).trim();
  // Same rule as correctNameInContent: a one-word mishearing gets a one-word fix,
  // because that is how the sentence was spoken.
  const to = from.includes(" ") ? full : full.split(/\s+/)[0] || full;
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return { updated: 0 };

  try {
    const { rows } = await query(
      `SELECT id, content FROM conversation_messages
        WHERE owner_id = $1::uuid AND conversation_id = $2::uuid
          AND role = 'user' AND deleted_at IS NULL`,
      [ownerId, conversationId],
    );
    if (rows.length === 0) return { updated: 0 };

    const re = nameBoundaryRegex(from, "gi");
    if (!re) return { updated: 0 };

    let updated = 0;
    for (const row of rows) {
      const current = typeof row.content === "string" ? row.content : "";
      if (!current) continue;
      re.lastIndex = 0;
      if (!re.test(current)) continue;
      re.lastIndex = 0;
      const next = current.replace(re, to);
      if (next === current) continue;
      await query(
        `UPDATE conversation_messages SET content = $1 WHERE id = $2 AND owner_id = $3::uuid`,
        [next, row.id, ownerId],
      );
      updated += 1;
    }
    return { updated };
  } catch {
    // Fail-open: a transcript that keeps the old spelling is a cosmetic miss, and
    // it must never fail the correction that the user actually asked for.
    return { updated: 0 };
  }
}

export async function correctNameInContent({
  ownerId,
  contentType,
  contentId,
  fromName,
  toName,
} = {}) {
  const out = { updated: false, text: null };
  if (!ownerId || !contentId || !fromName || !toName) return out;
  // ONE TABLE, BECAUSE THERE IS ONLY ONE TABLE.
  //
  // This picked between contact_notes and contact_experiences by contentType.
  // Both were dropped in the observations rebuild -- a note and an experience
  // are both `observations` rows now, told apart by `kind`, with their words in
  // `body`. So every resolution of an experience logged
  //
  //   [store] correctNameInContent failed: relation "contact_experiences" does not exist
  //
  // and the transcript kept the misheard name while the tag was corrected. The
  // failure was caught and logged, which is why it survived: the resolution
  // still appeared to work, and only the words stayed wrong.
  if (contentType !== "note" && contentType !== "experience") return out;

  const from = String(fromName).trim();
  // A single-token mishearing gets a single-token correction: "Roger" becomes
  // "Raj", not "Raj Patel", because that is how the sentence was spoken.
  const full = String(toName).trim();
  const to = from.includes(" ") ? full : full.split(/\s+/)[0] || full;
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return out;

  try {
    const { rows } = await query(
      `SELECT body AS text FROM observations
        WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [contentId, ownerId],
    );
    const current = rows[0]?.text;
    if (typeof current !== "string" || !current) return out;
    // nameBoundaryRegex escapes the raw name (a transcript can contain regex
    // metacharacters) and uses Unicode boundaries so accented names match.
    const re = nameBoundaryRegex(from, "gi");
    if (!re || !re.test(current)) return out;
    re.lastIndex = 0;
    const next = current.replace(re, to);
    if (next === current) return out;
    // NO updated_at, BECAUSE THE TABLE HAS NO SUCH COLUMN.
    //
    // observations carries created_at and observed_at and nothing else; the
    // rebuild deliberately left out a mutation timestamp, because an
    // observation is a thing somebody said at a time rather than a record that
    // gets revised. Naming it here raised
    //
    //   column "updated_at" of relation "observations" does not exist
    //
    // on EVERY name correction -- caught, logged, and invisible: the tag moved,
    // the words kept the misheard name, and the user's correction looked like it
    // had worked. Same class of bug as the contact_experiences line above, two
    // statements apart, which is what a column named from memory costs.
    await query(
      `UPDATE observations SET body = $1
        WHERE observation_id = $2 AND owner_id = $3 AND deleted_at IS NULL`,
      [next, contentId, ownerId],
    );
    return { updated: true, text: next };
  } catch (err) {
    console.error(`[store] correctNameInContent failed: ${err?.message || err}`);
    return out;
  }
}
