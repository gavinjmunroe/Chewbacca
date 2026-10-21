/**
 * /v1/personal/* — Medha's "canvas" surface.
 *
 * Three first-class object kinds (see ../db/personal-life.js for storage):
 *
 *   brand_decision    long-lived branding calls (e.g. "rytual newsletter = the rave")
 *   teammate_pursuit  what Shirley / Alinna / Emily are working on personally
 *   journal_entry     freeform yapping about creative conversations
 *
 * All routes require either a Privy JWT (user-scoped) or a service x-api-key
 * (paired with x-amber-phone so the agent can write on the owner's behalf).
 * Tenant DID always comes from the verified principal; body-level userId
 * fields are rejected with principal_mismatch so a stolen JWT can't be used
 * to write into someone else's namespace.
 *
 * Pinecone indexing is best-effort and lives behind ../knowledge/personal-life-index.js
 * so the routes stay healthy even when Tab 7's pinecone-client has not
 * landed yet.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import * as firestoreDefaults from "../db/agent-data.js";
import { extractClaimedDid } from "../lib/claimed-did.js";
import {
  BRAND_DECISIONS_TABLE,
  TEAMMATE_PURSUITS_TABLE,
  JOURNAL_ENTRIES_TABLE,
  AUTHOR_VOICES_TABLE,
  BRANDS,
  PURSUIT_KINDS,
  PURSUIT_STATUSES,
  DIMENSIONS,
  AUTHOR_ORGS,
  normalizeBrandDecision,
  normalizeTeammatePursuit,
  normalizeJournalEntry,
  normalizeAuthorVoice,
  upsertBrandDecision,
  upsertTeammatePursuit,
  upsertJournalEntry,
  upsertAuthorVoice,
  listBrandDecisions,
  listTeammatePursuits,
  listJournalEntries,
  listAllForSearch,
  listTeammatePursuitsBySlugs,
  listRecentJournalEntries,
  listAuthorVoices,
  getAuthorVoice,
  deleteAuthorVoice,
  slugifyForId,
} from "../db/personal-life.js";
import { listContacts as defaultListContacts } from "../db/user-store.js";
import {
  resolveAmberIdByPhone as defaultResolveAmberIdByPhone,
  resolveAmberIdByPrivyDid as defaultResolveAmberIdByPrivyDid,
} from "../db/store.js";
import { filterEntriesMentioningContact } from "../lib/person-mentions.js";
// THE EXTERNAL INDEX IS GONE. These were best-effort writes and reads against a
// separate vector service that held a second copy of this data. Observations
// carry their own pgvector embedding and retrieval.js searches it in-database, so
// the second copy was the sprawl this rebuild removed. The dependency-injection
// seams stay so tests and any future in-database indexer can slot straight in;
// the defaults now do nothing and say so.
const _noIndex = async () => ({ indexed: false, reason: "external_index_removed" });
const _noSearch = async () => [];
const defaultIndexRow = _noIndex;
const defaultSearchPersonalLife = _noSearch;
const defaultIndexAuthorVoice = _noIndex;
const defaultSearchAuthorVoices = _noSearch;
const defaultDeleteAuthorVoiceVector = _noIndex;

/**
 * Verify caller identity and return the principal DID. Mirrors the
 * resolvePrincipal helper in events.js so personal-life routes behave the
 * same way under either Privy JWT auth or service x-api-key + x-amber-phone.
 */
async function resolvePrincipal(request, reply, tenantIndex) {
  let privyDid = request.privyUser?.userId;
  const rawHeaderPhone = request.headers["x-amber-phone"];
  const headerPhone = Array.isArray(rawHeaderPhone)
    ? rawHeaderPhone[0]
    : rawHeaderPhone;

  if (!privyDid && request.serviceAuth) {
    if (!headerPhone) {
      reply.code(400).send({
        error: "x-amber-phone header required when using service auth",
        code: "missing_phone_header",
      });
      return null;
    }
    const phoneErr = validatePhone(headerPhone);
    if (phoneErr) {
      reply.code(400).send({
        error: "invalid_phone_header",
        code: "invalid_phone",
        message: phoneErr,
      });
      return null;
    }
    const tenant = tenantIndex.getByPhone(headerPhone);
    if (!tenant) {
      reply.code(404).send({
        error: `No tenant found for phone ${headerPhone}`,
        code: "tenant_not_found",
      });
      return null;
    }
    privyDid = tenant.id || tenant.privyUserId;
  } else if (privyDid && headerPhone) {
    const phoneTenant = tenantIndex.getByPhone(headerPhone);
    const phoneDid = phoneTenant?.id || phoneTenant?.privyUserId || null;
    if (phoneDid && phoneDid !== privyDid) {
      reply.code(403).send({
        error: "principal_mismatch",
        message:
          "x-amber-phone header resolves to a different DID than the bearer token",
      });
      return null;
    }
  }

  if (!privyDid) {
    reply.code(401).send({ error: "auth_required" });
    return null;
  }

  const claimedDid = extractClaimedDid(request.body);
  if (claimedDid && claimedDid !== privyDid) {
    reply.code(403).send({
      error: "principal_mismatch",
      message: "Body userId/did does not match the authenticated principal",
    });
    return null;
  }

  return { privyDid };
}

function sendValidationError(reply, err) {
  return reply.code(err.statusCode || 400).send({
    error: err.code || "validation_failed",
    message: err.message || "validation failed",
  });
}

const brandDecisionSchema = {
  type: "object",
  required: ["brand", "key", "value"],
  properties: {
    brand: { type: "string", enum: BRANDS },
    key: { type: "string", minLength: 1, maxLength: 80 },
    value: { type: "string", minLength: 1, maxLength: 2000 },
    rationale: { type: "string", maxLength: 4000 },
    decided_at: { type: "string", maxLength: 64 },
    decided_with: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 20,
    },
  },
  additionalProperties: false,
};

const teammatePursuitSchema = {
  type: "object",
  required: ["teammate_name", "pursuit_name"],
  properties: {
    teammate_name: { type: "string", minLength: 1, maxLength: 120 },
    contact_handle: { type: "string", maxLength: 120 },
    pursuit_name: { type: "string", minLength: 1, maxLength: 200 },
    kind: { type: "string", enum: PURSUIT_KINDS },
    status: { type: "string", enum: PURSUIT_STATUSES },
    notes: { type: "string", maxLength: 4000 },
    last_mentioned_at: { type: "string", maxLength: 64 },
  },
  additionalProperties: false,
};

const journalEntrySchema = {
  type: "object",
  required: ["topic", "body"],
  properties: {
    topic: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", minLength: 1, maxLength: 16000 },
    written_at: { type: "string", maxLength: 64 },
    with: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 20,
    },
    dimension: { type: "string", enum: DIMENSIONS },
  },
  additionalProperties: false,
};

const searchSchema = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 2000 },
    kind: {
      type: "string",
      enum: ["brand_decision", "teammate_pursuit", "journal_entry"],
    },
    topK: { type: "integer", minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
};

const authorVoiceSchema = {
  type: "object",
  required: ["display_name"],
  properties: {
    author_slug: { type: "string", minLength: 1, maxLength: 80 },
    display_name: { type: "string", minLength: 1, maxLength: 120 },
    role_at_org: { type: "string", maxLength: 200 },
    org: { type: "string", enum: AUTHOR_ORGS },
    voice_tells: {
      type: "object",
      properties: {
        sentence_rhythm: { type: "string", maxLength: 1000 },
        vocabulary_tells: { type: "string", maxLength: 1000 },
        opener_patterns: { type: "string", maxLength: 1000 },
        closer_patterns: { type: "string", maxLength: 1000 },
        signature_phrases: {
          type: "array",
          items: { type: "string", maxLength: 120 },
          maxItems: 40,
        },
        jargon_blacklist: {
          type: "array",
          items: { type: "string", maxLength: 120 },
          maxItems: 40,
        },
      },
      additionalProperties: false,
    },
    what_they_dont_say: {
      type: "array",
      items: { type: "string", maxLength: 200 },
      maxItems: 40,
    },
    sample_pieces: {
      type: "array",
      items: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          url: { type: "string", maxLength: 500 },
          body: { type: "string", maxLength: 16000 },
        },
        additionalProperties: false,
      },
      maxItems: 10,
    },
    substack_handle: { type: "string", maxLength: 120 },
    linkedin_handle: { type: "string", maxLength: 120 },
  },
  additionalProperties: false,
};

const recallPersonSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    lookback_days: { type: "integer", minimum: 1, maximum: 3650 },
    journal_limit: { type: "integer", minimum: 1, maximum: 50 },
    pursuit_limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
};

/**
 * Fire-and-forget Pinecone indexing. Logged on failure so an outage of the
 * vector store doesn't fail the write path, but is still observable.
 */
function indexAsync(indexRow, app, privyDid, row) {
  indexRow(privyDid, row)
    .then((result) => {
      if (
        !result?.indexed &&
        result?.reason &&
        result.reason !== "pinecone_unavailable"
      ) {
        app.log.warn(
          { reason: result.reason, kind: row.kind, id: row.id },
          "[personal-life] pinecone index did not complete",
        );
      }
    })
    .catch((err) => {
      app.log.warn(
        { err: err?.message, kind: row.kind, id: row.id },
        "[personal-life] pinecone index threw",
      );
    });
}

/**
 * Register all /v1/personal/* routes. `deps` lets tests inject in-memory
 * stand-ins for the Firestore helpers, the auth pre-handler, the
 * Pinecone indexer, and the tenantIndex.
 */
export function registerPersonalLifeRoutes(app, deps = {}) {
  const agentDataGet = deps.agentDataGet || firestoreDefaults.agentDataGet;
  const agentDataUpsert =
    deps.agentDataUpsert || firestoreDefaults.agentDataUpsert;
  const agentDataQuery =
    deps.agentDataQuery || firestoreDefaults.agentDataQuery;
  const agentDataDelete =
    deps.agentDataDelete || firestoreDefaults.agentDataDelete;
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const indexPersonalLifeRow = deps.indexPersonalLifeRow || defaultIndexRow;
  const searchPersonalLife =
    deps.searchPersonalLife || defaultSearchPersonalLife;
  const indexAuthorVoice = deps.indexAuthorVoice || defaultIndexAuthorVoice;
  const searchAuthorVoices =
    deps.searchAuthorVoices || defaultSearchAuthorVoices;
  const deleteAuthorVoiceVector =
    deps.deleteAuthorVoiceVector || defaultDeleteAuthorVoiceVector;
  const listContacts = deps.listContacts || defaultListContacts;
  const resolveAmberIdByPhone =
    deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const resolveAmberIdByPrivyDid =
    deps.resolveAmberIdByPrivyDid || defaultResolveAmberIdByPrivyDid;
  const firestoreDeps = {
    agentDataGet,
    agentDataUpsert,
    agentDataQuery,
    agentDataDelete,
  };

  // ─── brand decisions ───────────────────────────────────────────────────

  app.post(
    "/v1/personal/brand-decision",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: brandDecisionSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      let row;
      try {
        row = normalizeBrandDecision(request.body, { privyDid: ctx.privyDid });
      } catch (err) {
        return sendValidationError(reply, err);
      }
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: BRAND_DECISIONS_TABLE,
        rowKey: row.id,
      });
      const stored = await upsertBrandDecision(
        ctx.privyDid,
        existing ? { ...existing, ...row } : row,
        firestoreDeps,
      );
      indexAsync(indexPersonalLifeRow, app, ctx.privyDid, stored);
      return reply
        .code(existing ? 200 : 201)
        .send({ ok: true, brand_decision: stored });
    },
  );

  app.get(
    "/v1/personal/brand-decision",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const brand = request.query?.brand
        ? String(request.query.brand).toLowerCase()
        : null;
      try {
        const rows = await listBrandDecisions(
          ctx.privyDid,
          { brand, limit: 200 },
          firestoreDeps,
        );
        return { ok: true, count: rows.length, brand_decisions: rows };
      } catch (err) {
        return sendValidationError(reply, err);
      }
    },
  );

  // ─── teammate pursuits ─────────────────────────────────────────────────

  app.post(
    "/v1/personal/teammate-pursuit",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: teammatePursuitSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      let row;
      try {
        row = normalizeTeammatePursuit(request.body, {
          privyDid: ctx.privyDid,
        });
      } catch (err) {
        return sendValidationError(reply, err);
      }
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: TEAMMATE_PURSUITS_TABLE,
        rowKey: row.id,
      });
      const stored = await upsertTeammatePursuit(
        ctx.privyDid,
        existing ? { ...existing, ...row } : row,
        firestoreDeps,
      );
      indexAsync(indexPersonalLifeRow, app, ctx.privyDid, stored);
      return reply
        .code(existing ? 200 : 201)
        .send({ ok: true, teammate_pursuit: stored });
    },
  );

  app.get(
    "/v1/personal/teammate-pursuit",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const teammate = request.query?.teammate
        ? String(request.query.teammate)
        : null;
      const status = request.query?.status
        ? String(request.query.status).toLowerCase()
        : null;
      try {
        const rows = await listTeammatePursuits(
          ctx.privyDid,
          { teammate, status, limit: 200 },
          firestoreDeps,
        );
        return { ok: true, count: rows.length, teammate_pursuits: rows };
      } catch (err) {
        return sendValidationError(reply, err);
      }
    },
  );

  // ─── journal entries ───────────────────────────────────────────────────

  app.post(
    "/v1/personal/journal",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: journalEntrySchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      let row;
      try {
        row = normalizeJournalEntry(request.body, { privyDid: ctx.privyDid });
      } catch (err) {
        return sendValidationError(reply, err);
      }
      const stored = await upsertJournalEntry(ctx.privyDid, row, firestoreDeps);
      indexAsync(indexPersonalLifeRow, app, ctx.privyDid, stored);
      return reply.code(201).send({ ok: true, journal_entry: stored });
    },
  );

  app.get(
    "/v1/personal/journal",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const withWhom = request.query?.with ? String(request.query.with) : null;
      const dimension = request.query?.dimension
        ? String(request.query.dimension).toLowerCase()
        : null;
      try {
        const rows = await listJournalEntries(
          ctx.privyDid,
          { withWhom, dimension, limit: 200 },
          firestoreDeps,
        );
        return { ok: true, count: rows.length, journal_entries: rows };
      } catch (err) {
        return sendValidationError(reply, err);
      }
    },
  );

  // ─── semantic search ───────────────────────────────────────────────────

  app.post(
    "/v1/personal/search",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: searchSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const { query, kind, topK = 12 } = request.body || {};
      const matches = await searchPersonalLife(ctx.privyDid, {
        query,
        kind,
        topK,
      });

      // Pinecone unavailable or no matches: fall back to a topical Firestore
      // listing so the caller still gets something useful instead of an
      // empty array. The fallback is clearly tagged.
      if (matches.length === 0) {
        const fallbackKinds = kind
          ? [kind]
          : ["brand_decision", "teammate_pursuit", "journal_entry"];
        const fallback = [];
        for (const k of fallbackKinds) {
          const rows = await listAllForSearch(ctx.privyDid, k, firestoreDeps);
          for (const row of rows.slice(0, topK)) {
            fallback.push({ kind: k, score: null, row });
          }
        }
        return {
          ok: true,
          source: "firestore_fallback",
          count: fallback.length,
          matches: fallback,
        };
      }

      return {
        ok: true,
        source: "pinecone",
        count: matches.length,
        matches,
      };
    },
  );

  // ─── recall person ─────────────────────────────────────────────────────
  //
  // Given a person's name, gather everything Medha knows on them:
  //   - matched contacts from the tenant's address book (firstName match)
  //   - their teammate_pursuits (so creative projects surface)
  //   - recent journal entries that mention them (live text-scan against
  //     body / topic / with array, so inline mentions still surface even
  //     when Sagar didn't tag the person in `with`)
  //
  // Honest empty response when nothing is on file — the agent uses that
  // signal to ask Sagar "I don't have anything yet, want to tell me what
  // they're working on?" instead of fabricating an answer.
  app.post(
    "/v1/personal/recall-person",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: recallPersonSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      const name = String(body.name || "").trim();
      const lookbackDays = body.lookback_days ?? 30;
      const journalLimit = body.journal_limit ?? 10;
      const pursuitLimit = body.pursuit_limit ?? 20;

      const nameSlug = slugifyForId(name);
      const firstToken = name.split(/\s+/)[0] || name;

      // Address-book match. We pull the full tenant contact list (bounded,
      // typically a few hundred rows) and filter by firstName / first
      // whitespace-token equality. Returning ALL near-matches lets the
      // caller disambiguate when two people share a first name.
      // TWO WAYS TO REACH THE OWNER, because the phone is not always there.
      // This used to resolve the owner from the phone ONLY, and returned an
      // empty contact list when there was no phone -- no error, no log, just
      // `found: false` for a person who is sitting in the address book. Any
      // principal without one hit that: a service/API-key caller, or an
      // Apple-only signup that never verified a number. The DID is always
      // present (resolvePrincipal guarantees it above), so it is the fallback.
      let allContacts = [];
      try {
        const rawPhone =
          request.privyUser?.phone ?? request.headers["x-amber-phone"];
        const headerPhone = Array.isArray(rawPhone) ? rawPhone[0] : rawPhone;
        let ownerId = headerPhone
          ? await resolveAmberIdByPhone(headerPhone).catch(() => null)
          : null;
        if (!ownerId && ctx.privyDid) {
          ownerId = await resolveAmberIdByPrivyDid(ctx.privyDid).catch(() => null);
        }
        if (ownerId) {
          allContacts = await listContacts(ownerId);
        } else {
          // Distinguishable in the log from "the address book is empty", which
          // is what this looked like from the outside for every phoneless caller.
          app.log.warn(
            { did: ctx.privyDid, hadPhone: Boolean(headerPhone) },
            "[personal-life] recall-person could not resolve an owner_id; " +
              "returning no contact matches",
          );
        }
      } catch (err) {
        app.log.warn(
          { err: err?.message, did: ctx.privyDid },
          "[personal-life] listContacts failed during recall-person",
        );
      }
      const needle = firstToken.toLowerCase();
      const matchedContacts = allContacts.filter((c) => {
        const fn = (c.firstName || "").toLowerCase();
        const headToken = (c.name || "").toLowerCase().split(/\s+/)[0] || "";
        return fn === needle || headToken === needle;
      });

      // teammate_pursuits — keyed by slug. Try every reasonable variant so
      // a contact stored as "Shirley Park" still matches an existing
      // pursuit row stored under teammate_slug "shirley".
      const slugCandidates = new Set([nameSlug, slugifyForId(firstToken)]);
      for (const c of matchedContacts) {
        if (c.name) slugCandidates.add(slugifyForId(c.name));
        if (c.firstName) slugCandidates.add(slugifyForId(c.firstName));
      }
      const slugList = [...slugCandidates].filter(Boolean);
      let pursuits = [];
      try {
        pursuits = await listTeammatePursuitsBySlugs(
          ctx.privyDid,
          slugList,
          { limit: pursuitLimit },
          firestoreDeps,
        );
      } catch (err) {
        app.log.warn(
          { err: err?.message, did: ctx.privyDid },
          "[personal-life] listTeammatePursuitsBySlugs failed",
        );
      }

      // Journal entries — pull a generous recent window, then run the
      // mention filter against the contact's first-name token so inline
      // body references count, not just explicit `with` tags.
      let recentEntries = [];
      try {
        recentEntries = await listRecentJournalEntries(
          ctx.privyDid,
          { limit: 500 },
          firestoreDeps,
        );
      } catch (err) {
        app.log.warn(
          { err: err?.message, did: ctx.privyDid },
          "[personal-life] listRecentJournalEntries failed",
        );
      }
      const scanContact = matchedContacts[0] || { firstName: firstToken };
      const journalEntries = filterEntriesMentioningContact(
        recentEntries,
        scanContact,
        { lookbackDays },
      ).slice(0, journalLimit);

      const found =
        matchedContacts.length > 0 ||
        pursuits.length > 0 ||
        journalEntries.length > 0;

      return {
        ok: true,
        found,
        query: { name, first_token: firstToken },
        matched_contacts: matchedContacts.map((c) => ({
          id: c.id,
          name: c.name,
          firstName: c.firstName || null,
          source: c.source || null,
          company: c.company || null,
          title: c.title || null,
        })),
        pursuits,
        journal_entries: journalEntries,
      };
    },
  );

  // ─── author voices ─────────────────────────────────────────────────────
  //
  // Per-tenant catalog of authors Medha can ghost-write for. Slug-keyed
  // upserts mean re-posting the same author overwrites instead of
  // duplicating. The draft tool in medha-platform loads a profile via
  // GET /v1/personal/author-voice/:slug then interpolates voice_tells +
  // what_they_dont_say into the prompt.

  app.post(
    "/v1/personal/author-voice",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: authorVoiceSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      let row;
      try {
        row = normalizeAuthorVoice(request.body, { privyDid: ctx.privyDid });
      } catch (err) {
        return sendValidationError(reply, err);
      }
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: AUTHOR_VOICES_TABLE,
        rowKey: row.id,
      });
      const stored = await upsertAuthorVoice(
        ctx.privyDid,
        existing ? { ...existing, ...row } : row,
        firestoreDeps,
      );
      indexAsync(indexAuthorVoice, app, ctx.privyDid, stored);
      return reply
        .code(existing ? 200 : 201)
        .send({ ok: true, author_voice: stored });
    },
  );

  app.get(
    "/v1/personal/author-voice",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const q = request.query || {};
      const semantic =
        q.semantic === "true" || q.semantic === "1" || q.semantic === true;
      const queryText =
        q.q != null ? String(q.q) : q.text ? String(q.text) : "";

      // Semantic recall: "whose voice sounds most like Sagar?" routes through
      // Pinecone vector distance instead of the org exact-match filter.
      if (semantic && queryText.trim()) {
        const matches = await searchAuthorVoices(ctx.privyDid, {
          query: queryText,
          topK: 12,
        });
        if (matches.length > 0) {
          return {
            ok: true,
            source: "pinecone",
            count: matches.length,
            matches,
          };
        }
        // Fall through to the Firestore listing when Pinecone is unavailable
        // or returns nothing.
      }

      const org = q.org ? String(q.org).toLowerCase() : null;
      try {
        const rows = await listAuthorVoices(
          ctx.privyDid,
          { org, limit: 200 },
          firestoreDeps,
        );
        return {
          ok: true,
          source: semantic ? "firestore_fallback" : "firestore",
          count: rows.length,
          author_voices: rows,
        };
      } catch (err) {
        return sendValidationError(reply, err);
      }
    },
  );

  app.get(
    "/v1/personal/author-voice/:slug",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const slug = slugifyForId(request.params?.slug);
      if (!slug) {
        return reply
          .code(400)
          .send({ error: "missing_slug", message: "slug is required" });
      }
      const row = await getAuthorVoice(ctx.privyDid, slug, firestoreDeps);
      if (!row) {
        return reply.code(404).send({
          error: "author_voice_not_found",
          message: `No author voice on file for slug '${slug}'`,
        });
      }
      return { ok: true, author_voice: row };
    },
  );

  app.delete(
    "/v1/personal/author-voice/:slug",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const slug = slugifyForId(request.params?.slug);
      if (!slug) {
        return reply
          .code(400)
          .send({ error: "missing_slug", message: "slug is required" });
      }
      await deleteAuthorVoice(ctx.privyDid, slug, firestoreDeps);
      deleteAuthorVoiceVector(ctx.privyDid, slug).catch((err) => {
        app.log.warn(
          { err: err?.message, slug },
          "[personal-life] author-voice vector delete threw",
        );
      });
      return reply.code(204).send();
    },
  );
}
