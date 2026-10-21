/**
 * Firestore-backed user store.
 *
 * Replaces the Drizzle/Postgres CRUD that auth.js, internal.js, profile.js,
 * onboarding.js, and privacy.js used to do against:
 *   users / user_profiles / onboarding_progress / personality_profiles /
 *   user_permissions / permission_audit_log / contacts
 *
 * Storage layout (per AGENTS.md: DID is the primary key everywhere):
 *
 *   users/{privyDid}                       canonical user doc
 *     id            = privyDid (string; legacy ports treat user.id as PK)
 *     privyUserId   = privyDid
 *     privacyTier   = "local_only" | "selective_cloud" | "full_social"
 *     cnftMint, cnftAssetId, cnftTxSignature, cnftMerkleTree, cnftMintedAt
 *     createdAt, updatedAt
 *
 *   users/{privyDid}/profile/main          profile fields
 *   users/{privyDid}/onboarding/progress   onboarding progress
 *   users/{privyDid}/personality/{type}    personality profiles by type
 *   users/{privyDid}/permissions/{field}   field-level sync flags
 *   users/{privyDid}/audit/{autoId}        permission change audit log
 *   users/{privyDid}/contacts/{contactId}  user contacts (Apple/iOS import)
 *
 * Everything is keyed by Privy DID — no integer surrogate keys. Callers that
 * historically passed an `id` integer should now pass the DID string. The
 * old contract is preserved at the wire level by returning `id = privyDid`.
 */

import { normalizePhone } from "../lib/auth-session.js";
import { query } from "./sql.js";
import {
  claimIdentityKeys,
  claimsForRecord,
  mergedColumnValues,
  noteContactWrite,
  recordReviewCandidates,
  resolveContactIdentity,
} from "./contact-identity.js";
import { normalizeExternalId } from "../lib/contact-identity.js";
import {
  resolveAmberIdByPrivyDid,
  getUserProfileByAmberId,
  setUserProfileFields,
  getUserProfileExtraByAmberId,
  mergeUserProfileExtra,
} from "./store.js";

/**
 * "Does this caller correspond to a real account?" -- from Cloud SQL.
 *
 * THIRTEEN ROUTE FILES USED TO ASK FIRESTORE THIS, and 404'd the request when the
 * answer did not come back. /v1/ask was one of them. The Firestore user document
 * held exactly one field Postgres did not -- the Solana cNFT mint -- and the cNFT
 * surface is gone, so there is nothing left in that document worth a network hop
 * to another datastore.
 *
 * Accepts any of the three shapes a caller's identity arrives in: a legacy Privy
 * DID, the `did:amber:<uuid>` an amber-id session carries, or a bare amber_id.
 * Returns a plain object with `id` so the ~13 call sites that only test
 * truthiness keep working unchanged.
 *
 * upsertUser is NOT replaced. Its only caller was the cNFT mint route.
 */
const _DID_AMBER = /^did:amber:([0-9a-f-]{36})$/i;
const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getUserByPrivyDid(did) {
  if (!did || typeof did !== "string") return null;
  const bare = _DID_AMBER.exec(did)?.[1] ?? (_UUID.test(did) ? did : null);
  const { rows } = await query(
    `SELECT amber_id, privy_did, phone, full_name, handle, status, created_at
       FROM users
      WHERE deleted_at IS NULL
        AND (privy_did = $1 OR ($2::uuid IS NOT NULL AND amber_id = $2::uuid))
      LIMIT 1`,
    [did, bare],
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.privy_did || `did:amber:${u.amber_id}`,
    amberId: String(u.amber_id),
    privyUserId: u.privy_did ?? null,
    phone: u.phone ?? null,
    fullName: u.full_name ?? null,
    handle: u.handle ?? null,
    status: u.status ?? null,
    createdAt: u.created_at ?? null,
  };
}

/**
 * Find an account by email address -- from Cloud SQL.
 *
 * This used to ask Privy, which held a primary and linked addresses per user. We
 * hold exactly one kind of address: the one a provider sign-in gave us, in
 * `user_identities.email` (Apple sends it on the first authorization and never
 * again, which is why migration 024 put the column back). `users` has no email
 * column at all, so there is nothing else to search.
 *
 * NARROWER THAN THE PRIVY VERSION, deliberately. An account that has never signed
 * in with a provider has no address here and will not be found. The three callers
 * -- two internal admin lookups and the tenant resolver -- all treat "not found"
 * as an ordinary answer.
 */
export async function getUserByEmail(email) {
  const addr = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!addr) return null;
  const { rows } = await query(
    `SELECT u.amber_id, u.privy_did, u.phone, u.full_name, i.email
       FROM user_identities i
       JOIN users u ON u.amber_id = i.amber_id
      WHERE lower(i.email) = $1 AND i.deleted_at IS NULL AND u.deleted_at IS NULL
      ORDER BY i.last_used_at DESC NULLS LAST
      LIMIT 1`,
    [addr],
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.privy_did || `did:amber:${u.amber_id}`,
    amberId: String(u.amber_id),
    email: u.email ?? null,
    phone: u.phone ?? null,
    fullName: u.full_name ?? null,
  };
}

/**
 * Normalize an array of phone strings to E.164. Pure helper; exported for
 * tests. Drops empty/unparseable entries.
 */
export function normalizePhoneList(phones) {
  if (!Array.isArray(phones)) return [];
  const out = [];
  for (const p of phones) {
    const n = normalizePhone(p);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Lowercase + trim an email string. Returns null for non-strings, empty
 * strings, or anything missing an "@". Mirror of normalizePhone for emails
 * so cross-tenant `array-contains` lookups can match case-insensitively
 * without scanning every contact at read time.
 */
export function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.indexOf("@") < 1) return null;
  return trimmed;
}

/**
 * Normalize an array of emails. Pure helper; exported for tests. Drops
 * empties + duplicates so the persisted `emailsNormalized` list never
 * carries the same value twice (which would make array-contains-any noisy).
 */
export function normalizeEmailList(emails) {
  if (!Array.isArray(emails)) return [];
  const seen = new Set();
  const out = [];
  for (const e of emails) {
    const n = normalizeEmail(e);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// ─── canonical user (amber) ──────────────────────────────────────────────────

/**
 * GET-ONLY resolver keyed by Privy DID (Chunk 4a). Returns the amber `users`
 * row for a DID that has been linked (privy_did backfilled), else null.
 *
 * Unlike the old Firestore version this CANNOT create a user — a Cloud SQL user
 * requires a phone, and creation is owned by resolveAmberIdByPhone on the OTP
 * path. Every live caller's user is already backfilled, so a get is sufficient;
 * an unlinked DID resolves to null and callers treat that as "no user" (the
 * same shape the Firestore version returned for a missing doc).
 */
export async function getOrCreateUser(privyDid) {
  if (!privyDid) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function setUserPrivacyTier(privyDid, tier) {
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return;
  await setUserProfileFields({ amberId, privacyTier: tier });
}

// ─── profile ───────────────────────────────────────────────────────────────
// The camelCase profile shape merges the discrete users columns (via
// getUserProfileByAmberId) with the users.profile_extra jsonb overflow, so
// callers keep reading BOTH known fields (displayName, currentCity, bio, …)
// and overflow keys (pronouns, birthday, almaMater, contentHash, …).

export async function getProfile(privyDid) {
  if (!privyDid) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  const base = await getUserProfileByAmberId(amberId);
  if (!base) return null;
  const extra = await getUserProfileExtraByAmberId(amberId);
  // Discrete columns are canonical; spread them LAST so they win any overlap.
  return { ...extra, ...base };
}

// Column-backed profile keys go through setUserProfileFields; every other key
// merges into profile_extra. Partial patches never null untouched fields
// (undefined values are skipped; each store maps only what it was given).
const PROFILE_COLUMN_KEYS = new Set([
  "currentCity",
  "occupation",
  "bio",
  "mbti",
  "school",
  "hometown",
  "horoscope",
  "avatarUrl",
  "privacyTier",
  "onboardingCompletedAt",
  "username",
]);

export async function upsertProfile(privyDid, patch) {
  if (!privyDid) throw new Error("privyDid required");
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;

  const known = {};
  const extra = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (k === "displayName" || k === "name" || k === "fullName") {
      known.fullName = v;
    } else if (k === "city") {
      known.currentCity = v;
    } else if (PROFILE_COLUMN_KEYS.has(k)) {
      known[k] = v;
    } else {
      extra[k] = v;
    }
  }

  if (Object.keys(known).length > 0) {
    await setUserProfileFields({ amberId, ...known });
  }
  if (Object.keys(extra).length > 0) {
    await mergeUserProfileExtra(amberId, extra);
  }
  return getProfile(privyDid);
}

// ─── onboarding progress ───────────────────────────────────────────────────
// One row per owner: onboarding_progress(owner_id PK, progress jsonb). The
// whole progress object lives in the jsonb; upsert merges it SQL-side so a
// partial patch keeps prior keys (currentStep, stepsCompleted, …).

export async function getOnboardingProgress(privyDid) {
  if (!privyDid) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT progress FROM onboarding_progress WHERE owner_id = $1`,
      [amberId],
    );
    const p = rows[0]?.progress;
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

export async function upsertOnboardingProgress(privyDid, patch) {
  if (!privyDid) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO onboarding_progress (owner_id, progress)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (owner_id) DO UPDATE
         SET progress   = COALESCE(onboarding_progress.progress, '{}'::jsonb) || EXCLUDED.progress,
             updated_at = now()
       RETURNING progress`,
      [amberId, JSON.stringify(patch || {})],
    );
    return rows[0]?.progress ?? null;
  } catch {
    return null;
  }
}

// ─── personality profiles ──────────────────────────────────────────────────
// personality_profiles(owner_id, profile_type, data jsonb) — UNIQUE
// (owner_id, profile_type). The arbitrary profile fields live in `data`;
// profile_type is the key. Returned shape { profileType, ...data } matches the
// old Firestore per-type doc.

function personalityRowToShape(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return { profileType: row.profile_type, ...data };
}

export async function listPersonalityProfiles(privyDid) {
  if (!privyDid) return [];
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return [];
  try {
    const { rows } = await query(
      `SELECT profile_type, data FROM personality_profiles
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    return rows.map(personalityRowToShape);
  } catch {
    return [];
  }
}

export async function upsertPersonalityProfile(privyDid, profile) {
  if (!privyDid || !profile?.profileType) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  const { profileType, ...data } = profile;
  try {
    const { rows } = await query(
      `INSERT INTO personality_profiles (owner_id, profile_type, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (owner_id, profile_type) DO UPDATE
         SET data       = COALESCE(personality_profiles.data, '{}'::jsonb) || EXCLUDED.data,
             updated_at = now()
       RETURNING profile_type, data`,
      [amberId, profileType, JSON.stringify(data)],
    );
    return personalityRowToShape(rows[0]);
  } catch {
    return null;
  }
}

/** insert ... ON CONFLICT (owner_id, profile_type) DO NOTHING, then read back. */
export async function insertPersonalityIfAbsent(privyDid, profile) {
  if (!privyDid || !profile?.profileType) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  const { profileType, ...data } = profile;
  try {
    await query(
      `INSERT INTO personality_profiles (owner_id, profile_type, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (owner_id, profile_type) DO NOTHING`,
      [amberId, profileType, JSON.stringify(data)],
    );
    const { rows } = await query(
      `SELECT profile_type, data FROM personality_profiles
       WHERE owner_id = $1 AND profile_type = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [amberId, profileType],
    );
    return personalityRowToShape(rows[0]);
  } catch {
    return null;
  }
}

// ─── field-level permissions ───────────────────────────────────────────────
// permissions(owner_id, field_type, allowed bool) — UNIQUE (owner_id,
// field_type). The public shape uses `syncEnabled`; the column is `allowed`.

export async function listPermissions(privyDid) {
  if (!privyDid) return [];
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return [];
  try {
    const { rows } = await query(
      `SELECT field_type, allowed FROM permissions WHERE owner_id = $1`,
      [amberId],
    );
    return rows.map((r) => ({
      fieldType: r.field_type,
      syncEnabled: !!r.allowed,
    }));
  } catch {
    return [];
  }
}

export async function getPermission(privyDid, fieldType) {
  if (!privyDid || !fieldType) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT field_type, allowed FROM permissions
       WHERE owner_id = $1 AND field_type = $2
       LIMIT 1`,
      [amberId, fieldType],
    );
    if (!rows[0]) return null;
    return { fieldType: rows[0].field_type, syncEnabled: !!rows[0].allowed };
  } catch {
    return null;
  }
}

export async function upsertPermission(privyDid, { fieldType, syncEnabled }) {
  if (!privyDid || !fieldType) return null;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO permissions (owner_id, field_type, allowed)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, field_type) DO UPDATE
         SET allowed = EXCLUDED.allowed, updated_at = now()
       RETURNING field_type, allowed`,
      [amberId, fieldType, !!syncEnabled],
    );
    return { fieldType: rows[0].field_type, syncEnabled: !!rows[0].allowed };
  } catch {
    return null;
  }
}

export async function disableAllPermissions(privyDid) {
  if (!privyDid) return;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return;
  try {
    await query(
      `UPDATE permissions SET allowed = false, updated_at = now()
       WHERE owner_id = $1`,
      [amberId],
    );
  } catch {
    // best-effort
  }
}

// ─── permission audit log ──────────────────────────────────────────────────
// permission_audit(owner_id, entry jsonb, created_at). The whole entry lives in
// jsonb; changedAt/changedTs are folded in so listPermissionAudit preserves the
// Firestore ordering + shape.

export async function appendPermissionAudit(privyDid, entry) {
  if (!privyDid) return;
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return;
  const now = new Date();
  const full = {
    ...(entry || {}),
    changedAt: now.toISOString(),
    changedTs: now.getTime(),
  };
  try {
    await query(
      `INSERT INTO permission_audit (owner_id, entry) VALUES ($1, $2::jsonb)`,
      [amberId, JSON.stringify(full)],
    );
  } catch {
    // best-effort
  }
}

export async function listPermissionAudit(privyDid) {
  if (!privyDid) return [];
  const amberId = await resolveAmberIdByPrivyDid(privyDid);
  if (!amberId) return [];
  try {
    const { rows } = await query(
      `SELECT entry FROM permission_audit
       WHERE owner_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [amberId],
    );
    return rows.map((r) => r.entry);
  } catch {
    return [];
  }
}

// ─── contacts ──────────────────────────────────────────────────────────────
//
// All contact functions now read+write the Cloud SQL amber `contacts` table
// via query() from ./sql.js.  The return SHAPE is preserved exactly so all
// callers keep working: { id: <string-bigint>, ...camelCaseFields }.
//
// Amber schema differs from the old Railway schema:
//   - id          UUID. This line used to say bigint, and every WHERE below
//                 cast to ::bigint accordingly -- uuid = bigint is not an
//                 operator, so all six of those statements threw.
//   - owner_id    uuid  (amber_id, not privyDid)
//   - full_name   (not name)
//   - phones_all  comma-string  (not text[] phone_numbers)
//   - emails      comma-string  (not text[] emails)
//   - apple_notes (not notes)
//   - metadata    jsonb — carries overflow fields that have no dedicated column
//                 (context, relationship, sourceHandle, avatarUrl, socialUrls,
//                  birthday, messageFrequency, lastContactedAt, relationshipScore)
//
// NOTE: all callers must pass amber_id (uuid) as `ownerId`.  The migration
// guide for each call site is in docs/AUDIT-legacy-removal.md.

/**
 * A CONTACT ID IS A UUID. This was CONTACT_BIGINT_RE = /^\d+$/, and it guards
 * three write paths -- the contact UPDATE, and both metadata writers. A uuid
 * fails /^\d+$/, so all three returned null or skipped the UPDATE without
 * erroring: the write simply did not happen and nothing said so. The SQL type
 * audit cannot see this one, because these never reached SQL at all.
 */
const CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Flatten stored enrichment candidates for the app.
 *
 * The resolver stores the ranked array in its nested shape
 * `[{ candidate: { name, linkedinUrl, title, company, city, ... }, score,
 * signals }]`, but the app (apps/mobile/lib/enrichment.ts and
 * app/(gated)/person/[id].tsx) reads each candidate FLAT (`.name`, `.title`,
 * `.company`, `.city`, `.linkedinUrl`, `.score`, `.signals`). Serving the raw
 * nested rows produced a blank "This is them" card. Flatten each element to
 * `{ ...candidate, score, signals }`; pass through anything already flat.
 * Mirrors the `candOf` helper in src/routes/contacts-enrich.js.
 */
function flattenEnrichmentCandidates(candidates) {
  if (!Array.isArray(candidates)) return candidates ?? null;
  return candidates.map((el) => {
    if (el && typeof el === "object" && el.candidate) {
      return { ...el.candidate, score: el.score, signals: el.signals };
    }
    return el;
  });
}

/** Map an amber contacts row (snake_case) to the camelCase shape callers expect. */
export function rowToContact(row) {
  if (!row) return null;
  const meta =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const phoneNumbers = row.phones_all
    ? row.phones_all
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : row.phone_primary
      ? [row.phone_primary]
      : [];
  const emails = row.emails
    ? row.emails
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    id: String(row.id),
    userId: row.owner_id ?? null,
    externalId: row.external_id ?? null,
    name: row.full_name ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    phoneNumbers,
    phoneNumbersNormalized: normalizePhoneList(phoneNumbers),
    emails,
    emailsNormalized: normalizeEmailList(emails),
    phone: row.phone_primary ?? null,
    phoneNormalized: row.phone_primary_normalized ?? null,
    email: emails[0] ?? null,
    birthday: meta.birthday ?? null,
    messageFrequency: meta.messageFrequency ?? 0,
    lastContactedAt: meta.lastContactedAt ?? null,
    relationshipScore: meta.relationshipScore ?? 0,
    source: row.source ?? null,
    sourceHandle: meta.sourceHandle ?? null,
    company: row.company ?? null,
    title: row.title ?? null,
    city: row.city ?? null,
    location: row.location ?? null,
    notes: row.apple_notes ?? null,
    context: meta.context ?? null,
    // Dedicated columns are the source of truth; fall back to metadata.* only
    // for legacy rows written before these columns existed.
    avatarUrl: row.avatar_url ?? meta.avatarUrl ?? null,
    linkedinUrl: row.linkedin_url ?? meta.linkedinUrl ?? null,
    twitterUrl: row.twitter_url ?? meta.twitterUrl ?? null,
    githubUrl: row.github_url ?? meta.githubUrl ?? null,
    website: row.website ?? meta.website ?? null,
    websiteUrl: meta.websiteUrl ?? row.website ?? null,
    metadata: row.metadata ?? null,
    relationship: meta.relationship ?? null,
    // Enrichment lifecycle.
    enrichment: row.enrichment ?? null,
    enrichmentStatus: row.enrichment_status ?? null,
    enrichedAt: row.enriched_at ?? null,
    enrichmentCandidates: flattenEnrichmentCandidates(
      row.enrichment_candidates,
    ),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function listContacts(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC`,
      [ownerId],
    );
    return rows.map(rowToContact);
  } catch {
    return [];
  }
}

/**
 * Fields the ranking path actually reads. Kept for callers that inspect this
 * constant (e.g., light-read guards). The amber SELECT * is already cheap, so
 * there is no projection in the SQL itself.
 */
export const RANK_CONTACT_FIELDS = Object.freeze([
  "name",
  "firstName",
  "lastName",
  "company",
  "title",
  "phoneNumbers",
  "phoneNumbersNormalized",
  "emails",
  "emailsNormalized",
  "phone",
  "email",
  "messageFrequency",
  "lastContactedAt",
  "relationshipScore",
  "source",
  "sourceHandle",
  "avatarUrl",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
  "website",
  "websiteUrl",
  "updatedAt",
]);

export async function listContactsForRanking(ownerId) {
  return listContacts(ownerId);
}

/**
 * Cursor-paginated contacts for clients that page a large address book.
 *   listContactsPage(ownerId, { limit = 100, cursor = null })
 *     → { contacts, nextCursor, hasMore }
 * `cursor` is the bigint id string returned as `nextCursor` on the prior page.
 */
export async function listContactsPage(
  ownerId,
  { limit = 100, cursor = null } = {},
) {
  if (!ownerId) return { contacts: [], nextCursor: null, hasMore: false };
  const pageSize = Math.max(1, Math.min(Number(limit) || 100, 500));
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND ($2::uuid IS NULL OR id > $2::uuid)
       ORDER BY id
       LIMIT $3`,
      [ownerId, cursor ? String(cursor) : null, pageSize + 1],
    );
    const hasMore = rows.length > pageSize;
    const sliced = rows.slice(0, pageSize);
    const contacts = sliced.map(rowToContact);
    const nextCursor =
      hasMore && sliced.length > 0
        ? String(sliced[sliced.length - 1].id)
        : null;
    return { contacts, nextCursor, hasMore };
  } catch {
    return { contacts: [], nextCursor: null, hasMore: false };
  }
}

export async function getContactByExternalId(ownerId, externalId) {
  if (!ownerId || !externalId) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND external_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerId, externalId],
    );
    return rows.length ? rowToContact(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function upsertContact(ownerId, contact) {
  if (!ownerId || !contact?.name) return null;

  const phoneNumbers = Array.isArray(contact.phoneNumbers)
    ? contact.phoneNumbers
    : [];
  const phonePrimary = phoneNumbers[0] ?? contact.phone ?? null;
  const phonePrimaryNorm = normalizePhone(phonePrimary) || null;
  const phonesAll = phoneNumbers.length
    ? phoneNumbers.join(", ")
    : phonePrimary || null;

  const emailsArr = Array.isArray(contact.emails) ? contact.emails : [];
  const emailsStr = emailsArr.length ? emailsArr.join(", ") : null;

  // Overflow fields that have no dedicated amber column go into metadata jsonb.
  const existingMeta =
    contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
  const meta = { ...existingMeta };
  if (contact.context !== undefined) meta.context = contact.context;
  if (contact.relationship !== undefined)
    meta.relationship = contact.relationship;
  if (contact.sourceHandle !== undefined)
    meta.sourceHandle = contact.sourceHandle;
  if (contact.avatarUrl !== undefined) meta.avatarUrl = contact.avatarUrl;
  if (contact.linkedinUrl !== undefined) meta.linkedinUrl = contact.linkedinUrl;
  if (contact.twitterUrl !== undefined) meta.twitterUrl = contact.twitterUrl;
  if (contact.githubUrl !== undefined) meta.githubUrl = contact.githubUrl;
  if (contact.website !== undefined) meta.website = contact.website;
  if (contact.websiteUrl !== undefined) meta.websiteUrl = contact.websiteUrl;
  if (contact.birthday !== undefined) meta.birthday = contact.birthday;
  if (contact.messageFrequency !== undefined)
    meta.messageFrequency = contact.messageFrequency;
  if (contact.lastContactedAt !== undefined)
    meta.lastContactedAt = contact.lastContactedAt;
  if (contact.relationshipScore !== undefined)
    meta.relationshipScore = contact.relationshipScore;
  const metaJson = Object.keys(meta).length ? JSON.stringify(meta) : null;

  const city = contact.city ?? null;
  const location = contact.location ?? null;

  try {
    // contact.id as a bigint string → UPDATE existing row by id.
    if (contact.id && CONTACT_ID_RE.test(String(contact.id))) {
      const { rows: updated } = await query(
        `UPDATE contacts
         SET full_name = $3, first_name = $4, last_name = $5,
             phone_primary = $6, phone_primary_normalized = $7, phones_all = $8,
             emails = $9, apple_notes = $10, company = $11, title = $12, city = $13,
             location = $17, source = $14, metadata = $15::jsonb,
             external_id = COALESCE($16, external_id),
             updated_at = now()
         WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
          contact.id,
          ownerId,
          contact.name,
          contact.firstName ?? null,
          contact.lastName ?? null,
          phonePrimary,
          phonePrimaryNorm,
          phonesAll,
          emailsStr,
          contact.notes ?? null,
          contact.company ?? null,
          contact.title ?? null,
          city,
          contact.source ?? null,
          metaJson,
          contact.externalId ?? null,
          location,
        ],
      );
      if (updated.length) return rowToContact(updated[0]);
      // Stale id — fall through to externalId / fresh insert.
    }

    // IDENTITY RESOLUTION — the shared cascade (source key → phone → email →
    // corroborated name). This is what stops the OAuth scrapers from re-inserting
    // a person the Apple sync already stored, and what folds the two Google id
    // namespaces (`google:people/c1` and `people/c1`) onto one row.
    const resolved = await resolveContactIdentity(ownerId, contact).catch(() => null);
    if (resolved?.contactId) {
      const merged = await _mergeExistingContact(ownerId, resolved.contactId, contact, {
        // A source-key hit is this source restating its own record → it may
        // overwrite its own fields (a renamed LinkedIn contact still renames).
        // Any other rule is cross-card enrichment → fill blanks only.
        authoritative: resolved.rule === "source",
        metaJson,
        city,
        location,
      });
      if (merged) {
        await claimIdentityKeys(
          ownerId,
          claimsForRecord(String(resolved.contactId), contact),
        ).catch(() => null);
        noteContactWrite(ownerId, resolved.contactId, contact);
        return rowToContact(merged);
      }
      // The row vanished under us (deleted concurrently) — fall through to insert.
    }

    // externalId → INSERT ON CONFLICT (owner_id, external_id) DO UPDATE.
    if (contact.externalId != null) {
      const { rows } = await query(
        `INSERT INTO contacts
           (owner_id, external_id, full_name, first_name, last_name,
            phone_primary, phone_primary_normalized, phones_all,
            emails, apple_notes, company, title, city, location, source, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
         ON CONFLICT (owner_id, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET
           full_name                = EXCLUDED.full_name,
           first_name               = EXCLUDED.first_name,
           last_name                = EXCLUDED.last_name,
           phone_primary            = EXCLUDED.phone_primary,
           phone_primary_normalized = EXCLUDED.phone_primary_normalized,
           phones_all               = EXCLUDED.phones_all,
           emails                   = EXCLUDED.emails,
           apple_notes              = EXCLUDED.apple_notes,
           company                  = EXCLUDED.company,
           title                    = EXCLUDED.title,
           city                     = EXCLUDED.city,
           location                 = EXCLUDED.location,
           source                   = EXCLUDED.source,
           metadata                 = EXCLUDED.metadata,
           updated_at               = now()
         RETURNING *`,
        [
          ownerId,
          // Store the FOLDED external id: the OAuth scraper used to write
          // `google:people/c1` where the import path wrote `people/c1`, which put
          // one Google person in two rows of the same unique index.
          normalizeExternalId(contact.source, contact.externalId),
          contact.name,
          contact.firstName ?? null,
          contact.lastName ?? null,
          phonePrimary,
          phonePrimaryNorm,
          phonesAll,
          emailsStr,
          contact.notes ?? null,
          contact.company ?? null,
          contact.title ?? null,
          city,
          location,
          contact.source ?? null,
          metaJson,
        ],
      );
      if (!rows.length) return null;
      return rowToContact(await _claimKeysForNewContact(ownerId, rows[0], contact, resolved));
    }

    // Fresh insert.
    const { rows } = await query(
      `INSERT INTO contacts
         (owner_id, full_name, first_name, last_name,
          phone_primary, phone_primary_normalized, phones_all,
          emails, apple_notes, company, title, city, location, source, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       RETURNING *`,
      [
        ownerId,
        contact.name,
        contact.firstName ?? null,
        contact.lastName ?? null,
        phonePrimary,
        phonePrimaryNorm,
        phonesAll,
        emailsStr,
        contact.notes ?? null,
        contact.company ?? null,
        contact.title ?? null,
        city,
        location,
        contact.source ?? null,
        metaJson,
      ],
    );
    if (!rows.length) return null;
    return rowToContact(await _claimKeysForNewContact(ownerId, rows[0], contact, resolved));
  } catch {
    return null;
  }
}

/**
 * Field-UNION merge of `contact` into an existing row, for the columns
 * upsertContact owns. The phone/email/name/company/city columns go through the
 * SHARED union helper (so this path and the bulk path cannot disagree); the
 * columns only this writer touches — notes, title, location, metadata — follow
 * the same rule expressed as COALESCE ordering: authoritative writers may
 * overwrite their own fields, enrichment may only fill blanks.
 *
 * Returns the updated row, or null if the row is gone.
 */
async function _mergeExistingContact(
  ownerId,
  contactId,
  contact,
  { authoritative, metaJson, city, location },
) {
  const { rows: cur } = await query(
    `SELECT id, full_name, first_name, last_name, company, city, source,
            phone_primary, phones_all, emails
       FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [contactId, ownerId],
  );
  if (!cur.length) return null;

  const merged = mergedColumnValues(cur[0], contact, { authoritative }) || {
    ...cur[0],
    id: String(cur[0].id),
  };
  // COALESCE order encodes who wins for this writer's own columns.
  const own = (incoming, column) =>
    authoritative ? `COALESCE(${incoming}, ${column})` : `COALESCE(${column}, ${incoming})`;

  const { rows } = await query(
    `UPDATE contacts SET
       full_name                = $3,
       first_name               = $4,
       last_name                = $5,
       company                  = $6,
       city                     = ${own("$7", "city")},
       source                   = $8,
       phone_primary            = $9,
       phone_primary_normalized = $10,
       phones_all               = $11,
       emails                   = $12,
       apple_notes              = ${own("$13", "apple_notes")},
       title                    = ${own("$14", "title")},
       location                 = ${own("$15", "location")},
       metadata                 = ${own("$16::jsonb", "metadata")},
       external_id              = COALESCE(external_id, $17),
       updated_at               = now()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [
      contactId,
      ownerId,
      merged.full_name ?? null,
      merged.first_name ?? null,
      merged.last_name ?? null,
      merged.company ?? null,
      city ?? merged.city ?? null,
      merged.source ?? null,
      merged.phone_primary ?? null,
      merged.phone_primary_normalized ?? null,
      merged.phones_all ?? null,
      merged.emails ?? null,
      contact.notes ?? null,
      contact.title ?? null,
      location ?? null,
      metaJson,
      normalizeExternalId(contact.source, contact.externalId),
    ],
  );
  return rows[0] ?? null;
}

/**
 * Claim identity keys for a row this call just created.
 *
 * A conflict means another contact already holds one of those keys — a row this
 * process had not loaded, or a CONCURRENT writer that inserted first. The loser
 * collapses into the winner, which is what keeps two simultaneous scrapes from
 * leaving a twin behind. Returns the row to hand back to the caller (the winner's
 * row when a collapse happened).
 */
async function _claimKeysForNewContact(ownerId, row, contact, resolved) {
  const { collapseContactGroup } = await import("./store.js");
  const { conflicts } = await claimIdentityKeys(
    ownerId,
    claimsForRecord(String(row.id), contact),
  ).catch(() => ({ conflicts: [] }));

  const winner = conflicts.find((c) => String(c.winnerContactId) !== String(row.id));
  if (winner) {
    await collapseContactGroup(ownerId, winner.winnerContactId, [String(row.id)]).catch(
      () => null,
    );
    const { rows } = await query(
      `SELECT * FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [winner.winnerContactId, ownerId],
    );
    if (rows[0]) {
      noteContactWrite(ownerId, winner.winnerContactId, contact);
      return rows[0];
    }
  }

  noteContactWrite(ownerId, row.id, contact);
  await recordReviewCandidates(
    ownerId,
    (resolved?.reviewLinks ?? []).map((l) => ({
      contactId: String(row.id),
      candidateContactId: l.candidateContactId,
      reason: l.reason,
    })),
  ).catch(() => 0);
  return row;
}

/**
 * Find a single contact by name (case-insensitive, first-name OR full-name).
 * Most-recently-updated row wins on ambiguity.
 */
export async function findContactByName(ownerId, name) {
  if (!ownerId || !name) return null;
  const matches = await getContactsByName(ownerId, name);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const at = toMillis(a.updatedAt) || 0;
    const bt = toMillis(b.updatedAt) || 0;
    return bt - at;
  });
  return matches[0];
}

export async function getContactsByName(ownerId, name) {
  if (!ownerId || !name) return [];
  const needle = String(name).trim().toLowerCase();
  if (!needle) return [];
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND (
           lower(trim(full_name)) = $2
           OR lower(trim(first_name)) = $2
           OR (first_name IS NOT NULL AND last_name IS NOT NULL
               AND lower(trim(first_name) || ' ' || trim(last_name)) = $2)
         )`,
      [ownerId, needle],
    );
    return rows.map(rowToContact);
  } catch {
    return [];
  }
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Replace or append the `context` field stored in metadata jsonb.
 *   mode: "replace" — overwrites.
 *   mode: "append"  — appends "\n\n{ts}: {text}", capped at 32k chars.
 */
export async function updateContactContext(
  ownerId,
  contactId,
  text,
  { mode = "replace" } = {},
) {
  if (!ownerId || !contactId) return null;
  if (!CONTACT_ID_RE.test(String(contactId))) return null;
  const cleaned = typeof text === "string" ? text : "";

  try {
    const { rows: existing } = await query(
      `SELECT metadata FROM contacts
       WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [contactId, ownerId],
    );
    if (!existing.length) return null;

    const currentMeta =
      existing[0].metadata && typeof existing[0].metadata === "object"
        ? existing[0].metadata
        : {};

    let nextContext;
    if (mode === "append") {
      const prior =
        typeof currentMeta.context === "string" ? currentMeta.context : "";
      const stamp = new Date().toISOString();
      const addition = cleaned ? `${stamp}: ${cleaned}` : "";
      const combined =
        prior && addition ? `${prior}\n\n${addition}` : prior || addition;
      nextContext =
        combined.length > 32000 ? combined.slice(-32000) : combined;
    } else {
      nextContext =
        cleaned.length > 32000 ? cleaned.slice(0, 32000) : cleaned;
    }

    const newMeta = { ...currentMeta, context: nextContext };
    const { rows: updated } = await query(
      `UPDATE contacts
       SET metadata = $3::jsonb, updated_at = now()
       WHERE id = $1::uuid AND owner_id = $2
       RETURNING *`,
      [contactId, ownerId, JSON.stringify(newMeta)],
    );
    return updated.length ? rowToContact(updated[0]) : null;
  } catch {
    return null;
  }
}

// Structured relationship fields stored under metadata.relationship.
export const RELATIONSHIP_FIELDS = [
  "category",
  "howWeMet",
  "emotionalTone",
  "trustLevel",
  "closeness",
  "energyType",
  "tension",
  "boundaries",
  "appreciates",
  "avoids",
  "positiveHistory",
  "importantMemories",
  "lastMeaningfulInteraction",
  "nextAction",
  "privacyLevel",
  "shareableWithTogari",
];

export async function updateContactRelationship(ownerId, contactId, fields) {
  if (!ownerId || !contactId || !fields || typeof fields !== "object") {
    return null;
  }
  if (!CONTACT_ID_RE.test(String(contactId))) return null;

  try {
    const { rows: existing } = await query(
      `SELECT metadata FROM contacts
       WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [contactId, ownerId],
    );
    if (!existing.length) return null;

    const currentMeta =
      existing[0].metadata && typeof existing[0].metadata === "object"
        ? existing[0].metadata
        : {};
    const currentRelationship = currentMeta.relationship || {};
    const next = { ...currentRelationship };
    for (const key of RELATIONSHIP_FIELDS) {
      if (fields[key] !== undefined) next[key] = fields[key];
    }
    next.updatedAt = new Date().toISOString();

    const newMeta = { ...currentMeta, relationship: next };
    const { rows: updated } = await query(
      `UPDATE contacts
       SET metadata = $3::jsonb, updated_at = now()
       WHERE id = $1::uuid AND owner_id = $2
       RETURNING *`,
      [contactId, ownerId, JSON.stringify(newMeta)],
    );
    return updated.length ? rowToContact(updated[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Find a contact by phone number (normalized E.164). Returns null on no match.
 * Callers MUST treat null as "unknown contact", never as the owner.
 */
export async function findContactByPhone(ownerId, phone) {
  if (!ownerId || !phone) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND phone_primary_normalized = $2
       LIMIT 1`,
      [ownerId, normalized],
    );
    return rows.length ? rowToContact(rows[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a handle string: strip leading "@", trim, lowercase.
 * "@Shirley.Park" → "shirley.park".
 */
export function normalizeHandleNeedle(handle) {
  if (typeof handle !== "string") return "";
  let h = handle.trim();
  if (h.startsWith("@")) h = h.slice(1);
  return h.trim().toLowerCase();
}

/**
 * Resolve a "@handle" to a contact. Match order:
 *   1. metadata.sourceHandle exact (case-insensitive, tolerant of leading "@")
 *   2. Name fallback via findContactByName
 */
export async function findContactByHandle(ownerId, handle) {
  const needle = normalizeHandleNeedle(handle);
  if (!ownerId || !needle) return null;

  try {
    // sourceHandle is stored in metadata jsonb.
    const { rows: handleRows } = await query(
      `SELECT * FROM contacts
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND (
           lower(trim(metadata->>'sourceHandle')) = $2
           OR lower(trim(metadata->>'sourceHandle')) = $3
         )
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [ownerId, needle, "@" + needle],
    );
    if (handleRows.length > 0) return rowToContact(handleRows[0]);
  } catch {
    // fall through to name search
  }

  return findContactByName(ownerId, needle);
}

/**
 * Cross-tenant email lookup. Returns { did: amber_id, contact } or null.
 * `did` is the owning amber_id (uuid). listAllTenantDids is accepted for
 * backward compatibility but unused.
 */
export async function findContactByEmailAcrossTenants(
  email,
  { listAllTenantDids } = {},
) {
  const target = normalizeEmail(email);
  if (!target) return null;
  try {
    // Wrap with sentinel commas so the LIKE check is exact at word boundaries.
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE deleted_at IS NULL
         AND emails IS NOT NULL
         AND (',' || lower(emails) || ',') LIKE ('%,' || lower($1) || ',%')
       LIMIT 1`,
      [target],
    );
    if (!rows.length) return null;
    const row = rows[0];
    const did = row.owner_id ?? null;
    return did ? { did, contact: rowToContact(row) } : null;
  } catch {
    return null;
  }
}

export async function deleteAllContacts(ownerId) {
  if (!ownerId) return;
  try {
    await query(
      `UPDATE contacts SET deleted_at = now()
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    );
  } catch {
    // best-effort
  }
}

/** Fetch a single contact by its bigint id, scoped to the owner. */
export async function getContactById(ownerId, contactId) {
  if (!ownerId || !contactId) return null;
  if (!CONTACT_ID_RE.test(String(contactId))) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM contacts
       WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [contactId, ownerId],
    );
    return rows.length ? rowToContact(rows[0]) : null;
  } catch {
    return null;
  }
}
