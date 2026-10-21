/**
 * OTP routes — Amber-native phone auth over Photon iMessage.
 *
 *   POST /v1/otp/start    { phone }                    -> { ok, throttled? }
 *   POST /v1/otp/verify   { phone, code }              -> { ok, token, user }
 *
 * The user's first contact with Amber is an iMessage from Amber's own number,
 * sent through lib/photon-sender.js — the single iMessage transport in this
 * service.
 *
 * NOTE ON WHICH ROUTE THE APP USES. The iOS app signs in through
 * /v1/auth/otp/request and /v1/auth/otp/verify (routes/mobile-auth.js), which has
 * always sent over Photon. These /v1/otp/* routes are the older surface, kept
 * registered for any other consumer; they used to be the last thing in the
 * service dispatching over a second vendor, which is why they now use the same
 * sender as everything else rather than being deleted outright.
 *
 * On verify success we issue an HS256 JWT signed with the shared
 * AMBER_JWT_SECRET (also known to amber-agent so it can verify the same
 * tokens without a JWKS round-trip).
 */

import crypto from "node:crypto";
/**
 * THE OTP STORE THAT MATCHES THE TABLE.
 *
 * This imported csql-otp-store.js, which was written against an assumed
 * schema -- phone as the primary key, no soft deletes, no code_only_hash --
 * and the real otp_codes table is none of those things. Every send threw
 * 42P10 on `ON CONFLICT (phone)` (there is no unique index on phone, only a
 * non-unique partial one) and would have thrown a not-null violation on
 * code_only_hash immediately after. The path could never have worked.
 *
 * medha-otp-store.js is the implementation written against the table that
 * actually exists, and it was already in the repo. Same call signatures and
 * the same return shapes, so this is a swap and nothing downstream changes.
 */
import {
  startMedhaOtp as startOtp,
  verifyMedhaOtp as verifyOtp,
  OTP_TTL_MINUTES,
} from "../lib/medha-otp-store.js";
import { sendIMessage } from "../lib/photon-sender.js";
import { signSessionToken } from "../lib/amber-jwt.js";
import { getOrCreateUser } from "../db/user-store.js";
import { WEB_SESSION_SCOPE, webSessionScopeFor } from "../lib/token-scope.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { getMembership } from "../db/org-store.js";

/** Eight hours: a work day at a desk, not a phone in a pocket. */
const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;

// Strict E.164: '+' followed by 8-15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;

function normalizePhone(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!E164.test(trimmed)) return null;
  return trimmed;
}

function didForPhone(phone) {
  // Stable per-phone DID. Keeps the same canonical id even if the user
  // re-signs-in from a wiped device. Hashing avoids putting raw phone
  // numbers into doc keys / log lines.
  const h = crypto
    .createHash("sha256")
    .update(`amber-phone:${phone}`)
    .digest("hex")
    .slice(0, 24);
  return `did:amber:${h}`;
}

export function registerOtpRoutes(app) {
  /**
   * POST /v1/otp/start
   * Sends a 6-digit code to `phone` as an iMessage from Amber's own number.
   */
  app.post(
    "/v1/otp/start",
    {
      schema: {
        body: {
          type: "object",
          required: ["phone"],
          properties: { phone: { type: "string", maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const phone = normalizePhone(request.body?.phone);
      if (!phone) {
        return reply.code(400).send({
          error: "invalid_phone",
          message: "Phone must be E.164, like +15555551234.",
        });
      }

      let entry;
      try {
        // The requester's IP rides along: otp_codes indexes it, which is what
        // makes a per-source abuse query possible later.
        entry = await startOtp(phone, { requesterIp: request.ip ?? null });
      } catch (err) {
        request.log.error(err, "[otp] startOtp failed");
        return reply
          .code(503)
          .send({ error: "otp_unavailable", message: "Try again shortly." });
      }

      if (entry.throttled) {
        return reply.code(429).send({
          error: "rate_limited",
          message: "Wait a moment before requesting another code.",
        });
      }

      const text = `Your Amber code is ${entry.code}. Don't share it. It expires in ${OTP_TTL_MINUTES} minutes.`;
      const sent = await sendIMessage({ toPhone: phone, text });

      // Whether Photon dispatched or credentials are absent in dev, the code is
      // already stored. A real send failure is surfaced so the caller can retry;
      // a missing-credentials dev environment is not an error the user caused.
      if (!sent.ok && sent.reason !== "not_configured") {
        request.log.warn({ sent }, "[otp] Photon send failed");
        return reply.code(502).send({
          error: "delivery_failed",
          message:
            "Could not send the code via iMessage. Make sure your phone is iMessage-capable, then try again.",
        });
      }

      return reply.send({
        ok: true,
        deliveredVia: sent.ok ? "imessage" : "dev_fallback",
      });
    },
  );

  /**
   * POST /v1/otp/verify
   * Verifies the code, issues a session JWT, and returns the user record.
   */
  app.post(
    "/v1/otp/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["phone", "code"],
          properties: {
            phone: { type: "string", maxLength: 32 },
            code: { type: "string", maxLength: 16 },
            // WHICH KIND OF SESSION TO MINT. Omitted, or anything other than
            // "web", gives the full session the app has always been given --
            // so no existing client changes behavior by not knowing this
            // field exists. "web" gives a token that can read the network
            // graph and contact cards and nothing else, because that one ends
            // up in browser storage.
            //
            // This is a REQUEST for fewer privileges, never for more, which is
            // why it is safe to take from an unauthenticated body: the worst a
            // caller can do by lying is restrict itself.
            client: { type: "string", enum: ["app", "web"] },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = normalizePhone(request.body?.phone);
      const code = request.body?.code;

      if (!phone) {
        return reply
          .code(400)
          .send({ error: "invalid_phone", message: "Bad phone format." });
      }

      let result;
      try {
        result = await verifyOtp(phone, code);
      } catch (err) {
        request.log.error(err, "[otp] verifyOtp failed");
        return reply
          .code(503)
          .send({ error: "otp_unavailable", message: "Try again shortly." });
      }

      if (!result.ok) {
        const status =
          result.reason === "too_many_attempts"
            ? 429
            : result.reason === "expired" || result.reason === "not_found"
              ? 410
              : 401;
        return reply.code(status).send({
          error: result.reason,
          message:
            result.reason === "expired"
              ? "Code expired. Request a new one."
              : result.reason === "too_many_attempts"
                ? "Too many tries. Request a new code."
                : result.reason === "not_found"
                  ? "No active code for this number."
                  : "Wrong code.",
          attemptsRemaining: result.attemptsRemaining,
        });
      }

      const did = didForPhone(phone);

      // Get-or-create the canonical user doc keyed by our amber DID.
      try {
        await getOrCreateUser(did);
      } catch (err) {
        request.log.error(err, "[otp] getOrCreateUser failed");
        return reply.code(503).send({ error: "user_provision_failed" });
      }

      const isWeb = request.body?.client === "web";

      /*
       * WHAT A BROWSER TOKEN MAY REACH NOW DEPENDS ON WHO IS HOLDING IT.
       *
       * It used to be one frozen list for everybody. The enterprise fork adds
       * routes that only an admin of a company should be able to call, and the
       * cheapest place to withhold them is at mint time -- so an account that
       * is already in a company is not given org:create, and a member who is
       * not an admin is not given org:admin.
       *
       * This NARROWS the token; the route still checks the role against the
       * database on every request (requireOrgAdmin), because a token minted
       * while somebody was an admin outlives their demotion by up to eight
       * hours. Scope is the blast radius of a theft, not the authorization.
       *
       * The lookup is skipped entirely for the app, which gets an unrestricted
       * token exactly as before.
       */
      let webScope = WEB_SESSION_SCOPE;
      /*
       * THE SUBJECT OF A BROWSER TOKEN IS THE ACCOUNT'S OWN uuid, not the
       * hashed-phone DID the app gets.
       *
       * didForPhone() produces did:amber:<24 hex of a hash>, which is stable
       * and resolves to nothing: no column stores it. Every route keyed on the
       * token's subject rather than its phone claim -- the profile, for one --
       * therefore could not serve a web session at all, and an account with no
       * phone could not be served by either door.
       *
       * did:amber:<amber_id> is the shape resolveAmberIdByPrivyDid already
       * understands, so both doors open: the phone claim is still on the token
       * for every phone-keyed resolver, and the subject now resolves for
       * everything else. The app's token is untouched.
       */
      let subject = did;
      if (isWeb) {
        const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
        if (amberId) subject = `did:amber:${amberId}`;
        const membership = amberId ? await getMembership(amberId).catch(() => null) : null;
        webScope = webSessionScopeFor(membership);
      }

      const { token, expiresAt } = signSessionToken({
        did: subject,
        phone,
        scope: isWeb ? [...webScope] : null,
        // A browser token lives somewhere the person cannot see and cannot
        // clear from another device, so it is given hours rather than the
        // app's lifetime.
        ttlSeconds: isWeb ? WEB_SESSION_TTL_SECONDS : null,
      });

      return reply.send({
        ok: true,
        token,
        expiresAt,
        // Said out loud so the site can render what it is actually allowed to
        // show, rather than discovering it one 403 at a time.
        scope: isWeb ? webScope : null,
        user: { did: subject, phone },
      });
    },
  );
}
