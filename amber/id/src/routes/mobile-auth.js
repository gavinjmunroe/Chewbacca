/**
 * Mobile app phone-OTP login routes.
 *
 *   POST /v1/auth/otp/request   { phone }         → { ok: true }
 *   POST /v1/auth/otp/verify    { phone, code }   → { token, amberId, isNewUser }
 *
 * Reuses the medha auth stack (medha-otp-store + medha-jwt) so the minted
 * token is accepted by requireAuth Branch 2 (medha-id JWT) in privy.js.
 *
 * OTP delivery: Photon / Spectrum iMessage DM via photon-sender.js.
 * ONE EXCEPTION: the configured App Review number (lib/review-account.js) skips
 *   delivery entirely and accepts a expiring review credential, because App Review's phone is not
 *   one we can deliver an iMessage to. Off unless all review configuration is set.
 * IP rate limiting: max 5 requests per 15 minutes from the same IP,
 *   counted against the otp_codes.requester_ip column.
 */

import { restrictedOtpDelivery } from "../lib/otp-delivery-error.js";
import { toE164 } from "../pdw/phone.js";
import { startMedhaOtp, verifyMedhaOtp } from "../lib/medha-otp-store.js";
import { issueSessionPair } from "./auth-sessions.js";
import { getUserByPhone, resolveAmberIdByPhone } from "../db/store.js";
import { sendPhotonIMessage } from "../lib/photon-sender.js";
import { generateOptInUrl, senderPhone } from "../lib/imessage-opt-in.js";
import { personIdFromHandle } from "../pdw/person-resolver.js";
import { query } from "../db/sql.js";
import { isReviewPhone, reviewAccountConfigured } from "../lib/review-account.js";

import { verifyReviewLogin } from "../lib/review-login.js";

const IP_MAX_PER_WINDOW = 5;
const IP_WINDOW_INTERVAL = "15 minutes";

export function registerMobileAuthRoutes(app) {
  // ── POST /v1/auth/otp/request ─────────────────────────────────────────────
  // Generate a 6-digit OTP and deliver it via Photon iMessage DM.
  // Rate-limited per IP (5 per 15 min) and per phone (30s cooldown via store).
  app.post(
    "/v1/auth/otp/request",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["phone"],
          properties: {
            phone: { type: "string", minLength: 7, maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = toE164(request.body.phone);
      if (!phone) return reply.code(400).send({ error: "invalid_phone" });

      // Review credentials are supplied privately to Apple; no message is sent.
      if (isReviewPhone(phone)) {
        return reviewAccountConfigured() ? reply.send({ ok: true }) : reply.code(503).send({ error: "account_unavailable" });
      }

      // Per-IP rate limit using the otp_codes table.
      const ip =
        request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        request.ip ||
        null;
      if (ip) {
        const { rows: ipRows } = await query(
          `SELECT count(*) AS cnt FROM otp_codes
           WHERE requester_ip = $1
             AND created_at > now() - interval '${IP_WINDOW_INTERVAL}'`,
          [ip],
        ).catch(() => ({ rows: [{ cnt: 0 }] }));
        if (Number(ipRows[0]?.cnt) >= IP_MAX_PER_WINDOW) {
          return reply.code(429).send({ error: "rate_limited" });
        }
      }

      const startedAt = performance.now();
      try {
        const { code, throttled } = await startMedhaOtp(phone, { requesterIp: ip });
        if (throttled) return reply.code(429).send({ error: "resend_cooldown" });

        const storedAt = performance.now();
        try {
          await sendPhotonIMessage(
            phone,
            // CODE FIRST. iOS pulls a one-time code out of Messages by looking
            // for digits near a keyword like "code", and the leading-token form
            // is the shape Apple's own examples use and the one it recognizes
            // most reliably. Burying it mid-sentence between two other numbers
            // ("is 123456. It expires in 5 minutes") is the weakest case for the
            // parser, and a miss means QuickType offers contact data -- the
            // user's own phone number -- instead of the code.
            `${code} is your Amber verification code. It expires in five minutes, and Amber will never ask you for it.`,
          );
        } catch (sendErr) {
          const detail = sendErr?.message ? String(sendErr.message) : String(sendErr);
          request.log.warn(
            { err: detail },
            "[mobile-auth] Photon DM delivery failed",
          );

          const restricted = restrictedOtpDelivery(detail);
          if (restricted) return reply.code(503).send(restricted);

          // Pattern-match known iMessage delivery errors so the user gets an
          // actionable response instead of a bare 502. The numeric codes are the
          // ones the iMessage backend reports for these conditions.
          const isNotIMessageCapable =
            detail.includes("Invalid contact phone number") ||
            detail.includes('"code": 180') ||
            detail.includes('"code":180');
          if (isNotIMessageCapable) {
            return reply.code(422).send({
              error: "phone_not_imessage",
              message:
                "That phone can't receive iMessage. Make sure it's an iPhone with iMessage turned on, then try again. (SMS fallback for Android is on the roadmap.)",
            });
          }

          // 520 = no active conversation (recipient has never messaged our line).
          // 540 = cold-send rate limit (1 per 15 min per sender, Apple anti-spam).
          // Both are resolved by the opt-in link: the user taps a deep link that opens
          // Messages pre-addressed to Amber's number, and their reply activates the
          // conversation so subsequent sends succeed immediately.
          const isNoActiveConversation =
            detail.includes("no active conversations") ||
            detail.includes('"code": 520') ||
            detail.includes('"code":520');
          const isColdSendLimited =
            detail.includes("reached the limit of sending messages") ||
            detail.includes('"code": 540') ||
            detail.includes('"code":540');
          if (isNoActiveConversation || isColdSendLimited) {
            const medhaPhone = senderPhone();
            const optIn = generateOptInUrl({
              body: "Hi Amber [opt-in-code]",
              clickId: `signin-${phone}-${Date.now()}`,
            });
            if (optIn.ok && optIn.data?.imessage) {
              return reply.code(409).send({
                error: "phone_needs_opt_in",
                message:
                  "Tap the button to message Amber, then come back and tap Send code again.",
                opt_in_url: optIn.data.imessage,
                opt_in_sms_url: optIn.data.sms || null,
                opt_in_web_url: optIn.data.url || null,
                sender_phone: medhaPhone,
                imessage_code: isColdSendLimited ? 540 : 520,
              });
            }
            return reply.code(409).send({
              error: "phone_needs_handshake",
              message: isColdSendLimited
                ? `Amber can only send 1 verification code per 15 minutes to people she's never texted. iMessage ${medhaPhone} 'hi' first to skip the wait, then tap Send code again.`
                : `iMessage ${medhaPhone} 'hi' first (or anything), then come back and tap Send code again. Amber can only text people she's already in a thread with.`,
              sender_phone: medhaPhone,
              imessage_code: isColdSendLimited ? 540 : 520,
            });
          }

          return reply.code(502).send({ error: "delivery_failed" });
        }

        request.log.info({
          storeMs: Math.round(storedAt - startedAt),
          deliveryMs: Math.round(performance.now() - storedAt),
          totalMs: Math.round(performance.now() - startedAt),
        }, "[mobile-auth] OTP delivery timing");
        return reply.send({ ok: true });
      } catch (err) {
        request.log.error(err, "[mobile-auth.otp/request] failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── POST /v1/auth/otp/verify ──────────────────────────────────────────────
  // Verify the submitted OTP and mint a medha session JWT.
  // Returns { token, amberId, isNewUser } where:
  //   token     — HS256 medha-id ACCESS JWT (15-min TTL), accepted by requireAuth Branch 2
  //   refreshToken — opaque, 60-day sliding, single-use, rotated on every
  //                  /v1/auth/refresh. Store it in the keychain, never in JS.
  //   amberId   — Cloud SQL users.amber_id (uuid) for this phone
  //   isNewUser — true if this is the first successful login from this phone
  app.post(
    "/v1/auth/otp/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["phone", "code"],
          properties: {
            phone: { type: "string", minLength: 7, maxLength: 20 },
            code:  { type: "string", minLength: 6, maxLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = toE164(request.body.phone);
      if (!phone) return reply.code(400).send({ error: "invalid_phone" });

      if (isReviewPhone(phone)) {
        const reviewed = await verifyReviewLogin(request.body.code);
        if (!reviewed.ok) return reply.code(401).send({ error: reviewed.reason });
        const pair = await issueSessionPair({ personId: reviewed.personId, phone, request, body: request.body });
        return reply.send({ ...pair, amberId: reviewed.amberId, isNewUser: false });
      }
      const result = await verifyMedhaOtp(phone, request.body.code);
      if (!result.ok) {
        return reply.code(result.reason === 'expired' ? 410 : 401).send({
          error: result.reason, attemptsRemaining: result.attemptsRemaining,
        });
      }

      // Detect new user before the get-or-create call.
      const existingUser = await getUserByPhone(phone).catch(() => null);
      const isNewUser = !existingUser;

      // Resolve (or create) the Cloud SQL user row and return the amber_id.
      const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!amberId) {
        return reply.code(503).send({ error: "account_unavailable" });
      }

      const personId = personIdFromHandle(phone);
      const pair = await issueSessionPair({
        personId,
        phone,
        request,
        body: request.body,
      });

      return reply.send({
        token: pair.token,
        refreshToken: pair.refreshToken,
        expiresIn: pair.expiresIn,
        amberId: String(amberId),
        isNewUser,
      });
    },
  );
}
