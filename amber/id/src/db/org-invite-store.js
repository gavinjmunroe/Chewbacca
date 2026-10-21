/**
 * org-invite-store — the only way into a company, and the account an invite
 * creates when the person on the far end has never used Amber.
 *
 * THE LINK IS THE CREDENTIAL. Same model as lib/gcs-signing.js, same sentence:
 * the URL is the capability and its lifetime is the blast radius. Only the
 * SHA-256 of the token is ever stored, so the database holds no working invite
 * links; expiry is mandatory; and acceptance is single-use because the UPDATE
 * that reads the row is the UPDATE that consumes it.
 *
 * A WORK EMAIL IS AN IDENTITY HERE, WHICH IS NEW. Everywhere else in this
 * service an account is proved by a phone OTP, and user-identities-store says
 * out loud that an identity never creates a user. That rule holds for Apple and
 * Google -- a provider login attaches to an account a phone already proved. It
 * cannot hold for an employee invited by their work address, because there is
 * no phone in that story at all.
 *
 * So this file is the one place that creates a user from an email, and it is
 * allowed to because of what the invite is: an admin of a company, already
 * authenticated, asserted that this address belongs to somebody who should be
 * in their company, and the person on the far end proved they can read that
 * address. That is two parties, not one, which is the property phone OTP has
 * and a bare "sign me up with this email" does not.
 */

import crypto from "node:crypto";
import { query, withTransaction } from "./sql.js";
import { hashPassword, passwordComplaint, verifyPassword } from "../lib/password.js";

/** Invites are measured in days; a week is long enough to be forwarded and read. */
const DEFAULT_TTL_HOURS = 24 * 7;

export function normalizeEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s || s.length > 254) return null;
  // Deliberately loose. This is not an address validator -- delivery is the
  // only real test of an address -- it is a guard against a value that is
  // obviously not one, stored as though it were an identity.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest();
}

/** 32 bytes of randomness, URL-safe. Guessing one is not a threat model. */
function mintToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function rowToInvite(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    email: row.email,
    role: row.role,
    groupId: row.group_id ? String(row.group_id) : null,
    invitedBy: row.invited_by ? String(row.invited_by) : null,
    expiresAt: row.expires_at ?? null,
    acceptedAt: row.accepted_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

/**
 * Issue an invite. Returns the plaintext token EXACTLY ONCE, to the caller that
 * is about to put it in an email. It is not stored and cannot be re-read; an
 * admin who loses it issues another.
 *
 * Re-inviting the same address revokes the outstanding invite first, so the
 * live-invite index holds and "revoke the invite" means one row, not six.
 */
export async function createInvite({ orgId, email, role = "member", groupId = null, invitedBy = null, ttlHours = DEFAULT_TTL_HOURS } = {}) {
  const addr = normalizeEmail(email);
  if (!orgId || !addr) return { ok: false, reason: "bad_email" };
  if (role !== "admin" && role !== "member") return { ok: false, reason: "bad_role" };

  /*
   * THE COMPANY'S DOMAIN RULE, ENFORCED HERE BECAUSE THIS IS THE ONLY DOOR.
   *
   * An invitation is the single way anybody joins a company, so a restriction
   * checked here is a restriction that holds -- including for the Google
   * callback, which accepts an invitation rather than minting a membership of
   * its own. Checking it in the admin UI instead would be a check somebody
   * could skip with curl.
   *
   * The flag and the domain are separate on purpose: a company can be
   * paychex.com without refusing its own contractors. See migration 077.
   */
  const { rows: rule } = await query(
    `SELECT email_domain, restrict_domain FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  if (rule[0]?.restrict_domain && rule[0]?.email_domain) {
    const want = String(rule[0].email_domain).toLowerCase();
    if (addr.split("@")[1] !== want) {
      return { ok: false, reason: "wrong_domain", domain: want };
    }
  }

  const token = mintToken();
  try {
    const invite = await withTransaction(async (client) => {
      await client.query(
        `UPDATE org_invites SET revoked_at = now()
          WHERE org_id = $1::uuid AND lower(email) = $2
            AND accepted_at IS NULL AND revoked_at IS NULL`,
        [orgId, addr],
      );
      const { rows } = await client.query(
        `INSERT INTO org_invites (org_id, email, role, group_id, token_hash, invited_by, expires_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6::uuid, now() + ($7 || ' hours')::interval)
         RETURNING *`,
        [
          orgId,
          addr,
          role,
          groupId || null,
          hashToken(token),
          invitedBy,
          String(Math.max(1, Number(ttlHours) || DEFAULT_TTL_HOURS)),
        ],
      );
      return rowToInvite(rows[0]);
    });
    return { ok: true, invite, token };
  } catch (err) {
    /*
     * A BARE CATCH HERE COST AN AFTERNOON.
     *
     * Every failure became "write_failed", which reaches the admin as "could
     * not create that invite" -- a sentence that fits a duplicate address, a
     * revoked-invite race, a bad group id and a database being down equally
     * well, and distinguishes none of them. The constraint name is the only
     * thing that knows which it was.
     */
    const constraint = err?.constraint ?? "";
    if (constraint === "org_invites_email_live") return { ok: false, reason: "already_invited" };
    if (err?.code === "23503") return { ok: false, reason: "no_such_group" };
    console.error(`[invite] create failed code=${err?.code} constraint=${constraint}`);
    return { ok: false, reason: "write_failed" };
  }
}

export async function listInvites(orgId) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT * FROM org_invites
      WHERE org_id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [orgId],
  );
  return rows.map(rowToInvite);
}

export async function revokeInvite({ orgId, inviteId } = {}) {
  const { rowCount } = await query(
    `UPDATE org_invites SET revoked_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
        AND accepted_at IS NULL AND revoked_at IS NULL`,
    [orgId, inviteId],
  );
  return rowCount > 0;
}

/**
 * What the accept screen shows BEFORE anybody clicks accept: which company,
 * which address. Read-only and does not consume the invite.
 *
 * Returns null for anything that is not a live invite -- expired, revoked,
 * already used, or never existed. One answer for all four on purpose: the
 * difference between "that invite expired" and "that invite was never real" is
 * information about a company to somebody holding a token for it.
 */
export async function peekInvite(token) {
  if (!token) return null;
  /*
   * THROUGH THE DEFINER FUNCTION, because this runs before there is a tenant.
   *
   * Whoever is holding the link has no session, no membership and usually no
   * account, so nothing upstream resolved an actor and no tenant scope was
   * opened. org_invites is policied; under enforcement a bare read returns
   * nothing and every invitation in the product reads as expired. The token
   * is the authorization here, and the function cannot be asked anything
   * else -- see migration 073.
   */
  const { rows } = await query(
    `SELECT id, org_id, email, role, group_id, expires_at, invited_by,
            org_name, org_slug
       FROM amber_invite_peek($1)`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...rowToInvite(row), orgName: row.org_name, orgSlug: row.org_slug };
}

/**
 * Find or create the account that owns this work address, inside a caller's
 * transaction.
 *
 * A HUMAN WHO ALREADY HAS A PERSONAL AMBER GETS A SECOND ACCOUNT, and that is
 * the enterprise model rather than an accident of this function: what you say
 * in the company instance is the company's, what you say in your own is yours,
 * and the two are different amber_ids with no join between them. Matching this
 * address against a personal account's contact email and reusing that row would
 * quietly merge the two instances the first time somebody was invited at an
 * address they had already given Amber.
 */
async function ensureAccountForEmail(client, email, { verified = true } = {}) {
  const { rows: found } = await client.query(
    `SELECT amber_id FROM user_identities
      WHERE provider = 'email' AND subject = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [email],
  );
  if (found[0]) return { amberId: String(found[0].amber_id), created: false };

  const personId = crypto.createHash("sha256").update(`amber-email:${email}`).digest("hex").slice(0, 32);
  /*
   * A WORK ACCOUNT, EXPLICITLY. This is the only place work accounts are born
   * -- an invite accepted, or a work-email signup -- and the kind is set here
   * rather than inferred later from "has an org membership", because the
   * account exists for a moment before the membership does and a route that
   * guessed would guess wrong in exactly that window.
   */
  const { rows: made } = await client.query(
    `INSERT INTO users (phone, status, person_id, full_name, workspace_kind)
     VALUES (NULL, 'active', $1, $2, 'work')
     RETURNING amber_id`,
    [personId, email.split("@")[0]],
  );
  const amberId = String(made[0].amber_id);
  await client.query(
    `INSERT INTO user_identities (provider, subject, amber_id, email, email_verified, verified_at)
     VALUES ('email', $1, $2::uuid, $1, $3, CASE WHEN $3 THEN now() ELSE NULL END)`,
    [email, amberId, verified],
  );
  return { amberId, created: true };
}

/**
 * Accept. One transaction: consume the invite, find-or-create the account for
 * the invited address, add the membership.
 *
 * THE INVITE IS CONSUMED BY THE STATEMENT THAT READS IT. Two clicks on the same
 * link cannot make two members, and a crash after the UPDATE leaves the invite
 * used and no member -- recoverable by issuing another invite, which is the
 * direction to be wrong in. The reverse (member created, invite still live)
 * would leave a working key to the company in an inbox.
 *
 * `amberId` is optional and is the one case where an already-signed-in account
 * accepts directly: somebody who signed up by phone and was then invited at
 * work. Passing it skips account creation and binds the address to that
 * account as a second identity.
 */
/**
 * Accept, by link token OR by a Google-verified address.
 *
 * THE SECOND DOOR EXISTS BECAUSE GOOGLE PROVES THE SAME THING THE LINK DOES.
 * A link in an inbox is evidence that whoever clicked it can read that inbox.
 * A verified Google id_token is better evidence of exactly that, so somebody
 * invited at an address they sign into Google with should not have to go find
 * the email -- especially when the email may never have been delivered.
 *
 * `verifiedEmail` is not a parameter a client can set. It reaches here only
 * from org-sso.js, after a signature check against Google's keys and an
 * email_verified assertion, and the invite is re-read inside the transaction
 * and its address compared -- so an inviteId alone opens nothing.
 */
export async function acceptInvite({ token, inviteId = null, verifiedEmail = null } = {}) {
  if (!token && !(inviteId && verifiedEmail)) return { ok: false, reason: "invalid_invite" };
  try {
    return await withTransaction(async (client) => {
      /*
       * CLAIMED THROUGH THE DEFINER FUNCTION, for the same reason peekInvite
       * is: there is no tenant yet, and the row that would name one is the
       * row being claimed. One UPDATE, so two people racing the same link
       * produce exactly one winner.
       */
      const { rows } = token
        ? await client.query(
            `SELECT id, org_id, email, role, group_id, invited_by
               FROM amber_invite_claim($1)`,
            [hashToken(token)],
          )
        : /*
           * BY ID, AND ONLY FOR THE ADDRESS IT NAMES. The email comparison is
           * in the WHERE clause rather than in JavaScript after the read, so
           * there is no window in which the row is claimed and the check has
           * not run yet, and no path where somebody forgets to run it.
           */
          await client.query(
            `UPDATE org_invites
                SET accepted_at = now()
              WHERE id = $1::uuid
                AND lower(email) = $2
                AND accepted_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > now()
              RETURNING id, org_id, email, role, group_id, invited_by`,
            [inviteId, normalizeEmail(verifiedEmail)],
          );
      const invite = rowToInvite(rows[0]);
      if (!invite) return { ok: false, reason: "invalid_invite" };

      /*
       * THE TENANT IS SET HERE, BECAUSE NOTHING EARLIER COULD KNOW IT.
       *
       * Accepting is unauthenticated by design: the person holding the link
       * has no session yet, so no actor is resolved and no tenant scope is
       * opened for them. Every write below is to a policied table, and under
       * enforcement a write with no tenant set fails the policy's WITH CHECK
       * -- which would mean nobody could ever accept an invitation.
       *
       * The invite row is what names the company, and it was just read and
       * claimed by this transaction. Setting it here is the same move
       * createOrganization makes: the one statement that discovers the tenant
       * also announces it, and it unwinds with the transaction.
       */
      await client.query(`SELECT set_config('amber.org_id', $1, true)`, [String(invite.orgId)]);

      /*
       * ACCEPTING AN INVITE ALWAYS LANDS IN A WORK ACCOUNT. NEVER THE CALLER'S.
       *
       * This used to take an optional amberId meaning "I already have an Amber
       * account, put THAT one in the company" -- which is the same mistake
       * createOrganization made, arriving through a different door: somebody's
       * personal account, with their own address book in it, becomes the
       * company's because they happened to be signed in when they clicked a
       * link in their work inbox.
       *
       * The account is resolved from the INVITED ADDRESS and nothing else. A
       * person who already has a personal Amber now has two accounts, which is
       * the entire model: they switch between them, and nothing crosses.
       */
      const account = await ensureAccountForEmail(client, invite.email);

      const { rows: memberRows } = await client.query(
        `INSERT INTO org_members (org_id, amber_id, role, invited_by)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
         ON CONFLICT (org_id, amber_id) DO UPDATE
           SET deleted_at = NULL, status = 'active', updated_at = now()
         RETURNING org_id, amber_id, role, status`,
        [invite.orgId, account.amberId, invite.role, invite.invitedBy],
      );

      /*
       * AND INTO THE TEAM THEY WERE INVITED TO.
       *
       * Without this, putting a new hire on a team is five steps and four of
       * them happen days apart: invite, wait, remember they exist, find them in
       * the roster, add them. The cost of forgetting the last one is a person
       * who cannot see what their team shares and has no way to know that is
       * why.
       *
       * The composite foreign key guarantees the group is in this same
       * organization, so there is no check to forget here either. It runs after
       * the membership insert because org_group_members points at that row.
       */
      if (invite.groupId) {
        await client.query(
          `INSERT INTO org_group_members (org_id, group_id, amber_id, added_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
           ON CONFLICT (org_id, group_id, amber_id) DO NOTHING`,
          [invite.orgId, invite.groupId, account.amberId, invite.invitedBy],
        );
      }
      return {
        ok: true,
        orgId: String(memberRows[0].org_id),
        amberId: account.amberId,
        role: memberRows[0].role,
        email: invite.email,
        accountCreated: account.created,
      };
    });
  } catch (err) {
    // The one-live-org index. An account already inside a company cannot join a
    // second one, and the invite has now been consumed -- which is correct: the
    // link worked, the answer was no.
    if (err?.constraint === "org_members_one_live_org") {
      return { ok: false, reason: "already_in_org" };
    }
    return { ok: false, reason: "accept_failed" };
  }
}


/** The account behind a work address, or null. Used by the email login path. */
export async function findAccountByEmail(email) {
  const addr = normalizeEmail(email);
  if (!addr) return null;
  const { rows } = await query(
    `SELECT i.amber_id FROM user_identities i
       JOIN users u ON u.amber_id = i.amber_id AND u.deleted_at IS NULL
      WHERE i.provider = 'email' AND i.subject = $1 AND i.deleted_at IS NULL
      LIMIT 1`,
    [addr],
  );
  return rows[0] ? String(rows[0].amber_id) : null;
}

/**
 * AN ACCOUNT FOR A WORK EMAIL, WITH NO INVITE BEHIND IT.
 *
 * This is how somebody sets up a company: they arrive with a work address and
 * nobody has invited them, because the company does not exist yet.
 *
 * WHY THIS IS SAFE WITHOUT A VERIFIED ADDRESS FIRST. The account created here
 * is inert -- it owns nothing and cannot be signed into. The only way in is a
 * link sent TO that address, so somebody who types an address they do not
 * control has created a row and gained nothing. Control is proven by consuming
 * the link, which is also where the identity is marked verified.
 *
 * Creating the row up front rather than holding a pending-signup record is the
 * trade: one table instead of two, and the failure mode is an unused row rather
 * than a second expiry mechanism nobody maintains.
 */
export async function ensureAccountForWorkEmail(email) {
  const addr = normalizeEmail(email);
  if (!addr) return { ok: false, reason: "bad_email" };
  try {
    const existing = await findAccountByEmail(addr);
    if (existing) return { ok: true, amberId: existing, created: false, email: addr };
    const amberId = await withTransaction(async (client) => {
      const made = await ensureAccountForEmail(client, addr, { verified: false });
      return made.amberId;
    });
    return { ok: true, amberId, created: true, email: addr };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

/**
 * The name a work account shows up under.
 *
 * Only ever fills a blank. An account created by an invitation may already
 * carry the name the admin typed when they sent it, and a later self-signup
 * typing something else should not quietly rename somebody in a roster other
 * people are reading.
 */
export async function setDisplayName(amberId, fullName) {
  const name = String(fullName ?? "").trim().slice(0, 120);
  if (!amberId || !name) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE users
        SET full_name = $2, updated_at = now()
      WHERE amber_id = $1::uuid
        AND deleted_at IS NULL
        AND COALESCE(nullif(btrim(full_name), ''), NULL) IS NULL`,
    [amberId, name],
  );
  return { ok: rowCount > 0 };
}

/** Consuming a sign-in link is the proof of control, so that is where it lands. */
export async function markEmailVerified(email) {
  const addr = normalizeEmail(email);
  if (!addr) return;
  await query(
    `UPDATE user_identities
        SET email_verified = true, verified_at = COALESCE(verified_at, now()),
            last_used_at = now()
      WHERE provider = 'email' AND subject = $1 AND deleted_at IS NULL`,
    [addr],
  ).catch(() => {});
}

// ─── passwords, for accounts with no phone ──────────────────────────────────

/**
 * Set or replace the password on a work account.
 *
 * Work accounts only, deliberately. A phone account already has a way in that
 * cannot be guessed, forgotten or reused from another site; giving it a
 * password would add an attack surface and subtract nothing.
 */
export async function setAccountPassword(amberId, password) {
  const complaint = passwordComplaint(password);
  if (complaint) return { ok: false, reason: "weak_password", message: complaint };
  const hash = await hashPassword(password);
  const { rowCount } = await query(
    `UPDATE users
        SET password_hash = $2, password_set_at = now(), updated_at = now()
      WHERE amber_id = $1::uuid AND deleted_at IS NULL AND workspace_kind = 'work'`,
    [amberId, hash],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_a_work_account" };
}

/**
 * Sign in with a work email and a password.
 *
 * ONE ANSWER FOR EVERY FAILURE. No account, no password set, wrong password --
 * all of them return null. Distinguishing them would turn this into a way to
 * ask which addresses at a company have accounts, which is the same reason the
 * magic-link endpoint answers identically either way.
 *
 * The hash is verified even when there is no account, against a dummy, so the
 * two paths take the same time. A sign-in form that answers faster for an
 * unknown address is a user-enumeration oracle with extra steps.
 */
const DUMMY_HASH =
  "scrypt$16384$00000000000000000000000000000000$" + "0".repeat(128);

export async function signInWithPassword(email, password) {
  const addr = normalizeEmail(email);
  if (!addr || typeof password !== "string") {
    await verifyPassword("x", DUMMY_HASH).catch(() => false);
    return null;
  }
  const { rows } = await query(
    `SELECT u.amber_id, u.password_hash
       FROM user_identities i
       JOIN users u ON u.amber_id = i.amber_id AND u.deleted_at IS NULL
      WHERE i.provider = 'email' AND i.subject = $1 AND i.deleted_at IS NULL
      LIMIT 1`,
    [addr],
  );
  const row = rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH).catch(() => false);
  if (!ok || !row) return null;
  return String(row.amber_id);
}

/** Does this address have a password set? Drives nothing but a helpful form. */
export async function hasPassword(email) {
  const addr = normalizeEmail(email);
  if (!addr) return false;
  const { rows } = await query(
    `SELECT u.password_hash IS NOT NULL AS has
       FROM user_identities i
       JOIN users u ON u.amber_id = i.amber_id AND u.deleted_at IS NULL
      WHERE i.provider = 'email' AND i.subject = $1 AND i.deleted_at IS NULL
      LIMIT 1`,
    [addr],
  );
  return rows[0]?.has === true;
}

/* -------------------------------------------------------------- usernames */

/**
 * THE SHAPE OF A USERNAME, in one place.
 *
 * The same expression as the CHECK on the column, deliberately duplicated
 * rather than inferred: the database's job is to refuse a bad row whatever
 * wrote it, and this one's is to tell somebody what is wrong with what they
 * typed before they press the button. A single source of truth that produced
 * either a 500 or no message at all would be worse than two that agree.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/*
 * THIS IS users.login_username, NOT users.username.
 *
 * The second one already existed and is a consumer profile handle: free-form,
 * baseline-visible, shown to people in your network. Adopting it as a
 * credential made the same human's two accounts collide -- a personal Amber
 * with the handle "karthik" made "karthik" unavailable to that same person's
 * work account -- and would have meant editing a display name silently
 * changed what you sign in with. See migration 072.
 */

export function normalizeUsername(value) {
  const u = String(value ?? "").trim().toLowerCase();
  return u || null;
}

/** Why this username cannot be used, or null if it can. */
export function usernameComplaint(value) {
  const u = normalizeUsername(value);
  if (!u) return "Pick a username.";
  if (u.length < 3) return "A username is at least 3 characters.";
  if (u.length > 32) return "A username is at most 32 characters.";
  if (u.includes("@")) return "A username cannot contain @ — that is the email field.";
  if (!USERNAME_RE.test(u)) {
    return "Use letters, digits, dots, underscores or hyphens, starting with a letter or digit.";
  }
  return null;
}

export async function setUsername(amberId, value) {
  const u = normalizeUsername(value);
  const complaint = usernameComplaint(u);
  if (complaint) return { ok: false, reason: "bad_username", message: complaint };
  try {
    const { rowCount } = await query(
      `UPDATE users SET login_username = $2, updated_at = now()
        WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId, u],
    );
    return rowCount > 0 ? { ok: true, username: u } : { ok: false, reason: "not_found" };
  } catch (err) {
    // 23505 is the partial unique index doing its job. It is the only error
    // here that is about the person's input rather than about the service.
    if (err?.code === "23505") {
      return { ok: false, reason: "taken", message: "That username is already taken." };
    }
    if (err?.code === "23514") {
      return {
        ok: false,
        reason: "bad_username",
        message: "Use lowercase letters, digits, dots, underscores or hyphens.",
      };
    }
    return { ok: false, reason: "write_failed" };
  }
}

export async function findAccountByUsername(value) {
  const u = normalizeUsername(value);
  if (!u) return null;
  const { rows } = await query(
    `SELECT amber_id FROM users WHERE login_username = $1 AND deleted_at IS NULL`,
    [u],
  );
  return rows[0] ? String(rows[0].amber_id) : null;
}

/**
 * SIGN IN WITH WHATEVER THEY TYPED.
 *
 * One field on the form, because asking somebody to first classify their own
 * identifier is asking them to do the computer's job. An @ means it is an
 * address -- which is also exactly why the username CHECK forbids one.
 *
 * THE TIMING IS EQUALIZED THE SAME WAY the email path already does it: a miss
 * still runs a verify against a dummy hash, so "no such account" and "wrong
 * password" take the same time and the form cannot be used to enumerate who
 * works here.
 */
export async function signInWithIdentifier(identifier, password) {
  const id = String(identifier ?? "").trim();
  if (!id || typeof password !== "string") {
    await verifyPassword("x", DUMMY_HASH).catch(() => false);
    return null;
  }
  if (id.includes("@")) return signInWithPassword(id, password);

  const amberId = await findAccountByUsername(id);
  if (!amberId) {
    await verifyPassword("x", DUMMY_HASH).catch(() => false);
    return null;
  }
  const { rows } = await query(
    `SELECT password_hash FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
    [amberId],
  );
  const ok = await verifyPassword(password, rows[0]?.password_hash ?? DUMMY_HASH).catch(() => false);
  return ok && rows[0]?.password_hash ? amberId : null;
}

/** The sign-in facts about an account, for its own settings screen. */
export async function credentialsFor(amberId) {
  if (!amberId) return null;
  const { rows } = await query(
    `SELECT u.login_username AS username,
            u.password_hash IS NOT NULL AS has_password,
            u.phone,
            (SELECT i.subject FROM user_identities i
              WHERE i.amber_id = u.amber_id AND i.provider = 'email' AND i.deleted_at IS NULL
              ORDER BY i.created_at ASC LIMIT 1) AS email
       FROM users u
      WHERE u.amber_id = $1 AND u.deleted_at IS NULL`,
    [amberId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    username: r.username ?? null,
    hasPassword: r.has_password === true,
    email: r.email ?? null,
    phone: r.phone ?? null,
  };
}

/**
 * Change a password from inside a session.
 *
 * THE CURRENT PASSWORD IS REQUIRED WHEN ONE EXISTS, and that is not
 * ceremony: a session token lives in a browser for eight hours, and without
 * this check anybody who got hold of one could set a password and keep the
 * account after the token expired. When no password is set yet -- the invited
 * member who just arrived -- there is nothing to prove and asking for one
 * would lock them out of the feature entirely.
 */
export async function changePassword(amberId, { current = null, next } = {}) {
  const complaint = passwordComplaint(next);
  if (complaint) return { ok: false, reason: "weak_password", message: complaint };

  const { rows } = await query(
    `SELECT password_hash FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
    [amberId],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const existing = rows[0].password_hash;
  if (existing) {
    const ok = await verifyPassword(String(current ?? ""), existing).catch(() => false);
    if (!ok) return { ok: false, reason: "bad_current", message: "That is not your current password." };
  }

  const saved = await setAccountPassword(amberId, next);
  return saved ? { ok: true, created: !existing } : { ok: false, reason: "write_failed" };
}

/**
 * A FRESH LINK FOR AN INVITATION THAT ALREADY EXISTS.
 *
 * The plaintext token is returned exactly once, at creation, because only its
 * sha256 is stored -- which is the right call and had one consequence nobody
 * designed for: an admin who closed the dialog, or whose email provider
 * refused the send, had an invitation they could no longer deliver. The only
 * recovery was to revoke it and make another, which works and which nobody
 * discovers.
 *
 * So "show me that link again" is implemented as what it actually has to be:
 * a NEW token for the SAME invitation. The old one stops working the moment
 * this runs, which is a feature rather than a cost -- a link that was pasted
 * into the wrong Slack channel is revoked by the act of asking for a new one.
 *
 * The expiry is pushed out from now, because an invitation somebody is
 * actively trying to deliver should not die on a clock that started when the
 * first attempt failed.
 */
export async function rotateInviteToken({ orgId, inviteId, ttlHours = DEFAULT_TTL_HOURS } = {}) {
  if (!orgId || !inviteId) return { ok: false, reason: "bad_input" };
  const token = mintToken();
  const { rows } = await query(
    `UPDATE org_invites
        SET token_hash = $3,
            expires_at = now() + ($4 || ' hours')::interval
      WHERE org_id = $1::uuid AND id = $2::uuid
        AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING *`,
    [orgId, inviteId, hashToken(token), String(Math.max(1, Number(ttlHours) || DEFAULT_TTL_HOURS))],
  );
  if (!rows[0]) return { ok: false, reason: "not_found" };
  return { ok: true, invite: rowToInvite(rows[0]), token };
}


/**
 * The live invitation for an address, if there is one.
 *
 * Used by Google sign-in, where somebody has just proved they control the
 * address but has no link in hand. It returns the invite's id and nothing
 * secret -- no token, no hash -- because the caller is about to accept it
 * through a path that re-checks the address anyway.
 */
export async function peekInviteByEmail(email) {
  const addr = normalizeEmail(email);
  if (!addr) return null;
  const { rows } = await query(
    `SELECT i.id, i.org_id, i.email, i.role, o.name AS org_name
       FROM org_invites i
       JOIN organizations o ON o.id = i.org_id AND o.deleted_at IS NULL
      WHERE lower(i.email) = $1
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [addr],
  );
  const r = rows[0];
  return r ? { id: String(r.id), orgId: String(r.org_id), email: r.email, role: r.role, orgName: r.org_name } : null;
}
