/**
 * /v1/partnerships/* — long-form, evolving partnership records.
 *
 * Sagar's canonical prompts this unblocks:
 *   "please track that we are building an enterprise partnership with
 *    Perplexity, and the main contact is Alex Tsai"
 *   "what do you know about our Perplexity partnership?"
 *   "tell me what Carlo proposed"
 *
 * The pipeline_investors / pipeline_relationships tables already exist
 * for funnel-shaped data (stage tracking, multi-thread relationships).
 * Partnerships are the COMPANION concept for the things that don't fit
 * a funnel: a long-form pitch, an append-only history of notes from
 * across many conversations, a list of next-actions that survive across
 * weeks. The agent picks the right surface; the storage is distinct.
 *
 * Routes:
 *   POST   /v1/partnerships
 *   GET    /v1/partnerships
 *   GET    /v1/partnerships/:id
 *   PATCH  /v1/partnerships/:id
 *   DELETE /v1/partnerships/:id
 *   POST   /v1/partnerships/:id/notes              — append history note
 *   POST   /v1/partnerships/:id/next-actions       — add an open action
 *   POST   /v1/partnerships/:id/next-actions/:naId/complete
 *   GET    /v1/partnerships/by-name?name=Perplexity
 *
 * Auth follows /v1/pipelines/*: Privy bearer OR service x-api-key with
 * x-amber-phone. Body userId/did mismatches are rejected with
 * principal_mismatch.
 *
 * Pinecone indexing is best-effort via knowledge/partnerships-index.js.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import {
  upsertPartnership,
  getPartnership,
  listPartnerships,
  findPartnershipByName,
  appendPartnershipNote,
  addNextAction,
  completeNextAction,
  deletePartnership,
  PARTNERSHIP_KINDS,
  PARTNERSHIP_STATUSES,
} from "../db/partnerships.js";
import { extractClaimedDid } from "../lib/claimed-did.js";

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

function validateEnum(value, allowed, field) {
  if (allowed.has(value)) return null;
  return {
    error: `invalid_${field}`,
    message: `${field}=${value} is not one of ${[...allowed].join(", ")}`,
  };
}

const contactSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    role: { type: "string", maxLength: 200 },
    contact_id: { type: "string", maxLength: 200 },
    email: { type: "string", maxLength: 320 },
  },
  additionalProperties: false,
};

const nextActionSchema = {
  type: "object",
  required: ["description"],
  properties: {
    description: { type: "string", minLength: 1, maxLength: 1000 },
    due_date: { type: "string", maxLength: 64 },
  },
  additionalProperties: false,
};

const partnershipCreateSchema = {
  type: "object",
  required: ["name"],
  properties: {
    id: { type: "string", maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    kind: { type: "string", maxLength: 32 },
    status: { type: "string", maxLength: 32 },
    org_name: { type: "string", maxLength: 200 },
    pitch: { type: "string", maxLength: 16000 },
    primary_contacts: {
      type: "array",
      items: contactSchema,
      maxItems: 50,
    },
    next_actions: {
      type: "array",
      items: nextActionSchema,
      maxItems: 100,
    },
  },
  additionalProperties: false,
};

const partnershipPatchSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    kind: { type: "string", maxLength: 32 },
    status: { type: "string", maxLength: 32 },
    org_name: { type: "string", maxLength: 200 },
    pitch: { type: "string", maxLength: 16000 },
    primary_contacts: {
      type: "array",
      items: contactSchema,
      maxItems: 50,
    },
  },
  additionalProperties: false,
};

const appendNoteSchema = {
  type: "object",
  required: ["note"],
  properties: {
    note: { type: "string", minLength: 1, maxLength: 8000 },
    source: { type: "string", maxLength: 200 },
  },
  additionalProperties: false,
};

export function registerPartnershipsRoutes(app, deps = {}) {
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const dbOps = {
    upsertPartnership: deps.upsertPartnership || upsertPartnership,
    getPartnership: deps.getPartnership || getPartnership,
    listPartnerships: deps.listPartnerships || listPartnerships,
    findPartnershipByName: deps.findPartnershipByName || findPartnershipByName,
    appendPartnershipNote: deps.appendPartnershipNote || appendPartnershipNote,
    addNextAction: deps.addNextAction || addNextAction,
    completeNextAction: deps.completeNextAction || completeNextAction,
    deletePartnership: deps.deletePartnership || deletePartnership,
  };
  // The external vector index these wrote to is gone; observations carry their
  // own pgvector embedding and retrieval.js searches it in-database. The seams
  // stay so an in-database indexer can slot in; the defaults do nothing.
  const _noIndex = async () => ({ indexed: false, reason: "external_index_removed" });
  const idx = {
    indexPartnershipNote: deps.indexPartnershipNote || _noIndex,
    deletePartnershipVectors: deps.deletePartnershipVectors || _noIndex,
  };

  // POST /v1/partnerships — create or upsert by name.
  app.post(
    "/v1/partnerships",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: partnershipCreateSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      if (body.kind) {
        const err = validateEnum(body.kind, PARTNERSHIP_KINDS, "kind");
        if (err) return reply.code(400).send(err);
      }
      if (body.status) {
        const err = validateEnum(body.status, PARTNERSHIP_STATUSES, "status");
        if (err) return reply.code(400).send(err);
      }
      let row;
      try {
        row = await dbOps.upsertPartnership(ctx.privyDid, body);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "invalid_partnership", message: err.message });
      }
      return reply.code(201).send({ ok: true, partnership: row });
    },
  );

  // GET /v1/partnerships — list, optionally filter by kind / status.
  app.get(
    "/v1/partnerships",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const q = request.query || {};
      if (q.kind) {
        const err = validateEnum(q.kind, PARTNERSHIP_KINDS, "kind");
        if (err) return reply.code(400).send(err);
      }
      if (q.status) {
        const err = validateEnum(q.status, PARTNERSHIP_STATUSES, "status");
        if (err) return reply.code(400).send(err);
      }
      const limit = Math.min(parseInt(q.limit, 10) || 100, 500);
      const rows = await dbOps.listPartnerships(ctx.privyDid, {
        kind: q.kind,
        status: q.status,
        limit,
      });
      return { ok: true, count: rows.length, partnerships: rows };
    },
  );

  // GET /v1/partnerships/by-name?name=…
  app.get(
    "/v1/partnerships/by-name",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const name = request.query?.name;
      if (!name || typeof name !== "string") {
        return reply
          .code(400)
          .send({ error: "missing_name", message: "?name=<string> required" });
      }
      const row = await dbOps.findPartnershipByName(ctx.privyDid, name);
      if (!row) return reply.code(404).send({ error: "partnership_not_found" });
      return { ok: true, partnership: row };
    },
  );

  // GET /v1/partnerships/:id
  app.get(
    "/v1/partnerships/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const row = await dbOps.getPartnership(ctx.privyDid, request.params.id);
      if (!row) return reply.code(404).send({ error: "partnership_not_found" });
      return { ok: true, partnership: row };
    },
  );

  // PATCH /v1/partnerships/:id — merge structured fields.
  app.patch(
    "/v1/partnerships/:id",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: partnershipPatchSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const existing = await dbOps.getPartnership(
        ctx.privyDid,
        request.params.id,
      );
      if (!existing)
        return reply.code(404).send({ error: "partnership_not_found" });
      const body = request.body || {};
      if (body.kind) {
        const err = validateEnum(body.kind, PARTNERSHIP_KINDS, "kind");
        if (err) return reply.code(400).send(err);
      }
      if (body.status) {
        const err = validateEnum(body.status, PARTNERSHIP_STATUSES, "status");
        if (err) return reply.code(400).send(err);
      }
      let row;
      try {
        row = await dbOps.upsertPartnership(ctx.privyDid, {
          ...body,
          id: request.params.id,
          name: body.name || existing.name,
        });
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "invalid_partnership", message: err.message });
      }
      return { ok: true, partnership: row };
    },
  );

  // DELETE /v1/partnerships/:id
  app.delete(
    "/v1/partnerships/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      await dbOps.deletePartnership(ctx.privyDid, request.params.id);
      idx
        .deletePartnershipVectors(ctx.privyDid, request.params.id)
        .catch(() => {});
      return { ok: true, deleted: request.params.id };
    },
  );

  // POST /v1/partnerships/:id/notes — append-only history.
  app.post(
    "/v1/partnerships/:id/notes",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: appendNoteSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      let result;
      try {
        result = await dbOps.appendPartnershipNote(
          ctx.privyDid,
          request.params.id,
          { note: body.note, source: body.source },
        );
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "invalid_note", message: err.message });
      }
      if (!result)
        return reply.code(404).send({ error: "partnership_not_found" });
      // Embed the rolled-up partnership AND the new note as a standalone vector.
      idx
        .indexPartnershipNote(ctx.privyDid, result.row, result.entry)
        .catch(() => {});
      return { ok: true, partnership: result.row, note: result.entry };
    },
  );

  // POST /v1/partnerships/:id/next-actions
  app.post(
    "/v1/partnerships/:id/next-actions",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: nextActionSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      let result;
      try {
        result = await dbOps.addNextAction(
          ctx.privyDid,
          request.params.id,
          body,
        );
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "invalid_next_action", message: err.message });
      }
      if (!result)
        return reply.code(404).send({ error: "partnership_not_found" });
      return { ok: true, partnership: result.row, next_action: result.action };
    },
  );

  // POST /v1/partnerships/:id/next-actions/:naId/complete
  app.post(
    "/v1/partnerships/:id/next-actions/:naId/complete",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const result = await dbOps.completeNextAction(
        ctx.privyDid,
        request.params.id,
        request.params.naId,
      );
      if (!result)
        return reply.code(404).send({ error: "partnership_not_found" });
      if (!result.found)
        return reply.code(404).send({ error: "next_action_not_found" });
      return { ok: true, partnership: result.row };
    },
  );
}
