/**
 * SIGN IN WITH APPLE AND SIGN IN WITH GOOGLE — one flow, two providers.
 *
 *   POST /v1/auth/{provider}        { <token>, rawNonce }
 *       known identity   -> { token, refreshToken, amberId, isNewUser: false }
 *       unknown identity -> { needsPhone: true, ticket, expiresIn }
 *
 *   POST /v1/auth/{provider}/link   { ticket, phone, code }
 *                                -> { token, refreshToken, amberId, isNewUser }
 *
 * WHY TWO STEPS, AND WHY THE PHONE IS NOT OPTIONAL. Neither provider tells us a
 * phone number, so a first-time social sign-in cannot answer "does this person
 * already have an Amber account?" -- Apple private-relay addresses mean there is
 * often no shared field to match on at all. So a phone + OTP is required before a
 * social identity becomes usable, and the identity is ATTACHED to the
 * phone-resolved user. One human, one users row, at the cost of one extra screen
 * the first time.
 *
 * A PHONE IS THE ROOT OF IDENTITY HERE, AND THAT IS THE SECURITY MODEL. An
 * identity NEVER creates a user (see db/user-identities-store.js). Apple and
 * Google are additional ways to sign in to an account the phone already
 * established -- which is why adding a provider cannot widen who can get in, and
 * why matching on a provider email is never, anywhere, enough to join an
 * existing account.
 *
 * ONE FILE FOR BOTH, because the flow is genuinely identical and the parts that
 * differ are four values. The alternative was a second 250-line copy of the most
 * security-critical route in the service, where a fix to one is a fix to one.
 *
 * The ticket between the steps is server-signed AND provider-bound
 * (lib/apple-ticket.js). The provider `sub` is never handed to the client and
 * taken back: a `sub` is not a secret, and anyone could then bind someone else's
 * Apple or Google ID to their own phone.
 */

import { toE164 } from "../pdw/phone.js";
import { verifyAppleIdentityToken } from "../lib/apple-auth.js";
import { verifyGoogleIdToken } from "../lib/google-auth.js";
import { issueLinkTicket, verifyLinkTicket } from "../lib/apple-ticket.js";
import { verifyMedhaOtp } from "../lib/medha-otp-store.js";
import { isReviewPhone } from "../lib/review-account.js";
import { findIdentity, linkIdentity, touchIdentity } from "../db/user-identities-store.js";
import { getUserByPhone, resolveAmberIdByPhone } from "../db/store.js";
import { query } from "../db/sql.js";
import { issueSessionPair } from "./auth-sessions.js";
import { personIdFromHandle } from "../pdw/person-resolver.js";
import { setDiscoveryKeys } from "../db/discovery-store.js";
import { linkResolvableContacts } from "../db/identity-link.js";
import { notifyPendingCircleInvites } from "../lib/circle-invite-notify.js";

/** The phone on a users row. issueSessionPair needs it: person_id is derived from
 *  the phone, and the whole rest of the service resolves the caller by it. */
async function phoneForAmberId(amberId) {
  const { rows } = await query(
    `SELECT phone FROM users WHERE amber_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
    [amberId],
  );
  return rows[0]?.phone ?? null;
}

export function registerSocialAuthRoutes(app, config) {
  const { provider, verifyToken, tokenField, label } = config;
  const base = `/v1/auth/${provider}`;
  const tag = `[${provider}-auth]`;
  // ── POST /v1/auth/{provider} ──────────────────────────────────────────────
  app.post(
    `${base}`,
    {
      config: {
        // Unauthenticated and credential-minting, same class as /v1/auth/refresh.
        rateLimit: { max: 20, timeWindow: "15 minutes" },
      },
      schema: {
        body: {
          type: "object",
          required: [tokenField],
          properties: {
            [tokenField]: { type: "string", minLength: 40, maxLength: 8192 },
            rawNonce: { type: "string", minLength: 8, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const verified = await verifyToken(request.body[tokenField], {
        rawNonce: request.body.rawNonce ?? null,
      });
      if (!verified.ok) {
        // The reason is logged, never returned: the failure modes distinguish
        // "expired" from "wrong audience" from "forged", and that is a map of the
        // verifier for anyone probing it.
        request.log.warn({ reason: verified.reason }, `${tag} identity token rejected`);
        return reply.code(401).send({ error: `${provider}_auth_failed` });
      }

      const identity = await findIdentity(provider, verified.sub).catch(() => null);
      if (identity) {
        const phone = await phoneForAmberId(identity.amberId).catch(() => null);
        if (!phone) {
          // The identity outlived its user (deleted account). Make them re-link
          // rather than minting a session against a row that is gone.
          request.log.warn({ amberId: identity.amberId }, `${tag} identity with no live user`);
          const { ticket, expiresIn } = issueLinkTicket(provider, verified);
          return reply.send({ needsPhone: true, ticket, expiresIn });
        }
        // The pair, not an id: user_identities is keyed on (provider, subject)
        // and the store no longer invents a surrogate. identity.id was undefined,
        // so this UPDATE matched nothing and last_used_at never moved.
        void touchIdentity(provider, verified.sub);
        const pair = await issueSessionPair({
          personId: personIdFromHandle(phone),
          phone,
          request,
          body: request.body,
        });
        return reply.send({
          token: pair.token,
          refreshToken: pair.refreshToken,
          expiresIn: pair.expiresIn,
          amberId: identity.amberId,
          isNewUser: false,
          /**
           * THE ACCOUNT'S PHONE, because the client has no other way to learn it
           * on this path and it stores it beside the session.
           *
           * The OTP flow knows the phone -- the user just typed it. A returning
           * Apple or Google sign-in never sees one, so without this the app
           * either keeps an empty phone (and shows a blank where the number
           * should be, forever) or invents a placeholder, which is worse. It is
           * the caller's OWN number, returned only after they proved they hold
           * the provider identity attached to that account.
           */
          phone,
        });
      }

      // First time for this identity. Nothing is created yet: the phone step is
      // what decides whether this joins an existing account or starts a new one.
      const { ticket, expiresIn } = issueLinkTicket(provider, verified);
      return reply.send({ needsPhone: true, ticket, expiresIn });
    },
  );

  // ── POST /v1/auth/{provider}/link ─────────────────────────────────────────
  // The reconciliation step. Verifies the OTP exactly the way /v1/auth/otp/verify
  // does, resolves (or creates) the user by phone, and attaches the provider identity
  // carried in the ticket.
  app.post(
    `${base}/link`,
    {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["ticket", "phone", "code"],
          properties: {
            ticket: { type: "string", minLength: 16, maxLength: 4096 },
            phone: { type: "string", minLength: 7, maxLength: 20 },
            code: { type: "string", minLength: 6, maxLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const t = verifyLinkTicket(provider, request.body.ticket);
      if (!t.ok) {
        request.log.warn({ reason: t.reason }, `${tag} link ticket rejected`);
        return reply
          .code(401)
          .send({ error: t.reason === "ticket_expired" ? "ticket_expired" : "bad_ticket" });
      }

      const phone = toE164(request.body.phone);
      if (!phone) return reply.code(400).send({ error: "invalid_phone" });

      // A shared review account must never attach a reviewer's personal identity.
      if (isReviewPhone(phone)) return reply.code(403).send({ error: 'review_phone_only' });
      const result = await verifyMedhaOtp(phone, request.body.code);
      if (!result.ok) return reply.code(result.reason === 'expired' ? 410 : 401).send({ error: result.reason });

      const existingUser = await getUserByPhone(phone).catch(() => null);
      const isNewUser = !existingUser;

      const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
      if (!amberId) return reply.code(503).send({ error: "account_unavailable" });

      const linked = await linkIdentity({
        amberId,
        provider,
        subject: t.sub,
        email: t.email,
        emailVerified: t.emailVerified,
        isPrivateEmail: t.isPrivateEmail,
      });
      if (!linked.ok) {
        if (linked.reason === "subject_taken") {
          // This provider identity is already live on another account. Refusing is
          // the whole point of the unique index: re-pointing it would hand one
          // person's account to whoever verified a phone last.
          request.log.warn({ amberId }, `${tag} subject already linked elsewhere`);
          return reply.code(409).send({ error: `${provider}_id_already_linked` });
        }
        return reply.code(500).send({ error: "link_failed" });
      }

      // "...THE SECOND THEY SIGN UP FOR AMBER WITH THEIR PHONE NUMBER OR EMAIL."
      //
      // The phone half already happens: resolveAmberIdByPhone claims the phone
      // discovery key on a brand-new account and links every contact card
      // carrying it. This is the email half, and it is only possible HERE.
      //
      // A discovery key must come from something the account has PROVEN it owns
      // -- claiming an email somebody typed into their profile would let anyone
      // claim the circles and shared notes belonging to whoever's address it was.
      // The provider's id token is proof: `email_verified` comes from Apple or
      // Google, not from the client. So this is the one place in the app where an email is
      // good enough to resolve people by, and it is why the email half of that
      // sentence works on social sign-in and nowhere else yet.
      //
      // setDiscoveryKeys REFUSES a key another account already holds (it does not
      // steal it), so a shared or recycled address cannot take somebody's
      // identity. linkResolvableContacts then points every card holding that key
      // at this account -- and refuses any card that resolves to two accounts.
      //
      // Best-effort and awaited: it runs at most once per account per address,
      // the very next thing the app does is ask what is waiting for it, and a
      // failure must not cost a valid sign-in.
      if (t.email && t.emailVerified) {
        try {
          await setDiscoveryKeys(amberId, { emails: [t.email] });
          const linked = await linkResolvableContacts({ amberId });
          if (linked.linked > 0) {
            request.log.info(
              `${tag} ${linked.linked} contact card(s) resolved to amber=${amberId} by verified email`,
            );
          }
        } catch (err) {
          request.log.warn(
            `${tag} email discovery claim failed for amber=${amberId}: ${err?.message || err}`,
          );
        }
      }

      // AND TELL THEM WHAT THEY WALKED INTO. Detached: a push must not sit in
      // front of a sign-in, and circle_invites records who has been told so this
      // cannot notify the same person twice. It is also fired from push-token
      // registration, which is the path that catches a phone-only signup.
      void notifyPendingCircleInvites(app, String(amberId), { log: request.log }).catch(
        () => {},
      );

      const pair = await issueSessionPair({
        personId: personIdFromHandle(phone),
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
        // Echoed for symmetry with the branch above, so the client stores the
        // same field on both paths rather than one of two shapes.
        phone,
      });
    },
  );
}

/**
 * The two providers, registered.
 *
 * `label` is what a human sees; `tokenField` is what the CLIENT sends, and the
 * two differ because the SDKs name it differently: Apple's
 * ASAuthorizationAppleIDCredential gives `identityToken`, Google Sign-In gives
 * `idToken`. Renaming either at the boundary would be tidier and would mean
 * every existing Apple client stops working.
 */
export function registerAppleAuthRoutes(app) {
  return registerSocialAuthRoutes(app, {
    provider: "apple",
    label: "Apple",
    tokenField: "identityToken",
    verifyToken: verifyAppleIdentityToken,
  });
}

export function registerGoogleAuthRoutes(app) {
  return registerSocialAuthRoutes(app, {
    provider: "google",
    label: "Google",
    tokenField: "idToken",
    verifyToken: verifyGoogleIdToken,
  });
}
