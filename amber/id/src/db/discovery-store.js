/**
 * DISCOVERY KEYS — the hashed phone numbers and email addresses an ACCOUNT has
 * proven it owns.
 *
 * This is the only globally-indexed identity table in the system, and the rule
 * that keeps it from being a surveillance tool is that it holds accounts and
 * nothing else. `contact_identity_keys` holds everybody's address book -- people
 * who never signed up for anything -- and is only ever queried scoped to one
 * owner. `discovery_keys` holds people who opted in by creating an account, and
 * may be queried globally. Confusing the two is how a product like this becomes a
 * reverse phone lookup.
 *
 * TWO JOBS:
 *
 *  1. PUSH AT SIGNUP. When someone signs up, the server looks up their number
 *     across contact_identity_keys once, links the matching contact cards, and
 *     notifies those owners. That is a single write-time sweep. The alternative --
 *     letting a client ask "does this number have an account" -- is a pull, and a
 *     pull can be run ten million times against a dictionary of every number.
 *
 *  2. PROVING WHO A VIEWER IS. The share-reach predicate needs to know that the
 *     person asking for a note is the member whose phone their friend has. It
 *     reads that from here rather than from a parameter, so the answer comes from
 *     something the account proved rather than something the caller asserted.
 *
 * NOTHING IN HERE MAY BE CALLED FROM A USER-FACING ROUTE with a value the user
 * supplied. Writes happen at signup and at verification; the global read happens
 * in the signup job. A route that hands a client-supplied number to
 * `amberIdsForKeys` turns this file into the thing it exists to prevent.
 */

import { query } from "./sql.js";
import { KEY_TYPE, identityKeysFor } from "../lib/identity-keys.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * Record the keys an account owns. Idempotent. FIRST CLAIM WINS.
 *
 * A key can only belong to ONE account -- key_hash is the primary key -- because
 * two accounts claiming the same number is exactly the ambiguity that would make
 * "who is this viewer" unanswerable.
 *
 * THIS USED TO SAY `DO UPDATE SET amber_id = EXCLUDED.amber_id`, reasoning that a
 * recycled number should move to its new owner. That reasoning is not wrong about
 * recycled numbers; it is wrong about doing it HERE, silently, as a side effect
 * of an INSERT at signup. Two consequences, and a test caught both:
 *
 *   phoneKey normalizes to the last ten digits, so +33612345678 (French 06) and
 *   +13612345678 (US area code 361) -- both real, allocatable numbers -- hash
 *   identically. The second of those two people to sign up SILENTLY TOOK OVER the
 *   first one's discovery identity. The displaced user could no longer be found
 *   by their own number, reach circles they were a member of, or see notes shared
 *   to them, and nothing anywhere said so.
 *
 *   even with perfect normalization, a signup quietly moving an identity from one
 *   account to another is a privilege transfer with no audit trail and no
 *   notification to the person losing it.
 *
 * So the claim now fails rather than steals, and says which keys it could not
 * take. Refusing is the safe direction: an account that cannot prove it owns a
 * number is simply not discoverable by it, which is a missing feature rather than
 * somebody else's data. A genuinely recycled number goes through
 * reassignDiscoveryKey(), where it is deliberate and written to audit_log.
 *
 * Returns { held, conflicts }: how many keys this account now holds, and the
 * hashes that belong to somebody else. A caller that ignores `conflicts` is
 * throwing away the only signal that this happened.
 */
export async function setDiscoveryKeys(amberId, { phones = [], emails = [] } = {}) {
  const amber = asUuid(amberId);
  if (!amber) return 0;
  const keys = identityKeysFor({ phones, emails });
  if (keys.length === 0) return 0;
  const hashes = keys.map((k) => k.keyHash);
  await query(
    `INSERT INTO discovery_keys (key_hash, key_type, amber_id)
     SELECT * FROM unnest($1::bytea[], $2::smallint[], $3::uuid[])
     ON CONFLICT (key_hash) DO NOTHING`,
    [hashes, keys.map((k) => k.keyType), keys.map(() => amber)],
  );

  // WHICH ONES DID SOMEBODY ELSE ALREADY HAVE. Read back rather than inferred
  // from rowCount: DO NOTHING cannot tell "already mine" from "already theirs",
  // and those two mean completely different things.
  const { rows: taken } = await query(
    `SELECT key_hash, amber_id FROM discovery_keys
      WHERE key_hash = ANY($1::bytea[]) AND amber_id <> $2`,
    [hashes, amber],
  );
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM discovery_keys WHERE amber_id = $1`,
    [amber],
  );
  if (taken.length) {
    console.error(
      `DISCOVERY_KEY_CONFLICT account=${amber} refused=${taken.length} ` +
        `holders=${[...new Set(taken.map((t) => t.amber_id))].join(",")}`,
    );
  }
  return {
    held: rows[0]?.n ?? 0,
    conflicts: taken.map((t) => ({ keyHash: t.key_hash, heldBy: t.amber_id })),
  };
}

/**
 * Move one key to a different account, DELIBERATELY, and write it down.
 *
 * The legitimate case setDiscoveryKeys used to handle by accident: a phone number
 * genuinely changes hands and the new holder should be discoverable by it. That
 * is a real thing which needs a real decision behind it, so it is a separate
 * function, it records who did it, and it is not reachable from signup.
 *
 * NOT CALLABLE FROM A USER-FACING ROUTE with a client-supplied number. Same rule
 * as the rest of this file: the value must come from something the account
 * proved.
 */
export async function reassignDiscoveryKey(
  toAmberId, keyType, keyHash, { actorAmberId = null, reason = null } = {},
) {
  const to = asUuid(toAmberId);
  if (!to || !Buffer.isBuffer(keyHash) || keyHash.length !== 16) return false;
  const type = Number(keyType);
  if (type !== KEY_TYPE.PHONE && type !== KEY_TYPE.EMAIL) return false;

  const { rows: before } = await query(
    `SELECT amber_id FROM discovery_keys WHERE key_hash = $1`, [keyHash]);
  const from = before[0]?.amber_id ?? null;
  if (from === to) return true;

  await query(
    `INSERT INTO discovery_keys (key_hash, key_type, amber_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (key_hash) DO UPDATE SET amber_id = EXCLUDED.amber_id,
                                          key_type = EXCLUDED.key_type`,
    [keyHash, type, to],
  );

  // THE HASH IS RECORDED, NOT THE NUMBER. An audit row that held the phone would
  // undo the point of hashing it in the first place.
  await query(
    `INSERT INTO audit_log (actor_amber_id, action, target_type, target_id, detail)
     VALUES ($1, 'discovery_key.reassign', 'discovery_key', $2, $3)`,
    [asUuid(actorAmberId) ?? to, to,
     JSON.stringify({ keyHash: keyHash.toString("hex"), keyType: type,
                      from, to, reason })],
  ).catch((e) => {
    // An unaudited reassignment is worse than a failed one.
    console.error(`DISCOVERY_KEY_REASSIGN_AUDIT_ERR ${e?.message || e}`);
    throw e;
  });
  return true;
}

/** Drop one key from an account (a number they removed, an unverified address). */
export async function removeDiscoveryKey(amberId, keyType, keyHash) {
  const amber = asUuid(amberId);
  if (!amber || !keyHash) return 0;
  const { rowCount } = await query(
    `DELETE FROM discovery_keys WHERE amber_id = $1 AND key_type = $2 AND key_hash = $3`,
    [amber, keyType, keyHash],
  );
  return rowCount ?? 0;
}

/**
 * THE SIGNUP SWEEP, and the reason the global index on contact_identity_keys
 * exists.
 *
 * Given a brand-new account's keys, find every contact card in every address book
 * that holds one of those keys and point it at the new account. From that moment
 * the card is a linked person: their circles resolve, their shared notes reach
 * them, and their owner can be told "Maggie just joined."
 *
 * This runs ONCE per signup, server-side, over keys the account itself supplied.
 * It is the push half of push-vs-pull discovery and it is why no user-facing
 * endpoint ever needs to ask "is this number registered".
 *
 * Returns { linked, owners } -- how many cards were linked and which owners to
 * notify.
 */
export async function linkContactsToNewAccount(amberId, { phones = [], emails = [] } = {}) {
  const amber = asUuid(amberId);
  if (!amber) return { linked: 0, owners: [] };
  const keys = identityKeysFor({ phones, emails });
  if (keys.length === 0) return { linked: 0, owners: [] };
  const { rows } = await query(
    `UPDATE contacts c
        SET linked_amber_id = $1
      WHERE c.deleted_at IS NULL
        AND c.linked_amber_id IS DISTINCT FROM $1
        AND EXISTS (
          SELECT 1 FROM contact_identity_keys k
           WHERE k.owner_id = c.owner_id AND k.contact_id = c.id
             AND k.key_hash = ANY($2::bytea[])
        )
        -- Never point somebody's card at their own account. A contact card for
        -- yourself is a duplicate of you, not a link to you.
        AND c.owner_id <> $1
      RETURNING c.owner_id`,
    [amber, keys.map((k) => k.keyHash)],
  );
  const owners = [...new Set(rows.map((r) => String(r.owner_id)))];
  return { linked: rows.length, owners };
}

/**
 * Which accounts hold these keys. SERVER-SIDE ONLY -- see the file header. The
 * signup job is the caller; a route is not.
 */
export async function amberIdsForKeys(keyHashes = []) {
  const list = (keyHashes || []).filter(Boolean);
  if (list.length === 0) return new Map();
  const { rows } = await query(
    `SELECT key_hash, amber_id FROM discovery_keys WHERE key_hash = ANY($1::bytea[])`,
    [list],
  );
  const out = new Map();
  for (const r of rows) out.set(r.key_hash.toString("hex"), String(r.amber_id));
  return out;
}

export { KEY_TYPE };
