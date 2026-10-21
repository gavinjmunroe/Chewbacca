/**
 * THE NAME ON THE ENVELOPE, KEPT.
 *
 * A mail header names everybody on the thread and a calendar invite sometimes
 * names a guest. Both were read, used to decide who a message was with, and
 * discarded -- the name survived only when the sync happened to create a
 * contact card, which it does past a message-count threshold and never when a
 * card already existed. The result was a graph where the people most clearly
 * identified, the ones on a single important introduction, were the ones left
 * as mailbox strings.
 *
 * This writes the (address, name) pair as it goes past. Nothing else: no
 * subject, no body, no thread. The address was already stored; the name is
 * the cheapest thing in the message and the only one anybody reads.
 */

import { query } from "./sql.js";

/** Headers write names in both directions. "Vance, Beaumont" is a person. */
export function tidyName(raw) {
  let name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return null;

  // Quoted display names arrive with the quotes attached.
  name = name.replace(/^"(.*)"$/, "$1").trim();
  if (!name || name.includes("@")) return null;

  /*
   * "LAST, FIRST" IS A NAME, NOT A LIST. Exchange writes every internal
   * address this way -- "Ryan, Jason" -- and storing it verbatim gives a
   * graph of surnames with commas in them. One comma, two sides, each side
   * without a comma of its own: flip it. Anything with two commas is left
   * alone, because that is a list and guessing at it is how "Smith, Jones,
   * Patel" becomes a person.
   */
  const parts = name.split(",");
  if (parts.length === 2) {
    const last = parts[0].trim();
    const first = parts[1].trim();
    if (last && first && first.length <= 40 && last.length <= 40) {
      name = `${first} ${last}`;
    }
  }

  if (name.length < 2 || name.length > 120) return null;
  return name;
}

/**
 * Record names seen beside addresses.
 *
 * `entries` is [{ email, name }]. Anything unusable is dropped silently --
 * this runs inside a sync and must never be the reason one fails.
 */
export async function noteNames(ownerId, entries = [], { source = "mail" } = {}) {
  if (!ownerId) return 0;

  const seen = new Map();
  for (const e of entries ?? []) {
    const email = String(e?.email ?? e?.address ?? "").trim().toLowerCase();
    const name = tidyName(e?.name);
    if (!email.includes("@") || !name) continue;
    /*
     * A display name that is just the address, or just its local part, is
     * the placeholder a client filled in. Keeping it would let it outvote a
     * real name on the count.
     */
    const local = email.split("@")[0].replace(/[^a-z0-9]/g, "");
    if (name.toLowerCase().replace(/[^a-z0-9]/g, "") === local) continue;
    seen.set(`${email}|${name}`, { email, name });
  }
  if (seen.size === 0) return 0;

  const rows = [...seen.values()];
  const { rowCount } = await query(
    `INSERT INTO observed_names (owner_id, email, name, source)
     SELECT $1::uuid, t.email, t.name, $4::text
       FROM unnest($2::text[], $3::text[]) AS t(email, name)
     ON CONFLICT (owner_id, email, name) DO UPDATE
        SET seen = observed_names.seen + 1, last_seen = now()`,
    [ownerId, rows.map((r) => r.email), rows.map((r) => r.name), source],
  ).catch(() => ({ rowCount: 0 }));

  return rowCount ?? 0;
}

/**
 * The best name each address has been seen under, across one org's members.
 *
 * Most-seen wins, and mail outranks calendar at equal counts: a header is
 * written by the person themselves, a calendar displayName is written by
 * whoever happened to organize the meeting.
 */
export async function observedNamesForOrg(orgId) {
  if (!orgId) return new Map();

  const { rows } = await query(
    `SELECT DISTINCT ON (o.email)
            o.email, o.name
       FROM observed_names o
       JOIN org_members m ON m.amber_id = o.owner_id
      WHERE m.org_id = $1::uuid AND m.status = 'active'
      ORDER BY o.email,
               o.seen DESC,
               (o.source = 'mail') DESC,
               o.last_seen DESC`,
    [orgId],
  );

  return new Map(rows.map((r) => [String(r.email).toLowerCase(), r.name]));
}

/**
 * The best name anybody has seen for any of these identities.
 *
 * Called on the path that creates or touches a person, so it is one indexed
 * lookup on a handful of addresses and nothing more. Not scoped to an org:
 * the table is a record of what a wire carried, the address is already known
 * to the caller, and the name adds nothing the caller could not read off the
 * same envelope.
 */
export async function bestObservedName(identities = []) {
  const emails = (identities ?? [])
    .filter((i) => i?.kind === "email" && typeof i.value === "string")
    .map((i) => i.value.trim().toLowerCase())
    .filter((v) => v.includes("@"));
  if (emails.length === 0) return null;

  const { rows } = await query(
    `SELECT name
       FROM observed_names
      WHERE email = ANY($1::text[])
      ORDER BY seen DESC, (source = 'mail') DESC, last_seen DESC
      LIMIT 1`,
    [emails],
  );
  return rows[0]?.name ?? null;
}
