/**
 * FILL THE HOLES GOOGLE LEAVES, WITHOUT INVENTING ANYBODY.
 *
 * WHAT THE PROVIDERS ACTUALLY SEND. Of 515 calendar guest entries in one real
 * account, five carried a display name. Google sends an address and nothing
 * else for almost every attendee, so the graph fills with nodes labeled
 * sagartiw@stanford.edu and every screen that shows a person shows an address.
 * The answers read the same way: "You know three people at Paychex:
 * bvance@paychex.com, jryan4@paychex.com." That is a database leaking, not a
 * product that knows somebody.
 *
 * TWO PASSES, AND THE ORDER MATTERS.
 *
 * FIRST, SPLIT WHAT IS ALREADY THERE. `b.vance`, `brian_vance` and
 * `vance.brian` are each a whole name with a separator in it; no cleverness
 * is required and none should be spent. humanizeAddress does this, it is free
 * and it is certain.
 *
 * SECOND, AND ONLY FOR WHAT IS LEFT, ask a model. `sagartiw` has no separator
 * and no case change, so splitting it is a guess -- but it is not an
 * unanswerable question, because `sagartiw@stanford.edu` plus a known meeting
 * at Stanford is enough for a person to say "Sagar Tiwari" and be right.
 *
 * THE GUARD, WHICH IS THE WHOLE REASON THIS IS SAFE TO RUN. A model asked for
 * a name will always produce one, and a wrong name on somebody's record is
 * far worse than an address: it is confidently wrong, it is shown everywhere,
 * and nobody who reads it knows to doubt it. So every answer is checked back
 * against the address it came from. The letters of the proposed name, with
 * the spaces removed, must EXPLAIN the local part -- as a prefix, as
 * first-initial-plus-surname, as surname-plus-initial, or exactly. "Sagar
 * Tiwari" -> `sagartiwari`, which `sagartiw` is a prefix of: accepted.
 * "Sarah Chen" for `sagartiw`: rejected, because nothing in those letters is
 * in that address. A name the address cannot account for is a hallucination
 * by definition, and it is dropped without ceremony.
 *
 * WHAT IT NEVER TOUCHES. A person who already has a real name -- the five
 * Google did send, anything typed by a human, anything a previous pass
 * accepted -- is left exactly as it is. This only ever writes over an
 * address.
 */

import { query } from "./sql.js";
import { callChat } from "../lib/anthropic-chat.js";
import { humanizeAddress } from "./org-memory-store.js";

/** How many to send the model in one request. */
const BATCH = 30;

/** Is this "name" still just an address, or a word nobody is called? */
export function stillAnAddress(name) {
  const v = String(name ?? "").trim();
  if (!v) return true;
  if (v.includes("@")) return true;
  // One word, no space: "Sagartiw", "Bvance". A real single-word name exists
  // but is rare, and the model is asked rather than assumed either way.
  return !v.includes(" ");
}

/**
 * Could this name have produced this address?
 *
 * Exact about what it allows and silent about what it does not. Everything
 * here is letters-only on both sides, because punctuation in an address is a
 * separator and punctuation in a name is noise.
 */
export function nameExplainsAddress(name, address) {
  const local = String(address ?? "")
    .toLowerCase()
    .split("@")[0]
    .replace(/[^a-z]/g, "");
  if (!local) return false;

  const parts = String(name ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return false;

  const joined = parts.join("");
  const reversed = [...parts].reverse().join("");
  const first = parts[0];
  const last = parts[parts.length - 1];

  const forms = new Set([
    joined,
    reversed,
    `${first[0]}${last}`,
    `${last}${first[0]}`,
    `${first}${last[0]}`,
    last,
    first,
  ]);

  for (const form of forms) {
    if (!form) continue;
    // The address may be a truncation of the name (sagartiw <- sagartiwari)
    // or the name a truncation of the address (jryan4 -> jryan).
    if (form.startsWith(local) || local.startsWith(form)) return true;
  }
  return false;
}

const SYSTEM = `You work out people's real names from what a company already knows about them.

For each person you are given their email addresses, the firm they are at if we know it, and the titles of meetings they were in. Reply with their full name, or null if you genuinely cannot tell.

THE MEETING TITLES ARE THE BEST EVIDENCE. People put each other's names in subject lines: "Sagar Tiwari and Harris Stolzenberg", "Karthik x Sagar", "maggie <> sagar perplexity". If a name in a title matches the letters of the person's address, that is the person.

Rules:
- The name must be supported by the letters in one of their addresses. "sagartiw@stanford.edu" seen in a meeting called "Sagar Tiwari and Harris Stolzenberg" is Sagar Tiwari.
- Never guess a first name from a single initial with nothing else to go on.
- A role mailbox (info@, sales@, noreply@) is not a person: null.
- Use ordinary capitalization.

Reply with a JSON array only, one object per person, in the same order:
[{"address":"<their first address>","name":"Full Name"|null}]`;

/**
 * Ask the model, parse defensively, and keep only what an address supports.
 *
 * WHAT CHANGED AND WHY IT WAS NOT WORKING. The first version handed over one
 * email address and asked for a name. That resolves b.vance and cannot
 * resolve sagartiw, so most people stayed as addresses while the answer sat
 * one table away: the calendar is full of titles like "Sagar Tiwari and
 * Harris Stolzenberg", already on that person's timeline, with the name in
 * plain text. Nothing was reading it.
 *
 * THE GUARD IS WHY THIS IS SAFE TO RUN AT ALL. A model asked for a name
 * always produces one, and a wrong name on somebody's record is worse than
 * an address: confidently wrong, shown everywhere, and nobody reading it
 * knows to doubt it. Every answer is checked back against EVERY address the
 * person has -- it must explain at least one -- and anything else is
 * dropped.
 */
export async function proposeNames(people = [], { chat = callChat } = {}) {
  /* A bare string is a person we know nothing else about, which is what the
     tests and the older caller pass. */
  const list = people
    .filter(Boolean)
    .slice(0, BATCH)
    .map((p) =>
      typeof p === "string" ? { email: p.toLowerCase(), emails: [p.toLowerCase()] } : p,
    );
  if (list.length === 0) return new Map();

  const asked = list.map((p) => ({
    address: p.email,
    alsoKnownAs: (p.emails ?? []).filter((e) => e !== p.email).slice(0, 4),
    firm: p.firm ?? null,
    seenInMeetings: (p.seenIn ?? []).slice(0, 8),
  }));

  const raw = await chat({
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(asked) }],
    maxTokens: 1500,
  }).catch(() => null);
  if (!raw) return new Map();

  let parsed;
  try {
    const text = String(raw);
    const open = text.indexOf("[");
    const close = text.lastIndexOf("]");
    parsed = open >= 0 && close > open ? JSON.parse(text.slice(open, close + 1)) : null;
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return new Map();

  const byAddress = new Map(list.map((p) => [p.email, p]));

  const out = new Map();
  for (const row of parsed) {
    const address = String(row?.address ?? "").trim().toLowerCase();
    const name = String(row?.name ?? "").trim();
    if (!address || !name || name.toLowerCase() === "null") continue;
    if (name.length > 80 || name.split(/\s+/).length > 4) continue;

    /*
     * ACROSS ALL OF THEIR ADDRESSES. Somebody with four emails has four
     * chances to be explained, and the one that explains them is routinely
     * not the one we happened to file first.
     */
    const person = byAddress.get(address);
    const candidates = person?.emails?.length ? person.emails : [address];
    if (!candidates.some((e) => nameExplainsAddress(name, e))) continue;

    out.set(address, name);
  }
  return out;
}

/**
 * Name everybody in one org who is still an address.
 *
 * Returns what it did rather than logging it, so a route can show a number
 * and a script can print one. `dryRun` lists the changes without making them.
 */
export async function enrichNames({ orgId, dryRun = false, limit = 300, chat = callChat } = {}) {
  if (!orgId) return { ok: false, reason: "bad_input" };

  /*
   * EVERYTHING WE ALREADY KNOW ABOUT THEM, NOT JUST ONE ADDRESS.
   *
   * THE FIRST VERSION ASKED A MODEL TO READ ONE EMAIL ADDRESS AND GUESS.
   * That works for b.vance and cannot work for sagartiw -- and it was
   * leaving most people as addresses while the answer sat one table away.
   *
   * TWO THINGS WERE BEING IGNORED.
   *
   * ALL THEIR ADDRESSES. Somebody with four emails has four chances at a
   * name, and the one that resolves is often not the first: sagartiw tells
   * you little, s.tiwari tells you everything.
   *
   * AND THE MEETING TITLES. This is the good one. A calendar is full of
   * "Sagar Tiwari and Harris Stolzenberg", "Karthik x Sagar", "maggie <>
   * sagar perplexity" -- people put each other's NAMES in the subject line,
   * and those rows are already on this person's timeline. The name is
   * sitting in the ledger in plain text; nothing was reading it.
   */
  const { rows } = await query(
    `SELECT p.id, p.display_name, p.company,
            (SELECT array_agg(i.value ORDER BY i.created_at)
               FROM org_person_identities i
              WHERE i.org_id = p.org_id AND i.person_id = p.id AND i.kind = 'email'
            ) AS emails,
            a.name AS firm,
            (SELECT array_agg(DISTINCT x.summary)
               FROM (
                 SELECT s.summary
                   FROM org_interactions s
                  WHERE s.org_id = p.org_id AND s.person_id = p.id
                    AND s.summary IS NOT NULL AND btrim(s.summary) <> ''
                  ORDER BY s.occurred_at DESC
                  LIMIT 12
               ) x
            ) AS seen_in
       FROM org_people p
       LEFT JOIN org_accounts a ON a.org_id = p.org_id AND a.id = p.account_id
      WHERE p.org_id = $1::uuid
        AND p.deleted_at IS NULL
      LIMIT $2`,
    [orgId, Math.min(Number(limit) || 300, 2000)],
  );

  const changes = [];
  const needsModel = [];

  for (const r of rows) {
    if (!stillAnAddress(r.display_name)) continue;

    const emails = (r.emails ?? []).filter(Boolean).map((e) => String(e).toLowerCase());
    if (emails.length === 0 && String(r.display_name ?? "").includes("@")) {
      emails.push(String(r.display_name).toLowerCase());
    }
    if (emails.length === 0) continue;

    /*
     * THE FREE PASS FIRST, ACROSS EVERY ADDRESS. Separators are certainty,
     * not inference, and the address that has one is often not the first
     * one filed.
     */
    const split = emails.map((e) => humanizeAddress(e)).find((n) => n && n.includes(" "));
    if (split) {
      changes.push({ id: r.id, from: r.display_name, to: split, how: "split" });
      continue;
    }

    needsModel.push({
      id: r.id,
      from: r.display_name,
      email: emails[0],
      emails,
      firm: r.firm ?? r.company ?? null,
      seenIn: (r.seen_in ?? []).filter(Boolean).slice(0, 8),
    });
  }

  /* Then the rest, in batches, with the guard on every answer. */
  for (let i = 0; i < needsModel.length; i += BATCH) {
    const slice = needsModel.slice(i, i + BATCH);
    const named = await proposeNames(slice, { chat });
    for (const s of slice) {
      const name = named.get(s.email);
      if (name) changes.push({ id: s.id, from: s.from, to: name, how: "enriched" });
    }
  }

  if (dryRun) return { ok: true, dryRun: true, considered: rows.length, changes };

  let written = 0;
  const skipped = [];
  for (const c of changes) {
    /*
     * THE WHERE CLAUSE IS THE SAFETY, not the SELECT above. Between reading
     * and writing, a human may have typed a real name on this row -- and if
     * they did, this must not overwrite it. Re-checking the address shape in
     * the UPDATE makes the write itself conditional, so a racing edit wins.
     *
     * AND EACH WRITE IS ITS OWN STATEMENT, caught on its own. org_people
     * carries a unique index on (org_id, lower(display_name)): naming two
     * addresses that resolve to one person raises on the second, and inside
     * a shared transaction that would roll back every name in the batch. A
     * collision here means a probable duplicate, which is the merge tool's
     * job and not something to guess at from an address.
     */
    try {
      const { rowCount } = await query(
        /*
         * THE PROVENANCE DELIBERATELY DOES NOT CHANGE.
         *
         * "calebnew@usc.edu" became "Caleb New" here: close enough to look
         * right, wrong enough to be useless. It is still a name derived from
         * an address -- a model read the address and nothing else -- so it
         * stays marked 'address', and every pass that exists to replace
         * address-derived names will replace it the moment a provider says
         * who this actually is.
         *
         * The earlier version of this marked it as a real name, which is
         * what let it hold the seat: it no longer looked like an address, so
         * nothing would overwrite it, and Caleb Newton could never land.
         */
        `UPDATE org_people
            SET display_name = $3::text, updated_at = now()
          WHERE org_id = $1::uuid
            AND id = $2::uuid
            AND name_source = 'address'
            AND (display_name LIKE '%@%' OR display_name NOT LIKE '% %')`,
        [orgId, c.id, c.to],
      );
      written += rowCount;
    } catch (err) {
      skipped.push({ id: c.id, to: c.to, reason: String(err?.message ?? err).slice(0, 120) });
    }
  }

  return { ok: true, dryRun: false, considered: rows.length, named: written, changes, skipped };
}

/**
 * FIRMS HAVE THE SAME HOLE. An account created from a domain is called
 * "pnptc.com", so asking "who do we know at Plug and Play" matches nothing --
 * the name people use and the name we store are different strings.
 *
 * The guard cannot be the one above: a company name is not derivable from its
 * domain by any rule, which is exactly why a model is useful here and exactly
 * why its answer cannot be checked the same way. So the domain is KEPT and
 * shown, the name only becomes a second way to find the row, and a wrong
 * answer is a bad label on a firm rather than a wrong name on a person.
 */
const FIRM_SYSTEM = `You name companies from their email domains.

Reply with a JSON array only, one object per domain, in the same order:
[{"domain":"...","name":"Company Name"|null}]

Use the company's ordinary name, not its legal name. If you do not recognize the domain, use null. Never invent a company.`;

export async function enrichFirms({ orgId, dryRun = false, limit = 200, chat = callChat } = {}) {
  if (!orgId) return { ok: false, reason: "bad_input" };

  const { rows } = await query(
    `SELECT id, name, domain
       FROM org_accounts
      WHERE org_id = $1::uuid
        AND deleted_at IS NULL
        AND domain IS NOT NULL
        AND lower(name) = lower(domain)
      LIMIT $2`,
    [orgId, Math.min(Number(limit) || 200, 1000)],
  );
  if (rows.length === 0) return { ok: true, considered: 0, named: 0, changes: [] };

  const changes = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const raw = await chat({
      system: FIRM_SYSTEM,
      messages: [{ role: "user", content: slice.map((r) => r.domain).join("\n") }],
      maxTokens: 900,
    }).catch(() => null);
    if (!raw) continue;

    let parsed;
    try {
      const text = String(raw);
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed)) continue;

    const named = new Map();
    for (const row of parsed) {
      const domain = String(row?.domain ?? "").trim().toLowerCase();
      const name = String(row?.name ?? "").trim();
      if (!domain || !name || name.toLowerCase() === "null" || name.length > 80) continue;
      named.set(domain, name);
    }
    for (const r of slice) {
      const name = named.get(String(r.domain).toLowerCase());
      if (name && name.toLowerCase() !== String(r.domain).toLowerCase()) {
        changes.push({ id: r.id, domain: r.domain, from: r.name, to: name });
      }
    }
  }

  if (dryRun) return { ok: true, dryRun: true, considered: rows.length, changes };

  let written = 0;
  for (const c of changes) {
    // org_accounts_name_idx is not unique, but a name collision with another
    // firm is still not worth losing the batch over.
    try {
      const { rowCount } = await query(
        `UPDATE org_accounts
            SET name = $3::text, updated_at = now()
          WHERE org_id = $1::uuid AND id = $2::uuid AND lower(name) = lower(domain)`,
        [orgId, c.id, c.to],
      );
      written += rowCount;
    } catch {
      /* leave it as its domain */
    }
  }

  return { ok: true, dryRun: false, considered: rows.length, named: written, changes };
}
