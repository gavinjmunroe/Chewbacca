/**
 * /v1/me/events* — intent-named event memory wrappers.
 *
 * Built for Rave Master v1 (Sagar-only, EDC 2026). Provides:
 *
 *   POST   /v1/me/events                       create or upsert an event card
 *   GET    /v1/me/events                       list caller's events
 *   GET    /v1/me/events/:event_id             fetch a single event card
 *   PATCH  /v1/me/events/:event_id             merge structured fields
 *   DELETE /v1/me/events/:event_id             tear down event + items
 *   POST   /v1/me/events/:event_id/items       append memory items (drafts, scans, ...)
 *   GET    /v1/me/events/:event_id/items       list items, newest first
 *   GET    /v1/me/events/:event_id/plan        return latest_plan + next_meetup only
 *   POST   /v1/me/events/:event_id/summarize   stamp a generated summary
 *
 * Storage:
 *   agent_data/{tenantDid}/events/{event_id}        — the card (single doc)
 *   agent_log/{tenantDid}/event_items/...           — append-only items
 *
 * Auth follows /ingest/imessage: a Privy bearer token OR a service x-api-key
 * with x-amber-phone. The tenant DID always comes from the verified principal;
 * body-level userId fields are rejected with principal_mismatch.
 *
 * Visibility is forced to "private" in v1 (assertPrivateVisibility throws).
 *
 * Substance guardrail: any inbound item text is run through
 * classifySubstanceRisk; "block" responses 422 with code
 * substance_procurement_blocked, "safety_context" decisions are stored but
 * tagged so amber-imessage can route to harm-reduction rather than logistics.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import * as firestoreDefaults from "../db/agent-data.js";
import { extractClaimedDid } from "../lib/claimed-did.js";
import {
  buildEventId,
  parseEventId,
  assertPrivateVisibility,
  classifySubstanceRisk,
  deriveEventItemKey,
  normalizeCardPatch,
  validateEventItem,
  validateEventTask,
  normalizeTaskPatch,
  buildTaskId,
  parseTaskId,
  EVENT_ITEM_KINDS,
  EVENT_STATUSES,
  EVENT_TASK_STATUSES,
  MAX_TASKS_PER_EVENT,
} from "../lib/events.js";
// THE EXTERNAL INDEX IS GONE. These were best-effort writes and reads against a
// separate vector service that held a second copy of this data. Observations
// carry their own pgvector embedding and retrieval.js searches it in-database, so
// the second copy was the sprawl this rebuild removed. The dependency-injection
// seams stay so tests and any future in-database indexer can slot straight in;
// the defaults now do nothing and say so.
const _noIndex = async () => ({ indexed: false, reason: "external_index_removed" });
const _noSearch = async () => [];
const defaultIndexEvent = _noIndex;
const defaultIndexTask = _noIndex;
const defaultDeleteEventVector = _noIndex;
const defaultDeleteTaskVector = _noIndex;

const EVENTS_TABLE = "events";
const EVENT_ITEMS_TABLE = "event_items";
const EVENT_TASKS_TABLE = "event_tasks";

/**
 * Verify caller identity and return the principal DID. Mirrors the
 * resolveCnft helper in /ingest/imessage but does NOT require a cNFT
 * mint — event records are operational metadata, not Pinecone writes.
 *
 * `tenantIndex` is passed in so tests can supply a stub without
 * provisioning the real Privy tenant cache.
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

/**
 * Ensure the supplied event_id parses and belongs to the caller. Returns
 * the parsed parts on success, or sends a 4xx and returns null.
 */
function authorizeEventId(eventId, ownerDid, reply) {
  const parts = parseEventId(eventId);
  if (!parts) {
    reply.code(400).send({
      error: "invalid_event_id",
      message: "event_id must look like event:<owner_did>:<slug>:<year>",
    });
    return null;
  }
  if (parts.ownerDid !== ownerDid) {
    // Don't leak whether the event exists — 404 like the rest of /v1/me.
    reply.code(404).send({ error: "event_not_found" });
    return null;
  }
  return parts;
}

/** Schema fragment shared by all card-write endpoints. */
const cardPatchSchema = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 200 },
    year: { type: "integer", minimum: 1970, maximum: 9999 },
    slug: { type: "string", maxLength: 64 },
    visibility: { type: "string" },
    // Personal-planning fields
    description: { type: "string", maxLength: 8000 },
    start_date: { type: "string", maxLength: 64 },
    end_date: { type: "string", maxLength: 64 },
    location: { type: "string", maxLength: 500 },
    status: { type: "string", enum: [...EVENT_STATUSES] },
    attendees: { type: "array", maxItems: 200 },
    host_did: { type: "string", maxLength: 200 },
    // Rave Master logistics fields
    source_chats: { type: "array", items: { type: "string" }, maxItems: 50 },
    latest_plan: { type: "string", maxLength: 8000 },
    next_meetup: { type: "object" },
    ticket_ledger: { type: "array", maxItems: 200 },
    payment_ledger: { type: "array", maxItems: 200 },
    transport_plan: { type: "object" },
    lodging_plan: { type: "object" },
    supply_list: { type: "array", maxItems: 200 },
    safety_status: { type: "string", maxLength: 200 },
    open_loops: { type: "array", maxItems: 200 },
    last_scanned_at: { type: "string", maxLength: 64 },
  },
  additionalProperties: false,
};

const taskCreateSchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 500 },
    status: { type: "string", enum: [...EVENT_TASK_STATUSES] },
    notes: { type: "string", maxLength: 4000 },
    assigned_to: { type: "string", maxLength: 200 },
    due_date: { type: "string", maxLength: 64 },
    order: { type: "integer", minimum: 0, maximum: 999 },
  },
  additionalProperties: false,
};

const taskPatchSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 500 },
    status: { type: "string", enum: [...EVENT_TASK_STATUSES] },
    notes: { type: "string", maxLength: 4000 },
    assigned_to: { type: "string", maxLength: 200 },
    due_date: { type: "string", maxLength: 64 },
    order: { type: "integer", minimum: 0, maximum: 999 },
  },
  additionalProperties: false,
};

const tasksBatchSchema = {
  type: "object",
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TASKS_PER_EVENT,
      items: taskCreateSchema,
    },
  },
};

const itemSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    id: { type: "string", maxLength: 128 },
    kind: { type: "string", enum: [...EVENT_ITEM_KINDS] },
    text: { type: "string", maxLength: 8000 },
    summary: { type: "string", maxLength: 8000 },
    message_id: { type: "string", maxLength: 256 },
    thread_id: { type: "string", maxLength: 256 },
    chat_id: { type: "string", maxLength: 256 },
    occurred_at: { type: "string", maxLength: 64 },
    source_channel: { type: "string", maxLength: 32 },
    speaker_role: { type: "string", maxLength: 32 },
    participant: { type: "object" },
    metadata: { type: "object" },
  },
};

/**
 * Register all /v1/me/events* routes. `deps` lets tests inject in-memory
 * stand-ins for the Firestore helpers, the auth pre-handler, and the
 * tenantIndex without monkey-patching the module graph.
 */
export function registerEventsRoutes(app, deps = {}) {
  const agentDataGet = deps.agentDataGet || firestoreDefaults.agentDataGet;
  const agentDataUpsert =
    deps.agentDataUpsert || firestoreDefaults.agentDataUpsert;
  const agentDataQuery =
    deps.agentDataQuery || firestoreDefaults.agentDataQuery;
  const agentDataDelete =
    deps.agentDataDelete || firestoreDefaults.agentDataDelete;
  const agentLogInsert =
    deps.agentLogInsert || firestoreDefaults.agentLogInsert;
  const agentLogQuery = deps.agentLogQuery || firestoreDefaults.agentLogQuery;
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const indexEvent = deps.indexEvent || defaultIndexEvent;
  const indexTask = deps.indexTask || defaultIndexTask;
  const deleteEventVector = deps.deleteEventVector || defaultDeleteEventVector;
  const deleteTaskVector = deps.deleteTaskVector || defaultDeleteTaskVector;

  // Fire-and-forget vector upsert — never blocks the caller, never throws.
  function embedEventAsync(did, event) {
    Promise.resolve()
      .then(() => indexEvent(did, event))
      .catch(() => {});
  }
  function embedTaskAsync(did, event, task) {
    Promise.resolve()
      .then(() => indexTask(did, event, task))
      .catch(() => {});
  }
  /**
   * POST /v1/me/events
   * Body: { title, year?, slug?, ...cardFields }
   * Creates or upserts an event card. Returns the full card.
   */
  app.post(
    "/v1/me/events",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: {
        body: {
          type: "object",
          required: ["title"],
          properties: {
            ...cardPatchSchema.properties,
            title: cardPatchSchema.properties.title,
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const body = request.body || {};
      let eventId;
      try {
        eventId = buildEventId({
          ownerDid: ctx.privyDid,
          title: body.title,
          year: body.year,
          slug: body.slug,
        });
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }

      const now = new Date().toISOString();
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });

      let patch;
      try {
        patch = normalizeCardPatch(body, { ownerDid: ctx.privyDid });
      } catch (err) {
        return reply
          .code(err.statusCode || 400)
          .send({ error: err.code || "invalid_card", message: err.message });
      }

      const card = {
        ...(existing || {}),
        ...patch,
        event_id: eventId,
        owner_did: ctx.privyDid,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      await agentDataUpsert({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
        row: card,
      });

      embedEventAsync(ctx.privyDid, card);

      return reply.code(existing ? 200 : 201).send({ ok: true, event: card });
    },
  );

  /** GET /v1/me/events — list caller's events, newest first. */
  app.get(
    "/v1/me/events",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const rows = await agentDataQuery({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        filters: [],
        order: { col: "updated_at", dir: "desc" },
        limit: 100,
      });
      return { ok: true, count: rows.length, events: rows };
    },
  );

  /** GET /v1/me/events/:event_id — fetch a single card. */
  app.get(
    "/v1/me/events/:event_id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!card) return reply.code(404).send({ error: "event_not_found" });
      return { ok: true, event: card };
    },
  );

  /** PATCH /v1/me/events/:event_id — merge structured fields onto the card. */
  app.patch(
    "/v1/me/events/:event_id",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: cardPatchSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!existing) return reply.code(404).send({ error: "event_not_found" });
      let patch;
      try {
        patch = normalizeCardPatch(request.body || {}, {
          ownerDid: ctx.privyDid,
        });
      } catch (err) {
        return reply
          .code(err.statusCode || 400)
          .send({ error: err.code || "invalid_card", message: err.message });
      }
      const merged = { ...existing, ...patch, event_id: eventId };
      await agentDataUpsert({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
        row: merged,
      });
      embedEventAsync(ctx.privyDid, merged);
      return { ok: true, event: merged };
    },
  );

  /**
   * DELETE /v1/me/events/:event_id — teardown.
   * Removes the card and best-effort deletes recent item rows. Older log
   * rows beyond the page size remain for audit; tests + the brief call out
   * "one-click event teardown" as the UX, not a forensic wipe.
   */
  app.delete(
    "/v1/me/events/:event_id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      await agentDataDelete({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      // Best-effort: drop the event's vector and any task vectors we can
      // enumerate via the per-tenant tasks table. Task rows themselves
      // are left in place for audit; the vectors are removed so a stale
      // search doesn't surface a deleted event.
      Promise.resolve()
        .then(async () => {
          await deleteEventVector(ctx.privyDid, eventId);
          try {
            const taskRows = await agentDataQuery({
              tenantDid: ctx.privyDid,
              table: EVENT_TASKS_TABLE,
              filters: [{ col: "event_id", op: "eq", value: eventId }],
              limit: MAX_TASKS_PER_EVENT,
            });
            for (const t of taskRows || []) {
              if (t?.task_id) await deleteTaskVector(ctx.privyDid, t.task_id);
            }
          } catch {}
        })
        .catch(() => {});
      return { ok: true, deleted: eventId };
    },
  );

  /**
   * POST /v1/me/events/:event_id/items
   * Body: { items: [{ kind, text|summary, ... }] }
   * Runs the substance guardrail on each item. Returns per-item decisions.
   */
  app.post(
    "/v1/me/events/:event_id/items",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: {
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: itemSchema,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;

      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!card) return reply.code(404).send({ error: "event_not_found" });

      const items = request.body.items;
      const validationErrors = [];
      items.forEach((it, i) => {
        const errs = validateEventItem(it);
        if (errs.length) validationErrors.push({ index: i, errors: errs });
      });
      if (validationErrors.length) {
        return reply.code(400).send({
          error: "validation_failed",
          details: validationErrors,
        });
      }

      const results = [];
      const stored = [];
      const blocked = [];
      const now = new Date().toISOString();

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const text = it.text || it.summary || "";
        const risk = classifySubstanceRisk(text);
        if (risk.decision === "block") {
          blocked.push({
            index: i,
            kind: it.kind,
            code: risk.code,
            reason: risk.reason,
          });
          results.push({ index: i, decision: "block", code: risk.code });
          continue;
        }
        const safetyTagged = risk.decision === "safety_context";
        const itemKey = deriveEventItemKey(it);
        const row = {
          ...it,
          item_key: itemKey,
          event_id: eventId,
          owner_did: ctx.privyDid,
          visibility: "private",
          safety_status: safetyTagged
            ? "safety_context"
            : it.safety_status || null,
          guardrail_decision: risk.decision,
          guardrail_reason: risk.reason || null,
          occurred_at: it.occurred_at || now,
          stored_at: now,
        };
        await agentLogInsert({
          tenantDid: ctx.privyDid,
          table: EVENT_ITEMS_TABLE,
          row,
        });
        stored.push(row);
        results.push({
          index: i,
          decision: safetyTagged ? "safety_context" : "allow",
          item_key: itemKey,
        });
      }

      // Bounce a `last_scanned_at` onto the card so downstream consumers
      // can detect staleness without scanning the log.
      if (stored.length) {
        await agentDataUpsert({
          tenantDid: ctx.privyDid,
          table: EVENTS_TABLE,
          rowKey: eventId,
          row: { last_scanned_at: now, updated_at: now },
        });
      }

      const status = blocked.length && !stored.length ? 422 : 200;
      return reply.code(status).send({
        ok: blocked.length === 0,
        stored: stored.length,
        blocked: blocked.length,
        results,
        blocked_details: blocked,
      });
    },
  );

  /** GET /v1/me/events/:event_id/items — newest items first. */
  app.get(
    "/v1/me/events/:event_id/items",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const limit = Math.min(parseInt(request.query?.limit, 10) || 50, 500);
      const kind =
        typeof request.query?.kind === "string" ? request.query.kind : null;
      const filters = [{ col: "event_id", op: "eq", value: eventId }];
      if (kind) filters.push({ col: "kind", op: "eq", value: kind });
      const rows = await agentLogQuery({
        tenantDid: ctx.privyDid,
        table: EVENT_ITEMS_TABLE,
        filters,
        order: { col: "created_at", dir: "desc" },
        limit,
      });
      return { ok: true, count: rows.length, items: rows };
    },
  );

  /**
   * GET /v1/me/events/:event_id/plan — returns the canonical latest plan
   * payload that amber-imessage hands back to trusted friends. We narrow
   * to logistics fields only so a friend never sees ledger PII.
   */
  app.get(
    "/v1/me/events/:event_id/plan",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!card) return reply.code(404).send({ error: "event_not_found" });
      return {
        ok: true,
        event_id: eventId,
        title: card.title || null,
        latest_plan: card.latest_plan || null,
        next_meetup: card.next_meetup || null,
        safety_status: card.safety_status || null,
        last_scanned_at: card.last_scanned_at || card.updated_at || null,
      };
    },
  );

  /**
   * POST /v1/me/events/:event_id/summarize
   * Body: { latest_plan, next_meetup?, open_loops?, source }
   * Stamps a generated summary onto the card and appends a plan_snapshot
   * item to the log so we keep retrieval history. The actual summary text
   * is generated by amber-imessage — this endpoint is the storage seam.
   */
  app.post(
    "/v1/me/events/:event_id/summarize",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: {
        body: {
          type: "object",
          required: ["latest_plan"],
          properties: {
            latest_plan: { type: "string", minLength: 1, maxLength: 8000 },
            next_meetup: { type: "object" },
            open_loops: { type: "array", maxItems: 200 },
            source: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!existing) return reply.code(404).send({ error: "event_not_found" });

      const body = request.body || {};
      const risk = classifySubstanceRisk(body.latest_plan);
      if (risk.decision === "block") {
        return reply.code(422).send({
          error: "substance_procurement_blocked",
          code: risk.code,
          message: risk.reason,
        });
      }

      const now = new Date().toISOString();
      const safetyTagged = risk.decision === "safety_context";
      const merged = {
        ...existing,
        latest_plan: body.latest_plan,
        next_meetup: body.next_meetup ?? existing.next_meetup ?? null,
        open_loops: body.open_loops ?? existing.open_loops ?? [],
        last_scanned_at: now,
        updated_at: now,
        visibility: "private",
        safety_status: safetyTagged
          ? "safety_context"
          : existing.safety_status || null,
      };
      try {
        assertPrivateVisibility(merged.visibility);
      } catch (err) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }

      await agentDataUpsert({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
        row: merged,
      });

      await agentLogInsert({
        tenantDid: ctx.privyDid,
        table: EVENT_ITEMS_TABLE,
        row: {
          event_id: eventId,
          owner_did: ctx.privyDid,
          kind: "plan_snapshot",
          summary: body.latest_plan,
          source: body.source || "amber-imessage",
          visibility: "private",
          safety_status: safetyTagged ? "safety_context" : null,
          guardrail_decision: risk.decision,
          stored_at: now,
        },
      });

      return { ok: true, event: merged };
    },
  );

  // ─── Personal-planning tasks ────────────────────────────────────────────
  //
  // Tasks live alongside the event card under
  //   agent_data/{tenantDid}/event_tasks/{task_id}
  // and join to their parent via the embedded event_id field. Each
  // create/patch/delete also appends a task_audit row to agent_log and
  // refreshes the parent card's task_count + task_open_count so the
  // event GET surfaces the headline numbers without a separate query.

  /**
   * Re-derive the parent card's task counters from the live task rows and
   * persist them on the card. Cheap (one query per write) and keeps the
   * card displayable without a fan-out scan from the agent side.
   */
  async function refreshCardTaskCounts(privyDid, eventId, existingCard) {
    const rows = await agentDataQuery({
      tenantDid: privyDid,
      table: EVENT_TASKS_TABLE,
      filters: [{ col: "event_id", op: "eq", value: eventId }],
      limit: MAX_TASKS_PER_EVENT,
    });
    const total = rows?.length || 0;
    const open = rows?.filter((r) => r?.status === "open").length || 0;
    const now = new Date().toISOString();
    const patch = {
      ...(existingCard || {}),
      event_id: eventId,
      owner_did: privyDid,
      task_count: total,
      task_open_count: open,
      updated_at: now,
    };
    await agentDataUpsert({
      tenantDid: privyDid,
      table: EVENTS_TABLE,
      rowKey: eventId,
      row: patch,
    });
    return patch;
  }

  /**
   * POST /v1/me/events/:event_id/tasks
   * Body: { tasks: [{ title, status?, notes?, assigned_to?, due_date?, order? }] }
   * Creates 1..N tasks in one call. Returns the created rows.
   * Sagar's Rytual retreat prompt produces eight tasks in one shot, so
   * batch-create is the primary shape; single-task POST is just N=1.
   */
  app.post(
    "/v1/me/events/:event_id/tasks",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: tasksBatchSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;

      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      if (!card) return reply.code(404).send({ error: "event_not_found" });

      const tasks = request.body.tasks;
      const validationErrors = [];
      tasks.forEach((t, i) => {
        const errs = validateEventTask(t, { requireTitle: true });
        if (errs.length) validationErrors.push({ index: i, errors: errs });
      });
      if (validationErrors.length) {
        return reply.code(400).send({
          error: "validation_failed",
          details: validationErrors,
        });
      }

      // Determine the starting ordinal so caller-supplied tasks that don't
      // set `order` get a stable position at the tail of the existing list.
      const existingRows = await agentDataQuery({
        tenantDid: ctx.privyDid,
        table: EVENT_TASKS_TABLE,
        filters: [{ col: "event_id", op: "eq", value: eventId }],
        limit: MAX_TASKS_PER_EVENT,
      });
      const existingCount = existingRows?.length || 0;
      if (existingCount + tasks.length > MAX_TASKS_PER_EVENT) {
        return reply.code(409).send({
          error: "too_many_tasks",
          message: `event already has ${existingCount} tasks; adding ${tasks.length} would exceed the per-event cap of ${MAX_TASKS_PER_EVENT}`,
        });
      }

      const now = new Date().toISOString();
      const created = [];
      for (let i = 0; i < tasks.length; i++) {
        const input = tasks[i];
        const order =
          typeof input.order === "number" ? input.order : existingCount + i;
        const taskId = buildTaskId({
          eventId,
          order,
          title: input.title,
        });
        const row = {
          task_id: taskId,
          event_id: eventId,
          owner_did: ctx.privyDid,
          title: input.title,
          status: input.status || "open",
          notes: input.notes || null,
          assigned_to: input.assigned_to || null,
          due_date: input.due_date || null,
          order,
          completed_at: input.status === "done" ? now : null,
          created_at: now,
          updated_at: now,
        };
        await agentDataUpsert({
          tenantDid: ctx.privyDid,
          table: EVENT_TASKS_TABLE,
          rowKey: taskId,
          row,
        });
        await agentLogInsert({
          tenantDid: ctx.privyDid,
          table: EVENT_ITEMS_TABLE,
          row: {
            event_id: eventId,
            owner_did: ctx.privyDid,
            kind: "task_audit",
            summary: `task created: ${input.title}`,
            visibility: "private",
            stored_at: now,
            extra: { task_id: taskId, action: "create" },
          },
        });
        created.push(row);
        embedTaskAsync(ctx.privyDid, card, row);
      }

      const refreshedCard = await refreshCardTaskCounts(
        ctx.privyDid,
        eventId,
        card,
      );
      embedEventAsync(ctx.privyDid, refreshedCard);

      return reply.code(201).send({
        ok: true,
        count: created.length,
        tasks: created,
      });
    },
  );

  /**
   * GET /v1/me/events/:event_id/tasks
   * Query: ?status=open|done|blocked  ?limit=N
   * Returns tasks ordered by their `order` field ascending.
   */
  app.get(
    "/v1/me/events/:event_id/tasks",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const limit = Math.min(
        parseInt(request.query?.limit, 10) || 100,
        MAX_TASKS_PER_EVENT,
      );
      const status =
        typeof request.query?.status === "string" ? request.query.status : null;
      if (status && !EVENT_TASK_STATUSES.includes(status)) {
        return reply.code(400).send({
          error: "invalid_status",
          message: `status must be one of [${EVENT_TASK_STATUSES.join(", ")}]`,
        });
      }
      const filters = [{ col: "event_id", op: "eq", value: eventId }];
      if (status) filters.push({ col: "status", op: "eq", value: status });
      const rows = await agentDataQuery({
        tenantDid: ctx.privyDid,
        table: EVENT_TASKS_TABLE,
        filters,
        limit,
      });
      // Firestore doesn't promise stable order without an index on `order`;
      // sort client-side so the natural ordinal wins.
      const sorted = [...(rows || [])].sort(
        (a, b) => (a?.order ?? 0) - (b?.order ?? 0),
      );
      return { ok: true, count: sorted.length, tasks: sorted };
    },
  );

  /**
   * PATCH /v1/me/events/:event_id/tasks/:task_id
   * Update title / status / notes / assigned_to / due_date / order on a
   * task. Status flipping to "done" stamps completed_at; flipping back
   * clears it. Refreshes the parent card's counters.
   */
  app.patch(
    "/v1/me/events/:event_id/tasks/:task_id",
    {
      preHandler: [requireApiKeyOrAuth],
      schema: { body: taskPatchSchema },
    },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      const taskId = request.params.task_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;

      // The task id is owner-scoped via its embedded event_id, so a
      // task_id that doesn't belong to this event is a 404 — never leak
      // whether it exists in some other event.
      const parsed = parseTaskId(taskId);
      if (!parsed || parsed.eventId !== eventId) {
        return reply.code(404).send({ error: "task_not_found" });
      }

      const existing = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENT_TASKS_TABLE,
        rowKey: taskId,
      });
      if (!existing) return reply.code(404).send({ error: "task_not_found" });

      const validationErrors = validateEventTask(request.body || {}, {
        requireTitle: false,
      });
      if (validationErrors.length) {
        return reply.code(400).send({
          error: "validation_failed",
          details: validationErrors,
        });
      }

      const patch = normalizeTaskPatch(request.body || {});
      const merged = {
        ...existing,
        ...patch,
        task_id: taskId,
        event_id: eventId,
        owner_did: ctx.privyDid,
      };
      await agentDataUpsert({
        tenantDid: ctx.privyDid,
        table: EVENT_TASKS_TABLE,
        rowKey: taskId,
        row: merged,
      });

      const now = new Date().toISOString();
      await agentLogInsert({
        tenantDid: ctx.privyDid,
        table: EVENT_ITEMS_TABLE,
        row: {
          event_id: eventId,
          owner_did: ctx.privyDid,
          kind: "task_audit",
          summary: `task updated: ${merged.title}`,
          visibility: "private",
          stored_at: now,
          extra: { task_id: taskId, action: "update", patch },
        },
      });

      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      embedTaskAsync(ctx.privyDid, card, merged);
      const refreshedCard = await refreshCardTaskCounts(
        ctx.privyDid,
        eventId,
        card,
      );
      embedEventAsync(ctx.privyDid, refreshedCard);

      return { ok: true, task: merged };
    },
  );

  /**
   * DELETE /v1/me/events/:event_id/tasks/:task_id
   * Removes the task row and its Pinecone vector. The audit log row stays.
   */
  app.delete(
    "/v1/me/events/:event_id/tasks/:task_id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const eventId = request.params.event_id;
      const taskId = request.params.task_id;
      if (!authorizeEventId(eventId, ctx.privyDid, reply)) return;
      const parsed = parseTaskId(taskId);
      if (!parsed || parsed.eventId !== eventId) {
        return reply.code(404).send({ error: "task_not_found" });
      }
      await agentDataDelete({
        tenantDid: ctx.privyDid,
        table: EVENT_TASKS_TABLE,
        rowKey: taskId,
      });
      const now = new Date().toISOString();
      await agentLogInsert({
        tenantDid: ctx.privyDid,
        table: EVENT_ITEMS_TABLE,
        row: {
          event_id: eventId,
          owner_did: ctx.privyDid,
          kind: "task_audit",
          summary: `task deleted`,
          visibility: "private",
          stored_at: now,
          extra: { task_id: taskId, action: "delete" },
        },
      });
      Promise.resolve()
        .then(() => deleteTaskVector(ctx.privyDid, taskId))
        .catch(() => {});
      const card = await agentDataGet({
        tenantDid: ctx.privyDid,
        table: EVENTS_TABLE,
        rowKey: eventId,
      });
      const refreshedCard = await refreshCardTaskCounts(
        ctx.privyDid,
        eventId,
        card,
      );
      embedEventAsync(ctx.privyDid, refreshedCard);
      return { ok: true, deleted: taskId };
    },
  );
}
