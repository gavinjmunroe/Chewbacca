/**
 * Amber → Clay: push the caller's contacts into their own Clay table.
 *
 * The mirror image of the Clay → Amber path in src/routes/api-keys.js
 * (POST /v1/ingest/contacts). Together they make the two systems bidirectional:
 *
 *   Clay → Amber   Clay's HTTP API action POSTs to /v1/ingest/contacts with a personal
 *                  Amber API key. Already shipped.
 *   Amber → Clay   these routes POST to a Clay "Import from Webhook" source URL that
 *                  the user pasted in.
 *
 *   GET    /v1/me/clay/destination   → is one configured, masked URL, last push
 *   PUT    /v1/me/clay/destination   → set/replace it (validated, see clay-webhook.js)
 *   DELETE /v1/me/clay/destination   → forget it
 *   POST   /v1/me/clay/push          → push contacts now
 *
 * AUTH: every route is JWT (requireAuth) and resolves the owner from the session
 * phone — the SAME owner id the contact tables use. No client-supplied owner id is
 * ever trusted, so a cross-tenant push is impossible: the contacts read and the
 * destination read are both keyed by the resolved owner.
 *
 * THE WEBHOOK URL IS A CREDENTIAL. Anyone holding it can write rows into that Clay
 * table, so it is never echoed back to the client in full and never written to a log
 * line. GET returns a masked form.
 */

import { requireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, listContactsForOwnerAppShape } from "../db/store.js";
import {
  getClayDestination,
  setClayDestination,
  deleteClayDestination,
  recordClayPush,
  maskWebhookUrl,
} from "../db/clay-destinations-store.js";
import {
  CLAY_DEFAULT_MODE,
  CLAY_MODES,
  pushRowsToClay,
  toClayRow,
  validateClayWebhookUrl,
} from "../lib/clay-webhook.js";

// A ceiling on one push. Large enough for a real address book, small enough that a
// single request cannot run for minutes or pin a connection.
const MAX_PUSH = 2000;

/**
 * Resolve the signed-in caller to the owner id the contact tables use.
 *
 * `request.privyUser.phone` is what requireAuth actually populates — matching
 * src/routes/api-keys.js, which is the other half of this integration. Reading the
 * wrong property here would resolve to null and 401 every request with no hint why.
 */
async function resolveOwner(request, reply) {
  const phone = request.privyUser?.phone;
  if (!phone) {
    reply.code(400).send({ error: "no_phone_on_session" });
    return null;
  }
  const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
  if (!ownerId) {
    reply.code(500).send({ error: "could_not_resolve_owner" });
    return null;
  }
  return ownerId;
}

export function registerClayPushRoutes(app) {
  // ── GET /v1/me/clay/destination ────────────────────────────────────────────────
  app.get("/v1/me/clay/destination", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveOwner(request, reply);
    if (!ownerId) return;
    const row = await getClayDestination(ownerId);
    if (!row) return reply.send({ configured: false });
    return reply.send({
      configured: true,
      // MASKED. The full URL is a write capability for that Clay table; the client
      // only needs to recognize which one is set.
      webhookUrl: maskWebhookUrl(row.webhook_url),
      label: row.label ?? null,
      lastPushAt: row.last_push_at ?? null,
      lastPushCount: row.last_push_count ?? 0,
      mode: row.mode ?? CLAY_DEFAULT_MODE,
      // Whether a token is set, never the token itself.
      hasAuthToken: !!row.auth_token,
    });
  });

  // ── PUT /v1/me/clay/destination ────────────────────────────────────────────────
  app.put(
    "/v1/me/clay/destination",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["webhookUrl"],
          properties: {
            webhookUrl: { type: "string", maxLength: 2048 },
            label: { type: "string", maxLength: 120 },
            // 'object' (default) posts one flat row per request, which is what Clay's
            // webhook source documents. 'array' batches, for sources that accept it.
            mode: { type: "string", enum: CLAY_MODES },
            // Clay's optional "Add auth token" on the webhook source.
            authToken: { type: "string", maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      // THE SSRF GATE. See src/lib/clay-webhook.js — this is the only thing standing
      // between a user-supplied URL and the server making requests to it.
      const check = validateClayWebhookUrl(request.body?.webhookUrl);
      if (!check.ok) {
        return reply.code(400).send({ error: "invalid_webhook_url", message: check.reason });
      }

      const label =
        typeof request.body?.label === "string" && request.body.label.trim()
          ? request.body.label.trim().slice(0, 120)
          : null;
      const mode = CLAY_MODES.includes(request.body?.mode)
        ? request.body.mode
        : CLAY_DEFAULT_MODE;
      const authToken =
        typeof request.body?.authToken === "string" && request.body.authToken.trim()
          ? request.body.authToken.trim()
          : null;
      const row = await setClayDestination(ownerId, check.url, { label, mode, authToken });
      if (!row) return reply.code(500).send({ error: "save_failed" });
      return reply.send({
        ok: true,
        configured: true,
        webhookUrl: maskWebhookUrl(row.webhook_url),
        label: row.label ?? null,
        mode: row.mode ?? CLAY_DEFAULT_MODE,
        hasAuthToken: !!row.auth_token,
      });
    },
  );

  // ── DELETE /v1/me/clay/destination ─────────────────────────────────────────────
  app.delete("/v1/me/clay/destination", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveOwner(request, reply);
    if (!ownerId) return;
    await deleteClayDestination(ownerId);
    return reply.send({ ok: true, configured: false });
  });

  // ── POST /v1/me/clay/push ──────────────────────────────────────────────────────
  /**
   * Body (all optional):
   *   contactIds: string[]  push only these (still owner-scoped — ids that are not
   *                         the caller's are simply not found and therefore skipped)
   *   limit:      number    cap the number pushed
   *   dryRun:     boolean   validate and report what WOULD be sent, send nothing.
   *                         This is what makes the feature testable from a terminal
   *                         without writing junk rows into a real Clay table.
   */
  app.post(
    "/v1/me/clay/push",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          properties: {
            contactIds: { type: "array", maxItems: MAX_PUSH, items: { type: "string" } },
            limit: { type: "integer", minimum: 1, maximum: MAX_PUSH },
            dryRun: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const dest = await getClayDestination(ownerId);
      if (!dest) {
        return reply.code(400).send({
          error: "no_destination",
          message: "Add your Clay webhook URL first.",
        });
      }
      // Re-validate on the way OUT as well as on the way in. The row could predate a
      // tightening of the rules, or have been written by an older build; a stored
      // value is not a trusted value.
      const check = validateClayWebhookUrl(dest.webhook_url);
      if (!check.ok) {
        return reply.code(400).send({ error: "invalid_webhook_url", message: check.reason });
      }

      const all = await listContactsForOwnerAppShape(ownerId);
      const wanted = Array.isArray(request.body?.contactIds) ? new Set(request.body.contactIds) : null;
      let selected = wanted ? all.filter((c) => wanted.has(String(c.id))) : all;

      // A contact with no name is not a lead; it is a row of nulls in someone's table.
      selected = selected.filter((c) => (c.name ?? "").trim());

      const limit = Number(request.body?.limit) || MAX_PUSH;
      const skippedForLimit = Math.max(0, selected.length - limit);
      selected = selected.slice(0, limit);

      const rows = selected.map(toClayRow);

      if (request.body?.dryRun) {
        return reply.send({
          ok: true,
          dryRun: true,
          wouldPush: rows.length,
          skippedForLimit,
          // One row back so the caller can eyeball the column mapping before
          // committing anything to a real table.
          sample: rows[0] ?? null,
          destination: maskWebhookUrl(dest.webhook_url),
          mode: dest.mode ?? CLAY_DEFAULT_MODE,
        });
      }

      const { pushed, failures } = await pushRowsToClay(check.url, rows, {
        mode: dest.mode ?? CLAY_DEFAULT_MODE,
        authToken: dest.auth_token ?? null,
      });

      if (pushed > 0) await recordClayPush(ownerId, pushed);

      return reply.code(failures.length && pushed === 0 ? 502 : 200).send({
        ok: failures.length === 0,
        pushed,
        total: rows.length,
        skippedForLimit,
        mode: dest.mode ?? CLAY_DEFAULT_MODE,
        failures,
      });
    },
  );
}
