/**
 * Cloud SQL store for the Connections social graph.
 *
 * Schema assumed:
 *   users               (amber_id uuid PK, username text, full_name text, ...)
 *   connection_requests (id bigserial PK, requester_amber_id uuid,
 *                        addressee_amber_id uuid, status text, message text, ...)
 *   connections         (a_amber_id uuid, b_amber_id uuid,
 *                        status text CHECK (pending|active|blocked),
 *                        established_at timestamptz,
 *                        PRIMARY KEY (a_amber_id, b_amber_id),
 *                        CHECK (a_amber_id < b_amber_id))
 *
 *   THIS BLOCK USED TO DESCRIBE (id bigserial, user_a, user_b, deleted_at), and
 *   every query in this file was written against that. None of those four columns
 *   exist -- migration 004 redesigned the table and the consumer was never
 *   checked -- so the entire social graph threw on every call, and the catch in
 *   each function turned that into an empty list or a false. A person with
 *   connections read as a person with none.
 *
 *   Two consequences worth knowing when reading below: there is no surrogate id,
 *   the PAIR is the key; and a connection is retired by status rather than by
 *   deleted_at, so `status = 'active'` is what "not deleted" used to mean. Verify
 *   with node scripts/column-drift-audit.mjs rather than trusting this comment.
 *   wall_posts          (id bigserial PK, owner_id UUID, text text,
 *                        visibility text, ...)
 *
 *   owner_id is a uuid on wall_posts and answers, not text. Every join here used
 *   to say u.amber_id::text = wp.owner_id, which is text = uuid and does not
 *   exist as an operator -- so the network feed threw and returned empty. Found
 *   by scripts/sql-prepare-audit.mjs, which is the only one of the three audits
 *   that can see a type.
 *
 * Canonical pair ordering: a_amber_id = LEAST(a, b), b_amber_id = GREATEST(a, b),
 * enforced by a CHECK rather than by convention.
 *
 * SECURITY INVARIANT: every function is scoped by the caller's amber_id.
 * No function may read or write rows for other owners.
 */

import { query } from "./sql.js";
import { blocksInteraction } from "./blocks-store.js";
import { linkResolvableContacts } from "./identity-link.js";
import { normalizePhone } from "../lib/auth-session.js";

// Guard: parse a positive integer from any input. Returns null for invalid inputs.
function _toInt(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The display-safe PUBLIC projection of a user, looked up by username.
 *
 * Feeds the unauthenticated /u/:username share page, so the projection is the whole
 * security story here and is deliberately narrow:
 *
 *   - Only fields a user put on a profile meant for other people to see. No phone, no
 *     email, nothing from the graph.
 *   - NO amber_id. The page has no use for it, and an unauthenticated endpoint that
 *     maps a guessable username to a stable internal id is an enumeration primitive --
 *     the APP resolves the username to a user over an authenticated call instead.
 *   - Case-insensitive match, because a username typed or pasted from a text message
 *     will not reliably preserve case, and `deleted_at IS NULL` so a deleted account
 *     stops resolving.
 *
 * This is the ONE function in this file that is not scoped by a caller's amber_id, so
 * it is called out explicitly against the SECURITY INVARIANT in the header above: it
 * reads no owner-scoped data at all, only a self-published profile card.
 *
 * Returns null for a missing, unknown or deleted user.
 */
export async function getPublicProfileByUsername(username) {
  const u = typeof username === "string" ? username.trim() : "";
  if (!u) return null;
  try {
    const { rows } = await query(
      `SELECT u.username, u.full_name, u.avatar_url, u.occupation, u.current_city
         FROM users u
        WHERE lower(u.username) = lower($1) AND u.deleted_at IS NULL
        LIMIT 1`,
      [u],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      username: r.username ?? null,
      fullName: r.full_name ?? null,
      avatarUrl: r.avatar_url ?? null,
      occupation: r.occupation ?? null,
      currentCity: r.current_city ?? null,
    };
  } catch {
    // The caller renders a degraded page rather than a 500; a share link must not
    // break because of a transient database error.
    return null;
  }
}

/**
 * Are two users connected? Checks for a live `connections` row for the pair in
 * either canonical order. Returns false for missing inputs, self-pairs, or on
 * error. Owner-scoped by construction (both amber_ids must be in the row).
 */
export async function areConnected(a, b) {
  if (!a || !b || a === b) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM connections
        WHERE ((a_amber_id = $1 AND b_amber_id = $2) OR (a_amber_id = $2 AND b_amber_id = $1))
          AND status = 'active' 
        LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Search users by username prefix, full-name substring, or exact amber_id.
 * Excludes self and soft-deleted users.
 * Returns [{ amberId, username, fullName, avatarUrl, occupation, currentCity, status }]
 * where status ∈ none | pending_out | pending_in | connected.
 */
export async function searchUsers(meAmberId, q, { limit = 20 } = {}) {
  if (!meAmberId || !q) return [];
  const term = q.trim();
  if (!term) return [];
  try {
    const isUuid = _UUID_RE.test(term);
    const params = [meAmberId, term, Math.min(limit, 100)];
    const uuidClause = isUuid ? `OR u.amber_id::text = $2` : "";
    const { rows } = await query(
      `SELECT
         u.amber_id, u.username, u.full_name, u.avatar_url, u.occupation, u.current_city,
         CASE
           WHEN conn.a_amber_id IS NOT NULL THEN 'connected'
           WHEN req_out.id IS NOT NULL THEN 'pending_out'
           WHEN req_in.id  IS NOT NULL THEN 'pending_in'
           ELSE 'none'
         END AS status
       FROM users u
       LEFT JOIN connections conn ON (
           (conn.a_amber_id = $1 AND conn.b_amber_id = u.amber_id)
        OR (conn.a_amber_id = u.amber_id AND conn.b_amber_id = $1)
       ) AND conn.status = 'active'
       LEFT JOIN connection_requests req_out ON
         req_out.requester_amber_id = $1
         AND req_out.addressee_amber_id = u.amber_id
         AND req_out.status = 'pending' AND req_out.deleted_at IS NULL
       LEFT JOIN connection_requests req_in ON
         req_in.requester_amber_id = u.amber_id
         AND req_in.addressee_amber_id = $1
         AND req_in.status = 'pending' AND req_in.deleted_at IS NULL
       WHERE u.deleted_at IS NULL
         AND u.amber_id != $1
         AND (
           lower(u.username) LIKE lower($2) || '%'
           OR u.full_name ILIKE '%' || $2 || '%'
           ${uuidClause}
         )
       ORDER BY u.full_name ASC NULLS LAST
       LIMIT $3`,
      params,
    );
    return rows.map((r) => ({
      amberId: String(r.amber_id),
      username: r.username ?? null,
      fullName: r.full_name ?? null,
      avatarUrl: r.avatar_url ?? null,
      occupation: r.occupation ?? null,
      currentCity: r.current_city ?? null,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

/**
 * Send a connection request from meAmberId to addresseeAmberId.
 *
 * Returns { status } where status ∈:
 *   "requested"        — pending request created
 *   "connected"        — reverse pending existed; auto-accepted + connection inserted
 *   "already_connected"— already in connections table
 *   "already_requested"— a pending request from me to them already exists (23505)
 *   "self"             — tried to connect to self
 *   "invalid"          — missing params
 *   "error"            — unexpected DB error
 */
export async function createRequest(meAmberId, addresseeAmberId, message = null) {
  if (!meAmberId || !addresseeAmberId) return { status: "invalid" };
  if (meAmberId === addresseeAmberId) return { status: "self" };
  /**
   * A BLOCK HAS TO MEAN THIS TOO.
   *
   * Until this line, blocking somebody stopped their direct messages and
   * nothing else: they could still send a connection request, which puts a push
   * on the recipient's lock screen with the blocker's name on it. That is
   * precisely the contact the block was for.
   *
   * Checked BEFORE the already-connected and reverse-pending lookups, because
   * both of those are answers about a relationship the blocked party has no
   * business learning anything about.
   */
  if (await blocksInteraction(meAmberId, addresseeAmberId)) {
    return { status: "blocked" };
  }
  try {
    // Already connected?
    const { rows: connRows } = await query(
      // SELECT 1, not id: there is no surrogate id, and this only asks whether a
      // row exists. `status = 'active'` is what `deleted_at IS NULL` used to mean.
      `SELECT 1 FROM connections
       WHERE ((a_amber_id = $1 AND b_amber_id = $2) OR (a_amber_id = $2 AND b_amber_id = $1))
         AND status = 'active'`,
      [meAmberId, addresseeAmberId],
    );
    if (connRows.length > 0) return { status: "already_connected" };

    // Reverse pending request → auto-accept
    const { rows: reverseRows } = await query(
      `SELECT id, requester_amber_id, addressee_amber_id
       FROM connection_requests
       WHERE requester_amber_id = $1 AND addressee_amber_id = $2
         AND status = 'pending' AND deleted_at IS NULL`,
      [addresseeAmberId, meAmberId],
    );
    if (reverseRows.length > 0) {
      const reverseId = reverseRows[0].id;
      await query(
        `UPDATE connection_requests
         SET status = 'accepted', responded_at = now(), updated_at = now()
         WHERE id = $1`,
        [reverseId],
      );
      const ua = meAmberId < addresseeAmberId ? meAmberId : addresseeAmberId;
      const ub = meAmberId < addresseeAmberId ? addresseeAmberId : meAmberId;
      await query(
        // LEAST/GREATEST rather than trusting the caller's ordering: the table
        // CHECKs a_amber_id < b_amber_id, so a pair passed the other way round
        // fails the constraint rather than inserting a mirrored duplicate.
        // status is explicit -- 'pending' is the column default, and an accepted
        // request is not pending.
        //
        // THE ::uuid CASTS ARE LOAD-BEARING. Without them Postgres types the
        // parameters as text, LEAST() returns text, and the INSERT fails with
        // "column a_amber_id is of type uuid but expression is of type text" --
        // which the catch here would have turned into { ok: false } and nothing
        // else.
        `INSERT INTO connections (a_amber_id, b_amber_id, status)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), 'active')
         ON CONFLICT (a_amber_id, b_amber_id) DO UPDATE SET status = 'active'`,
        [ua, ub],
      );

      /**
       * AND LINK THE CARDS, EXACTLY AS THE ACCEPT PATH DOES.
       *
       * THIS IS THE ONE THAT WAS MISSING, and it is the commonest way two
       * people actually connect. There are two routes to an active connection:
       * somebody presses accept on a request, and -- here -- both people happen
       * to send a request to each other, in which case the second one connects
       * on the spot without an accept ever happening.
       *
       * The accept path stamps contacts.linked_amber_id for both sides. This
       * one returned "connected" and stamped nothing, so a pair who found each
       * other this way ended up connected with neither address book knowing it.
       * Everything downstream reads that column: the circle previews, the
       * profile web's filter, the caller's own card for a connection. So the
       * app said "nobody from that circle is on Amber" about the only three
       * people on Amber -- the connection was real and no card pointed at it.
       *
       * Same two scoped statements, same best-effort placement after the
       * INSERT: a link that fails to stamp must not fail a real connection.
       */
      await Promise.all([
        linkResolvableContacts({ ownerId: meAmberId, amberId: addresseeAmberId }),
        linkResolvableContacts({ ownerId: addresseeAmberId, amberId: meAmberId }),
      ]).catch(() => {});

      return { status: "connected" };
    }

    // Insert new pending request
    const { rows: inserted } = await query(
      `INSERT INTO connection_requests (requester_amber_id, addressee_amber_id, message)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [meAmberId, addresseeAmberId, message ?? null],
    );
    return { status: "requested", requestId: String(inserted[0].id) };
  } catch (e) {
    if (e?.code === "23505") return { status: "already_requested" };
    return { status: "error" };
  }
}

/**
 * Accept or decline a connection request addressed to meAmberId.
 * Returns { ok: true, status } or { ok: false, reason }.
 */
export async function respondToRequest(meAmberId, requestId, action) {
  const id = _toInt(requestId);
  if (!meAmberId || !id || !["accept", "decline"].includes(action)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const { rows } = await query(
      `SELECT id, requester_amber_id, addressee_amber_id
       FROM connection_requests
       WHERE id = $1 AND addressee_amber_id = $2
         AND status = 'pending' AND deleted_at IS NULL`,
      [id, meAmberId],
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    const req = rows[0];

    const newStatus = action === "accept" ? "accepted" : "declined";
    await query(
      `UPDATE connection_requests
       SET status = $1, responded_at = now(), updated_at = now()
       WHERE id = $2`,
      [newStatus, id],
    );

    if (action === "accept") {
      const ua = req.requester_amber_id < req.addressee_amber_id
        ? req.requester_amber_id
        : req.addressee_amber_id;
      const ub = req.requester_amber_id < req.addressee_amber_id
        ? req.addressee_amber_id
        : req.requester_amber_id;
      await query(
        // LEAST/GREATEST rather than trusting the caller's ordering: the table
        // CHECKs a_amber_id < b_amber_id, so a pair passed the other way round
        // fails the constraint rather than inserting a mirrored duplicate.
        // status is explicit -- 'pending' is the column default, and an accepted
        // request is not pending.
        //
        // THE ::uuid CASTS ARE LOAD-BEARING. Without them Postgres types the
        // parameters as text, LEAST() returns text, and the INSERT fails with
        // "column a_amber_id is of type uuid but expression is of type text" --
        // which the catch here would have turned into { ok: false } and nothing
        // else.
        `INSERT INTO connections (a_amber_id, b_amber_id, status)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), 'active')
         ON CONFLICT (a_amber_id, b_amber_id) DO UPDATE SET status = 'active'`,
        [ua, ub],
      );

      // ── AND NOW THE TWO OF YOU ARE THE SAME PEOPLE YOU ALREADY HAD ────────
      //
      // Accepting is the moment identity becomes knowable. Before it, a card in
      // your address book named "Sagar Tiwari" and the account @sagar are two
      // unrelated rows; after it there is a proven relationship between two
      // accounts, and any card either of you holds for the other should point at
      // the real person from here on.
      //
      // Nothing linked these before. `linkContactsToAmberUserByPhone` ran once
      // per SIGNUP, over whatever cards happened to exist at that instant, and
      // never again -- so every card synced after the other person had already
      // joined stayed unlinked forever. That is most cards, and it is why a
      // circle member "wasn't really the Sagar I connected with": he wasn't,
      // because nothing had ever said so.
      //
      // Scoped to the pair, both directions, so this is two indexed statements
      // rather than a sweep. Best-effort and deliberately after the INSERT: a
      // link that fails to stamp must not fail an accepted connection.
      await Promise.all([
        linkResolvableContacts({ ownerId: req.addressee_amber_id, amberId: req.requester_amber_id }),
        linkResolvableContacts({ ownerId: req.requester_amber_id, amberId: req.addressee_amber_id }),
      ]).catch(() => {});
    }

    // The requester comes back so the route can notify the person who was waiting.
    // Without it the accept was silent: the only one who learned anything was the
    // person who did the accepting, who already knew.
    return { ok: true, status: newStatus, requesterAmberId: req.requester_amber_id };
  } catch (e) {
    console.error(`RESPOND_TO_REQUEST_ERR ${e?.message || e}`);
    return { ok: false, reason: "error" };
  }
}

/**
 * Cancel a pending outgoing request sent by meAmberId.
 * Returns { ok: true } or { ok: false, reason }.
 */
export async function cancelRequest(meAmberId, requestId) {
  const id = _toInt(requestId);
  if (!meAmberId || !id) return { ok: false, reason: "invalid" };
  try {
    const { rowCount } = await query(
      `UPDATE connection_requests
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND requester_amber_id = $2
         AND status = 'pending' AND deleted_at IS NULL`,
      [id, meAmberId],
    );
    if (!rowCount) return { ok: false, reason: "not_found" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Incoming pending requests addressed to meAmberId.
 * Returns [{ requestId, message, createdAt, requester: { amberId, username, fullName, avatarUrl, occupation, currentCity } }].
 */
export async function listIncomingRequests(meAmberId) {
  if (!meAmberId) return [];
  try {
    const { rows } = await query(
      `SELECT cr.id, cr.message, cr.created_at,
              u.amber_id AS req_amber_id, u.username, u.full_name, u.avatar_url,
              u.occupation, u.current_city
       FROM connection_requests cr
       JOIN users u ON u.amber_id = cr.requester_amber_id AND u.deleted_at IS NULL
       WHERE cr.addressee_amber_id = $1
         AND cr.status = 'pending' AND cr.deleted_at IS NULL
       ORDER BY cr.created_at DESC`,
      [meAmberId],
    );
    return rows.map((r) => ({
      requestId: String(r.id),
      message: r.message ?? null,
      createdAt: r.created_at,
      requester: {
        amberId: String(r.req_amber_id),
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
        occupation: r.occupation ?? null,
        currentCity: r.current_city ?? null,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Outgoing pending requests sent by meAmberId.
 * Returns [{ requestId, message, createdAt, addressee: { amberId, username, fullName, avatarUrl, occupation, currentCity } }].
 */
export async function listOutgoingRequests(meAmberId) {
  if (!meAmberId) return [];
  try {
    const { rows } = await query(
      `SELECT cr.id, cr.message, cr.created_at,
              u.amber_id AS addr_amber_id, u.username, u.full_name, u.avatar_url,
              u.occupation, u.current_city
       FROM connection_requests cr
       JOIN users u ON u.amber_id = cr.addressee_amber_id AND u.deleted_at IS NULL
       WHERE cr.requester_amber_id = $1
         AND cr.status = 'pending' AND cr.deleted_at IS NULL
       ORDER BY cr.created_at DESC`,
      [meAmberId],
    );
    return rows.map((r) => ({
      requestId: String(r.id),
      message: r.message ?? null,
      createdAt: r.created_at,
      addressee: {
        amberId: String(r.addr_amber_id),
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
        occupation: r.occupation ?? null,
        currentCity: r.current_city ?? null,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * All confirmed connections for meAmberId.
 * Returns [{ connectionId, connectedAt, user: { amberId, username, fullName, avatarUrl, occupation, currentCity } }].
 */
export async function listConnections(meAmberId) {
  if (!meAmberId) return [];
  try {
    const { rows } = await query(
      // No c.id: the pair IS the key. connectionId is synthesised from it below
      // rather than dropped, because the field is part of the response shape.
      // MY OWN CARD FOR THIS PERSON, when I have one.
      //
      // A connection is an ACCOUNT, and an account is not a contact card. The
      // app was pushing /u/<amberId> when somebody tapped a person, which draws
      // the Amber profile -- and for an account that has filled nothing in, the
      // whole screen reads "Amber user". The person tapping already has a card
      // for them, with the name they use, the notes they wrote and the history;
      // it was simply not reachable from there.
      //
      // contacts.linked_amber_id is that link, and it is already maintained by
      // sync and by addCircleMember. LATERAL because a book can hold more than
      // one card pointing at one account until the duplicate is merged, and the
      // most recently touched one is the one the person is actually keeping.
      `SELECT c.a_amber_id, c.b_amber_id, c.established_at,
              u.amber_id, u.username, u.full_name, u.avatar_url, u.occupation, u.current_city,
              mine.id AS my_contact_id
       FROM connections c
       JOIN users u
         ON u.amber_id = CASE WHEN c.a_amber_id = $1 THEN c.b_amber_id ELSE c.a_amber_id END
         AND u.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT ct.id
           FROM contacts ct
          WHERE ct.owner_id = $1
            AND ct.linked_amber_id = u.amber_id
            AND ct.deleted_at IS NULL
          ORDER BY ct.updated_at DESC NULLS LAST
          LIMIT 1
       ) mine ON TRUE
       WHERE (c.a_amber_id = $1 OR c.b_amber_id = $1) AND c.status = 'active'
       ORDER BY c.established_at DESC`,
      [meAmberId],
    );
    return rows.map((r) => ({
      connectionId: `${r.a_amber_id}:${r.b_amber_id}`,
      connectedAt: r.established_at,
      user: {
        amberId: String(r.amber_id),
        // Null when this owner has no card for them -- connected by link, never
        // in the address book. The client falls back to the Amber profile.
        contactId: r.my_contact_id ? String(r.my_contact_id) : null,
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
        occupation: r.occupation ?? null,
        currentCity: r.current_city ?? null,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Network feed for meAmberId's connections: network-visibility wall posts AND
 * network-visibility Q&A answers, newest-first. Each item is tagged with a
 * `kind`:
 *   { kind: 'wall',   postId, text, createdAt, author }
 *   { kind: 'answer', answerId, prompt, answerText, answerChoice, createdAt, author }
 * author = { amberId, username, fullName, avatarUrl }.
 */
export async function listNetworkFeed(meAmberId, { limit = 50 } = {}) {
  if (!meAmberId) return [];
  try {
    // The set of the caller's connected amber_ids (as text) is reused by both
    // arms of the UNION; inline it in each to keep a single parameterized query.
    const { rows } = await query(
      `SELECT * FROM (
         SELECT 'wall' AS kind, wp.id, wp.created_at,
                wp.text AS text, NULL::text AS prompt,
                NULL::text AS answer_text, NULL::text AS answer_choice,
                u.amber_id, u.username, u.full_name, u.avatar_url
         FROM wall_posts wp
         JOIN users u ON u.amber_id = wp.owner_id AND u.deleted_at IS NULL
         WHERE wp.visibility = 'network'
           AND wp.deleted_at IS NULL
           AND wp.owner_id IN (
             SELECT CASE WHEN c.a_amber_id = $1 THEN c.b_amber_id
                         ELSE c.a_amber_id END
             FROM connections c
             WHERE (c.a_amber_id = $1 OR c.b_amber_id = $1) AND c.status = 'active'
           )

         UNION ALL

         SELECT 'answer' AS kind, a.id, a.created_at,
                NULL::text AS text, q.prompt AS prompt,
                a.answer_text, a.answer_choice,
                u.amber_id, u.username, u.full_name, u.avatar_url
         FROM answers a
         JOIN users u ON u.amber_id = a.owner_id AND u.deleted_at IS NULL
         JOIN questions q ON q.id = a.question_id
         WHERE a.visibility = 'network'
           AND a.deleted_at IS NULL
           AND a.owner_id IN (
             SELECT CASE WHEN c.a_amber_id = $1 THEN c.b_amber_id
                         ELSE c.a_amber_id END
             FROM connections c
             WHERE (c.a_amber_id = $1 OR c.b_amber_id = $1) AND c.status = 'active'
           )
       ) feed
       ORDER BY feed.created_at DESC
       LIMIT $2`,
      [meAmberId, Math.min(limit, 200)],
    );
    return rows.map((r) => {
      const author = {
        amberId: String(r.amber_id),
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
      };
      if (r.kind === "answer") {
        return {
          kind: "answer",
          answerId: String(r.id),
          prompt: r.prompt ?? null,
          answerText: r.answer_text ?? null,
          answerChoice: r.answer_choice ?? null,
          createdAt: r.created_at,
          author,
        };
      }
      return {
        kind: "wall",
        postId: String(r.id),
        text: r.text,
        createdAt: r.created_at,
        author,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Resolve a contact's phone number(s) to an Amber user + the caller's
 * connection status with them. `phones` is a string[]; each is normalized via
 * normalizePhone, empties dropped, deduped. Matches a user whose users.phone
 * equals ANY normalized phone (non-deleted, not the caller). Status uses the
 * SAME joins/CASE as searchUsers ('connected' | 'pending_out' | 'pending_in' |
 * 'none'). Returns { amberId, username, fullName, avatarUrl, occupation,
 * currentCity, status } or null (no phones, no match, or error).
 */
export async function resolveContactAmberUser(meAmberId, phones) {
  if (!meAmberId || !Array.isArray(phones)) return null;
  const normalized = [
    ...new Set(phones.map((p) => normalizePhone(p)).filter(Boolean)),
  ];
  if (normalized.length === 0) return null;
  try {
    const { rows } = await query(
      `SELECT
         u.amber_id, u.username, u.full_name, u.avatar_url, u.occupation, u.current_city,
         CASE
           WHEN conn.a_amber_id IS NOT NULL THEN 'connected'
           WHEN req_out.id IS NOT NULL THEN 'pending_out'
           WHEN req_in.id  IS NOT NULL THEN 'pending_in'
           ELSE 'none'
         END AS status
       FROM users u
       LEFT JOIN connections conn ON (
           (conn.a_amber_id = $1 AND conn.b_amber_id = u.amber_id)
        OR (conn.a_amber_id = u.amber_id AND conn.b_amber_id = $1)
       ) AND conn.status = 'active'
       LEFT JOIN connection_requests req_out ON
         req_out.requester_amber_id = $1
         AND req_out.addressee_amber_id = u.amber_id
         AND req_out.status = 'pending' AND req_out.deleted_at IS NULL
       LEFT JOIN connection_requests req_in ON
         req_in.requester_amber_id = u.amber_id
         AND req_in.addressee_amber_id = $1
         AND req_in.status = 'pending' AND req_in.deleted_at IS NULL
       WHERE u.deleted_at IS NULL
         AND u.amber_id != $1
         AND u.phone = ANY($2::text[])
       LIMIT 1`,
      [meAmberId, normalized],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      amberId: String(r.amber_id),
      username: r.username ?? null,
      fullName: r.full_name ?? null,
      avatarUrl: r.avatar_url ?? null,
      occupation: r.occupation ?? null,
      currentCity: r.current_city ?? null,
      status: r.status,
    };
  } catch {
    return null;
  }
}
