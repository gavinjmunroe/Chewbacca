import { tenantIndex } from "../lib/auth-session.js";
import { verifySessionTokenAny } from "../lib/auth-session.js";
import { getUserByEmail } from "../db/user-store.js";
import { getUserByPrivyDid as getUserByDid } from "../db/user-store.js";
/**
 * Internal API routes for amber-agent (service-to-service).
 * Authenticated via API key (x-api-key header), not Privy Bearer tokens.
 *
 * GET  /internal/users/:userId/context  — normalized context blob
 * GET  /internal/users/:userId/contacts — full contact list
 * POST /internal/auth/resolve-user      — resolve Privy token to userId + profile
 * POST /internal/agents/group-chat/decide
 *
 * Migrated from Drizzle/Postgres to Firestore (DID-keyed). The :userId path
 * segment now accepts the Privy DID. amber-agent's existing
 * `/internal/auth/resolve-user` flow already returns a DID (claims.userId)
 * so the contract is preserved.
 */

import { requireApiKey, validatePhone, validateUserId } from "../lib/auth.js";
import {
} from "../lib/auth-session.js";
import {
  getUserByPrivyDid,
  getProfile,
  getOnboardingProgress,
  listPersonalityProfiles,
  listContacts,
  listContactsPage,
  listPermissions,
  findContactByPhone,
  findContactByHandle,
  findContactByEmailAcrossTenants,
  findContactByName,
  getContactsByName,
  updateContactContext,
  updateContactRelationship,
  getOrCreateUser,
  upsertContact,
} from "../db/user-store.js";
import {
  decideGroupChatResponse,
  GROUP_CHAT_RULES,
} from "../lib/group-chat-governor.js";
import { findTenantByOAuthEmail } from "../lib/tenant-email-resolver.js";
import { rankDidViaTogari } from "../enrichment/togari-search-rank.js";
import {
  resolveAmberIdByPrivyDid,
  getContactsForResolution,
  getContactContentForContacts,
} from "../db/store.js";
import { embedContacts } from "../lib/contact-vectors.js";





const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isLikelyEmail(s) {
  return (
    typeof s === "string" && s.length > 3 && s.length <= 254 && EMAIL_RE.test(s)
  );
}

function pickDisplayName(user) {
  const meta = user?.customMetadata || {};
  return (
    meta.ownerName ||
    meta.displayName ||
    meta.agentName ||
    user?.email?.address ||
    null
  );
}

export function registerInternalRoutes(app) {
  /**
   * POST /internal/contacts/backfill-vectors  (x-api-key)
   * Body: { ownerId }. Embeds all of an owner's contacts into contact_embedding
   * so the PeopleRank vector pre-filter has an index to search. Runs in the
   * BACKGROUND (a large address book would otherwise exceed request timeouts) and
   * returns immediately; watch the logs for VECTOR_BACKFILL / VECTOR_BACKFILL_DONE.
   */
  app.post(
    "/internal/contacts/backfill-vectors",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const ownerId = String(request.body?.ownerId || "").trim();
      if (!ownerId) {
        return reply.code(400).send({ error: "owner_required", message: "ownerId is required" });
      }
      setImmediate(async () => {
        try {
          const contacts = await getContactsForResolution(ownerId);
          if (!Array.isArray(contacts) || contacts.length === 0) {
            request.log?.info?.(`VECTOR_BACKFILL owner=${ownerId} no_contacts`);
            return;
          }
          // String, not Number: Number() of a uuid is NaN, so this handed
          // getContactContentForContacts an array of NaN and the vector backfill
          // ran with no facts attached to anybody.
          const ids = contacts.map((c) => String(c.id));
          const factsMap = await getContactContentForContacts(ownerId, ids).catch(() => ({}));
          let embedded = 0;
          let skipped = 0;
          let errored = 0;
          const BATCH = 200;
          for (let i = 0; i < contacts.length; i += BATCH) {
            const r = await embedContacts(ownerId, contacts.slice(i, i + BATCH), factsMap);
            embedded += r.embedded;
            skipped += r.skipped;
            errored += r.errored;
            request.log?.info?.(
              `VECTOR_BACKFILL owner=${ownerId} progress=${Math.min(i + BATCH, contacts.length)}/${contacts.length} embedded=${embedded} skipped=${skipped} errored=${errored}`,
            );
          }
          request.log?.info?.(
            `VECTOR_BACKFILL_DONE owner=${ownerId} total=${contacts.length} embedded=${embedded} skipped=${skipped} errored=${errored}`,
          );
        } catch (e) {
          request.log?.error?.(`VECTOR_BACKFILL_ERR owner=${ownerId} ${e?.message || e}`);
        }
      });
      return reply.send({ ok: true, started: true, ownerId });
    },
  );

  /**
   * GET /internal/users/:userId/context
   * Returns a normalized context blob for amber-agent to consume.
   * :userId is the Privy DID (post-Firestore migration).
   */
  app.get(
    "/internal/users/:userId/context",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const user = await getUserByPrivyDid(userId);
      if (!user) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const profile = await getProfile(userId);
      const progress = await getOnboardingProgress(userId);
      const personalities = await listPersonalityProfiles(userId);
      const amberIdForCtx = await resolveAmberIdByPrivyDid(userId);
      const contactList = amberIdForCtx
        ? await listContacts(amberIdForCtx)
        : [];
      const permissions = await listPermissions(userId);

      return {
        userId: user.id || userId,
        privyUserId: user.privyUserId || userId,
        profile: profile
          ? {
              displayName: profile.displayName,
              username: profile.username,
              birthday: profile.birthday,
              currentCity: profile.currentCity,
              hometown: profile.hometown,
              almaMater: profile.almaMater,
              bio: profile.bio,
              avatarUrl: profile.avatarUrl,
              privacyTier:
                profile.privacyTier ||
                user.privacy_tier ||
                user.privacyTier ||
                "local_only",
              onboardingCompleted: !!profile.onboardingCompletedAt,
              contentHash: profile.contentHash,
            }
          : null,
        onboarding: progress
          ? {
              currentStep: progress.currentStep,
              stepsCompleted: progress.stepsCompleted,
            }
          : null,
        personalityProfiles: personalities.map((p) => ({
          type: p.profileType,
          result: p.result,
          derivedFrom: p.derivedFrom,
          confidence: p.confidence,
        })),
        contacts: contactList.map((c) => ({
          id: c.id,
          name: c.name,
          firstName: c.firstName ?? null,
          lastName: c.lastName ?? null,
          phoneNumbers: c.phoneNumbers,
          emails: c.emails,
          birthday: c.birthday,
          relationshipScore: c.relationshipScore,
          messageFrequency: c.messageFrequency,
          lastContactedAt: c.lastContactedAt,
        })),
        permissions: permissions.map((p) => ({
          fieldType: p.fieldType,
          syncEnabled: p.syncEnabled,
        })),
      };
    },
  );

  /**
   * GET /internal/users/:userId/contacts
   * Full contact list optimized for prompt injection into amber-agent.
   */
  app.get(
    "/internal/users/:userId/contacts",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const user = await getUserByPrivyDid(userId);
      if (!user) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const amberId = await resolveAmberIdByPrivyDid(userId);
      const contactList = amberId ? await listContacts(amberId) : [];
      return { userId, contacts: contactList };
    },
  );

  /**
   * GET /internal/users/:userId/contacts/export
   *
   * Full raw contact book for a DID, paginated server-side into one array.
   * Unlike GET .../contacts this does NOT require a Privy user row — it reads
   * the Firestore contacts subcollection directly (via listContactsPage), so it
   * works for imported/env-default owners (e.g. Sagar) whose contacts exist but
   * who were never provisioned as a Privy user. Used by the DNC sync to push
   * contacts to Clay and MERGE them into BigQuery.
   */
  app.get(
    "/internal/users/:userId/contacts/export",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const MAX = 10000;
      const out = [];
      let cursor = null;
      const exportAmberId = await resolveAmberIdByPrivyDid(userId);
      if (!exportAmberId) {
        return { userId, count: 0, contacts: [] };
      }
      try {
        do {
          const page = await listContactsPage(exportAmberId, {
            limit: 500,
            cursor,
          });
          out.push(...(page.contacts || []));
          cursor = page.nextCursor;
        } while (cursor && out.length < MAX);
      } catch (err) {
        request.log.error(err, "[contacts/export] failed");
        return reply.code(500).send({ error: "export_failed" });
      }
      return { userId, count: out.length, contacts: out };
    },
  );

  /**
   * POST /internal/users/:userId/contacts/reindex
   *
   * Re-embed every contact for a DID into Pinecone using the current
   * textForContact representation. Run after changing how contacts are
   * embedded (e.g. the apple company->notes relabel). Reads Firestore directly
   * (no Privy-user requirement).
   */
  app.post(
    "/internal/users/:userId/contacts/reindex",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      // Paginated: re-embed ONE page per request so the call stays well under
      // the platform's edge timeout and the caller can drive + verify the loop.
      // Pass ?cursor=<nextCursor> to continue; nextCursor=null means done.
      const limit = Math.min(Number(request.query?.limit) || 100, 200);
      const cursor = request.query?.cursor || null;
      const reindexAmberId = await resolveAmberIdByPrivyDid(userId);
      if (!reindexAmberId) {
        return {
          userId,
          indexed: 0,
          nextCursor: null,
          result: { skipped: "privy_did_not_linked" },
        };
      }
      let page;
      try {
        page = await listContactsPage(reindexAmberId, { limit, cursor });
      } catch (err) {
        request.log.error(err, "[contacts/reindex] page failed");
        return reply.code(500).send({ error: "page_failed" });
      }
      const result = { indexed: 0 };
      return {
        userId,
        indexed: (page.contacts || []).length,
        nextCursor: page.nextCursor,
        result,
      };
    },
  );

  /**
   * GET /internal/users/:userId/contacts/by-phone?phone=+1…
   *
   * Resolve a single contact in this tenant's address book by phone
   * number. Returned object's `name` / `firstName` belong to the
   * CONTACT, never to the tenant owner. A 404 here MUST be interpreted
   * by callers (amber-imessage especially) as "unknown sender" — DO NOT
   * fall back to the tenant's displayName or the owner profile.
   *
   * This route exists specifically to close the owner-vs-contact
   * identity bleed that caused inbound messages from a stranger to be
   * answered with the owner's first name.
   */
  app.get(
    "/internal/users/:userId/contacts/by-phone",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const phone = request.query?.phone;
      const phoneErr = validatePhone(phone);
      if (phoneErr) {
        return reply
          .code(400)
          .send({ error: "invalid_phone", message: phoneErr });
      }

      const user = await getUserByPrivyDid(userId);
      if (!user) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const amberIdByPhone = await resolveAmberIdByPrivyDid(userId);
      const contact = amberIdByPhone
        ? await findContactByPhone(amberIdByPhone, phone)
        : null;
      if (!contact) {
        return reply.code(404).send({
          error: "contact_not_found",
          message:
            "No contact with this phone in the tenant address book. Treat sender as unknown; do not substitute the tenant owner's profile.",
        });
      }
      return {
        userId,
        contact: {
          id: contact.id,
          name: contact.name,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          phoneNumbers: contact.phoneNumbers,
          emails: contact.emails,
          relationshipScore: contact.relationshipScore,
        },
      };
    },
  );

  /**
   * GET /internal/users/:userId/contacts/by-handle?handle=@shirley
   *
   * Resolve a Slack-style "@handle" (or a bare name used as a handle) to a
   * single contact in this tenant's address book. Tab 31 of the 2026-05-29
   * dispatch — the cross-person reminder path. The reminder delivery worker
   * calls this at fire time to turn "remind @shirley to send the deck" into
   * a deliverable phone number.
   *
   * Match order: `sourceHandle` exact (case-insensitive) first, then a name
   * fallback (first / full / display name). The returned object carries the
   * contact's `phoneNumbers` so the caller can rewrite the reminder to an
   * imessage delivery. A 404 means **unknown handle** — callers MUST NOT
   * substitute the tenant owner's identity or phone.
   */
  app.get(
    "/internal/users/:userId/contacts/by-handle",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const handle = request.query?.handle;
      if (!handle || typeof handle !== "string") {
        return reply.code(400).send({
          error: "missing_handle",
          message: "?handle=@name required",
        });
      }

      const user = await getUserByPrivyDid(userId);
      if (!user) return reply.code(404).send({ error: "user_not_found" });

      const amberIdByHandle = await resolveAmberIdByPrivyDid(userId);
      const contact = amberIdByHandle
        ? await findContactByHandle(amberIdByHandle, handle)
        : null;
      if (!contact) {
        return reply.code(404).send({
          error: "contact_not_found",
          message:
            "No contact with this handle in the tenant address book. Treat handle as unresolvable; do not substitute the tenant owner.",
        });
      }
      return {
        userId,
        contact: {
          id: contact.id,
          name: contact.name,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          phoneNumbers: contact.phoneNumbers ?? [],
          phoneNumbersNormalized: contact.phoneNumbersNormalized ?? [],
          emails: contact.emails ?? [],
          source: contact.source ?? null,
          sourceHandle: contact.sourceHandle ?? null,
          relationshipScore: contact.relationshipScore ?? 0,
        },
      };
    },
  );

  /**
   * POST /internal/users/:userId/contacts
   *
   * Service-key upsert of a contact into the tenant's address book. Mirror
   * of POST /v1/me/contacts but service-authed via x-api-key so amber-agent
   * (and ops tooling) can register a contact without holding a Privy
   * session for the tenant owner.
   *
   * Body shape — single contact OR `{ contacts: [...] }`:
   *
   *   { name, firstName?, lastName?, phone?, phoneNumbers?, emails?, ... }
   *
   * `name` is REQUIRED. `phone` is accepted as a convenience and folded
   * into `phoneNumbers: [phone]` if `phoneNumbers` is absent.
   */
  app.post(
    "/internal/users/:userId/contacts",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const body = request.body || {};
      const incoming = Array.isArray(body.contacts)
        ? body.contacts
        : body.name
          ? [body]
          : null;

      if (!incoming) {
        return reply.code(400).send({
          error: "bad_request",
          message:
            "Body must be either { name, ... } or { contacts: [{ name, ... }, ...] }",
        });
      }

      await getOrCreateUser(userId);

      const amberIdPost = await resolveAmberIdByPrivyDid(userId);
      if (!amberIdPost) {
        return {
          userId,
          upserted: 0,
          contacts: [],
          warning: "privy_did_not_linked",
        };
      }

      const results = [];
      for (const c of incoming) {
        if (!c?.name) continue;
        const normalized = {
          ...c,
          phoneNumbers:
            c.phoneNumbers ?? (typeof c.phone === "string" ? [c.phone] : []),
        };
        const saved = await upsertContact(amberIdPost, normalized);
        if (saved) results.push(saved);
      }


      return { userId, upserted: results.length, contacts: results };
    },
  );

  /**
   * POST /internal/auth/resolve-user
   * Resolve a Privy token to userId + profile.
   * Replaces amber-agent's direct Privy calls.
   *
   * Body: { token: "privy-auth-token" }
   */
  app.post(
    "/internal/auth/resolve-user",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { token } = request.body || {};

      if (!token) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "token is required" });
      }

      const claims = await verifySessionTokenAny(token);
      if (!claims) {
        return reply.code(401).send({
          error: "invalid_token",
          message: "Invalid or expired session token",
        });
      }

      const user = await getUserByPrivyDid(claims.userId);
      if (!user) {
        return reply.code(404).send({
          error: "user_not_in_db",
          message:
            "User authenticated but not yet created in amber-id database",
          privyUserId: claims.userId,
        });
      }

      const profile = await getProfile(claims.userId);

      return {
        userId: user.id || claims.userId,
        privyUserId: claims.userId,
        profile: profile || null,
      };
    },
  );

  /**
   * POST /internal/agents/group-chat/decide
   *
   * Group-chat social-governor gate. amber-agent calls this *before*
   * generating a reply in any chat with more than one human or more than
   * one AI agent. The governor is a pure function — see
   * src/lib/group-chat-governor.js for the rule set and the production
   * incident that motivated it (Camber + Samber over-replying, ignoring
   * "guys can u both shut up").
   */
  app.post(
    "/internal/agents/group-chat/decide",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
          required: ["selfAgent", "transcript"],
          properties: {
            selfAgent: { type: "object" },
            transcript: { type: "array" },
            participants: { type: "array" },
            isGroupChat: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const decision = decideGroupChatResponse(request.body || {});
      return { rules: GROUP_CHAT_RULES, decision };
    },
  );

  /**
   * GET /internal/users/by-email?email=<address>
   *
   * Service-keyed sibling of /v1/tenants/by-email with a leaner response
   * shape, tailored for transport-layer callers that only need the DID and
   * a display name to attribute an inbound message. Tab 6's flow:
   *
   *   inbound Slack DM → users.info → profile.email → THIS ROUTE → tenant DID
   *
   * Two-stage lookup, same as /v1/tenants/by-email:
   *   1. Privy linked email match (signed in with this address).
   *   2. OAuth-connected account email in the per-tenant secrets bag
   *      (Google, Microsoft, GitHub, Railway, Notion, Slack, …). Closes
   *      the gap where a user's work / OAuth email differs from their
   *      Privy primary.
   *
   * Returns 404 when both stages miss so callers fall through to Option C.
   */
  app.get(
    "/internal/users/by-email",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const email = request.query?.email;
      if (!isLikelyEmail(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      try {
        const user = await getUserByEmail(email);
        if (user?.id) {
          return {
            did: user.id,
            displayName: pickDisplayName(user),
            matchedVia: "privy_primary",
          };
        }

        const hit = await findTenantByOAuthEmail(email, {
          // Cloud SQL, via the tenant index. Was Privy listAllUsers().
          listAllTenants: async () => tenantIndex.getAll(),
        });
        if (hit?.did) {
          const tenant = await getUserByDid(hit.did);
          if (tenant?.id) {
            return {
              did: tenant.id,
              displayName: pickDisplayName(tenant),
              matchedVia: "oauth_account",
              matchedKey: hit.matchedKey,
            };
          }
        }

        return reply.code(404).send({ error: "user_not_found" });
      } catch (err) {
        request.log.error(err, "Failed to resolve user by email");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /internal/contacts/by-email?email=<address>
   *
   * Resolve an inbound Slack / SMS / email sender to either a tenant
   * owner OR a contact in someone's address book. The response shape is
   * `{ found: true, kind, did, ... }` on hit (200) and `{ found: false }`
   * on miss (200; not 404 — callers branch on the boolean rather than
   * the status code). Bad input still returns 400.
   *
   * Lookup order:
   *   1. Tenant owner — Privy primary / linked email (`getUserByEmail`).
   *   2. Tenant owner — OAuth-connected account email
   *      (`findTenantByOAuthEmail`, e.g. caleb@bluemodernadvisory.com
   *      stored as MS_OAUTH_ACCOUNT_EMAIL in his secrets bag).
   *   3. Contact in some tenant's address book
   *      (`findContactByEmailAcrossTenants`).
   *   4. Miss → `{ found: false }`.
   *
   * On a contact hit, `did` is the OWNING tenant's DID (the address book
   * the contact lives in), and `contact` carries the full contact row so
   * transports can address the sender by firstName / displayName.
   */
  app.get(
    "/internal/contacts/by-email",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const email = request.query?.email;
      if (!isLikelyEmail(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      try {
        // Stage 1: Privy primary / linked email.
        const user = await getUserByEmail(email);
        if (user?.id) {
          return {
            found: true,
            kind: "tenant_owner",
            did: user.id,
            displayName: pickDisplayName(user),
            matchedVia: "privy_primary",
          };
        }

        // Stage 2: OAuth-connected account email across tenants.
        const ownerHit = await findTenantByOAuthEmail(email, {
          // Cloud SQL, via the tenant index. Was Privy listAllUsers().
          listAllTenants: async () => tenantIndex.getAll(),
        });
        if (ownerHit?.did) {
          const tenant = await getUserByDid(ownerHit.did);
          if (tenant?.id) {
            return {
              found: true,
              kind: "tenant_owner",
              did: tenant.id,
              displayName: pickDisplayName(tenant),
              matchedVia: "oauth_account",
              matchedKey: ownerHit.matchedKey,
            };
          }
        }

        // Stage 3: contact-in-someone's-address-book.
        // Pass a DID lister so the resolver can fall back to a per-tenant
        // scan if the collectionGroup index hasn't been provisioned yet.
        const contactHit = await findContactByEmailAcrossTenants(email, {
          listAllTenantDids: async () => {
            // Was Privy's listAllUsers(); the tenant list has been Cloud SQL
            // since the tenant index moved (see lib/auth-session.js).
            return tenantIndex.getAll().map((t) => t?.did).filter(Boolean);
          },
        });
        if (contactHit?.did && contactHit?.contact) {
          const c = contactHit.contact;
          return {
            found: true,
            kind: "contact",
            did: contactHit.did,
            contactId: c.id,
            contact: {
              id: c.id,
              name: c.name,
              firstName: c.firstName ?? null,
              lastName: c.lastName ?? null,
              phoneNumbers: c.phoneNumbers ?? [],
              emails: c.emails ?? [],
              relationshipScore: c.relationshipScore ?? 0,
              source: c.source ?? null,
            },
            matchedVia: "tenant_contact",
          };
        }

        return { found: false };
      } catch (err) {
        request.log.error(err, "Failed to resolve contact by email");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /internal/users/:userId/contacts/by-name?name=<string>
   *
   * Resolve a contact in this tenant's address book by name (case-
   * insensitive, first-name OR full-name match). Returns the most-
   * recently-updated row on ambiguous matches and a `matches` array
   * with the full set so callers can disambiguate when they need to.
   *
   * Used by the agent's update_contact_context tool — Sagar says
   * "Shirley shipped X" and the tool needs to find Shirley's contact ID
   * to write the context update.
   */
  app.get(
    "/internal/users/:userId/contacts/by-name",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const name = request.query?.name;
      if (!name || typeof name !== "string") {
        return reply
          .code(400)
          .send({ error: "missing_name", message: "?name=<string> required" });
      }

      const user = await getUserByPrivyDid(userId);
      if (!user) return reply.code(404).send({ error: "user_not_found" });

      const amberIdByName = await resolveAmberIdByPrivyDid(userId);
      const matches = amberIdByName
        ? await getContactsByName(amberIdByName, name)
        : [];
      if (matches.length === 0) {
        return reply.code(404).send({
          error: "contact_not_found",
          message: "No contact with this name in the tenant address book.",
        });
      }

      const best = amberIdByName
        ? await findContactByName(amberIdByName, name)
        : null;
      return {
        userId,
        contact: best
          ? {
              id: best.id,
              name: best.name,
              firstName: best.firstName ?? null,
              lastName: best.lastName ?? null,
              company: best.company ?? null,
              title: best.title ?? null,
              source: best.source ?? null,
              context: best.context ?? null,
              relationship: best.relationship ?? null,
            }
          : null,
        matches: matches.map((m) => ({
          id: m.id,
          name: m.name,
          firstName: m.firstName ?? null,
          lastName: m.lastName ?? null,
          company: m.company ?? null,
          source: m.source ?? null,
        })),
      };
    },
  );

  /**
   * POST /internal/users/:userId/contacts/import
   *
   * Bulk-import contacts into a tenant's address book (e.g. a parsed Apple
   * Contacts .vcf). Idempotent: each contact upserts on its externalId, so a
   * re-run merges instead of duplicating. When `index` !== false, each saved
   * contact is embedded into the tenant's Pinecone namespace so the relationship
   * graph is semantically searchable. Send in chunks (~100) to keep the call
   * bounded.
   *
   * Body: { contacts: [{ name, firstName?, lastName?, phoneNumbers?, emails?,
   *         company?, title?, notes?, externalId? }], index?: boolean }
   */
  app.post(
    "/internal/users/:userId/contacts/import",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const body = request.body || {};
      const contacts = Array.isArray(body.contacts) ? body.contacts : null;
      if (!contacts || contacts.length === 0) {
        return reply
          .code(400)
          .send({ error: "missing_contacts", message: "contacts[] required" });
      }
      if (contacts.length > 500) {
        return reply.code(400).send({
          error: "too_many",
          message: "Send at most 500 contacts per call.",
        });
      }
      const doIndex = body.index !== false;

      const amberIdImport = await resolveAmberIdByPrivyDid(userId);
      if (!amberIdImport) {
        return {
          userId,
          imported: 0,
          indexed: 0,
          failed: 0,
          received: contacts.length,
          indexReasons: { privy_did_not_linked: contacts.length },
        };
      }

      let imported = 0;
      let indexed = 0;
      let failed = 0;
      const saved = [];
      for (const c of contacts) {
        if (!c || !c.name) {
          failed++;
          continue;
        }
        try {
          const row = await upsertContact(amberIdImport, c);
          if (row) {
            imported++;
            saved.push(row);
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          request.log?.warn(
            { err: err?.message, name: c.name },
            "[contacts-import] upsert failed",
          );
        }
      }

      // Index to Pinecone with bounded concurrency so a 100-contact chunk
      // doesn't fan out 100 simultaneous embedding calls.
      const indexReasons = {};
      if (doIndex && saved.length) {
        const CONC = 24;
        for (let i = 0; i < saved.length; i += CONC) {
          const slice = saved.slice(i, i + CONC);
          const results = await Promise.all(
            slice.map((row) =>
              Promise.resolve({ indexed: false, reason: "external_index_removed" })
                .then((r) => {
                  if (r && r.indexed) return 1;
                  const reason = (r && r.reason) || "unknown";
                  indexReasons[reason] = (indexReasons[reason] || 0) + 1;
                  if (r?.message && !indexReasons[`msg:${r.message}`]) {
                    indexReasons[`msg:${String(r.message).slice(0, 120)}`] = 1;
                  }
                  return 0;
                })
                .catch((e) => {
                  const key = `threw:${String(e?.message || e).slice(0, 120)}`;
                  indexReasons[key] = (indexReasons[key] || 0) + 1;
                  return 0;
                }),
            ),
          );
          indexed += results.reduce((a, b) => a + b, 0);
        }
      }

      return {
        userId,
        imported,
        indexed,
        failed,
        received: contacts.length,
        indexReasons,
      };
    },
  );

  /**
   * Shared matcher for the Clay-facing contact match (GET query + POST body).
   * Accepts { q, phone, email, name } — `q` is auto-routed to phone/email/name.
   * Criteria combine as a UNION (a contact matching ANY criterion is returned),
   * which is what "is this person in my graph?" wants. Returns the full contact
   * records (all fields incl the relationship graph).
   */
  async function resolveContactMatches(amberId, criteria = {}) {
    const q = criteria.q ? String(criteria.q).trim() : null;
    let phone = criteria.phone ? String(criteria.phone).trim() : null;
    let email = criteria.email
      ? String(criteria.email).trim().toLowerCase()
      : null;
    let name = criteria.name ? String(criteria.name).trim() : null;
    if (q) {
      if (q.includes("@")) email = q.toLowerCase();
      else if (/^[+(]?[\d][\d()\s.-]{5,}$/.test(q)) phone = q;
      else name = q;
    }
    if (!phone && !email && !name) return { error: "missing_query" };
    if (!amberId) return { matched: false, count: 0, matches: [] };

    const byId = new Map();
    const add = (c) => {
      if (c && c.id && !byId.has(c.id)) byId.set(c.id, c);
    };
    if (phone) {
      const c = await findContactByPhone(amberId, phone).catch(() => null);
      add(c);
    }
    if (name) {
      const list = await getContactsByName(amberId, name).catch(() => []);
      for (const c of list) add(c);
    }
    if (email) {
      const all = await listContacts(amberId).catch(() => []);
      for (const c of all) {
        const emails = (c.emails || []).map((e) =>
          String(e).trim().toLowerCase(),
        );
        if (emails.includes(email)) add(c);
      }
    }
    const matches = Array.from(byId.values());
    return { matched: matches.length > 0, count: matches.length, matches };
  }

  /**
   * GET  /internal/users/:userId/contacts/match?q=  (or ?phone= ?email= ?name=)
   * POST /internal/users/:userId/contacts/match   body { q | phone | email | name }
   *
   * Clay-facing match. Pass a single `q` (name/email/phone, auto-detected) or any
   * combination of explicit phone/email/name. Returns EVERY matching contact as a
   * full record array (all stored fields incl the relationship graph). Service
   * key auth. GET uses query params (no body); POST uses a JSON body.
   */
  const handleMatch = async (request, reply) => {
    const userId = String(request.params.userId);
    const uidErr = validateUserId(userId);
    if (uidErr) return reply.code(400).send({ error: uidErr });
    const src =
      request.method === "POST" ? request.body || {} : request.query || {};
    const amberIdMatch = await resolveAmberIdByPrivyDid(userId);
    const result = await resolveContactMatches(amberIdMatch, src);
    if (result.error === "missing_query") {
      return reply.code(400).send({
        error: "missing_query",
        message:
          "Provide q (name, email, or phone) or any of phone/email/name — as ?query for GET or JSON body for POST.",
      });
    }
    return { userId, ...result };
  };

  app.get(
    "/internal/users/:userId/contacts/match",
    { preHandler: [requireApiKey] },
    handleMatch,
  );
  app.post(
    "/internal/users/:userId/contacts/match",
    { preHandler: [requireApiKey] },
    handleMatch,
  );

  /**
   * POST /internal/users/:userId/people-rank   body { query?, limit? }
   *
   * Service-key, DID-scoped PeopleRank via the live togari-search engine over
   * the user's own contacts. HARD FAILS (503) if the engine is off/down — no
   * local fallback. Used by the Medha agent tool and any service caller; the
   * iOS app uses the Privy-authed /v1/me/people-rank instead.
   */
  app.post(
    "/internal/users/:userId/people-rank",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const body = request.body || {};
      const amberIdRank = await resolveAmberIdByPrivyDid(userId);
      const r = await rankDidViaTogari(
        userId, // kept for getProfile(did) → Firestore
        { query: body.query, limit: body.limit },
        {
          listContactsForRanking: async () =>
            amberIdRank ? listContacts(amberIdRank) : [],
        },
      );
      if (!r.ok) {
        if (r.error === "no_contacts") {
          return reply.code(404).send({
            error: "no_contacts",
            message: "No contacts on file for this user.",
          });
        }
        return reply.code(503).send({
          error: r.error,
          engine: "togari-search",
          message:
            "PeopleRank engine is unavailable. Not falling back to local scoring.",
        });
      }
      return r.result;
    },
  );

  /**
   * PATCH /internal/users/:userId/contacts/:contactId/context
   *
   * Update the longform `context` field on a single contact. Mode is
   * `replace` (default) or `append`; append stamps an ISO timestamp and
   * concatenates to the existing context with a blank-line separator.
   *
   * Re-embeds the contact into Pinecone fire-and-forget so semantic
   * search picks up the new context within the next vector refresh
   * cycle. Failures from the embed are logged, never thrown.
   */
  app.patch(
    "/internal/users/:userId/contacts/:contactId/context",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", maxLength: 32000 },
            mode: { type: "string", enum: ["replace", "append"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const contactId = String(request.params.contactId);
      if (!contactId) {
        return reply.code(400).send({ error: "missing_contact_id" });
      }

      const amberIdCtx = await resolveAmberIdByPrivyDid(userId);
      if (!amberIdCtx) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const { text, mode } = request.body || {};
      const updated = await updateContactContext(amberIdCtx, contactId, text, {
        mode: mode || "replace",
      });
      if (!updated) {
        return reply.code(404).send({ error: "contact_not_found" });
      }


      return {
        userId,
        contact: {
          id: updated.id,
          name: updated.name,
          context: updated.context ?? null,
          updatedAt: updated.updatedAt ?? null,
        },
      };
    },
  );

  /**
   * PATCH /internal/users/:userId/contacts/:contactId/relationship
   *
   * Merge structured relationship fields (PRD §6 relationship graph) onto a
   * contact's `relationship` map: emotionalTone, trustLevel, closeness,
   * energyType, tension, boundaries, nextAction, privacyLevel,
   * shareableWithTogari, etc. Idempotent merge — send only changed fields.
   */
  app.patch(
    "/internal/users/:userId/contacts/:contactId/relationship",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
          properties: {
            category: { type: "string" },
            howWeMet: { type: "string" },
            emotionalTone: { type: "string" },
            trustLevel: { type: "number", minimum: 0, maximum: 1 },
            closeness: { type: "number", minimum: 0, maximum: 1 },
            energyType: { type: "string" },
            tension: { type: "string" },
            boundaries: { type: "string" },
            appreciates: { type: "string" },
            avoids: { type: "string" },
            positiveHistory: { type: "string" },
            importantMemories: { type: "string" },
            lastMeaningfulInteraction: { type: "string" },
            nextAction: { type: "string" },
            privacyLevel: {
              type: "string",
              enum: ["normal", "private", "sensitive"],
            },
            shareableWithTogari: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const userId = String(request.params.userId);
      const uidErr = validateUserId(userId);
      if (uidErr) return reply.code(400).send({ error: uidErr });

      const contactId = String(request.params.contactId);
      if (!contactId) {
        return reply.code(400).send({ error: "missing_contact_id" });
      }

      const amberIdRel = await resolveAmberIdByPrivyDid(userId);
      if (!amberIdRel) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const updated = await updateContactRelationship(
        amberIdRel,
        contactId,
        request.body || {},
      );
      if (!updated) {
        return reply.code(404).send({ error: "contact_not_found" });
      }


      return {
        userId,
        contact: {
          id: updated.id,
          name: updated.name,
          relationship: updated.relationship ?? null,
          context: updated.context ?? null,
          updatedAt: updated.updatedAt ?? null,
        },
      };
    },
  );
}
