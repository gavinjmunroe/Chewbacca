/**
 * COLLAPSING TWO CARDS FOR ONE PERSON -- the user-initiated half.
 *
 * WHY THIS EXISTS. Linking resolves identity -- it points a contact card at the
 * Amber account that card is -- but it does not collapse duplicates. So the
 * moment Caleb joined, one of the two cards already sitting in the address book
 * got marked ON AMBER and the other did not, and what had been an invisible
 * duplicate became a visible one: two Calebs, one apparently on Amber and one
 * apparently not, both built from the same information.
 *
 * THE MERGE ITSELF LIVES IN store.js. This file used to carry a second, whole
 * implementation of it: its own table list, its own field rules, its own
 * transaction. Two implementations of one operation drift, and these did. This
 * one discovered its tables from pg_constraint, so it moved event_participants;
 * the resolver's worked from a list written by hand in 2026-08, so it did not,
 * and every automatic collapse after 2026-09-03 left a person's meeting
 * attendance pointing at a card it then soft-deleted. Same two cards, two
 * different survivors, decided by whether a person or a sync did the merging.
 *
 * So there is one engine now -- collapseContactGroup -- and this file is the
 * door a person walks through to reach it: it refuses a merge naming a card
 * that is already gone, says the merge was "user" rather than "auto", and hands
 * back the moved/deleted split the iOS client has always read. What is left
 * here beyond that is the deciding: which pairs are provably one person and may
 * be merged unasked, and which merely look like it and must be offered.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;


/**
 * Merge `dropId` into `keepId`. Both must belong to `ownerId`.
 *
 * Returns { ok, moved, deleted, reason? } — `moved` and `deleted` are per-table
 * row counts, so a merge is auditable rather than a boolean.
 */
export async function mergeContacts(ownerId, keepId, dropId, { origin = "user", rule = null } = {}) {
  const owner = asUuid(ownerId);
  const keep = asUuid(keepId);
  const drop = asUuid(dropId);
  if (!owner || !keep || !drop) return { ok: false, reason: "invalid" };
  if (keep === drop) return { ok: false, reason: "same_contact" };

  try {
    // BOTH CARDS MUST BE REAL, and this is checked here rather than left to the
    // engine below. The engine is built for the resolver, which collapses a
    // group it just computed and treats an already-gone member as done. A
    // person tapping Merge on a card somebody deleted from another device needs
    // to be told, not quietly told it worked.
    const { rows: live } = await query(
      `SELECT id FROM contacts
        WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [owner, [keep, drop]],
    );
    if (live.length !== 2) return { ok: false, reason: "not_found" };

    // ONE ENGINE. This used to be a second implementation of the merge --
    // its own table list, its own field rules -- and the two drifted, as two
    // implementations of one thing do: this one discovered its tables from
    // pg_constraint and so moved event_participants, the other worked from a
    // hand-written list and so did not. Same two cards, two different
    // survivors, depending on whether a person or a sync did the merging.
    // Dynamic import because store.js is the big module and this file is
    // reached from it; the repo already threads collapseContactGroup this way.
    const { collapseContactGroup } = await import("./store.js");
    const res = await collapseContactGroup(owner, keep, [drop], { origin, rule });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.reason === "survivor_not_found" ? "not_found" : (res.reason ?? "error"),
      };
    }

    // The engine reports one map keyed by table, with suffixed keys for rows it
    // dropped rather than moved. This endpoint's callers have always been given
    // the two apart, so they are split back out rather than changing a shape the
    // iOS client already reads.
    const moved = {};
    const deleted = {};
    for (const [key, n] of Object.entries(res.moved ?? {})) {
      const cut = key.indexOf(":");
      if (cut === -1) moved[key] = (moved[key] ?? 0) + n;
      else {
        const table = key.slice(0, cut);
        deleted[table] = (deleted[table] ?? 0) + n;
      }
    }

    return {
      ok: true,
      moved,
      deleted,
      mergeId: res.mergeId ?? null,
      undoable: Boolean(res.undoable),
    };
  } catch (e) {
    console.error(`MERGE_CONTACTS_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
    return { ok: false, reason: "error" };
  }
}

/**
 * TWO CARDS THAT PROVABLY ARE ONE PERSON: both linked to the same account.
 *
 * This is the only case safe to merge without asking. Identity came from keys
 * the account itself proved it owns, so two cards pointing at one account are
 * two cards for one person, full stop — there is nothing for the user to
 * adjudicate.
 *
 * The keeper is the card with the most to lose: the one carrying the most
 * observations, then the oldest. Merging the busy card into the empty one would
 * work identically as far as the data goes, but the surviving id is the one
 * anything cached client-side is holding, and the busy card is the one the user
 * has been opening.
 */
export async function mergeProvableDuplicates(ownerId, amberId = null) {
  const owner = asUuid(ownerId);
  if (!owner) return { merged: 0, pairs: [] };
  try {
    const { rows } = await query(
      `SELECT c.linked_amber_id AS amber_id,
              c.id,
              COALESCE(o.n, 0) AS observations,
              c.created_at
         FROM contacts c
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n
             FROM observations ob
            WHERE ob.owner_id = c.owner_id
              AND ob.contact_id = c.id
              AND ob.deleted_at IS NULL
         ) o ON TRUE
        WHERE c.owner_id = $1
          AND c.deleted_at IS NULL
          AND c.linked_amber_id IS NOT NULL
          AND ($2::uuid IS NULL OR c.linked_amber_id = $2::uuid)
        ORDER BY c.linked_amber_id, o.n DESC, c.created_at ASC`,
      [owner, amberId ? asUuid(amberId) : null],
    );

    const byAccount = new Map();
    for (const r of rows) {
      const k = String(r.amber_id);
      if (!byAccount.has(k)) byAccount.set(k, []);
      byAccount.get(k).push(String(r.id));
    }

    let merged = 0;
    const pairs = [];
    for (const [account, ids] of byAccount) {
      if (ids.length < 2) continue;
      const [keep, ...rest] = ids; // ORDER BY put the busiest first
      for (const drop of rest) {
        const res = await mergeContacts(owner, keep, drop);
        if (res.ok) {
          merged += 1;
          pairs.push({ account, keep, drop });
        }
      }
    }
    return { merged, pairs };
  } catch (e) {
    console.error(`MERGE_PROVABLE_ERR owner=${ownerId} ${e?.message || e}`);
    return { merged: 0, pairs: [] };
  }
}

/**
 * CARDS THAT LOOK LIKE ONE PERSON BUT CANNOT BE PROVEN TO BE — offered, never
 * merged.
 *
 * The Caleb case: one card linked to his account, another with the same name
 * and no key that resolves anywhere. It is almost certainly him, and "almost
 * certainly" is not a license to destroy a card. Two people really can share a
 * name, and a wrong merge takes one person's notes and files them under
 * another, which nothing in the app would show you.
 *
 * So this returns pairs for the app to offer, ranked, with enough detail for a
 * human to decide in one glance: what each card knows, and which of the two is
 * the account.
 *
 * Only ever pairs a LINKED card with an UNLINKED one. Two unlinked same-name
 * cards are also probably duplicates, but there is no account involved and
 * therefore no reason this particular flow should be the one to raise it.
 */
/**
 * THE DUPLICATES A PERSON ACTUALLY HAS, found by the engine built for it.
 *
 * duplicateCandidates below finds exactly one shape: a card LINKED TO AN AMBER
 * ACCOUNT sitting next to an unlinked card whose name matches once every
 * non-letter is stripped. That is a narrow and useful case, and it is not the
 * case anybody complained about:
 *
 *   "he has multiple Shirley Parks, but one Shirley Park has a tagline that
 *    says USC on it... a couple of contacts that he has duplicates for on his
 *    phone weren't de-duplicated."
 *
 * Neither of those Shirley Parks is an Amber account, so the linked-side
 * requirement excludes them both. And "Shirley Park" normalizes to
 * "shirleypark" while "Shirley Park USC" normalizes to "shirleyparkusc", so
 * even without that requirement the keys would not match. The query could not
 * have found them.
 *
 * src/lib/contact-duplicates.js was written for this: it splits the annotation
 * off the name before comparing (so both Shirleys reduce to "Shirley Park" with
 * the tag USC held separately), buckets by phone, email and name key, and tiers
 * the result -- `provable` for a shared phone or email, `likely` for a name plus
 * complementary channels, a shared label, a shared company or a bare stub next
 * to a real record. It refuses on contradicting tags or companies, so two
 * different people who share a name are left alone. Twenty-one tests, and until
 * now NOTHING CALLED IT.
 *
 * This is that call. Both sources are returned by the route: this one finds what
 * a person recognizes as a duplicate, the account-linked query finds what the
 * graph can prove, and neither is a superset of the other.
 */
export async function duplicateCandidatesFromBook(ownerId, { limit = 50 } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  try {
    const { listAddressBookRows } = await import("./store.js");
    const rows = await listAddressBookRows(owner);
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const { findDuplicateCandidates } = await import("../lib/contact-duplicates.js");
    const pairs = findDuplicateCandidates(rows, { limit: Math.min(Math.max(Number(limit) || 50, 1), 200) });
    return pairs.map((p) => ({
      // The wire fields the merge endpoint and the existing client already
      // speak, so this can be concatenated with the account-linked list without
      // the app having to learn a second shape.
      keepContactId: String(p.keepId),
      dropContactId: String(p.dropId),
      name: p.keep.name ?? p.drop.name ?? null,
      // NULL, AND THE CLIENT MUST RESPECT IT. This source knows nothing about
      // Amber accounts -- it compares cards in the address book. The sheet
      // used to print "One is on Amber" for every row regardless, which is
      // simply false for everything found here.
      amberId: null,
      otherName: p.drop.name ?? null,
      otherPhone: p.drop.phones?.[0] ?? null,
      otherEmail: p.drop.emails?.[0] ?? null,
      // And the part that makes a review queue answerable rather than a coin
      // flip: WHY these two, and how sure.
      tier: p.tier,
      reason: p.reason,
      keep: p.keep,
      drop: p.drop,
    }));
  } catch {
    return [];
  }
}

export async function duplicateCandidates(ownerId, { limit = 20 } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  try {
    const { rows } = await query(
      `WITH norm AS (
         SELECT c.id,
                c.linked_amber_id,
                c.full_name,
                c.phone_primary,
                c.emails,
                c.created_at,
                regexp_replace(
                  lower(COALESCE(c.full_name,
                                 CONCAT_WS(' ', c.first_name, c.last_name))),
                  '[^a-z]', '', 'g') AS key
           FROM contacts c
          WHERE c.owner_id = $1 AND c.deleted_at IS NULL
       )
       SELECT l.id            AS linked_id,
              l.full_name     AS linked_name,
              l.linked_amber_id AS amber_id,
              u.id            AS unlinked_id,
              u.full_name     AS unlinked_name,
              u.phone_primary AS unlinked_phone,
              u.emails        AS unlinked_emails
         FROM norm l
         JOIN norm u
           ON u.key = l.key
          AND u.linked_amber_id IS NULL
        WHERE l.linked_amber_id IS NOT NULL
          AND l.key <> ''
        ORDER BY l.full_name ASC NULLS LAST, u.created_at ASC
        LIMIT $2`,
      [owner, Math.min(Math.max(Number(limit) || 20, 1), 100)],
    );
    return rows.map((r) => ({
      keepContactId: String(r.linked_id),
      dropContactId: String(r.unlinked_id),
      name: r.linked_name ?? r.unlinked_name ?? null,
      amberId: String(r.amber_id),
      // Shown so the choice is informed: "the other card has a number this one
      // doesn't" is the difference between merging and leaving it alone.
      otherPhone: r.unlinked_phone ?? null,
      otherEmail: (r.unlinked_emails || "").split(",")[0]?.trim() || null,
      // THE OTHER CARD'S OWN NAME, and WHY these two were paired.
      //
      // The sheet showed one name and the sentence "Two cards. One is on
      // Amber." for every row, which made an unanswerable question: somebody
      // looking for the second "Josh Bernson" cannot find one, because the
      // other card is filed as something else. Both halves of that were already
      // known here and thrown away.
      otherName: r.unlinked_name ?? null,
      // NOT "provable", however sure it feels. This source pairs a card linked
      // to an account with a same-named card, and checks NO shared phone or
      // email at all -- so there is nothing the person can go and look at to
      // confirm it, which is exactly the complaint. The route keeps only
      // provable pairs, so this is offered for review and not as a duplicate.
      tier: "likely",
      reason: "one card is linked to their Amber account and the other has the same name",
    }));
  } catch (e) {
    console.error(`DUPLICATE_CANDIDATES_ERR owner=${ownerId} ${e?.message || e}`);
    return [];
  }
}
