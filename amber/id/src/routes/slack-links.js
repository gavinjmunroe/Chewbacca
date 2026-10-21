/**
 * Slack -> phone identity link routes.
 *
 * Backend for the Option C link flow used by medha-imessage's Slack
 * transport. See src/db/slack-links.js for the storage shape and the
 * person_id derivation rationale (it intentionally collides with the
 * iMessage transport's person_id so Slack and iMessage history attach
 * to the same record).
 *
 *   GET    /v1/slack-links/:team/:user      -> { personId, phone } | 404
 *   POST   /v1/slack-links/pending          { team, user, channel? }
 *   POST   /v1/slack-links/complete         { team, user, phone }
 *   POST   /v1/slack-links/auto-bind        { team, user, tenantDid, phone, sourceEmail }
 *   GET    /v1/slack-links/:team/:user/prompted   -> { prompted: bool }
 *   POST   /v1/slack-links/mark-prompted    { team, user }
 *
 * All routes are service-to-service (x-api-key, same gating as the
 * existing /internal/* routes). End users never hit these directly.
 */

import { requireApiKey, validateDid, validatePhone } from "../lib/auth.js";
import {
  getLink,
  upsertPending,
  completeLink,
  autoBind,
  wasPrompted,
  markPrompted,
} from "../db/slack-links.js";

const SLACK_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSlackId(value) {
  return typeof value === "string" && SLACK_ID_RE.test(value);
}

function isLikelyEmail(value) {
  return (
    typeof value === "string" &&
    value.length > 3 &&
    value.length <= 254 &&
    EMAIL_RE.test(value)
  );
}

export function registerSlackLinksRoutes(app) {
  /**
   * GET /v1/slack-links/:team/:user
   *
   * Returns the existing link or 404. medha-imessage calls this on
   * every inbound Slack message to decide whether to enter the agent
   * loop with a real person_id or kick off the link ceremony.
   */
  app.get(
    "/v1/slack-links/:team/:user",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const team = String(request.params.team || "");
      const user = String(request.params.user || "");
      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      const link = await getLink(team, user);
      if (!link || link.status !== "linked" || !link.person_id) {
        return reply.code(404).send({ error: "not_linked" });
      }
      return {
        personId: link.person_id,
        phone: link.phone_e164 || null,
      };
    },
  );

  /**
   * POST /v1/slack-links/pending  { team, user, channel? }
   *
   * Marks the (team, user) as mid-link. Idempotent — repeated calls
   * are safe. Never downgrades a `linked` row back to `pending`.
   */
  app.post(
    "/v1/slack-links/pending",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const body = request.body || {};
      const team = String(body.team || "");
      const user = String(body.user || "");
      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      const channel = typeof body.channel === "string" ? body.channel : null;
      await upsertPending(team, user, { channel });
      return { ok: true };
    },
  );

  /**
   * POST /v1/slack-links/complete  { team, user, phone }
   *
   * Binds the link. person_id derives from sha256(toE164(phone)) so
   * the slack identity collides with any existing iMessage history for
   * the same phone. Returns { personId } for the caller to use right
   * away on the same inbound turn.
   */
  app.post(
    "/v1/slack-links/complete",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const body = request.body || {};
      const team = String(body.team || "");
      const user = String(body.user || "");
      const phone = body.phone;
      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      const phoneErr = validatePhone(phone);
      if (phoneErr) {
        return reply
          .code(400)
          .send({ error: "invalid_phone", message: phoneErr });
      }
      const result = await completeLink(team, user, phone);
      if (!result) {
        return reply.code(500).send({ error: "link_failed" });
      }
      return { personId: result.personId };
    },
  );

  /**
   * POST /v1/slack-links/auto-bind  { team, user, tenantDid, phone, sourceEmail }
   *
   * System-initiated bind (Slack Option B). Caller — medha-imessage's
   * Slack envelope — has already matched the inbound Slack user to a
   * Privy tenant by email and now wants to silently bind the Slack
   * identity to that tenant's phone. No Option C ceremony, no soft P.S.
   *
   * Same person_id derivation as /complete (sha256(phone)) so this
   * binding collides with any existing iMessage history for the same
   * phone, exactly like the user-typed path. Idempotent on (team, user):
   * a second auto-bind for the same Slack identity just rewrites the
   * same row.
   *
   * Returns { personId, phone } so the caller can use both in the same
   * envelope it's already building.
   */
  app.post(
    "/v1/slack-links/auto-bind",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const body = request.body || {};
      const team = String(body.team || "");
      const user = String(body.user || "");
      const tenantDid = body.tenantDid;
      const phone = body.phone;
      const sourceEmail = body.sourceEmail;

      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      const didErr = validateDid(tenantDid);
      if (didErr) {
        return reply
          .code(400)
          .send({ error: "invalid_tenant_did", message: didErr });
      }
      const phoneErr = validatePhone(phone);
      if (phoneErr) {
        return reply
          .code(400)
          .send({ error: "invalid_phone", message: phoneErr });
      }
      if (!isLikelyEmail(sourceEmail)) {
        return reply.code(400).send({ error: "invalid_source_email" });
      }

      const result = await autoBind(team, user, {
        tenantDid,
        phone,
        sourceEmail,
      });
      if (!result) {
        return reply.code(500).send({ error: "auto_bind_failed" });
      }
      return { personId: result.personId, phone: result.phone };
    },
  );

  /**
   * GET /v1/slack-links/:team/:user/prompted
   *
   * Has this user already been shown the one-time link offer? medha-imessage
   * checks this before posting the link P.S. so unlinked users don't get
   * nagged on every inbound. Returns 200 with { prompted: bool } either way.
   */
  app.get(
    "/v1/slack-links/:team/:user/prompted",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const team = String(request.params.team || "");
      const user = String(request.params.user || "");
      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      const prompted = await wasPrompted(team, user);
      return { prompted };
    },
  );

  /**
   * POST /v1/slack-links/mark-prompted  { team, user }
   *
   * Stamps the one-time offer so it does not re-appear on subsequent
   * inbound messages. Idempotent.
   */
  app.post(
    "/v1/slack-links/mark-prompted",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const body = request.body || {};
      const team = String(body.team || "");
      const user = String(body.user || "");
      if (!isSlackId(team) || !isSlackId(user)) {
        return reply.code(400).send({ error: "invalid_slack_id" });
      }
      await markPrompted(team, user);
      return { ok: true };
    },
  );
}
