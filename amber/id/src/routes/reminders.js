/**
 * /v1/me/reminders* + /v1/internal/reminders/* — reminder CRUD + worker hook.
 *
 * Tab 16 of the 2026-05-28 dispatch. The medha-platform `schedule_reminder`
 * tool (PR #174, merged) already writes rows to Firestore via @amber/firestore.
 * This module exposes:
 *
 *   POST   /v1/me/reminders                     create a reminder (Privy / service auth)
 *   GET    /v1/me/reminders                     list caller's reminders
 *   GET    /v1/me/reminders/:id                 fetch one
 *   DELETE /v1/me/reminders/:id                 cancel one
 *   POST   /v1/internal/reminders/fire          service-key only — used by the worker
 *                                               to mark a reminder fired or failed
 *   GET    /v1/internal/reminders/due           service-key only — used by the worker
 *                                               to pull due rows
 *
 * The collection is the flat top-level `pending_reminders` (see db/reminders.js
 * for the row shape). Per-tenant access is enforced in every Privy-gated
 * route — a tenant cannot read or cancel another tenant's reminder.
 */

import { tenantIndex as defaultTenantIndex } from "../lib/auth-session.js";
import {
  requireApiKey,
  requireApiKeyOrAuth as defaultRequireApiKeyOrAuth,
  validatePhone,
} from "../lib/auth.js";
import { extractClaimedDid } from "../lib/claimed-did.js";
import {
  createReminder,
  getReminder,
  listRemindersForTenant,
  cancelReminder,
  listDueReminders,
  markReminderFired,
  markReminderAttemptFailed,
  normalizeReminderBody,
  REMINDER_STATUSES,
} from "../db/reminders.js";

const REMINDER_ID_RE = /^rem_[a-zA-Z0-9_-]{8,128}$/;

function isValidReminderId(id) {
  return typeof id === "string" && REMINDER_ID_RE.test(id);
}

async function resolvePrincipal(request, reply, tenantIndex) {
  let privyDid = request.privyUser?.userId;
  const rawHeaderPhone = request.headers["x-amber-phone"];
  const headerPhone = Array.isArray(rawHeaderPhone)
    ? rawHeaderPhone[0]
    : rawHeaderPhone;

  let requesterPhone = null;

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
    requesterPhone = headerPhone;
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
    requesterPhone = headerPhone;
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

  if (!requesterPhone) {
    const tenant = tenantIndex.getByDid?.(privyDid);
    requesterPhone =
      tenant?.phoneNumber || tenant?.primaryPhone || tenant?.phone || null;
  }

  return { privyDid, requesterPhone };
}

export function registerRemindersRoutes(app, deps = {}) {
  const requireApiKeyOrAuth =
    deps.requireApiKeyOrAuth || defaultRequireApiKeyOrAuth;
  const tenantIndex = deps.tenantIndex || defaultTenantIndex;
  const dbCreate = deps.createReminder || createReminder;
  const dbGet = deps.getReminder || getReminder;
  const dbList = deps.listRemindersForTenant || listRemindersForTenant;
  const dbCancel = deps.cancelReminder || cancelReminder;
  const dbListDue = deps.listDueReminders || listDueReminders;
  const dbMarkFired = deps.markReminderFired || markReminderFired;
  const dbMarkFailed =
    deps.markReminderAttemptFailed || markReminderAttemptFailed;

  // ── POST /v1/me/reminders ─────────────────────────────────────────────
  app.post(
    "/v1/me/reminders",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;

      let row;
      try {
        row = normalizeReminderBody(request.body || {}, {
          privyDid: ctx.privyDid,
          requesterPhone: ctx.requesterPhone,
        });
      } catch (err) {
        return reply
          .code(err.statusCode || 400)
          .send({ error: err.code || "invalid_body", message: err.message });
      }

      try {
        await dbCreate(row);
      } catch (err) {
        request.log.error(
          { err: err.message, reminderId: row.reminder_id },
          "[reminders] create failed",
        );
        return reply.code(503).send({
          error: "firestore_unavailable",
          message: "Reminder could not be persisted",
        });
      }

      return reply.code(201).send({ ok: true, reminder: row });
    },
  );

  // ── GET /v1/me/reminders ──────────────────────────────────────────────
  app.get(
    "/v1/me/reminders",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;

      const status = request.query?.status
        ? String(request.query.status)
        : "pending";
      if (!REMINDER_STATUSES.includes(status) && status !== "all") {
        return reply.code(400).send({
          error: "invalid_status",
          message: `status must be one of ${[...REMINDER_STATUSES, "all"].join(", ")}`,
        });
      }
      const limit = Math.max(
        1,
        Math.min(200, Number(request.query?.limit) || 50),
      );

      const rows = await dbList(ctx.privyDid, {
        status: status === "all" ? null : status,
        limit,
      });
      return { reminders: rows };
    },
  );

  // ── GET /v1/me/reminders/:id ──────────────────────────────────────────
  app.get(
    "/v1/me/reminders/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const id = String(request.params.id || "");
      if (!isValidReminderId(id)) {
        return reply.code(400).send({ error: "invalid_reminder_id" });
      }
      const row = await dbGet(id);
      if (!row || row.tenant_did !== ctx.privyDid) {
        // Don't leak existence to other tenants.
        return reply.code(404).send({ error: "reminder_not_found" });
      }
      return { reminder: row };
    },
  );

  // ── DELETE /v1/me/reminders/:id ───────────────────────────────────────
  app.delete(
    "/v1/me/reminders/:id",
    { preHandler: [requireApiKeyOrAuth] },
    async (request, reply) => {
      const ctx = await resolvePrincipal(request, reply, tenantIndex);
      if (!ctx) return;
      const id = String(request.params.id || "");
      if (!isValidReminderId(id)) {
        return reply.code(400).send({ error: "invalid_reminder_id" });
      }
      const row = await dbCancel(id, { privyDid: ctx.privyDid });
      if (!row) return reply.code(404).send({ error: "reminder_not_found" });
      return { ok: true, reminder: row };
    },
  );

  // ── GET /v1/internal/reminders/due ────────────────────────────────────
  // Service-key only. Returns up to `limit` pending reminders whose
  // when.iso <= now. Used by the worker on each tick.
  app.get(
    "/v1/internal/reminders/due",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const limit = Math.max(
        1,
        Math.min(100, Number(request.query?.limit) || 25),
      );
      const now = request.query?.now ? new Date(request.query.now) : new Date();
      if (Number.isNaN(now.getTime())) {
        return reply.code(400).send({ error: "invalid_now" });
      }
      const rows = await dbListDue(now, limit);
      return { reminders: rows, now: now.toISOString() };
    },
  );

  // ── POST /v1/internal/reminders/fire ──────────────────────────────────
  // Service-key only. The worker calls this after attempting delivery so
  // the row is marked fired (on success) or failed (on terminal error).
  //
  // Body: { reminder_id, outcome: "fired"|"failed", reason?, fired_at? }
  app.post(
    "/v1/internal/reminders/fire",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const body = request.body || {};
      const id = String(body.reminder_id || "");
      if (!isValidReminderId(id)) {
        return reply.code(400).send({ error: "invalid_reminder_id" });
      }
      const outcome = String(body.outcome || "").toLowerCase();
      if (outcome === "fired") {
        const row = await dbMarkFired(id, { firedAt: body.fired_at });
        if (!row) return reply.code(404).send({ error: "reminder_not_found" });
        return { ok: true, reminder: row };
      }
      if (outcome === "failed") {
        const row = await dbMarkFailed(id, {
          reason: body.reason,
          maxAttempts: Number(body.max_attempts) || 5,
        });
        if (!row) return reply.code(404).send({ error: "reminder_not_found" });
        return { ok: true, reminder: row };
      }
      return reply.code(400).send({
        error: "invalid_outcome",
        message: "outcome must be 'fired' or 'failed'",
      });
    },
  );
}
