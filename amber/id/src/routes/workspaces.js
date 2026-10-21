/**
 * WORKSPACES — which Amber accounts this human holds, and how they move between
 * them.
 *
 *   GET  /v1/me/workspaces              the picker
 *   POST /v1/me/workspaces/link/start   send a code to a phone number
 *   POST /v1/me/workspaces/link/verify  prove it, and link the two accounts
 *   POST /v1/me/workspaces/switch       a session for a linked account
 *
 * THE RULE THIS FILE EXISTS TO HOLD: a link grants exactly one thing, the
 * ability to open the other workspace, and it carries no data whatsoever.
 * Nothing here returns a contact, a note, a share or a graph edge, and no other
 * read path in this service joins through account_links. A personal address
 * book is not visible from inside a company and a company's rows are not
 * visible from a phone, however the two accounts are linked.
 *
 * WHY LINKING IS A PHONE OTP AND NOT A SETTING. The claim being made is "the
 * human holding this work account is the same human who holds that personal
 * one". A checkbox cannot demonstrate that. Answering a code sent to the number
 * on the other account, while already holding a session for this one, is the
 * cheapest thing that actually does.
 *
 * SWITCHING MINTS A NEW SESSION rather than widening the current one. A token
 * that could act as either account would make every owner-scoped query in the
 * service depend on a header somebody could change.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { ownerIdFromSession } from "../lib/owner-id.js";
import {
  accountsAreLinked,
  findAccountByPhone,
  getAccountIdentity,
  linkAccounts,
  listWorkspaces,
} from "../db/org-store.js";
import { OTP_TTL_MINUTES, startMedhaOtp, verifyMedhaOtp } from "../lib/medha-otp-store.js";
import { sendIMessage } from "../lib/photon-sender.js";
import { signSessionToken } from "../lib/amber-jwt.js";
import { webSessionScopeFor } from "../lib/token-scope.js";

const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;
const E164 = /^\+[1-9]\d{7,14}$/;

export function registerWorkspaceRoutes(app, { requireAuth = defaultRequireAuth } = {}) {
  async function me(request, reply) {
    const amberId = await ownerIdFromSession(request.privyUser);
    if (!amberId) {
      reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
      return null;
    }
    return amberId;
  }

  /** Names and kinds. No content, by construction. */
  app.get("/v1/me/workspaces", { preHandler: [requireAuth] }, async (request, reply) => {
    const amberId = await me(request, reply);
    if (!amberId) return;
    const workspaces = await listWorkspaces(amberId);
    return { workspaces, count: workspaces.length };
  });

  /*
   * PER-CALLER COOLDOWN, held here rather than in the OTP store.
   *
   * The store's cooldown is keyed on the phone, so it only ever fires for a
   * number that already has an account -- which would make a 429 an answer to
   * "is this number on Amber". Keying the first check on the caller instead
   * makes the throttled response identical for a number that exists and one
   * that does not.
   */
  const lastStartByCaller = new Map();
  const CALLER_COOLDOWN_MS = 30 * 1000;

  app.post("/v1/me/workspaces/link/start", { preHandler: [requireAuth] }, async (request, reply) => {
    const amberId = await me(request, reply);
    if (!amberId) return;
    const phone = String(request.body?.phone ?? "").trim();
    if (!E164.test(phone)) return reply.code(400).send({ error: "bad_phone" });

    const last = lastStartByCaller.get(String(amberId));
    if (last && Date.now() - last < CALLER_COOLDOWN_MS) {
      const retryAfter = Math.ceil((CALLER_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return reply.code(429).send({
        error: "resend_cooldown",
        retryAfter,
        message: `Wait ${retryAfter}s before asking for another code.`,
      });
    }
    lastStartByCaller.set(String(amberId), Date.now());

    /*
     * THE NUMBER MUST ALREADY BE AN ACCOUNT, and this is where that is checked
     * rather than at verify time. Linking is for a personal Amber that already
     * exists; creating one from inside a company console would be the company
     * making somebody a consumer account they never asked for.
     *
     * The answer for a number with no account is the same as for one with a
     * code in flight, because a different one would make this an endpoint for
     * asking which phone numbers are on Amber.
     */
    const other = await findAccountByPhone(phone);
    if (!other || String(other) === String(amberId)) {
      return { ok: true, sent: true };
    }

    const started = await startMedhaOtp(phone, { requesterIp: request.ip ?? null }).catch((err) => {
      request.log.error({ err: String(err) }, "[workspaces.link] could not mint a code");
      return null;
    });
    if (!started) {
      return reply.code(503).send({
        error: "otp_unavailable",
        message: "Could not send a code just now. Try again in a moment.",
      });
    }
    if (started.throttled) {
      return reply.code(429).send({
        error: "resend_cooldown",
        retryAfter: 30,
        message: "A code was just sent to that number. Give it a moment.",
      });
    }

    /*
     * sendIMessage takes a single options object. It was called positionally
     * here, which made every send fail on `missing_args` inside a catch that
     * threw the result away -- the route said `sent: true` and no message ever
     * arrived. Delivery failures are reported now, for exactly that reason.
     */
    const sent = await sendIMessage({
      toPhone: phone,
      text: `Your Amber code is ${started.code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    });
    if (!sent.ok) {
      request.log.warn(
        { reason: sent.reason, detail: sent.detail },
        "[workspaces.link] iMessage delivery failed",
      );
      return reply.code(502).send({
        error: "delivery_failed",
        reason: sent.reason,
        message:
          sent.reason === "not_configured"
            ? "Code delivery is not configured on this server."
            : "We could not deliver a code to that number.",
      });
    }
    return { ok: true, sent: true };
  });

  app.post("/v1/me/workspaces/link/verify", { preHandler: [requireAuth] }, async (request, reply) => {
    const amberId = await me(request, reply);
    if (!amberId) return;
    const phone = String(request.body?.phone ?? "").trim();
    const code = String(request.body?.code ?? "").trim();
    if (!E164.test(phone) || !code) return reply.code(400).send({ error: "bad_input" });

    const result = await verifyMedhaOtp(phone, code).catch(() => null);
    if (!result?.ok) {
      return reply.code(401).send({ error: "bad_code", message: "That code is not right." });
    }
    const other = await findAccountByPhone(phone);
    if (!other || String(other) === String(amberId)) {
      return reply.code(404).send({
        error: "no_account",
        message: "There is no other Amber account on that number.",
      });
    }
    const linked = await linkAccounts(amberId, other, "phone");
    if (!linked.ok) return reply.code(503).send({ error: linked.reason });
    return { ok: true, workspaces: await listWorkspaces(amberId) };
  });

  /**
   * A SESSION FOR THE OTHER WORKSPACE.
   *
   * The link is re-checked here against the database rather than trusted from
   * the picker, because the picker is a list this caller was handed and the
   * thing being requested is a credential for a different account.
   */
  app.post("/v1/me/workspaces/switch", { preHandler: [requireAuth] }, async (request, reply) => {
    const amberId = await me(request, reply);
    if (!amberId) return;
    const target = String(request.body?.amberId ?? "").trim();
    if (!target) return reply.code(400).send({ error: "bad_target" });
    if (target === String(amberId)) return reply.code(400).send({ error: "already_here" });

    if (!(await accountsAreLinked(amberId, target))) {
      return reply.code(403).send({
        error: "not_linked",
        message: "That workspace is not linked to this account.",
      });
    }

    const identity = await getAccountIdentity(target);
    if (!identity) return reply.code(404).send({ error: "no_account" });

    const scope = [...webSessionScopeFor()];
    const { token, expiresAt } = signSessionToken({
      did: `did:amber:${target}`,
      // The account's own phone, when it has one. Without it the session
      // reaches none of the routes that still resolve their owner from the
      // phone claim -- which is most of the consumer product, and is why
      // switching into a personal workspace showed an empty address book.
      phone: identity.phone,
      scope,
      ttlSeconds: WEB_SESSION_TTL_SECONDS,
    });
    return { ok: true, token, expiresAt, scope, kind: identity.kind };
  });
}
