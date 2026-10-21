/**
 * BLOCKING, AND IT IS NOT A DM FEATURE.
 *
 * The table is called dm_blocks and the only code that ever consulted it lived
 * in routes/dms.js, in three places. So "block" meant, precisely: this person
 * cannot send me a direct message. They could still send a connection request,
 * ask for an intro, and push a notification onto my lock screen with their name
 * on it. Every one of those is the thing a person blocking somebody is trying to
 * stop, and none of them were stopped.
 *
 * That is not a missing feature so much as a promise the app was already making
 * and not keeping. A block button that leaves somebody able to reach you is
 * worse than no block button: it tells you the problem is handled.
 *
 * The table name stays. Renaming it means a migration, a rewrite of every query
 * against it, and a window where two names for one thing are both live, in
 * exchange for a word. What changes is who asks.
 *
 * ── FAIL CLOSED, AND THIS IS THE WHOLE REASON THIS FILE EXISTS ───────────────
 *
 * The original returned false on any error:
 *
 *     } catch {
 *       return false;   // "not blocked"
 *     }
 *
 * A database blip therefore un-blocked everybody, silently, for as long as it
 * lasted. That is the wrong direction for a safety control and it is wrong in a
 * way nobody would ever see in a log: the messages simply go through.
 *
 * Not knowing is treated as blocked. The cost of being wrong that way is one
 * refused connection request during an outage, and the person tries again. The
 * cost of being wrong the other way is a message arriving from somebody the
 * recipient deliberately shut out, which cannot be taken back.
 *
 * ── AND IT IS A HARD BLOCK: THE PERSON, NOT THE ROW ─────────────────────────
 *
 * Keyed on amber_id alone, a block was a block on a database row. Delete the
 * account, sign up again on the same phone, new amber_id, clean slate -- and the
 * person who blocked you never learns any of that happened.
 *
 * So blocking also copies the blocked account's proven handles (phone, verified
 * email) into blocked_handles, as the same 16-byte HMACs discovery_keys already
 * stores. Matching is then a join on (key_type, key_hash) and no plaintext phone
 * number is ever read, written or compared. See migration 053.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * May these two reach each other at all?
 *
 * @returns {Promise<boolean>} true when blocked in EITHER direction, and true
 *   when the answer could not be read. Symmetric on purpose: a block is about
 *   contact between two people, not about a direction of travel, and letting the
 *   blocked party still receive things from the blocker leaks that they were
 *   blocked.
 */
export async function blocksInteraction(x, y, deps = {}) {
  const run = deps.query || query;
  const a = asUuid(x);
  const b = asUuid(y);
  // A malformed id is not a person. Nothing to block, and refusing here would
  // break every call that legitimately has no counterparty yet.
  if (!a || !b) return false;
  if (a === b) return false;
  try {
    const { rows } = await run(
      /**
       * TWO WAYS TO BE BLOCKED, ASKED AS ONE QUESTION.
       *
       * The first half is the account block. The second is the handle block: any
       * phone or verified email this person blocked, matched against the handles
       * the OTHER account has actually proven (discovery_keys). That is what
       * survives somebody deleting their account and signing up again on the
       * same number.
       *
       * UNION ALL rather than UNION -- this only asks whether a row exists, and
       * de-duplicating two rows to answer a yes/no is work for nothing.
       */
      `SELECT 1 FROM dm_blocks
        WHERE (blocker_amber_id = $1::uuid AND blocked_amber_id = $2::uuid)
           OR (blocker_amber_id = $2::uuid AND blocked_amber_id = $1::uuid)
       UNION ALL
       SELECT 1 FROM blocked_handles bh
         JOIN discovery_keys dk
           ON dk.key_type = bh.key_type AND dk.key_hash = bh.key_hash
        WHERE (bh.blocker_amber_id = $1::uuid AND dk.amber_id = $2::uuid)
           OR (bh.blocker_amber_id = $2::uuid AND dk.amber_id = $1::uuid)
       LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  } catch (err) {
    // See the header. Unknown is treated as blocked, and it says so out loud
    // rather than becoming an invisible "no".
    console.error(`BLOCK_CHECK_UNAVAILABLE treating as blocked: ${err?.message || err}`);
    return true;
  }
}

/**
 * Everybody this account cannot reach, in one query.
 *
 * For fan-out. The notification path has a list of recipients and one sender,
 * and asking blocksInteraction per recipient is a round trip per person on a
 * path that already runs on every share, every circle add and every connection
 * request. One query, one Set.
 *
 * @returns {Promise<Set<string>|null>} null means the answer is unknown, which
 *   the caller must treat as "block everything" rather than "block nothing".
 *   A Set, even an empty one, means the answer was read.
 */
export async function blockedIdsFor(amberId, deps = {}) {
  const run = deps.query || query;
  const me = asUuid(amberId);
  if (!me) return new Set();
  try {
    const { rows } = await run(
      /**
       * Four sources, one Set. The two dm_blocks directions, plus the two handle
       * directions -- accounts whose proven handle THIS person blocked, and
       * people who blocked a handle that belongs to this person.
       *
       * The second handle direction is easy to forget and is the one that
       * matters most: without it, somebody who blocked you by phone would still
       * receive your notifications.
       */
      `SELECT blocked_amber_id AS other FROM dm_blocks WHERE blocker_amber_id = $1::uuid
       UNION
       SELECT blocker_amber_id AS other FROM dm_blocks WHERE blocked_amber_id = $1::uuid
       UNION
       SELECT dk.amber_id AS other FROM blocked_handles bh
         JOIN discovery_keys dk
           ON dk.key_type = bh.key_type AND dk.key_hash = bh.key_hash
        WHERE bh.blocker_amber_id = $1::uuid
       UNION
       SELECT bh.blocker_amber_id AS other FROM blocked_handles bh
         JOIN discovery_keys dk
           ON dk.key_type = bh.key_type AND dk.key_hash = bh.key_hash
        WHERE dk.amber_id = $1::uuid`,
      [me],
    );
    return new Set(rows.map((r) => String(r.other).toLowerCase()));
  } catch (err) {
    console.error(`BLOCK_LIST_UNAVAILABLE: ${err?.message || err}`);
    return null;
  }
}

/**
 * Block or unblock, from the blocker's side.
 *
 * ONE DIRECTION IS WRITTEN, BOTH ARE ENFORCED. A row means "a blocked b", and
 * unblocking removes only the row this account created -- so if both people
 * blocked each other, one of them relenting does not reopen the door on the
 * other's behalf.
 */
export async function setBlock(meAmberId, otherAmberId, blocked, deps = {}) {
  const run = deps.query || query;
  const me = asUuid(meAmberId);
  const other = asUuid(otherAmberId);
  if (!me || !other || me === other) return false;
  try {
    if (blocked) {
      await run(
        `INSERT INTO dm_blocks (blocker_amber_id, blocked_amber_id)
         VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
        [me, other],
      );
      /**
       * AND THE HANDLES, COPIED AS HASHES.
       *
       * INSERT ... SELECT straight from discovery_keys, so this never reads,
       * writes or compares a plaintext phone number or email -- the 16-byte
       * HMACs are already there and are the only form either table holds.
       *
       * source_amber_id is recorded so unblocking removes exactly what blocking
       * added. It goes NULL rather than cascading when that account is deleted,
       * which is the entire point: the block outlives the account.
       *
       * An account with no proven handles copies nothing and is blocked by
       * amber_id alone, exactly as before.
       */
      await run(
        `INSERT INTO blocked_handles (blocker_amber_id, key_type, key_hash, source_amber_id)
         SELECT $1::uuid, dk.key_type, dk.key_hash, $2::uuid
           FROM discovery_keys dk
          WHERE dk.amber_id = $2::uuid
         ON CONFLICT DO NOTHING`,
        [me, other],
      );
    } else {
      await run(
        `DELETE FROM dm_blocks
          WHERE blocker_amber_id = $1::uuid AND blocked_amber_id = $2::uuid`,
        [me, other],
      );
      /**
       * BY source_amber_id, NOT by re-reading their current handles.
       *
       * Somebody who changed their phone number while blocked would otherwise
       * leave a row behind that nothing could ever clear -- an invisible block
       * on a number, with no way to find it and no UI that admits it exists.
       */
      await run(
        `DELETE FROM blocked_handles
          WHERE blocker_amber_id = $1::uuid AND source_amber_id = $2::uuid`,
        [me, other],
      );
    }
    return true;
  } catch (err) {
    console.error(`BLOCK_WRITE_ERR ${err?.message || err}`);
    return false;
  }
}
