import { getUserByPrivyDid as getUserByDid } from "../db/user-store.js";
/**
 * Profile routes — Firestore-backed (DID-keyed).
 *
 * GET   /v1/me                  — own profile + personality profiles
 * PATCH /v1/me                  — update mutable fields
 * GET   /v1/me/contacts         — user's contacts
 * POST  /v1/me/contacts         — upsert contacts from iOS
 * GET   /v1/profile/:userId     — privacy-filtered view of another user
 * POST  /v1/account/delete      — full account deletion (Firestore + Privy)
 *
 * Authorization model:
 *   - All routes require a Privy Bearer token (requireAuth).
 *   - Self-only routes resolve the caller's DID from the token; the path
 *     never accepts a foreign user id, so cross-user reads cannot leak.
 *   - GET /v1/profile/:userId allows lookup of another user's *public*
 *     fields, but the response is filtered by the target's privacyTier.
 *     A caller is never given more than the target chose to publish.
 */

import { requireAuth, tenantIndex } from "../lib/auth-session.js";
import {
  linkResolvableContacts,
  ambiguousContactLinks,
  suggestContactsForAccount,
  linkContactByConfirmation,
  unlinkContact,
} from "../db/identity-link.js";
import { listUndoableMerges, undoContactMerge } from "../db/contact-merge-undo.js";
import {
  listReviewCandidates,
  dismissReviewCandidate,
} from "../db/contact-identity.js";
import {
  duplicateCandidates,
  duplicateCandidatesFromBook,
  mergeContacts,
  mergeProvableDuplicates,
} from "../db/contact-merge.js";
import { validateUserId } from "../lib/auth.js";
import {
  getProfile,
  listPersonalityProfiles,
  getOrCreateUser,
  getUserByPrivyDid,
} from "../db/user-store.js";
import { purgeOwnerData } from "../db/purge.js";
import { ownerIdFromSession } from "../lib/owner-id.js";
import {
  resolveAmberIdByPhone,
  resolveAmberIdByPrivyDid,
  upsertContactsForOwner,
  countLiveContactsBySource,
  listContactsForOwnerAppShape,
  setUserProfileFields,
  getFactsForContact,
  getContactById,
  getContactByPhone,
  setContactLinkedAmberId,
  createContactForOwner,
  updateContactFields,
  getPendingFactContextById,
  getUserPhoneByAmberId,
  mergeUserProfileExtra,
  getContactsForSearch,
} from "../db/store.js";
import { resolvePendingItem } from "../lib/resolve-pending.js";
import { importGoogleContactsForOwner } from "../lib/google-contacts.js";
import { userToTenant } from "./tenants.js";
import { createHash } from "crypto";
import { deleteContactCascade } from "../db/contact-delete.js";
import { storeAppleCardDetails, retagAddressBook } from "../db/address-book-store.js";
import { getContactProvenance } from "../db/contact-provenance.js";
import { getContactCadence } from "../db/contact-cadence.js";
import { prepareForSearch, searchContacts } from "../lib/contact-search.js";
import { enrichOneContact } from "../enrichment/metered-enrich.js";
import { usageSummary } from "../db/enrichment-meter.js";

// A contact id is a uuid. Declared here rather than inlined so the checks in
// this file cannot drift apart.
const _CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;




// Only identity / system fields are immutable — never client-editable. ALL
// user-facing profile fields (displayName, bio, currentCity, hometown,
// birthday, school, mbti, horoscope, almaMater, …) are editable via
// MUTABLE_FIELDS below. These keys are the user's identity anchor
// (userId/did/phone/phoneNumber) and server-managed system fields
// (createdAt/contentHash); a client must never overwrite them via PATCH /v1/me.
// NOTE: the rejection guard fires unconditionally when one of these is in the
// body — there is no "after onboarding" check despite the error wording.
const IMMUTABLE_FIELDS = [
  "userId",
  "did",
  "phone",
  "phoneNumber",
  "createdAt",
  "contentHash",
];

const MUTABLE_FIELDS = [
  "displayName",
  "username",
  "bio",
  "avatarUrl",
  "currentCity",
  "privacyTier",
  // iOS onboarding (Flow B, see amber-ios ONBOARDING_SPEC.md) PATCHes this
  // when the user finishes the six-step flow. The web onboarding flow sets
  // it directly via /v1/onboarding/complete; both paths converge here.
  "onboardingCompletedAt",
  // Editable profile fields the client sends (personality + background).
  // Previously these were either dropped (mbti/school/horoscope — not
  // whitelisted) or rejected (hometown — was in IMMUTABLE_FIELDS).
  "mbti",
  "school",
  "hometown",
  "horoscope",
  // Feeds buildMe(getProfile) → PeopleRank's "shares your field" proximity term.
  "occupation",
  // F5 disambiguation-prior fields. These are NOT discrete columns — they flow
  // to users.profile_extra (the same overflow path upsertProfile uses for
  // non-column keys) and surface as top-level fields via getProfile. buildMe
  // already reads placesLived→cities, schools, employers (F3b); travel and
  // socialDynamism are stored for later use and ignored by the ranker.
  "placesLived",
  "schools",
  "employers",
  "travel",
  "socialDynamism",
];

// F5: prior keys that must be string[] to be accepted (else 400).
const PRIOR_STRING_ARRAY_FIELDS = ["placesLived", "schools", "employers", "travel"];

// A full Apple address book easily exceeds the 1 MB global Fastify bodyLimit
// (10k contacts × ~100 bytes of JSON each), which surfaced as a silent 413 on
// the client. Raised per-route only — the global limit stays where it is.
const CONTACTS_BODY_LIMIT = 10 * 1024 * 1024; // 10 MB

function _firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
      continue;
    }
    return v;
  }
  return null;
}

function _asArray(...vals) {
  for (const v of vals) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Deterministic stand-in external id for a contact the client sent WITHOUT one.
 *
 * A null external_id routes the row to the no-ON-CONFLICT INSERT branch in
 * upsertContactsForOwner, so every re-sync of that contact inserts a brand-new
 * row — the same duplicate-per-sync failure a random client-side id causes.
 * Hashing the contact's own identity fields gives a key that is stable across
 * syncs, so the existing ON CONFLICT (owner_id, external_id) upsert updates in
 * place instead.
 *
 * Basis: normalized name | digits-only phone | lowercased company | source.
 * The phone drops a leading US "1" on an 11-digit number, so the same contact
 * re-sent as "+13105550100" and "3105550100" keeps ONE key — otherwise a client
 * that changes its formatting between syncs would silently duplicate the row,
 * which is the exact failure this function exists to prevent.
 *
 * TRADE-OFF: two genuinely different people who share a name and have neither a
 * phone nor a company will now collapse into one row where they previously
 * stayed separate. Clients that send a real device id (every current build) are
 * unaffected — this only fires when there is no id at all.
 */
export function synthesizeExternalId({ name, phone, company, source }) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  const basis = [
    String(name || "").toLowerCase().trim().replace(/\s+/g, " "),
    digits,
    String(company || "").toLowerCase().trim(),
    String(source || ""),
  ].join("|");
  const digest = createHash("sha256").update(basis).digest("hex").slice(0, 32);
  return `sha256:${digest}`;
}

/**
 * Accept BOTH contact shapes on the sync path:
 *   - server shape (current app builds): { externalId, phoneNumbers, company }
 *   - device shape (older app builds):   { id,         phones,       organization }
 *
 * Older builds POST the raw CNContact-ish object, so `phoneNumbers` /
 * `externalId` / `company` were all undefined and every one of those contacts
 * landed with phone_primary and external_id NULL — the sync looked successful
 * (200 { ok, upserted }) while silently dropping every phone number. Normalizing
 * here (backend-only) fixes those builds without shipping a new app.
 *
 * Returns null for a contact that must be skipped (no usable name) — the
 * pre-existing "skip if no name" rule. Contacts with a name but no phones and
 * no emails are valid and DO upsert.
 *
 * Exported for tests.
 */
export function normalizeIncomingContact(contact) {
  if (!contact || typeof contact !== "object") return null;
  if (!contact.name) return null;

  const phoneNumbers = _asArray(contact.phoneNumbers, contact.phones);
  const company = _firstNonEmpty(contact.company, contact.organization);
  // /v1/me/contacts is the iOS Apple-Contacts import path; other sources
  // come in through the service-auth ingest route with an explicit source.
  const source = contact.source || "apple";

  return {
    // Preserve any extra fields the client sent (birthday, notes, …) — the
    // provenance row stores the raw object losslessly.
    ...contact,
    name: contact.name,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    phoneNumbers,
    emails: _asArray(contact.emails),
    // No client-supplied id → derive a stable one, so the next sync upserts
    // this same row instead of inserting a duplicate (see synthesizeExternalId).
    externalId:
      _firstNonEmpty(contact.externalId, contact.id) ??
      synthesizeExternalId({
        name: contact.name,
        phone: phoneNumbers[0],
        company,
        source,
      }),
    company,
    source,
  };
}

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

export function registerProfileRoutes(app) {
  /**
   * GET /v1/me
   * Returns authenticated user's full profile + personality profiles
   */
  app.get("/v1/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const privyDid = requirePrivyDid(request, reply);
    if (!privyDid) return;

    // A profile is NOT required to be a valid caller. OTP / medha-id session
    // users (sub = person_id, a phone hash) authenticate fine but may have no
    // profile doc keyed by that person_id. Returning 404 here is what made the
    // in-app agent path fail for every new user (medha-platform saw the 404 as
    // amber_id_error). Treat a missing profile as an empty one and still return
    // the caller's identity (phone + loop sender) so the agent can run.
    const profile = (await getProfile(privyDid)) || {};

    const personalities = await listPersonalityProfiles(privyDid).catch(
      () => [],
    );

    // Surface sender ID + tenant phone so callers like medha-platform
    // /api/v1/quick-call can synthesize a Photon-shaped webhook for the caller
    // without a second round trip.
    let phoneNumber = null;
    let loopSenderId = null;
    try {
      const user = await getUserByDid(privyDid);
      if (user) {
        const tenant = userToTenant(user);
        phoneNumber = tenant.phoneNumber || null;
        loopSenderId = tenant.loopSenderId || null;
      }
    } catch {
      // Non-Privy session or transient Privy failure. /v1/me must still
      // return the profile; the caller can fall back to other lookups.
    }

    // OTP / medha-id session callers are keyed by person_id (phone hash), so
    // getUserByDid above misses the Privy-DID-keyed tenant and leaves phone /
    // loop sender null. The session is already verified and carries the phone
    // (request.privyUser.phone), so resolve the owner tenant by phone the same
    // way /tenants/resolve?phone= does. This is the field medha-platform reads
    // to dispatch the in-app agent; without it the caller is "not provisioned".
    if ((!phoneNumber || !loopSenderId) && request.privyUser?.phone) {
      try {
        const match = tenantIndex.getByPhone(request.privyUser.phone);
        if (match) {
          const t = userToTenant(match);
          phoneNumber = phoneNumber || t.phoneNumber || request.privyUser.phone;
          loopSenderId = loopSenderId || t.loopSenderId || null;
        } else {
          // No tenant yet (index lag right after sign-in provisioning). At
          // least surface the verified phone so callers aren't blind.
          phoneNumber = phoneNumber || request.privyUser.phone;
        }
      } catch {
        phoneNumber = phoneNumber || request.privyUser.phone;
      }
    }

    return {
      ...profile,
      personalityProfiles: personalities,
      did: privyDid,
      phoneNumber,
      loopSenderId,
    };
  });

  /**
   * PATCH /v1/me
   * Update editable profile fields only (reject immutable ones)
   */
  app.patch("/v1/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const privyDid = requirePrivyDid(request, reply);
    if (!privyDid) return;

    const rawBody = request.body || {};
    const attempted = IMMUTABLE_FIELDS.filter((f) => f in rawBody);
    if (attempted.length > 0) {
      return reply.code(400).send({
        error: "immutable_fields",
        message: `Cannot edit immutable fields after onboarding: ${attempted.join(", ")}`,
      });
    }

    const update = {};
    for (const f of MUTABLE_FIELDS) {
      if (rawBody[f] !== undefined) update[f] = rawBody[f];
    }

    // Normalize ISO strings for onboardingCompletedAt (validation only — no
    // Firestore timestamp coercion needed now that the write is Cloud SQL).
    if (typeof update.onboardingCompletedAt === "string") {
      const parsed = new Date(update.onboardingCompletedAt);
      if (Number.isNaN(parsed.getTime())) {
        return reply.code(400).send({
          error: "invalid_field",
          message: "onboardingCompletedAt must be an ISO 8601 date string",
        });
      }
      update.onboardingCompletedAt = parsed;
    }

    // F5: validate the disambiguation-prior fields lightly, then collect them
    // into `extra` for the profile_extra overflow write. Arrays must be arrays
    // of strings; socialDynamism must be a plain object. Bad types → 400.
    const extra = {};
    for (const k of PRIOR_STRING_ARRAY_FIELDS) {
      if (update[k] === undefined) continue;
      const v = update[k];
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
        return reply.code(400).send({
          error: "invalid_field",
          message: `${k} must be an array of strings`,
        });
      }
      extra[k] = v;
    }
    if (update.socialDynamism !== undefined) {
      const v = update.socialDynamism;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return reply.code(400).send({
          error: "invalid_field",
          message: "socialDynamism must be an object",
        });
      }
      extra.socialDynamism = v;
    }

    if (Object.keys(update).length === 0) {
      return {};
    }

    // Write all profile fields to Cloud SQL.
    //
    // THIS USED TO BE GATED ON A PHONE being present on the session, which
    // silently skipped the entire write for an account that has none -- an
    // employee invited by work email would set their name, get a 200, and find
    // the field empty. The owner is resolved by phone OR by the token's
    // subject now, and the write happens for both kinds of account.
    {
      const amberId = await ownerIdFromSession(request.privyUser);
      if (amberId) {
        const profileFields = {};
        if (update.displayName !== undefined) profileFields.fullName = update.displayName;
        if (update.currentCity !== undefined) profileFields.currentCity = update.currentCity;
        if (update.occupation !== undefined) profileFields.occupation = update.occupation;
        if (update.bio !== undefined) profileFields.bio = update.bio;
        if (update.mbti !== undefined) profileFields.mbti = update.mbti;
        if (update.school !== undefined) profileFields.school = update.school;
        if (update.hometown !== undefined) profileFields.hometown = update.hometown;
        if (update.horoscope !== undefined) profileFields.horoscope = update.horoscope;
        if (update.avatarUrl !== undefined) profileFields.avatarUrl = update.avatarUrl;
        if (update.privacyTier !== undefined) profileFields.privacyTier = update.privacyTier;
        if (update.onboardingCompletedAt !== undefined) profileFields.onboardingCompletedAt = update.onboardingCompletedAt;
        if (update.username !== undefined) profileFields.username = update.username;
        if (Object.keys(profileFields).length > 0) {
          const sqlResult = await setUserProfileFields({ amberId, ...profileFields }).catch(() => null);
          if (sqlResult?.error === "username_taken") {
            return reply.code(409).send({ error: "username_taken", message: "Username is already taken" });
          }
          if (sqlResult?.error === "invalid_username") {
            return reply.code(400).send({ error: "invalid_username", message: "Username must be 3–20 characters: lowercase letters, digits, and underscores only" });
          }
        }
        // F5: prior fields have no discrete column — merge them into the
        // profile_extra jsonb (SQL-side ||, so sibling keys are preserved).
        if (Object.keys(extra).length > 0) {
          await mergeUserProfileExtra(amberId, extra).catch(() => null);
        }
      }
    }

    // Echo the saved fields. GET /v1/me is the canonical read for the full profile.
    return update;
  });

  /**
   * GET /v1/me/contacts
   * Returns all contacts for the authenticated user from Cloud SQL.
   */
  app.get(
    "/v1/me/contacts",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        request.log.error({ did: request.privyUser?.userId }, "[contacts] could not resolve an owner for this session");
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }
      return await listContactsForOwnerAppShape(ownerId);
    },
  );

  /**
   * GET /v1/me/contacts/search?q=...
   *
   * SEARCH OVER THE WHOLE ROLODEX, not just the name field.
   *
   * This began as typeahead for one reconciliation card -- find the right
   * existing contact when Amber's suggestions all miss on a mangled name -- and
   * it is now what the website's search bar and the graph both call, so it has
   * to answer the way a person asks. That means a company, a city, a title, an
   * email address or a phone number all find the card, a typo still finds the
   * person, and the ordering puts who you actually talk to first rather than
   * whoever sorts earliest in the alphabet.
   *
   * The ranking lives in src/lib/contact-search.js, pure and tested; this route
   * reads the book, hands it over, and returns the top of the list. Nothing
   * about a contact is exposed here that GET /v1/me/contacts does not already
   * return, which is why a scoped web token is allowed to call it.
   */
  app.get(
    "/v1/me/contacts/search",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return { contacts: [] };
      const q = String(request.query?.q || "").trim();
      if (!q) return { contacts: [] };
      const limit = Math.min(Math.max(Number(request.query?.limit) || 20, 1), 50);

      const rows = await getContactsForSearch(ownerId).catch(() => []);
      const hits = searchContacts(rows.map(prepareForSearch), q, { limit });

      return {
        contacts: hits.map((h) => ({
          id: h.id,
          name: h.name,
          company: h.row.company ?? null,
          title: h.row.title ?? null,
          city: h.row.city ?? null,
          // WHY THIS ROW IS IN THE LIST. Without it a contact matched on their
          // company looks like a mistake -- the typed word is nowhere in the
          // name on screen, and the only person who can tell the difference
          // between a good match and a bug is the one who cannot see the field
          // it matched.
          matchedOn: h.matchedOn,
          why: h.why,
        })),
      };
    },
  );

  /**
   * GET /v1/me/contacts/duplicates
   *
   * Pairs that look like one person and cannot be proven to be: a card linked
   * to an account, and another with the same name and no key that resolves
   * anywhere. Offered, never merged automatically — two people really can share
   * a name, and a wrong merge files one person's notes under another, which
   * nothing in the app would show you afterwards.
   *
   * The provable case (two cards pointing at the SAME account) is collapsed
   * without asking, on contact sync. It never reaches this list.
   */
  app.get(
    "/v1/me/contacts/duplicates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return { duplicates: [] };
      const limit = Math.min(Number(request.query?.limit) || 20, 100);
      // BOTH SOURCES, because neither contains the other.
      //
      // duplicateCandidates finds pairs the GRAPH can prove: one card resolves
      // to an Amber account and another carries the same stripped name. It
      // cannot see the case people actually report -- two Shirley Parks, one of
      // them annotated "Shirley Park USC", neither of them a registered
      // account -- because the linked side is required and the annotation
      // changes the name key.
      //
      // duplicateCandidatesFromBook is src/lib/contact-duplicates.js, which
      // splits the annotation off before comparing and tiers what it finds.
      // It was written for this, tested for this, and called by nothing.
      //
      // Provable pairs first, then the graph's, deduplicated by the pair itself
      // so a pair both agree on is offered once.
      const [fromBook, fromGraph, refused] = await Promise.all([
        duplicateCandidatesFromBook(ownerId, { limit }).catch(() => []),
        duplicateCandidates(ownerId, { limit }).catch(() => []),
        // THE THIRD SOURCE, AND THE ONLY ONE THE MATCHER ITSELF RAISED.
        //
        // contact_review_candidates is where the resolver writes a pair it
        // believed was one person and refused to merge on a bare name. It has
        // been written to since it shipped and read by nothing, so the exact
        // moment the app most needs a human answer has been going into a table
        // nobody opens.
        //
        // Returned in its OWN field, never folded into `duplicates`. These are
        // softer than provable by construction -- the resolver already judged
        // the evidence insufficient -- and mixing them in would repeat the
        // failure this endpoint was corrected for.
        listReviewCandidates(ownerId, { limit }).catch(() => []),
      ]);
      /**
       * ONLY PAIRS SOMEBODY CAN GO AND CHECK.
       *
       * This offered everything both sources found, tiered `provable` down to
       * `likely`, and the report back was blunt: these are not duplicates, and
       * when I look in my contacts there is only one of them. Both halves of
       * that were fair.
       *
       * A `likely` pair is two cards with the same name plus something softer --
       * a shared label, a shared company, one card being a bare stub. Every one
       * of those may well be a duplicate, and NONE of them can be verified by
       * the person being asked: they open their contacts, find one card, and
       * conclude the feature is inventing things. A review queue whose items
       * cannot be checked is worse than no review queue, because acting on it
       * is guessing with somebody's notes.
       *
       * `provable` means the two cards share a phone number or an email
       * address. That is a fact the person can see on both cards, and it is the
       * bar this list holds to now: "only showing duplicates of people with
       * matching numbers, and when I go into my contacts I would see two cards
       * there."
       *
       * The softer pairs are still computed and still returned by the store --
       * this is a filter at the edge, not a deletion -- so a screen that wants
       * to offer them with their evidence can, deliberately.
       */
      const seenPair = new Set();
      const duplicates = [];
      for (const d of [...fromBook, ...fromGraph]) {
        if (d.tier !== "provable") continue;
        // Order-independent, so A/B and B/A are one pair.
        const key = [String(d.keepContactId), String(d.dropContactId)].sort().join("|");
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        duplicates.push(d);
        if (duplicates.length >= limit) break;
      }
      // Pairs already offered as provable are not asked about twice.
      const needsReview = refused.filter((r) => {
        const key = [String(r.a.contactId), String(r.b.contactId)].sort().join("|");
        return !seenPair.has(key);
      });

      return { duplicates, needsReview };
    },
  );

  /**
   * DELETE /v1/me/contacts/review/:reviewId
   *
   * "These are two different people." Forgets the pair so the matcher stops
   * raising it.
   *
   * Deleting rather than flagging is deliberate: the resolver re-derives these
   * on every write, so a row that is merely marked would be re-raised by the
   * next sync under a new id. Gone means gone until the evidence genuinely
   * changes.
   */
  app.delete(
    "/v1/me/contacts/review/:reviewId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }
      const reviewId = Number(request.params?.reviewId);
      if (!Number.isFinite(reviewId) || reviewId <= 0) {
        return reply.code(400).send({ error: "bad_review_id" });
      }
      const ok = await dismissReviewCandidate(ownerId, reviewId).catch(() => false);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return { dismissed: true, reviewId };
    },
  );

  /**
   * POST /v1/me/contacts/merge  { keepContactId, dropContactId }
   *
   * A human said these are the same person. Repoints every table that
   * references the dropped card onto the kept one, fills the keeper's blank
   * fields from it, and soft-deletes it — all in one transaction, because a
   * half-merged person (notes moved, circle membership not) is worse than two
   * cards.
   */
  app.post(
    "/v1/me/contacts/merge",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["keepContactId", "dropContactId"],
          properties: {
            keepContactId: { type: "string" },
            dropContactId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }
      const { keepContactId, dropContactId } = request.body || {};
      const res = await mergeContacts(ownerId, keepContactId, dropContactId);
      if (!res.ok) {
        const code = res.reason === "not_found" ? 404 : 400;
        return reply.code(code).send({
          error: res.reason ?? "merge_failed",
          message:
            res.reason === "not_found"
              ? "One of those contacts no longer exists."
              : res.reason === "same_contact"
                ? "Those are the same contact."
                : "Could not merge those contacts.",
        });
      }
      request.log?.info?.(
        { ownerId, keep: keepContactId, drop: dropContactId, moved: res.moved },
        "[contacts] merged on user confirmation",
      );
      return {
        merged: true,
        moved: res.moved,
        deleted: res.deleted,
        // Returned so the client can show 'Merged. Undo' immediately rather
        // than making the person hunt for it in a settings screen later.
        mergeId: res.mergeId ?? null,
        undoable: Boolean(res.undoable),
      };
    },
  );

  /**
   * GET /v1/me/contacts/merges
   *
   * The merges this person can still reverse, newest first.
   *
   * Reversible means three things at once: the snapshot has not been pruned (30
   * days), the merge has not already been undone, and the window has not closed.
   * The query tests all three, so anything this returns has a working undo --
   * a list that offered an undo which then failed would be worse than no list.
   */
  app.get(
    "/v1/me/contacts/merges",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return { merges: [] };
      const limit = Number(request.query?.limit) || 25;
      const merges = await listUndoableMerges(ownerId, { limit }).catch(() => []);
      return {
        merges: merges.map((m) => ({
          mergeId: Number(m.id),
          survivorId: m.survivor_id,
          survivorName: m.survivor_name ?? null,
          absorbedIds: m.absorbed_ids,
          absorbedCount: Number(m.absorbed_count ?? 0),
          origin: m.origin,
          rule: m.rule ?? null,
          mergedAt: m.merged_at,
          undoableUntil: m.undoable_until,
        })),
      };
    },
  );

  /**
   * POST /v1/me/contacts/merge/undo  { mergeId }
   *
   * SPLIT TWO CARDS BACK APART.
   *
   * Replays the photograph the merge took of itself: the absorbed cards come
   * back, the survivor's overwritten fields are restored, and every row that was
   * repointed or deleted on the way in goes back where it was.
   *
   * Rows created SINCE the merge stay on the survivor. A note written against
   * the merged card belongs to whoever the person has been looking at, and
   * pushing it back onto a card they have not seen in a week would lose it.
   *
   * Every refusal names itself rather than returning a bare failure, because the
   * four reasons need four different sentences: a pruned snapshot is permanent,
   * an expired window is permanent, an already-undone merge means it worked, and
   * not_found means the id is wrong.
   */
  app.post(
    "/v1/me/contacts/merge/undo",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["mergeId"],
          properties: { mergeId: { type: ["integer", "string"] } },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }
      const mergeId = Number(request.body?.mergeId);
      if (!Number.isFinite(mergeId) || mergeId <= 0) {
        return reply.code(400).send({ error: "bad_merge_id" });
      }

      const res = await undoContactMerge(ownerId, mergeId);
      if (!res.ok) {
        const MESSAGES = {
          not_found: ["That merge is not in your history.", 404],
          already_undone: ["That merge has already been undone.", 409],
          snapshot_pruned: [
            "That merge is older than 30 days, so it can no longer be undone.",
            410,
          ],
          window_expired: [
            "That merge is older than 30 days, so it can no longer be undone.",
            410,
          ],
        };
        const [message, code] = MESSAGES[res.reason] ?? [
          "Could not undo that merge.",
          500,
        ];
        return reply.code(code).send({ error: res.reason ?? "undo_failed", message });
      }

      request.log?.info?.(
        { ownerId, mergeId, restored: res.restored },
        "[contacts] merge undone",
      );
      return {
        undone: true,
        mergeId: res.mergeId,
        survivorId: res.survivorId,
        restoredContacts: res.restoredContacts,
        restored: res.restored,
      };
    },
  );

  /**
   * GET /v1/me/contacts/link-suggestions?amberId=...
   *
   * "I FOUND ANOTHER SAGAR TIWARI IN YOUR CONTACTS. IS THAT THIS ONE?"
   *
   * The case: you connect with somebody on Amber and no key matches any card in
   * your book -- they signed up with an email you do not have, or a phone you
   * never saved. Nothing PROVES the card is them, so nothing may be linked
   * automatically (see db/identity-link.js, which is the only writer of
   * linked_amber_id and refuses anything it cannot prove).
   *
   * The alternative to asking was leaving them unresolved forever: a person on
   * Amber whose card in your book knows nothing about their account, so circle
   * membership does not resolve to them, shared notes never reach them and
   * their notifications have no recipient. So: ask, once, on connect.
   *
   * Ranked candidates only. This route writes nothing.
   */
  app.get(
    "/v1/me/contacts/link-suggestions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return { suggestions: [] };
      const amberId = String(request.query?.amberId || "").trim();
      if (!amberId) {
        return reply.code(400).send({ error: "amber_id_required" });
      }
      if (String(amberId) === String(ownerId)) return { suggestions: [] };
      const limit = Math.min(Number(request.query?.limit) || 5, 20);
      return {
        suggestions: await suggestContactsForAccount(ownerId, amberId, { limit }).catch(
          () => [],
        ),
      };
    },
  );

  /**
   * GET /v1/me/contacts/ambiguous
   *
   * Cards whose identity keys resolve to MORE THAN ONE account -- a shared
   * family email, a recycled work number. linkResolvableContacts refuses these
   * deliberately rather than picking one, so they are the other half of the
   * "ask once" story: nothing is broken, but a human has to say which.
   */
  app.get(
    "/v1/me/contacts/ambiguous",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return { ambiguous: [] };
      return { ambiguous: await ambiguousContactLinks(ownerId).catch(() => []) };
    },
  );

  /**
   * POST /v1/me/contacts/:id/link  { amberId }
   *
   * A human answered the question. The ONE place a link is written on a
   * confirmation rather than on proof -- and it still refuses to repoint a card
   * that is already linked to somebody else, because silently moving a link
   * would take that person's circles and shared notes with it.
   */
  app.post(
    "/v1/me/contacts/:id/link",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["amberId"],
          properties: { amberId: { type: "string", maxLength: 64 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return reply.code(500).send({ error: "could_not_resolve_owner" });
      const contactId = String(request.params?.id || "");
      const amberId = String(request.body?.amberId || "");
      const outcome = await linkContactByConfirmation(ownerId, contactId, amberId);
      if (outcome === "linked" || outcome === "already") {
        request.log?.info?.(
          `CONTACT_LINK_CONFIRMED owner=${ownerId} contact=${contactId} account=${amberId} outcome=${outcome}`,
        );
        return { linked: true, outcome };
      }
      const code =
        outcome === "not_found" ? 404 : outcome === "conflict" ? 409 : outcome === "error" ? 503 : 400;
      return reply.code(code).send({
        error: outcome,
        message:
          outcome === "conflict"
            ? "That card is already linked to a different Amber account. Unlink it first."
            : outcome === "not_found"
              ? "No such contact, or no such account."
              : outcome === "self"
                ? "That is your own account."
                : "Could not link that.",
      });
    },
  );

  /** DELETE /v1/me/contacts/:id/link — undo one. The owner's card, their call. */
  app.delete(
    "/v1/me/contacts/:id/link",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return reply.code(500).send({ error: "could_not_resolve_owner" });
      const ok = await unlinkContact(ownerId, String(request.params?.id || ""));
      if (!ok) return reply.code(404).send({ error: "not_linked" });
      return { unlinked: true };
    },
  );

  /**
   * POST /v1/me/contacts
   * Upsert contacts from iOS Apple Contacts import.
   *
   * Body: { contacts: [{
   *   externalId,
   *   name,                  // REQUIRED, full display name
   *   firstName?, lastName?, // optional, captured for transports that
   *                          // want to address the contact by first
   *                          // name (e.g. iMessage replies — "hey
   *                          // Maggie" not "hey Margaret Smith")
   *   phoneNumbers,          // raw strings; we also store an E.164
   *                          // normalized parallel list for fast
   *                          // by-phone resolution
   *   emails, birthday, ...
   * }] }
   */
  app.post(
    "/v1/me/contacts",
    {
      preHandler: [requireAuth],
      bodyLimit: CONTACTS_BODY_LIMIT, // full address books (global is 1 MB)
    },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      // Make sure the user doc exists so subsequent self lookups work.
      await getOrCreateUser(privyDid);

      const incoming = request.body?.contacts;
      if (!Array.isArray(incoming)) {
        return reply.code(400).send({
          error: "bad_request",
          message: "Body must have a contacts array",
        });
      }

      // Resolve Cloud SQL amber_id via the phone the JWT carries.
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        request.log.error({ did: request.privyUser?.userId }, "[contacts] could not resolve an owner for this session");
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }

      // Normalize device-shape payloads from older app builds onto the server
      // shape before validation/upsert (see normalizeIncomingContact). Source
      // defaults to "apple" — /v1/me/contacts is the iOS-Apple-Contacts import
      // path; other platforms (LinkedIn via amber-chrome, etc.) go through the
      // service-auth ingest route with an explicit source.
      const valid = [];
      for (const c of incoming) {
        const normalized = normalizeIncomingContact(c);
        if (!normalized) continue; // no name → skip (unchanged rule)
        valid.push(normalized);
      }
      // Junk on this path is a card with no usable name — the only thing the
      // normalizer rejects. Counted here because it is dropped before the store
      // ever sees it.
      const removed = incoming.length - valid.length;

      // FIRST SYNC MERGES. EVERY SYNC AFTER IT ONLY INSERTS.
      //
      // "Nothing from Apple should change Amber after the initial sync. It should
      //  only provide inserts, no edits, only inserts."
      //
      // Decided HERE, from the database, rather than trusted from the client: a
      // client that has lost its "have I synced" flag (reinstall, new device,
      // cleared cache) would otherwise ask for the merging behavior and undo
      // every name the owner has edited. The count is the honest question -- does
      // this owner already have Apple contacts? -- and it cannot be wrong.
      //
      // The client may ask for insert-only explicitly; it may never ask for
      // merging. `mode: "merge"` in a request body is ignored.
      const beforeCounts = await countLiveContactsBySource(ownerId).catch(() => null);
      const firstAppleSync = (beforeCounts?.apple ?? 0) === 0;
      // ── THREE-WAY MERGE, NOT A CHOICE BETWEEN TWO BAD OPTIONS ──────────────
      //
      // The two demands above and below look contradictory and are not:
      //
      //   "It shouldn't override the edits you made in Amber."
      //   "If I update Sagar's nickname in Apple and hit resync, Amber should
      //    see that update."
      //
      // The invariant under both is NEVER LOSE AN AMBER EDIT. insert_only held
      // it by refusing to learn anything, which is why a contact renamed on the
      // phone never arrived. The three-way merge holds it MORE strongly and
      // still picks up real changes -- see contacts.sync_snapshot and
      // mergedColumnValues.
      //
      // AND THE FLIP ITSELF WAS A BUG. The client batches at 200 and this route
      // re-reads the count per request, so a first sync of 1,179 contacts ran
      // batch one as "merge" and batches two through six as "insert_only" --
      // meaning the mode was never what either comment claimed. Three-way is
      // correct on sync one and on sync one hundred, so there is nothing to flip.
      //
      // insert_only survives as an env kill switch. If the merge misbehaves in
      // production the recovery is a variable, not a revert and a redeploy, and
      // that is worth one `if`.
      const mode = process.env.CONTACTS_SYNC_INSERT_ONLY === "1" ? "insert_only" : "three_way";

      const { upserted, failed, failures, merged, deduped, unchanged, inserted } =
        await upsertContactsForOwner({
          ownerId,
          // The owner's own number, when the session carries one. An
          // email-only account has none and upsertContactsForOwner treats it
          // as absent, which only means "do not match a contact card against
          // the owner's own number" -- there is no number to match.
          ownerPhone: request.privyUser?.phone ?? null,
          contacts: valid,
          mode,
        });
      if (failed) {
        // FLAT, AND BY NAME. This logged a count inside an object -- and the
        // details of a logged object are what the renderer drops (the same thing
        // that made a failed message-persist undiagnosable), so what actually
        // reached the logs was "[contacts] some contacts failed to upsert" and
        // nothing else. It appeared twice on a sync where two people he had just
        // added never showed up in Amber, and there was no way to learn which two
        // or why.
        //
        // One line, everything interpolated, each failure named with the reason
        // the write gave. Capped at 25 descriptions; the count is exact.
        const detail = (failures || [])
          .map(
            (f) =>
              `"${f.name}"${f.externalId ? ` ext=${f.externalId}` : ""}` +
              `${f.count > 1 ? ` x${f.count}` : ""}: ${f.reason}`,
          )
          .join(" | ");
        request.log.warn(
          `[contacts] ${failed} of ${incoming.length} did not upsert for owner=${ownerId} ` +
            `(upserted=${upserted})${detail ? ` -- ${detail}` : ""}` +
            `${(failures || []).length < failed ? ` (+${failed - (failures || []).length} more not described)` : ""}`,
        );
      }

      // ── RESOLVE WHO THESE PEOPLE ARE, NOW THAT THEIR KEYS EXIST ──────────
      //
      // The sync has just written contact_identity_keys for everything in this
      // payload, which is the moment a card first becomes matchable against a
      // registered account. Nothing used to happen here, and that is the whole
      // shape of the linking hole: the only sweep ran at the OTHER person's
      // signup, over the cards that existed at that instant. Sync your address
      // book the day after your co-founder joined and his card stayed a card
      // forever -- no circle membership resolved to him, no shared note reached
      // him, no notification had a recipient.
      //
      // Scoped to this owner and driven off the keys index, so it is one
      // statement over this address book rather than a global sweep. Runs after
      // the upsert has committed and cannot fail the sync.
      const linked = await linkResolvableContacts({ ownerId });
      if (linked.linked > 0) {
        request.log.info(
          { ownerId, linked: linked.linked },
          "[contacts] contact cards resolved to Amber accounts",
        );
      }

      // AND COLLAPSE THE ONES THAT ARE PROVABLY THE SAME PERSON.
      //
      // Only where two cards point at the SAME account, which came from keys
      // that account proved it owns -- so there is nothing for the user to
      // adjudicate. Same-name cards with no key are NOT touched here; they are
      // offered through GET /v1/me/contacts/duplicates, because two people can
      // share a name and a wrong merge files one person's notes under another.
      //
      // AND NOT ON A RE-SYNC. Collapsing two cards into one is an edit -- the
      // loser's fields are folded into the winner and the loser goes away -- so
      // on a refresh it is exactly the kind of change he asked not to happen.
      // The first sync is where an address book full of duplicates gets tidied;
      // after that, duplicates are offered through
      // GET /v1/me/contacts/duplicates for him to decide about.
      // ── THE SYNCED BOOK IS THE POINT, SO LAND ALL OF IT ────────────────────
      //
      // "If someone syncs their Apple contacts, they have the right to assume
      //  that information is being utilized to make the app better for them."
      //
      // The people themselves landed above, through the three-way merge. These
      // two steps land what came WITH them and make it findable:
      //
      //   storeAppleCardDetails  the addresses, job titles, departments, URLs,
      //                          dates, relationships and notes a card carries.
      //                          FILL-ONLY, so it can run on every sync forever
      //                          and can never overwrite something typed here.
      //
      //   retagAddressBook       the labels people write into contact NAMES
      //                          ("USC", "BTG", "Plumber") plus the metro each
      //                          phone number implies. Derived over the WHOLE
      //                          book, because a tagline is only distinguishable
      //                          from a surname by comparing one card against
      //                          all the others.
      //
      // Awaited rather than detached: the client refreshes its list the moment
      // this responds, and a book whose labels arrive a second later is a book
      // that answers "who goes to USC" with nothing on the first try.
      const details = await storeAppleCardDetails(ownerId, valid).catch((err) => {
        request.log?.warn?.({ err: err?.message }, "[contacts] detail write failed");
        return 0;
      });
      const retagged = await retagAddressBook(ownerId).catch((err) => {
        request.log?.warn?.({ err: err?.message }, "[contacts] retag failed");
        return { scanned: 0, changed: 0 };
      });
      request.log.info(
        { ownerId, details, scanned: retagged.scanned, retagged: retagged.changed },
        "[contacts] synced card details stored and labels derived",
      );

      const collapsed = firstAppleSync
        ? await mergeProvableDuplicates(ownerId).catch(() => ({ merged: 0 }))
        : { merged: 0 };
      if (collapsed.merged > 0) {
        request.log.info(
          { ownerId, merged: collapsed.merged },
          "[contacts] duplicate cards for one account collapsed",
        );
      }

      // Post-sync state, so the client can show "N contacts, X from Apple, Y from
      // Google" without a second round trip. Best-effort: the contacts are
      // already committed, so a failed count must not fail the request.
      const bySource = await countLiveContactsBySource(ownerId).catch(() => null);

      // `ok` and `upserted` are unchanged — every existing client keeps working.
      request.log?.info?.(
        `[contacts] sync mode=${mode} owner=${ownerId} received=${incoming.length} ` +
          `inserted=${inserted} unchanged=${unchanged ?? 0} merged=${merged} failed=${failed}`,
      );

      return {
        ok: true,
        upserted,
        // HOW MANY DID NOT LAND. The app had no way to know: it reported
        // `upserted` as "N contacts sent to Amber" and a sync that dropped two
        // people looked identical to one that dropped none.
        failed,
        // WHAT THE SYNC ACTUALLY DID, so the app can say "12 new" instead of
        // implying it rewrote the whole address book. `mode` is echoed because a
        // refresh that edited nothing is the promise being kept, and the client
        // should be able to show that it was.
        mode,
        inserted,
        unchanged: unchanged ?? 0,
        // duplicates collapsed onto a person already in the address book
        merged,
        // duplicate cards collapsed against each other inside THIS payload
        deduped,
        // junk entries filtered out before the write
        removed,
        bySource,
      };
    },
  );

  /**
   * POST /v1/me/contacts/import/google
   * Import the caller's Google contacts (saved + "other" buckets) into the
   * canonical contacts table, deduping via mergeContact. Runs inline and
   * returns the counts. 400 if the caller hasn't connected Google.
   *
   * Response carries the same dedup vocabulary as the Apple sync route:
   *   merged   collapsed onto a person already in the address book
   *   deduped  two Google cards for one person, collapsed inside this import
   *   removed  junk entries filtered out (harvested entries with no name and no
   *            phone; a contact the user SAVED is never counted here)
   *   bySource live contact totals per source after the import
   */
  app.post(
    "/v1/me/contacts/import/google",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      const ownerId = phone
        ? await ownerIdFromSession(request.privyUser)
        : null;
      if (!ownerId) {
        return reply.code(400).send({
          error: "no_amber_id",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }

      const result = await importGoogleContactsForOwner(ownerId);
      if (!result.connected) {
        return reply.code(400).send({ error: "google_not_connected" });
      }

      const bySource = await countLiveContactsBySource(ownerId).catch(() => null);
      // Every pre-existing field is preserved (created / updated / fetched /
      // failed / filteredCount / otherContactsScope); merged, deduped and removed
      // come from the importer, with defaults so an older importer shape can't
      // produce `undefined` in the JSON.
      return {
        ...result,
        merged: result.merged ?? 0,
        deduped: result.deduped ?? 0,
        removed: result.removed ?? result.filteredCount ?? 0,
        bySource,
      };
    },
  );

  /**
   * POST /v1/me/contacts/create
   * First-class single-contact creation with phone-match dedup, optional Amber
   * user linkage, and optional pending-fact auto-flush.
   *
   * SECURITY: ownerId always comes from the verified session token, never from
   * body. linked_amber_id is only written after confirming the supplied amberId
   * maps to a real user in our DB. contactId is always a DB-generated surrogate.
   * Every store call is owner-scoped (owner_id = ownerId in every WHERE).
   */
  app.post(
    "/v1/me/contacts/create",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name:      { type: "string", minLength: 1, maxLength: 200 },
            phone:     { type: "string", maxLength: 50 },
            email:     { type: "string", maxLength: 200 },
            company:   { type: "string", maxLength: 200 },
            title:     { type: "string", maxLength: 200 },
            city:      { type: "string", maxLength: 200 },
            amberId:   { type: "string", maxLength: 100 },
            username:  { type: "string", maxLength: 100 },
            pendingId: { type: ["integer", "string"] },
          },
        },
      },
    },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      await getOrCreateUser(privyDid);

      // Phone or token subject. Adding somebody to your address book by hand is
      // the one way to fill it that needs no phone, no app and no file, so it
      // must not be the thing that requires a phone.
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return reply.code(500).send({ error: "no_amber" });

      const body = request.body || {};
      const name = (body.name || "").trim();
      if (!name) return reply.code(400).send({ error: "name_required" });

      // Coerce optional string fields — null means absent, empty string is treated as absent.
      const phone   = typeof body.phone   === "string" ? body.phone.trim()   || null : null;
      const email   = typeof body.email   === "string" ? body.email.trim()   || null : null;
      const amberId = typeof body.amberId === "string" ? body.amberId.trim() || null : null;
      const company = typeof body.company === "string" ? body.company.trim() || null : null;
      const title   = typeof body.title   === "string" ? body.title.trim()   || null : null;
      const city    = typeof body.city    === "string" ? body.city.trim()    || null : null;

      // B2: require at least one real identifier. username is accepted but stubbed
      // (username→amberId resolution not yet implemented), so it doesn't count.
      if (!phone && !email && !amberId) {
        return reply.code(400).send({
          error: "need_identifier",
          message: "Provide a phone, email, or Amber ID.",
        });
      }

      // Basic format sanity — reject obviously malformed values early.
      if (phone) {
        const digits = phone.replace(/\D/g, "");
        if (digits.length < 7) {
          return reply.code(400).send({ error: "bad_phone", message: "Phone must contain at least 7 digits." });
        }
      }
      if (email && !email.includes("@")) {
        return reply.code(400).send({ error: "bad_email", message: "Email must contain @." });
      }

      // IDENTITY RESOLUTION — verify amberId maps to a real Amber user.
      // If invalid, fall through as a plain unlinked contact (never block the create).
      let linkedAmberId = null;
      let linkPhone = null;
      if (amberId) {
        const userPhone = await getUserPhoneByAmberId(amberId).catch(() => null);
        if (userPhone) {
          linkedAmberId = amberId;
          linkPhone = userPhone;
        }
      }
      // username: accepted in schema for forward-compat, no-op for now.

      // PHONE-MATCH DEDUP — prefer the linked user's phone (authoritative) over
      // the caller-supplied phone when both are present.
      const dedupPhone = linkPhone || phone;
      let existing = null;
      if (dedupPhone) existing = await getContactByPhone(ownerId, dedupPhone).catch(() => null);

      let contactId;
      let created = false;

      if (existing) {
        // Contact already in this owner's records — update fields and optionally
        // link; do NOT create a duplicate row.
        contactId = existing.id;
        if (linkedAmberId) {
          await setContactLinkedAmberId({ ownerId, contactId, linkedAmberId }).catch(() => null);
        }
        const fieldUpdate = {};
        if (company !== null) fieldUpdate.company = company;
        if (title   !== null) fieldUpdate.title   = title;
        if (city    !== null) fieldUpdate.city    = city;
        if (email)            fieldUpdate.email   = email;
        if (phone)            fieldUpdate.phone   = phone;
        if (Object.keys(fieldUpdate).length > 0) {
          await updateContactFields({ ownerId, contactId, ...fieldUpdate }).catch(() => null);
        }
      } else {
        // Create new contact row.
        const row = await createContactForOwner({
          ownerId,
          ownerPhone,
          fullName: name,
          phonePrimary: phone || linkPhone || null,
          source: "amber_manual",
        });
        if (!row?.id) return reply.code(500).send({ error: "create_failed" });
        contactId = row.id;
        created = true;

        // Write optional metadata fields that createContactForOwner doesn't accept.
        const fieldUpdate = {};
        if (company) fieldUpdate.company = company;
        if (title)   fieldUpdate.title   = title;
        if (city)    fieldUpdate.city    = city;
        if (email)   fieldUpdate.email   = email;
        if (Object.keys(fieldUpdate).length > 0) {
          await updateContactFields({ ownerId, contactId, ...fieldUpdate }).catch(() => null);
        }

        if (linkedAmberId) {
          await setContactLinkedAmberId({ ownerId, contactId, linkedAmberId }).catch(() => null);
        }
      }

      // OPTIONAL PENDING AUTO-FLUSH — if the caller supplies a pendingId (from a
      // prior clarify/soft_confirm event), resolve it onto the new/matched contact.
      let confirmText = null;
      const pendingId = body.pendingId != null ? Number(body.pendingId) : null;
      if (pendingId) {
        const pending = await getPendingFactContextById(pendingId, ownerId).catch(() => null);
        if (pending) {
          const r = await resolvePendingItem({ ownerId, pending, resolvedId: contactId, resolvedName: name });
          confirmText = r?.confirmText ?? null;
        }
      }

      return reply.send({
        ok: true,
        contactId: String(contactId),
        created,
        linked: !!linkedAmberId,
        confirmText,
      });
    },
  );

  /**
   * DELETE /v1/me/contacts/:contactId
   *
   * Deletes the contact AND everything derived from them — facts, notes,
   * experiences, name memories, the embedding, identity keys, favorites, circle
   * memberships, contact-scoped shares, and the Pinecone vector.
   *
   * A half-delete is worse than none. Free-text search reads contact_facts and
   * contact_notes directly, so deleting only the `contacts` row leaves a person who
   * has "been deleted" still answering questions about themselves in search. See
   * db/contact-delete.js for the ordering and the per-table reasoning.
   */
  app.delete(
    "/v1/me/contacts/:contactId",
    {
      preHandler: [requireAuth],
      schema: { params: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] } },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }

      const contactId = String(request.params.contactId);
      const res = await deleteContactCascade(ownerId, contactId);
      if (!res.ok) {
        if (res.reason === "not_found") {
          return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(400).send({ error: res.reason || "delete_failed" });
      }


      request.log.info(
        { owner: ownerId, contactId, rows: res.total, tables: res.deleted },
        "[contact] deleted with cascade",
      );
      return reply.send({ deleted: true, rows: res.total, tables: res.deleted });
    },
  );

  /**
   * POST /v1/me/contacts/:contactId/enrich
   *
   * ONE CONTACT. ON THE METER. FILL-ONLY.
   *
   * There is deliberately no bulk form of this. A sweep over an address book is
   * the shape that produces a surprise invoice and the shape that lands a bad
   * provider response on a thousand cards at once; a client that wants many
   * calls this many times and hits the same limit everything else does.
   *
   * 402 for a budget refusal rather than 429: this is not "you are going too
   * fast", it is "there is no budget left", and a client that retries a 429
   * with backoff would sit in a loop until the window rolled.
   */
  app.post(
    "/v1/me/contacts/:contactId/enrich",
    {
      preHandler: [requireAuth],
      schema: {
        params: {
          type: "object",
          properties: { contactId: { type: "string" } },
          required: ["contactId"],
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return reply.code(500).send({ error: "could_not_resolve_owner" });

      const result = await enrichOneContact(ownerId, request.params.contactId).catch((err) => {
        request.log?.error?.({ err: err?.message }, "[enrich] failed");
        return { ok: false, reason: "enrich_failed" };
      });

      if (result.ok) return result;
      const code = {
        contact_not_found: 404,
        no_name_to_search: 422,
        daily_limit: 402,
        monthly_limit: 402,
        enrichment_disabled: 403,
        recently_enriched: 409,
        provider_not_configured: 501,
        provider_error: 502,
      }[result.reason] ?? 500;
      return reply.code(code).send({ error: result.reason, ...result });
    },
  );

  /**
   * GET /v1/me/enrichment/usage
   *
   * What enrichment has cost this owner, what is left, and what it went on.
   * Read straight off the ledger, so it cannot disagree with what the meter
   * will decide on the next request -- they are the same rows.
   */
  app.get(
    "/v1/me/enrichment/usage",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) return reply.code(500).send({ error: "could_not_resolve_owner" });
      const usage = await usageSummary(ownerId).catch((err) => {
        request.log?.error?.({ err: err?.message }, "[enrich-usage] read failed");
        return null;
      });
      if (!usage) return reply.code(503).send({ error: "usage_unavailable" });
      return usage;
    },
  );

  /**
   * GET /v1/me/contacts/:contactId/cadence
   *
   * HOW OFTEN YOU TWO ARE ACTUALLY IN TOUCH, and on what, and which way.
   *
   * Every number here was already written by the rollup -- this endpoint adds
   * no storage and no computation beyond turning counts into the sentence a
   * person would say. It exists separately from the contact GET (which carries
   * the same object) so a client can refresh a cadence strip without refetching
   * the whole card, and so the graph can ask for it on hover.
   */
  app.get(
    "/v1/me/contacts/:contactId/cadence",
    {
      preHandler: [requireAuth],
      schema: {
        params: {
          type: "object",
          properties: { contactId: { type: "string" } },
          required: ["contactId"],
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }
      // Same three-way distinction the provenance route draws: null is "not
      // yours or gone" (404), undefined is "the read broke" (503). Collapsing
      // them would report a working contact as missing.
      const cadence = await getContactCadence(ownerId, request.params.contactId).catch((err) => {
        request.log?.error?.({ err: err?.message }, "[cadence] read failed");
        return undefined;
      });
      if (cadence === undefined) return reply.code(503).send({ error: "cadence_unavailable" });
      if (cadence === null) return reply.code(404).send({ error: "contact_not_found" });
      return cadence;
    },
  );

  /**
   * GET /v1/me/contacts/:contactId/provenance
   *
   * WHERE THIS CARD CAME FROM. An Amber contact is an amalgamation -- an Apple
   * card, a Google card, an address somebody has been emailing, a Clay
   * enrichment, a name typed by hand -- and the thing that makes an
   * amalgamation trustworthy is being able to see what it was amalgamated
   * from. This answers that: every source that ever claimed this person and
   * the RAW values it sent, which source owns each field on the card today,
   * how many identities anchor them, and which duplicates were merged in.
   *
   * Reads only. Nothing here is stored for this endpoint's benefit; it reads
   * back what the sync and merge paths already write.
   */
  app.get(
    "/v1/me/contacts/:contactId/provenance",
    {
      preHandler: [requireAuth],
      schema: {
        params: {
          type: "object",
          properties: { contactId: { type: "string" } },
          required: ["contactId"],
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }
      const provenance = await getContactProvenance(ownerId, request.params.contactId).catch(
        (err) => {
          request.log?.error?.({ err: err?.message }, "[provenance] read failed");
          return undefined;
        },
      );
      // null means "not this owner's, or gone"; undefined means the read blew
      // up. A 404 for the first is correct; for the second it would be a lie.
      if (provenance === undefined) {
        return reply.code(503).send({ error: "provenance_unavailable" });
      }
      if (provenance === null) {
        return reply.code(404).send({ error: "contact_not_found" });
      }
      return provenance;
    },
  );

  /**
   * GET /v1/me/contacts/:contactId
   * Returns a single contact record from Cloud SQL for the authenticated user.
   * Owner is resolved via amber_id (Pattern A), not Privy DID.
   */
  app.get(
    "/v1/me/contacts/:contactId",
    {
      preHandler: [requireAuth],
      schema: { params: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] } },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        request.log.error({ did: request.privyUser?.userId }, "[contact] could not resolve an owner for this session");
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }
      const { contactId } = request.params;
      const contact = await getContactById(ownerId, contactId);
      request.log?.info?.(`CONTACT_GET owner=${ownerId} contactId="${contactId}" found=${!!contact}`);
      if (!contact) {
        return reply.code(404).send({ error: "contact_not_found" });
      }
      // HOW OFTEN, ON WHAT, WHICH WAY. Rolled up already; this is a read of
      // rows that exist whether or not anyone asks for them. It is attached
      // rather than left to a second round trip because every caller that
      // wants a card wants this on it, and it CANNOT fail the request: a
      // cadence is an embellishment on a contact, and a contact that will not
      // load because its counts would not is a worse card than one without
      // counts.
      const cadence = await getContactCadence(ownerId, contactId).catch((err) => {
        request.log?.warn?.({ err: err?.message }, "[cadence] read failed");
        return null;
      });
      return { contact, cadence };
    },
  );

  /**
   * PATCH /v1/me/contacts/:contactId
   * Partial-update editable fields on a contact owned by the caller.
   * Auth pattern matches GET /v1/me/contacts/:contactId (Pattern A).
   *
   * Body (all optional, at least one required):
   *   name, firstName, lastName, phone, email, company, title, city, notes
   *
   * When `name` is supplied it sets full_name and derives first_name/last_name.
   * Explicit `firstName`/`lastName` in the body override the derived values.
   * Returns { contact } with the full updated shape on success.
   */
  app.patch(
    "/v1/me/contacts/:contactId",
    {
      preHandler: [requireAuth],
      schema: {
        params: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        request.log.error({ did: request.privyUser?.userId }, "[contact-patch] could not resolve an owner for this session");
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }

      const { contactId } = request.params;
      // contacts.id is a uuid. This tested /^\d+$/, so EVERY real contact id
      // failed and this endpoint answered 400 to every request ever made to it.
      if (!_CONTACT_ID_RE.test(String(contactId))) {
        return reply.code(400).send({ error: "invalid_contact_id", message: "contactId must be a uuid" });
      }

      const body = request.body || {};
      const patch = {};

      // Name: body.name drives fullName + derives first/last; explicit first/last override.
      if (typeof body.name === "string") {
        const trimmedName = body.name.trim();
        if (trimmedName) {
          patch.fullName = trimmedName;
          const tokens = trimmedName.split(/\s+/);
          patch.firstName = tokens[0];
          patch.lastName = tokens.slice(1).join(" "); // "" when single token (one-word name)
        }
      }
      if (typeof body.firstName === "string") patch.firstName = body.firstName.trim();
      if (typeof body.lastName  === "string") patch.lastName  = body.lastName.trim();
      if (typeof body.company   === "string") patch.company   = body.company.trim();
      if (typeof body.title     === "string") patch.title     = body.title.trim();
      if (typeof body.city      === "string") patch.city      = body.city.trim();
      if (typeof body.phone     === "string") patch.phone     = body.phone.trim();
      if (typeof body.email     === "string") patch.email     = body.email.trim();
      if (typeof body.notes     === "string") patch.notes     = body.notes.trim();

      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ error: "no_fields", message: "Supply at least one field to update" });
      }

      const updated = await updateContactFields({ ownerId, contactId, ...patch });
      if (!updated) {
        return reply.code(404).send({ error: "contact_not_found", message: "Contact not found or not owned" });
      }

      const contact = await getContactById(ownerId, contactId);
      return { contact };
    },
  );

  /**
   * GET /v1/me/contacts/:contactId/facts
   * Returns resolved facts for a single contact, for display on the person screen.
   * Owner is resolved via amber_id (Pattern A), not Privy DID.
   */
  app.get(
    "/v1/me/contacts/:contactId/facts",
    {
      preHandler: [requireAuth],
      schema: { params: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] } },
    },
    async (request, reply) => {
      const ownerId = await ownerIdFromSession(request.privyUser);
      if (!ownerId) {
        request.log.error({ did: request.privyUser?.userId }, "[contact-facts] could not resolve an owner for this session");
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }
      const { contactId } = request.params;
      const facts = await getFactsForContact(ownerId, contactId);
      return { facts };
    },
  );

  /**
   * GET /v1/profile/:userId
   * Returns another user's profile filtered by their privacy tier.
   *
   * Authorization: requires a valid Privy session (any authenticated
   * user). The target's privacyTier governs which fields come back; we
   * never return raw profile data without applying that filter, so the
   * caller cannot read fields the target hasn't opted into sharing.
   */
  app.get(
    "/v1/profile/:userId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const callerDid = requirePrivyDid(request, reply);
      if (!callerDid) return;

      const targetUserId = String(request.params.userId);
      const uidErr = validateUserId(targetUserId);
      if (uidErr) {
        return reply
          .code(400)
          .send({ error: "invalid_user_id", message: uidErr });
      }

      const target = await getUserByPrivyDid(targetUserId);
      const profile = await getProfile(targetUserId);

      if (!target || !profile) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "User not found" });
      }

      // Self-read goes through GET /v1/me; this endpoint is for cross-user
      // reads only and always applies the privacy filter.
      const tier =
        profile.privacyTier ||
        target.privacy_tier ||
        target.privacyTier ||
        "local_only";

      switch (tier) {
        case "local_only":
          return reply
            .code(404)
            .send({ error: "not_found", message: "User not found" });

        case "selective_cloud":
          return {
            displayName: profile.displayName,
            currentCity: profile.currentCity,
            avatarUrl: profile.avatarUrl,
          };

        case "full_social": {
          // Strip sensitive fields even at the most-public tier.
          const {
            birthdayTime: _bt,
            birthLocation: _bl,
            contentHash: _ch,
            ...publicProfile
          } = profile;
          return publicProfile;
        }

        default:
          return reply
            .code(404)
            .send({ error: "not_found", message: "User not found" });
      }
    },
  );

  /**
   * POST /v1/account/delete
   *
   * Full account deletion. Wipes all Firestore data for the caller and
   * deletes the Privy user record. This is irreversible.
   *
   * Required by the iOS client contract for App Store compliance.
   * Requires a valid Privy Bearer token (the user must be authenticated
   * to delete their own account).
   *
   * Body: { confirm: true }  — explicit confirmation required to prevent
   * accidental deletion from API clients.
   */
  app.post(
    "/v1/account/delete",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      if (request.body?.confirm !== true) {
        return reply.code(400).send({
          error: "confirmation_required",
          message:
            "Send { confirm: true } in the request body to confirm account deletion.",
        });
      }

      // WHAT COUNTS AS FAILURE, AND WHY IT CHANGED.
      //
      // This used to treat any of the three teardowns failing as a 500
      // "partial_deletion". Firestore is LEGACY storage — a deployment without
      // it configured throws on every call — so a deploy with no Firestore
      // returned an error on EVERY delete while the SQL purge and the Privy
      // deletion had both succeeded. The user saw "Could not delete account",
      // stayed signed in holding a token for an account that was already gone,
      // and had no way to tell which of the two had happened.
      //
      // The criteria are now the two that decide whether the account still
      // exists: the Cloud SQL purge (the data) and the Privy user (the
      // identity). Anything else that fails is a WARNING, reported in the body
      // and logged — not a claim that the deletion did not happen.
      const errors = [];
      const warnings = [];

      // 0. Purge all Cloud SQL data AND hard-delete the user row, so the phone is
      //    freed and a delete means a real clean slate (re-onboard from scratch).
      const phone = request.privyUser?.phone ?? null;
      try {
        // Resolve the caller's amber_id by DID first, then fall back to phone.
        // DID-first means deletion still purges data for accounts that have no
        // phone on the session (e.g. Sign in with Apple/Google without OTP),
        // which the phone-only path silently skipped.
        let amberId = await resolveAmberIdByPrivyDid(privyDid).catch(() => null);
        if (!amberId && phone) {
          amberId = await ownerIdFromSession(request.privyUser);
        }
        if (amberId) {
          // privyDid and phone reach the rows no amber_id can: device sessions
          // (whose refresh tokens would otherwise stay valid for a deleted
          // account), OTP codes, and the Slack link.
          const purge = await purgeOwnerData(amberId, { privyDid, phone });
          request.log.info(
            {
              deleted: purge.deleted,
              skipped: purge.skipped,
              errorCount: purge.errors.length,
              userRowDeleted: purge.userRowDeleted,
            },
            "account/delete: Cloud SQL purge result",
          );
          // A per-table failure used to be swallowed inside purgeOwnerData while
          // the route reported success anyway — a deletion that did not delete.
          if (purge.errors.length > 0) {
            request.log.error({ errors: purge.errors }, "account/delete: purge left rows behind");
            errors.push("sql_purge_incomplete");
          }
          if (!purge.userRowDeleted) errors.push("user_row_not_deleted");
        } else {
          // Nothing to purge — either the caller never had a Cloud SQL row, or
          // the lookup failed. Those are not the same thing and we cannot tell
          // them apart here, so say so rather than imply a clean sweep.
          request.log.warn(
            { privyDid, hasPhone: !!phone },
            "account/delete: no amber_id resolved — no Cloud SQL data was purged",
          );
          warnings.push("no_sql_account_found");
        }
      } catch (err) {
        request.log.error(err, "account/delete: Cloud SQL purge failed");
        errors.push("sql_purge_failed");
      }


      // 2. Delete the Privy user record. This is the identity, so it counts.
      try {
        // The Privy account delete used to run here. There is no Privy account:
        // the user is a row in `users` and their data is removed by the purge
        // above, which cascades. Deleting nothing externally is the correct
        // behavior now, not a gap.
      } catch (err) {
        // Privy returns 404 if the user was already deleted; that is not an error.
        if (err?.status !== 404 && err?.statusCode !== 404) {
          request.log.error(err, "account/delete: Privy deletion failed");
          errors.push("privy_deletion_failed");
        }
      }

      if (errors.length > 0) {
        return reply.code(500).send({
          error: "partial_deletion",
          message: "Some data could not be deleted. Contact support.",
          errors,
          warnings,
        });
      }

      return {
        ok: true,
        message: "Account and all associated data have been deleted.",
        warnings,
      };
    },
  );
}
