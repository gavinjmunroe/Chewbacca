/**
 * PHONE SIGN-IN. One file, one job.
 *
 *   POST /v1/auth/start              { phone }         → sends a code over Photon
 *   POST /v1/auth/issue-code         { phone }         → mints + persists a code (api key)
 *   POST /v1/auth/verify             { phone, code }   → session pair
 *   POST /v1/auth/verify-code-only   { code }          → session pair, phone from the code
 *   GET  /v1/auth/medha-me                             → who this session is
 *
 * WHY THIS FILE EXISTS. These five routes lived in a file called
 * medha-dashboard.js, named after a web surface being retired -- which meant
 * "delete the dashboard" would have deleted phone sign-in. amber-ios calls
 * /v1/auth/verify and /v1/auth/verify-code-only to log in. A file named after
 * one thing and load-bearing for another is how a safe deletion becomes an
 * outage, so the two are now separate.
 *
 * THE CODE GOES OVER PHOTON, the only messaging transport in this service. Same
 * sender as /v1/auth/otp/request in mobile-auth.js -- the app and this path
 * deliver a code identically, through one vendor.
 */

import { restrictedOtpDelivery } from "../lib/otp-delivery-error.js";
import { requireApiKey } from "../lib/auth.js";
import { requireMedhaJwt } from "../lib/medha-auth.js";
import {
  startMedhaOtp,
  verifyMedhaOtp,
  verifyMedhaOtpByCode,
} from "../lib/medha-otp-store.js";
import { sendIMessage } from "../lib/photon-sender.js";
import { generateOptInUrl, senderPhone } from "../lib/imessage-opt-in.js";
import { issueSessionPair } from "./auth-sessions.js";
import { personIdFromHandle } from "../pdw/person-resolver.js";
import { toE164 } from "../pdw/phone.js";
import { ensureTenantForPhone } from "./tenants.js";

import { isReviewPhone, reviewAccountConfigured } from "../lib/review-account.js";
import { verifyReviewLogin } from "../lib/review-login.js";

export function registerPhoneAuthRoutes(app) {

  app.post(
    "/v1/auth/start",
    {
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
      if (!phone) {
        return reply.code(400).send({ error: "invalid_phone" });
      }
      if (isReviewPhone(phone)) return reviewAccountConfigured()
        ? reply.send({ ok: true }) : reply.code(503).send({ error: "account_unavailable" });
      try {
        const { code, throttled } = await startMedhaOtp(phone);
        if (throttled) {
          return reply.code(429).send({ error: "resend_cooldown" });
        }
        // OTP body is intentionally URL-free. iMessage cold-send rules
        // reject first-contact messages that include links, attachments,
        // or marketing-shaped content with error code 180 'Invalid
        // contact phone number' — a misleading
        // surface for what's actually a content policy. Caleb's friend
        // hit this on 2026-05-27 and got 'Couldn't send the code' while
        // Caleb's own number worked because he already had a message
        // history with the Medha sender. Dropping the dashboard URL
        // unblocks first-time sends. The user is already ON the
        // dashboard when they request the code, so the link wasn't
        // load-bearing — they just paste the 6-digit code back into
        // the page they're already looking at.
        // PHOTON IS THE ONLY TRANSPORT. This used to POST the code to an
        // outside agent service, which meant sign-in depended on a deployment
        // outside amber-id. photon-sender.js is the same path /v1/auth/otp/request
        // already uses for the mobile app, so the dashboard and the app now
        // deliver a code the identical way.
        const sent = await sendIMessage({
          toPhone: phone,
          text: `Your Amber sign-in code: ${code}\n\nExpires in 5 minutes.`,
        });
        if (!sent.ok) {
          // Surface the upstream failure shape so a future debug session
          // (or a structured log drain) can see WHY delivery failed
          // instead of guessing at the 502. The user-visible error
          // stays the same; the extra fields are only useful at the
          // log + network-tab layer.
          request.log.warn(
            {
              reason: sent.reason,
              status: sent.status,
              detail: sent.detail,
            },
            "[auth.start] Photon delivery failed",
          );
          // Pattern-match known iMessage errors so the user sees a useful
          // message instead of generic delivery_failed. Code 180
          // ('Invalid contact phone number') fires when the target
          // phone is not iMessage-capable (Android, landline, VOIP)
          // or when the format isn't a number that can be dialled. Surface
          // as a dedicated error code so SignInForm can render
          // 'This phone can't receive iMessage' instead of the
          // generic 'try again in a moment.'
          const detail = sent.detail ? String(sent.detail) : "";
          const restricted = restrictedOtpDelivery(detail);
          if (restricted) return reply.code(503).send(restricted);

          const isNotIMessageCapable =
            detail.includes("Invalid contact phone number") ||
            detail.includes('"code": 180') ||
            detail.includes('"code":180');
          if (isNotIMessageCapable) {
            return reply.code(422).send({
              error: "phone_not_imessage",
              message:
                "That phone can't receive iMessage. Make sure it's an iPhone with iMessage turned on, then try again. (SMS fallback for Android is on the roadmap.)",
              agent_detail: detail.slice(0, 500),
            });
          }
          // 520 = 'no active conversations with sender' (sender
          // lacks init_conversations OR contact has never messaged us).
          // 540 = 'cold-send rate limit hit' (1 per 15 min per
          // sender, Apple-anti-spam guard).
          //
          // Both are bypassed cleanly by the OPT-IN URL flow: we call
          // lib/imessage-opt-in.js to build an imessage://
          // deep link, the user taps it, Messages.app opens with a
          // pre-filled body addressed to our sender, the user hits
          // send, the conversation becomes active. Subsequent
          // /message/send/ calls to that contact succeed instantly —
          // no cold-send limit, no init check, because the user
          // initiated. Render the imessage link in the response so
          // SignInForm can show a one-tap button.
          const detailStr = detail || "";
          const isNoActiveConversation =
            detailStr.includes("no active conversations") ||
            detailStr.includes('"code": 520') ||
            detailStr.includes('"code":520');
          const isColdSendLimited =
            detailStr.includes("reached the limit of sending messages") ||
            detailStr.includes('"code": 540') ||
            detailStr.includes('"code":540');
          if (isNoActiveConversation || isColdSendLimited) {
            const medhaPhone = senderPhone();
            const optIn = await generateOptInUrl({
              body: "Hi Medha [opt-in-code]",
              clickId: `signin-${phone}-${Date.now()}`,
            });
            if (optIn.ok && optIn.data?.imessage) {
              return reply.code(409).send({
                error: "phone_needs_opt_in",
                message:
                  "Tap the button to message Medha, then come back and tap Send code again.",
                opt_in_url: optIn.data.imessage,
                opt_in_sms_url: optIn.data.sms || null,
                opt_in_web_url: optIn.data.url || null,
                medha_phone: medhaPhone,
                // NOTE: this wire key is still `loop_code` because a dashboard
                // client this repo cannot see may read it. The transport is
                // Photon; only the key name is legacy. Rename it together with
                // the dashboard.
                loop_code: isColdSendLimited ? 540 : 520,
              });
            }
            // Opt-in link generation failed (no sender number configured).
            // Fall back to the manual-handshake instructions so the user
            // still has a path forward.
            return reply.code(409).send({
              error: "phone_needs_handshake",
              message: isColdSendLimited
                ? `Medha can only send 1 sign-in code per 15 minutes to people she's never texted. iMessage ${medhaPhone} 'hi' first to skip the wait, then tap Send code again.`
                : `iMessage ${medhaPhone} 'hi' first (or anything), then come back and tap Send code again. Medha can only text people she's already in a thread with.`,
              medha_phone: medhaPhone,
              loop_code: isColdSendLimited ? 540 : 520,
              agent_detail: detailStr.slice(0, 500),
            });
          }
          return reply.code(502).send({
            error: "delivery_failed",
            reason: sent.reason || null,
            agent_status: sent.status || null,
            // Pass through the agent's error body so the browser network
            // tab shows the actual cause. Without this every 502 reads
            // as 'Try again in a moment' which is unhelpful.
            agent_detail: detail ? detail.slice(0, 500) : null,
          });
        }
        return reply.send({ ok: true });
      } catch (err) {
        request.log.error(err, "auth.start failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // POST /v1/auth/issue-code
  //
  // Mints a sign-in code for `phone` AND PERSISTS IT in the OTP store
  // (so /v1/auth/verify accepts it later), but sends nothing.
  //
  // Used by the agent-side inbound handler: when a new user iMessages
  // 'Hi Medha' (the opt-in flow the /sign-in button triggers), the
  // agent receives the inbound, knows the sender's phone, and now
  // owns a WARM conversation with that phone. The agent calls this
  // endpoint to mint a code, then sends it back over the same warm
  // iMessage thread via the agent's own send path. That bypasses
  // The cold-send rate limit (540) and init-conversation gate (520)
  // entirely because we never make a cold send on the sign-in
  // path — the user initiates the conversation, we reply in-thread.
  //
  // Body: { phone: string }
  // 200:  { ok: true, code: '123456', expires_in_seconds: 300 }
  // 400:  { error: 'invalid_phone' }
  // 429:  { error: 'resend_cooldown' }
  // 500:  { error: 'internal_error' }
  // SECURITY: requireApiKey is load-bearing here, not decoration.
  //
  // This endpoint returns the PLAINTEXT sign-in code in its response body, by
  // design -- the agent needs it in order to send it over the user's warm
  // iMessage thread. That makes it a server-to-server endpoint and nothing
  // else. Without the API-key gate, anyone could POST a phone number, read the
  // code straight out of the response, and exchange it at /v1/auth/verify for a
  // session -- full account takeover of any user, given only their phone
  // number. Every other agent-called route in this file is already gated the
  // same way; this one was missed.
  //
  // Do not remove this preHandler. If a client ever needs to trigger a code,
  // it must use POST /v1/auth/otp/request (routes/mobile-auth.js), which
  // delivers out-of-band and never returns the code.
  app.post(
    "/v1/auth/issue-code",
    {
      preHandler: [requireApiKey],
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
      if (isReviewPhone(phone)) return reviewAccountConfigured()
        ? reply.send({ ok: true }) : reply.code(503).send({ error: "account_unavailable" });
      try {
        const { code, throttled } = await startMedhaOtp(phone);
        if (throttled) {
          return reply.code(429).send({ error: "resend_cooldown" });
        }
        return reply.send({
          ok: true,
          code,
          expires_in_seconds: 300,
        });
      } catch (err) {
        request.log.error(err, "auth.issue-code failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/auth/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["phone", "code"],
          properties: {
            phone: { type: "string" },
            code: { type: "string", minLength: 6, maxLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = toE164(request.body.phone);
      if (!phone) return reply.code(400).send({ error: "invalid_phone" });
      const review = isReviewPhone(phone);
      const result = review ? await verifyReviewLogin(request.body.code) : await verifyMedhaOtp(phone, request.body.code);
      if (!result.ok) {
        const status = result.reason === "expired" ? 410 : 401;
        return reply.code(status).send({ error: result.reason });
      }
      const personId = personIdFromHandle(phone);
      // Self-provision a tenant on first sign-in so the in-app agent works for
      // every new user (idempotent; never throws). Without a tenant, /v1/me
      // returns null identity and the quick-call path 424s.
      if (!review) await ensureTenantForPhone(phone);
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
        person_id: personId,
      });
    },
  );

  // POST /v1/auth/verify-code-only
  //
  // Code-only verify for the simplified /sign-in flow. The user
  // never types their phone on the dashboard — they iMessage Medha
  // with 'What's my login code?', the agent issues a code keyed to
  // the inbound phone, the user pastes the code on the web. This
  // route looks up the phone from the code via the OTP store's
  // reverse index, then verifies and mints the session JWT the
  // same way /v1/auth/verify does.
  //
  // Body: { code: '123456' }
  // 200:  { token, person_id }
  // 401:  { error: 'not_found' | 'expired' | 'mismatch' | 'too_many_attempts' | 'invalid_format' }
  app.post(
    "/v1/auth/verify-code-only",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 4, maxLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await verifyMedhaOtpByCode(request.body.code);
      if (!result.ok) {
        const status = result.reason === "expired" ? 410 : 401;
        return reply.code(status).send({ error: result.reason });
      }
      const personId = personIdFromHandle(result.phone);
      // Self-provision a tenant on first sign-in so the in-app agent works for
      // every new user (idempotent; never throws). This is the path the iOS app
      // uses (warm-OTP), so it is the one that unblocks in-app Medha for anyone.
      await ensureTenantForPhone(result.phone);
      const pair = await issueSessionPair({
        personId,
        phone: result.phone,
        request,
        body: request.body,
      });
      return reply.send({
        token: pair.token,
        refreshToken: pair.refreshToken,
        expiresIn: pair.expiresIn,
        person_id: personId,
        phone: result.phone,
      });
    },
  );

  app.get(
    "/v1/auth/medha-me",
    { preHandler: [requireMedhaJwt] },
    async (request) => {
      const { personId, phone } = request.medhaSession;
      return { person_id: personId, phone };
    },
  );
}
