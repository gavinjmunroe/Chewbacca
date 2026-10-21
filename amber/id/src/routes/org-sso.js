/**
 * CONTINUE WITH GOOGLE, for a company account.
 *
 *   GET /v1/org/auth/google/start      -> redirect to Google
 *   GET /v1/org/auth/google/callback   -> Google sends them back here
 *
 * Neither has requireAuth, which is the point and the reason this is its own
 * short file: somebody signing in has no session yet.
 *
 * ── THE RULE THAT MAKES THIS SAFE ──────────────────────────────────────────
 *
 * Google tells us, reliably, which verified address somebody controls. It does
 * NOT tell us whether that person should be in anybody's company. So this
 * signs in to an account that already exists, and creates one only when there
 * is a live invitation to that exact address.
 *
 * Without that rule "Continue with Google" is an open registration form: any
 * Gmail in the world becomes an Amber work account. With it, the button is
 * exactly as privileged as the invitation already was -- which is the property
 * worth having, because it means turning Google on grants nobody anything they
 * did not already have.
 *
 * ── WHY THE SESSION DOES NOT COME BACK IN THE REDIRECT ─────────────────────
 *
 * Google redirects a browser, so anything we hand back is in a URL: in
 * history, in the referrer, in any proxy's logs. So the redirect carries a
 * one-time, fifteen-minute login token instead -- the same object the email
 * sign-in link already uses, consumed by the same /signin page, which already
 * knows how to trade it for a session and has for months. A token that is
 * single-use and short-lived is an acceptable thing to put in a URL; a
 * session that lasts days is not.
 */

import crypto from "node:crypto";
import {
  buildSignInUrl,
  exchangeSignInCode,
  googleSignInConfigured,
  verifyIdToken,
} from "../lib/google-identity.js";
import {
  acceptInvite,
  ensureAccountForWorkEmail,
  findAccountByEmail,
  normalizeEmail,
  peekInviteByEmail,
} from "../db/org-invite-store.js";
import { issueLoginToken } from "../db/email-login-store.js";
import { webBaseUrl } from "../lib/email-delivery.js";

/**
 * The state parameter, signed rather than stored.
 *
 * It has to survive a round trip through Google and come back provably ours,
 * and it lives for ninety seconds. A database row for that is a row to write,
 * read, expire and clean up; an HMAC over a nonce and a timestamp does the
 * same job with nothing to garbage-collect.
 */
function stateSecret() {
  const s = process.env.AMBER_JWT_SECRET || process.env.GOOGLE_SIGNIN_CLIENT_SECRET;
  if (!s) throw new Error("no secret available for google sign-in state");
  return s;
}

function mintState(returnTo, intent) {
  const payload = Buffer.from(
    JSON.stringify({
      n: crypto.randomBytes(9).toString("base64url"),
      t: Date.now(),
      r: returnTo ?? null,
      // "register" means the person pressed Continue with Google on the CREATE
      // AN ACCOUNT screen. It is signed into the state rather than read off the
      // callback's query string, because a flag that decides whether an account
      // gets created must not be something a stranger can append to a URL.
      i: intent === "register" ? "register" : "signin",
    }),
  ).toString("base64url");
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function readState(state) {
  const [payload, mac] = String(state ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  // timingSafeEqual throws on a length mismatch, which a forged state can
  // cause deliberately.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const out = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Date.now() - Number(out.t) > 10 * 60 * 1000) return null;
    return out;
  } catch {
    return null;
  }
}

export function registerOrgSsoRoutes(app) {
  app.get("/v1/org/auth/google/start", async (request, reply) => {
    if (!googleSignInConfigured()) {
      return reply.code(503).send({
        error: "google_not_configured",
        message: "Google sign-in is not set up on this server.",
      });
    }
    const hint = normalizeEmail(request.query?.email);
    const url = buildSignInUrl({
      state: mintState(request.query?.returnTo ?? null, request.query?.intent),
      loginHint: hint,
    });
    return reply.redirect(url);
  });

  app.get("/v1/org/auth/google/callback", async (request, reply) => {
    const site = webBaseUrl(request);
    /** Every failure goes back to the sign-in page wearing a reason, never a stack. */
    const where = readState(request.query?.state)?.i === "register" ? "/login/work?mode=new&" : "/login/work?";
    const fail = (why) => reply.redirect(`${site}${where}sso=${encodeURIComponent(why)}`);

    if (!googleSignInConfigured()) return fail("not_configured");
    if (request.query?.error) return fail("declined");
    const state = readState(request.query?.state);
    if (!state) return fail("bad_state");

    const code = String(request.query?.code ?? "");
    if (!code) return fail("no_code");

    const exchanged = await exchangeSignInCode(code).catch(() => ({ ok: false }));
    if (!exchanged.ok) return fail("exchange_failed");

    const identity = await verifyIdToken(exchanged.idToken).catch(() => ({ ok: false, reason: "threw" }));
    if (!identity.ok) {
      request.log?.warn?.({ reason: identity.reason }, "[sso] google id_token rejected");
      return fail(identity.reason === "email_unverified" ? "email_unverified" : "bad_token");
    }

    /*
     * THREE WAYS IN, AND NO FOURTH.
     *
     *   1. The address already has an account        -> sign in
     *   2. There is a live invitation to it          -> accept it, enroll them
     *   3. They pressed the button on CREATE ACCOUNT -> make an account that
     *                                                   is in no company yet
     *
     * The third is new and is the narrowest of the three despite looking like
     * the widest. It makes an account and nothing else: no membership, no
     * company, no access to anybody's data. The person lands on the company
     * setup wizard, exactly where "sign up with email and a password" lands
     * them. Without it, "Continue with Google" on a signup screen could only
     * ever fail, which is what it did.
     *
     * What is still refused is case 1 and 2 failing on a SIGN-IN screen: a
     * Google address with no account and no invitation gets "no_account"
     * rather than an account, so turning Google on still grants nobody
     * entry to a company they were not already invited to.
     */
    let amberId = await findAccountByEmail(identity.email).catch(() => null);

    if (!amberId) {
      const invite = await peekInviteByEmail(identity.email).catch(() => null);
      if (invite) {
        // Accepting creates the work account for the invited address, enrolls
        // them, and is the same path the link in the email takes. Google has
        // just proved they control that address, which is what the link was
        // standing in for.
        const accepted = await acceptInvite({
          token: null, inviteId: invite.id, verifiedEmail: identity.email,
        });
        if (!accepted.ok) return fail("invite_failed");
        amberId = accepted.amberId;
      } else if (state.i === "register") {
        const made = await ensureAccountForWorkEmail(identity.email);
        if (!made.ok) return fail("register_failed");
        amberId = made.amberId;
      } else {
        return fail("no_account");
      }
    }

    const issued = await issueLoginToken({
      email: identity.email,
      amberId,
      requesterIp: request.ip ?? null,
    });
    if (!issued.ok) return fail("rate_limited");

    /*
     * The existing /signin page consumes this and trades it for a session,
     * then sends them to /org -- which already forwards an account with no
     * company on to the setup wizard. A brand-new account therefore lands in
     * the right place without this redirect having to know about it.
     */
    return reply.redirect(`${site}/signin?token=${encodeURIComponent(issued.token)}`);
  });

  /** So the sign-in page can decide whether to draw the button at all. */
  app.get("/v1/org/auth/methods", async () => ({
    google: googleSignInConfigured(),
    password: true,
    emailLink: Boolean(process.env.RESEND_API_KEY),
  }));
}
