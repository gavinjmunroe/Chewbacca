/**
 * Per-user personal API keys + Clay-style contact ingest.
 *
 * Two audiences, two auth models:
 *
 *  1. KEY MANAGEMENT (app-facing, JWT via requireAuth). The signed-in user mints
 *     / lists / revokes their own long-lived ingest keys:
 *       POST   /v1/me/api-keys     → create/rotate (returns the raw key ONCE)
 *       GET    /v1/me/api-keys     → list metadata (id, prefix, last4, timestamps)
 *       DELETE /v1/me/api-keys/:id → revoke
 *     Every key is bound to the caller's amber_id (resolved from the session
 *     phone — the SAME owner id the contact tables use).
 *
 *  2. INGEST (machine-facing, API-key auth). Clay (or any client) pushes contacts
 *     with the key it was given:
 *       POST /v1/ingest/contacts   (Authorization: Bearer <key>  OR
 *                                   x-amber-api-key: <key>)
 *     The key resolves to exactly one owner; every contact is written under that
 *     owner via the EXISTING app-sync upsert (upsertContactsForOwner →
 *     normalizeIncomingContact + synthesizeExternalId), so an ingested contact
 *     gets the identical full schema + dedupe as an app-synced one, and is fed to
 *     the same embedding path so it is immediately searchable / rankable.
 *
 * ISOLATION: no client-supplied owner id is ever trusted. The owner is derived
 * solely from the authenticated identity (JWT phone → amber_id for management;
 * verified key → owner_id for ingest), so a cross-tenant write is impossible.
 */

import { isReviewPhone } from "../lib/review-account.js";
import { requireAuth } from "../lib/auth-session.js";
import {
  issueUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  verifyUserApiKey,
} from "../db/user-api-keys-store.js";
import {
  resolveAmberIdByPhone,
  getUserPhoneByAmberId,
  upsertContactsForOwner,
  getContactIdsByExternalIds,
  getContactByPhone,
  updateContactFields,
  getFactsForContact,
} from "../db/store.js";
import { normalizeIncomingContact } from "./profile.js";
import { reembedContactSoon } from "../lib/contact-vectors.js";

// Cap per request so a single call can't pin a connection or blow the pool.
const MAX_CONTACTS_PER_REQUEST = 500;
// Generous body limit — 500 rich contacts still fit comfortably (global is 1 MB).
const INGEST_BODY_LIMIT = 4 * 1024 * 1024; // 4 MB

function _str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function _asArray(v) {
  if (Array.isArray(v)) return v.map((x) => _str(x)).filter(Boolean);
  const s = _str(v);
  return s ? [s] : [];
}

// First-class fields mapped to real columns; anything else the client sends is
// folded into the contact's notes so nothing is silently dropped.
const KNOWN_INGEST_FIELDS = new Set([
  "name", "firstName", "first_name", "lastName", "last_name",
  "phone", "phoneNumbers", "phones", "email", "emails",
  "company", "organization", "title", "linkedinUrl", "linkedin_url",
  "location", "city", "notes", "source", "externalId", "id",
]);

/**
 * Map ONE inbound Clay/API contact object onto the server contact shape that
 * normalizeIncomingContact expects, and collect the "extras" (title, location,
 * notes, linkedinUrl, and any unrecognized fields) written to columns / notes
 * AFTER the upsert. Returns { normalized, externalId, phonePrimary, extras } or
 * null when there is no usable name (mirrors the app-sync skip rule).
 */
function prepareIngestContact(raw, defaultSource) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const firstName = _str(raw.firstName ?? raw.first_name);
  const lastName = _str(raw.lastName ?? raw.last_name);
  let name = _str(raw.name);
  if (!name && (firstName || lastName)) {
    name = [firstName, lastName].filter(Boolean).join(" ");
  }
  if (!name) return null; // no usable name → skip (same rule as /v1/me/contacts)

  const phoneNumbers = _asArray(raw.phoneNumbers ?? raw.phones ?? raw.phone);
  const emails = _asArray(raw.emails ?? raw.email);
  const company = _str(raw.company ?? raw.organization);
  const source = _str(raw.source) || defaultSource;

  const serverShape = {
    name,
    firstName: firstName ?? null,
    lastName: lastName ?? null,
    phoneNumbers,
    emails,
    company,
    source,
  };
  const explicitExternalId = _str(raw.externalId ?? raw.id);
  if (explicitExternalId) serverShape.externalId = explicitExternalId;

  // Reuse the app-sync normalizer: derives a stable external_id when none was
  // supplied (so re-ingesting the same contact upserts in place, not duplicates).
  const normalized = normalizeIncomingContact(serverShape);
  if (!normalized) return null;

  // Extras written to dedicated columns / notes after the upsert.
  const title = _str(raw.title);
  const location = _str(raw.location ?? raw.city);
  const linkedinUrl = _str(raw.linkedinUrl ?? raw.linkedin_url);
  const notes = _str(raw.notes);

  const extraLines = [];
  if (linkedinUrl) extraLines.push(`LinkedIn: ${linkedinUrl}`);
  for (const [k, v] of Object.entries(raw)) {
    if (KNOWN_INGEST_FIELDS.has(k)) continue;
    const sv =
      typeof v === "string" ? v.trim() : v == null ? "" : JSON.stringify(v);
    if (sv) extraLines.push(`${k}: ${sv}`);
  }
  const notesText =
    [notes, extraLines.join("\n")].filter(Boolean).join("\n") || null;

  const extras = {};
  if (title !== null) extras.title = title;
  if (location !== null) extras.city = location;
  if (notesText !== null) extras.notes = notesText;

  return {
    normalized,
    externalId: normalized.externalId,
    phonePrimary: phoneNumbers[0] || null,
    extras,
  };
}

/**
 * preHandler: authenticate the ingest request by personal API key. Accepts the
 * key via `Authorization: Bearer <key>` or `x-amber-api-key: <key>`, verifies it
 * (constant-time, revocation-aware), and stashes the resolved owner on the
 * request. Never trusts any owner id from the body/query.
 */
async function ingestAuth(request, reply) {
  let headerKey = _str(request.headers["x-amber-api-key"]);
  if (!headerKey) {
    const auth = request.headers["authorization"];
    const a = Array.isArray(auth) ? auth[0] : auth;
    if (typeof a === "string" && a.toLowerCase().startsWith("bearer ")) {
      headerKey = a.slice(7).trim();
    }
  }

  if (!headerKey) {
    return reply.code(401).send({
      error: "missing_api_key",
      message:
        "Provide your key via 'Authorization: Bearer <key>' or 'x-amber-api-key: <key>'.",
    });
  }

  const ctx = await verifyUserApiKey(headerKey);
  if (!ctx) {
    return reply
      .code(401)
      .send({ error: "invalid_api_key", message: "Invalid or revoked API key." });
  }
  request.ingestOwnerId = ctx.ownerId;
  request.ingestKeyId = ctx.keyId;
}

export function registerUserApiKeyRoutes(app) {
  // ── Key management (JWT-authed) ───────────────────────────────────────────

  /**
   * POST /v1/me/api-keys  — create/rotate. Returns the raw key ONCE.
   * Body: { name?: string }
   */
  app.post(
    "/v1/me/api-keys",
    { preHandler: [requireAuth], config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) return reply.code(400).send({ error: "no_phone_on_session" });
      const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!ownerId)
        return reply.code(500).send({ error: "could_not_resolve_owner" });

      const purpose = request.body?.purpose ?? "ingest";
      if (!["ingest", "mcp"].includes(purpose)) return reply.code(400).send({ error: "invalid_key_purpose" });
      // The temporary Apple reviewer cannot create a credential that outlives review.
      if (isReviewPhone(phone)) return reply.code(403).send({ error: "review_key_creation_disabled" });
      const name = _str(request.body?.name);
      const issued = await issueUserApiKey(ownerId, name, purpose);
      if (!issued) return reply.code(500).send({ error: "issue_failed" });

      return reply.header("Cache-Control", "no-store").code(201).send({
        ok: true,
        purpose: issued.purpose,
        id: issued.id,
        key: issued.key, // shown ONCE — store it now
        prefix: issued.prefix,
        last4: issued.last4,
        name: issued.name,
        createdAt: issued.createdAt,
      });
    },
  );

  /** GET /v1/me/api-keys — list metadata (never the raw key). */
  app.get(
    "/v1/me/api-keys",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) return reply.code(400).send({ error: "no_phone_on_session" });
      const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!ownerId) return { keys: [] };
      const keys = await listUserApiKeys(ownerId);
      return { keys };
    },
  );

  /** DELETE /v1/me/api-keys/:id — revoke one of the caller's own keys. */
  app.delete(
    "/v1/me/api-keys/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) return reply.code(400).send({ error: "no_phone_on_session" });
      const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!ownerId)
        return reply.code(500).send({ error: "could_not_resolve_owner" });

      const keyId = _str(request.params?.id);
      if (!keyId) return reply.code(400).send({ error: "missing_key_id" });

      const revoked = await revokeUserApiKey(ownerId, keyId);
      if (!revoked) return reply.code(404).send({ error: "key_not_found" });
      return { ok: true, revoked: true, id: keyId };
    },
  );

  // ── Ingest (API-key authed) ───────────────────────────────────────────────

  /**
   * POST /v1/ingest/contacts
   * Auth: personal API key (Bearer or x-amber-api-key).
   * Body: a single contact object OR { contacts: [ ... ] }.
   * Fields (all optional except a usable name): name | firstName+lastName,
   *   phone | phoneNumbers, email | emails, company, title, linkedinUrl,
   *   location, notes, source. Unknown fields are folded into notes.
   * Returns { ok, created, updated, skipped, contactIds }.
   */
  app.post(
    "/v1/ingest/contacts",
    {
      preHandler: [ingestAuth],
      bodyLimit: INGEST_BODY_LIMIT,
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          // Bucket per presented key (falls back to IP) so one owner's traffic
          // never rate-limits another's.
          keyGenerator: (req) =>
            (typeof req.headers["x-amber-api-key"] === "string" &&
              req.headers["x-amber-api-key"]) ||
            (typeof req.headers["authorization"] === "string" &&
              req.headers["authorization"]) ||
            req.ip,
        },
      },
    },
    async (request, reply) => {
      const ownerId = request.ingestOwnerId;
      if (!ownerId) return reply.code(401).send({ error: "unauthorized" });

      // Accept a single contact object OR { contacts: [...] }.
      const body = request.body;
      let incoming;
      if (body && Array.isArray(body.contacts)) incoming = body.contacts;
      else if (body && typeof body === "object" && !Array.isArray(body))
        incoming = [body];
      else incoming = null;

      if (!Array.isArray(incoming) || incoming.length === 0) {
        return reply.code(400).send({
          error: "bad_request",
          message: "Send a contact object, or { contacts: [...] }.",
        });
      }
      if (incoming.length > MAX_CONTACTS_PER_REQUEST) {
        return reply.code(413).send({
          error: "too_many_contacts",
          message: `At most ${MAX_CONTACTS_PER_REQUEST} contacts per request.`,
        });
      }

      const defaultSource = _str(body.source) || "clay";

      const prepared = [];
      let skipped = 0;
      for (const raw of incoming) {
        const p = prepareIngestContact(raw, defaultSource);
        if (!p) {
          skipped += 1; // no usable name → skipped (not an error)
          continue;
        }
        prepared.push(p);
      }

      if (prepared.length === 0) {
        return { ok: true, created: 0, updated: 0, skipped, contactIds: [] };
      }

      // Owner phone is the iMessage-pipeline index key; resolved from the owner,
      // never from the client.
      const ownerPhone = await getUserPhoneByAmberId(ownerId).catch(() => null);

      // Identical write path + dedupe as the app's own contact sync.
      const result = await upsertContactsForOwner({
        ownerId,
        ownerPhone,
        contacts: prepared.map((p) => p.normalized),
      });

      // SAME DERIVATION AS THE APPLE SYNC, FOR THE SAME REASON.
      //
      // contact_tags / area_code / area_metro are what the labeled and implied
      // retrieval layers read. They were derived on the Apple route only, so
      // contacts arriving through this route -- CSV imports, amber-chrome,
      // LinkedIn -- were invisible to "who do I know that goes to USC" and "do
      // I know anyone in New York" no matter what their names said.
      //
      // After the upsert, not inside it: upsertContactsForOwner runs once per
      // chunk and this reads the whole book. Never fails an ingest that landed.
      try {
        const { retagAddressBook } = await import("../db/address-book-store.js");
        await retagAddressBook(ownerId);
      } catch (err) {
        request.log?.warn?.({ err: err?.message }, "[ingest] label derivation failed");
      }

      // Resolve the written rows' ids: primary by deterministic external_id,
      // fallback by phone (covers rows the dedupe merged into an existing person).
      const idMap = await getContactIdsByExternalIds(
        ownerId,
        prepared.map((p) => p.externalId),
      ).catch(() => ({}));

      const contactIds = [];
      for (const p of prepared) {
        let id = idMap[String(p.externalId)] ?? null;
        if (!id && p.phonePrimary) {
          const hit = await getContactByPhone(ownerId, p.phonePrimary).catch(
            () => null,
          );
          if (hit?.id != null) id = String(hit.id);
        }
        if (!id) continue;
        contactIds.push(id);

        // Extra columns (title / city / notes) via the existing owner-scoped
        // writer. upsertContactsForOwner does not carry these, so apply them here.
        if (Object.keys(p.extras).length > 0) {
          await updateContactFields({ ownerId, contactId: id, ...p.extras }).catch(
            () => null,
          );
        }
        // Same downstream as the rest of the app: make it searchable / rankable.
        reembedContactSoon(ownerId, id, () => getFactsForContact(ownerId, id));
      }

      const created = Number(result?.inserted) || 0;
      const updated = (Number(result?.updated) || 0) + (Number(result?.merged) || 0);
      const failed = Number(result?.failed) || 0;

      return {
        ok: true,
        created,
        updated,
        skipped: skipped + failed,
        contactIds,
      };
    },
  );
}
