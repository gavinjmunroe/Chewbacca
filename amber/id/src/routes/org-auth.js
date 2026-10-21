/**
 * ORG AUTH — the two things a person does before they have a session.
 *
 *   GET  /v1/org/invites/preview?token=…   which company is this, and for whom
 *   POST /v1/org/invites/accept            accept; creates the account if new
 *   POST /v1/org/auth/email/request        send a sign-in link to a work address
 *   POST /v1/org/auth/email/verify         spend the link, get a session
 *
 * NONE OF THESE HAVE requireAuth ON THEM, which is the whole point and also the
 * reason this file is separate from org.js: it is the attack surface, it is
 * four routes long, and it can be read in one sitting.
 *
 * TWO RULES HOLD EVERYWHERE IN HERE.
 *
 * 1. A TOKEN NEVER COMES BACK IN A RESPONSE EXCEPT THE SESSION ITSELF. The
 *    sign-in link leaves this service in an email to the address it names, and
 *    nowhere else. An endpoint that returned it would be an unauthenticated way
 *    to log in as anybody whose work address you could guess.
 *
 * 2. THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT.
 *    /email/request always says "check your inbox". Saying "no such account"
 *    would turn it into a way to ask which addresses at a company are on Amber,
 *    which is a question a competitor, a recruiter or an attacker would all
 *    like answered.
 */

import { signSessionToken } from "../lib/amber-jwt.js";
import { webSessionScopeFor } from "../lib/token-scope.js";
import {
  acceptInvite,
  signInWithIdentifier,
  signInWithPassword,
  ensureAccountForWorkEmail,
  findAccountByEmail,
  markEmailVerified,
  normalizeEmail,
  peekInvite,
  setAccountPassword,
  setDisplayName,
} from "../db/org-invite-store.js";
import { consumeLoginToken, issueLoginToken } from "../db/email-login-store.js";
import { getMembership } from "../db/org-store.js";
import { joinByDomain } from "../db/org-domain-join.js";
import { query } from "../db/sql.js";
import { emailConfigured, sendEmail, webBaseUrl } from "../lib/email-delivery.js";

/** A browser session: hours, not the thirty days a phone in a pocket gets. */
const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * Mint the session for a resolved account.
 *
 * The DID is `did:amber:<amber_id>`, the uuid form, NOT the hashed-phone form
 * /v1/otp/verify uses. That is required rather than cosmetic: an email-only
 * account has no phone to hash and no phone claim in its token, so the only
 * thing that can resolve it on the next request is the subject itself -- and
 * resolveAmberIdByPrivyDid resolves this shape and not the other.
 */
async function mintSession(amberId) {
  /*
   * JOIN THE WORKSPACE THAT OWNS THIS ADDRESS'S DOMAIN, BEFORE READING THE
   * MEMBERSHIP -- and here rather than in each route, because there are five
   * ways into a session and the one somebody uses is the one that would have
   * been forgotten.
   *
   * THE FAILURE THIS ENDS, watched live. Somebody signed up with their work
   * address and landed in a product where every screen was empty. Signing up
   * created the account and joined nothing; the only path into a workspace
   * was an invitation. So anybody who found the sign-up page first -- which
   * is everybody, because that is what a sign-up page is for -- held a valid
   * account to a company they were not in, and a calendar they connected
   * synced perfectly into a workspace nobody was looking at.
   *
   * The scope is minted from the membership two lines down, so this has to
   * happen first or the person is admitted and handed a token that says
   * otherwise.
   */
  const { rows: addr } = await query(
    `SELECT subject FROM user_identities
      WHERE amber_id = $1::uuid AND provider = 'email' AND deleted_at IS NULL
      LIMIT 1`,
    [amberId],
  ).catch(() => ({ rows: [] }));

  if (addr[0]?.subject) {
    await joinByDomain({ amberId, email: addr[0].subject }).catch(() => null);
  }

  const membership = await getMembership(amberId).catch(() => null);
  const scope = webSessionScopeFor(membership);
  const { token, expiresAt } = signSessionToken({
    did: `did:amber:${amberId}`,
    scope: [...scope],
    ttlSeconds: WEB_SESSION_TTL_SECONDS,
  });
  return { token, expiresAt, scope, membership };
}

export function registerOrgAuthRoutes(app) {
  /**
   * What the join screen shows before anybody clicks. Does not consume the
   * invite. One answer -- 404 -- for expired, revoked, used and never-existed,
   * because telling the difference tells a stranger about a company.
   */
  app.get("/v1/org/invites/preview", async (request, reply) => {
    const invite = await peekInvite(String(request.query?.token || ""));
    if (!invite) {
      return reply.code(404).send({
        error: "invalid_invite",
        message: "That invitation is no longer valid.",
      });
    }
    return {
      org: { name: invite.orgName, slug: invite.orgSlug },
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  });

  /**
   * Accept, and come back with a session for the WORK account.
   *
   * An Authorization header is ignored, deliberately. It used to mean "I
   * already have an Amber account, put that one in the company", which is how
   * somebody's personal account -- their own address book, their own graph --
   * became a company's because they happened to be signed in when they opened a
   * link from their work inbox. The account is resolved from the invited
   * address and from nothing else.
   */
  app.post("/v1/org/invites/accept", async (request, reply) => {
    const token = String(request.body?.token || "");
    const out = await acceptInvite({ token });
    if (!out.ok) {
      const status = out.reason === "already_in_org" ? 409 : 400;
      return reply.code(status).send({
        error: out.reason,
        message:
          out.reason === "already_in_org"
            ? "This account already belongs to an organization."
            : "That invitation is no longer valid.",
      });
    }
    const session = await mintSession(out.amberId);
    return reply.code(201).send({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      scope: session.scope,
      orgId: out.orgId,
      role: out.role,
      user: { did: `did:amber:${out.amberId}`, email: out.email },
      accountCreated: out.accountCreated,
    });
  });

  /**
   * Send a sign-in link. Always answers the same thing.
   *
   * The one case that DOES differ is mail not being configured at all, which is
   * a server fact rather than a fact about the address, and silently accepting
   * a request that can never arrive would leave somebody staring at an inbox.
   */
  app.post("/v1/org/auth/email/request", async (request, reply) => {
    if (!emailConfigured()) {
      return reply.code(503).send({
        error: "email_unavailable",
        message: "Email sign-in is not available on this deployment yet.",
      });
    }
    const email = normalizeEmail(request.body?.email);
    if (!email) return reply.code(400).send({ error: "bad_email" });

    const amberId = await findAccountByEmail(email);
    if (amberId) {
      const issued = await issueLoginToken({
        email,
        amberId,
        requesterIp: request.ip ?? null,
      });
      if (issued.ok) {
        await sendEmail({
          to: email,
          subject: "Your Amber sign-in link",
          text:
            `Sign in to Amber: ${webBaseUrl(request)}/signin?token=${encodeURIComponent(issued.token)}\n\n` +
            `The link works once and expires in 15 minutes. ` +
            `If you did not ask for it, ignore this email.`,
        }).catch(() => null);
      }
    }
    // Deliberately identical for an address with no account, an address over
    // its rate limit, and an address the mail provider refused.
    return { ok: true, sent: true };
  });

  /**
   * SETTING UP A COMPANY STARTS WITH A WORK ADDRESS, not a phone number.
   *
   * The phone is the right identity for the consumer product -- it is the one
   * people already text you on. It is the wrong one for an enterprise, where
   * the identity that matters is the one the company issued, the one that stops
   * working on somebody's last day, and the one a colleague already has.
   *
   * It also keeps the two instances apart by construction. An admin who signs
   * up with their work address gets a COMPANY ACCOUNT, separate from whatever
   * personal Amber they may already have on their phone -- which is the
   * separation the whole model rests on, arranged so that nobody has to think
   * about it. Linking the phone afterwards is a convenience, not a merge.
   *
   * Same answer whether or not an account already exists, for the same reason
   * /email/request gives one answer: a different reply would say which
   * addresses at a company are already here.
   */
  app.post("/v1/org/auth/email/signup", async (request, reply) => {
    if (!emailConfigured()) {
      return reply.code(503).send({
        error: "email_unavailable",
        message: "Email sign-in is not available on this deployment yet.",
      });
    }
    const email = normalizeEmail(request.body?.email);
    if (!email) return reply.code(400).send({ error: "bad_email" });

    const account = await ensureAccountForWorkEmail(email);
    if (!account.ok) return reply.code(503).send({ error: account.reason });

    const issued = await issueLoginToken({
      email,
      amberId: account.amberId,
      requesterIp: request.ip ?? null,
    });
    if (issued.ok) {
      await sendEmail({
        to: email,
        subject: "Set up your organization on Amber",
        text:
          `Continue here: ${webBaseUrl(request)}/signin?token=${encodeURIComponent(issued.token)}\n\n` +
          `The link works once and expires in 15 minutes. ` +
          `If you did not ask for it, ignore this email.`,
      }).catch(() => null);
    }
    return { ok: true, sent: true };
  });

  /**
   * CREATE A COMPANY ACCOUNT, RIGHT HERE, WITH A PASSWORD.
   *
   * This exists because signing up and signing in were literally the same
   * screen: both sent a link to a work address, so "create an account" and "I
   * already have one" produced the identical inbox message, and if the mail
   * provider was not configured neither worked at all. Somebody setting up
   * their company should be able to do it in one page load.
   *
   * THE ADDRESS IS NOT VERIFIED HERE AND THAT IS DELIBERATE. What this account
   * can do until it is verified is own a company nobody else is in. Anything
   * that involves another person -- an invitation -- goes to that person's
   * inbox and is accepted from there, so an unverified founder cannot pull
   * anybody in by typing their address.
   *
   * AN ADDRESS THAT ALREADY HAS AN ACCOUNT IS TOLD SO. The usual argument for
   * one vague answer is that a different reply reveals who is on Amber -- but
   * a registration form that silently signs you in to somebody else's account,
   * or silently does nothing, is worse than the disclosure. The flow that must
   * stay vague is /email/request, and it still is.
   */
  app.post(
    "/v1/org/auth/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 320 },
            password: { type: "string", minLength: 1, maxLength: 200 },
            fullName: { type: ["string", "null"], maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body?.email);
      if (!email) {
        return reply.code(400).send({ error: "bad_email", message: "That is not an email address." });
      }

      const existing = await findAccountByEmail(email).catch(() => null);
      if (existing) {
        return reply.code(409).send({
          error: "already_registered",
          message: "That address already has an account. Sign in instead.",
        });
      }

      const account = await ensureAccountForWorkEmail(email);
      if (!account.ok) {
        return reply.code(503).send({ error: account.reason, message: "Could not create that account." });
      }

      const pw = await setAccountPassword(account.amberId, request.body.password);
      if (!pw.ok) {
        return reply.code(400).send({ error: pw.reason, message: pw.message ?? "Pick a stronger password." });
      }

      const name = String(request.body?.fullName ?? "").trim();
      if (name) await setDisplayName(account.amberId, name).catch(() => null);

      const session = await mintSession(account.amberId);
      reply.code(201);
      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        scope: session.scope,
        user: { did: `did:amber:${account.amberId}` },
        org: null,
      };
    },
  );

  /**
   * SIGN IN WITH A WORK EMAIL AND A PASSWORD.
   *
   * The ordinary door, and it exists because the other one could close. An
   * account created from a work email has no phone, so its only way in was a
   * link mailed to that address -- which means an unconfigured mail provider,
   * or a DNS record still propagating, left that account with NO way in at all.
   *
   * One answer for every failure: unknown address, no password set, wrong
   * password. A different reply for any of them would make this a way to ask
   * which addresses at a company have accounts.
   */
  /**
   * ONE FIELD, EMAIL OR USERNAME.
   *
   * Asking somebody to first classify their own identifier is asking them to
   * do the computer's job, and an @ settles it -- which is also exactly why
   * the username CHECK forbids one. `email` is still accepted as the field
   * name so the existing clients keep working.
   */
  app.post("/v1/org/auth/password", async (request, reply) => {
    const body = request.body ?? {};
    const identifier = body.identifier ?? body.username ?? body.email;
    /*
     * A DATABASE THAT DID NOT ANSWER IS NOT A WRONG PASSWORD.
     *
     * This was `.catch(() => null)`, so an unreachable database and a bad
     * password produced the same value and the same sentence: "That does not
     * match an account." A founder whose Cloud SQL instance had become
     * unreachable was told, by his own product, that his account did not
     * exist -- while every row sat untouched in a database the API simply
     * could not open a connection to.
     *
     * Same rule as resolve-actor.js: a throw is UNAVAILABLE, and only a clean
     * lookup that finds nobody is a credential problem. 401 tells a browser
     * the credential is bad and sends somebody to reset a password that was
     * always correct; 503 says ask again, which is both true and actionable.
     */
    let amberId;
    try {
      amberId = await signInWithIdentifier(identifier, body.password);
    } catch (err) {
      request.log?.error?.({ err: err?.message }, "[org-auth] sign-in lookup failed");
      reply.header("retry-after", "2");
      return reply.code(503).send({
        error: "lookup_unavailable",
        message:
          "We could not reach the account service just now. Your password is fine — try again in a moment.",
      });
    }

    if (!amberId) {
      return reply.code(401).send({
        error: "bad_credentials",
        message: "That does not match an account. Check the email or username and the password.",
      });
    }
    const session = await mintSession(amberId);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      scope: session.scope,
      user: { did: `did:amber:${amberId}` },
      org: session.membership
        ? { id: session.membership.orgId, name: session.membership.orgName, role: session.membership.role }
        : null,
    };
  });

  app.post("/v1/org/auth/email/verify", async (request, reply) => {
    const spent = await consumeLoginToken(String(request.body?.token || ""));
    if (!spent) {
      return reply.code(401).send({
        error: "invalid_token",
        message: "That sign-in link has expired or has already been used.",
      });
    }
    // Consuming the link is the proof that this person controls the address,
    // so this is where the identity stops being provisional.
    await markEmailVerified(spent.email);

    const session = await mintSession(spent.amberId);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      scope: session.scope,
      user: { did: `did:amber:${spent.amberId}`, email: spent.email },
      org: session.membership
        ? { id: session.membership.orgId, name: session.membership.orgName, role: session.membership.role }
        : null,
    };
  });
}
