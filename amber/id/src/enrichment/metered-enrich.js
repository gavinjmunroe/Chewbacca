/**
 * ENRICH ONE CONTACT, ONCE, ON THE METER, AND NEVER OVER THE TOP OF THE PERSON.
 *
 * Three rules, and each one is here because the obvious implementation breaks
 * it:
 *
 *   ONE CONTACT PER CALL. Not a sweep. A sweep over an address book is the
 *   shape that produces a surprise invoice, and it is also the shape that makes
 *   a bad provider response land on a thousand cards before anybody notices.
 *   Callers that want many enrich many times, through the meter, which is the
 *   point.
 *
 *   THE METER IS CHECKED BEFORE THE CALL AND THE LEDGER IS WRITTEN AFTER IT --
 *   including when it fails. A check that happens after the spend is not a
 *   limit, and an unrecorded failure is how a broken provider stays invisible.
 *
 *   WHAT COMES BACK IS VENDOR-TIER AND FILLS BLANKS ONLY. A third party's guess
 *   at somebody's job title must never overwrite what the owner typed. That
 *   rule lives in src/lib/source-trust.js and is enforced by the union writer,
 *   so this path deliberately calls the SAME applyContactUnion every other
 *   import calls, with `authoritative: false`, rather than issuing an UPDATE of
 *   its own. A second write path is a second place for the trust rule to be
 *   forgotten.
 *
 * EVERYTHING IS INJECTED. The provider, the meter, the writer and the clock are
 * all parameters, so the tests exercise the real decision logic against fakes
 * and no test needs a database, a network, or an API key.
 */

import { makeClayProvider } from "./providers/clay-provider.js";
import * as meterModule from "../db/enrichment-meter.js";
import { applyContactUnion } from "../db/contact-identity.js";
import { query } from "../db/sql.js";

/** What the vendor is allowed to have an opinion about. */
const FILLABLE = Object.freeze(["company", "title", "city", "linkedinUrl"]);

/** Columns those map to, for counting what was actually filled. */
const COLUMN_OF = Object.freeze({
  company: "company",
  title: "title",
  city: "city",
  linkedinUrl: "linkedin_url",
});

const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * Which of the vendor's fields would land, given what the card already has.
 *
 * Pure, and exported, because "what would this actually change" is the question
 * worth asking BEFORE spending anything, and the answer is also what makes the
 * ledger's fields_filled honest rather than a guess.
 */
export function fillableFields(contactRow, candidate) {
  const out = {};
  for (const key of FILLABLE) {
    const value = candidate?.[key];
    if (blank(value)) continue;
    if (!blank(contactRow?.[COLUMN_OF[key]])) continue; // occupied: vendor never wins
    out[key] = String(value).trim();
  }
  return out;
}

/**
 * Pick the vendor row to believe, or none.
 *
 * A provider handed a common name returns a list of strangers. Taking the first
 * one is how a rolodex ends up telling somebody their friend works at a company
 * they have never heard of, and the person has no way to know it was a guess.
 *
 * So: exactly one candidate, or a clear leader that agrees with something
 * already on the card. Otherwise nothing, recorded as `empty`. An enrichment
 * that declines to guess is worth more than one that usually guesses right.
 */
export function chooseCandidate(contactRow, candidates = []) {
  const list = (candidates || []).filter(Boolean);
  if (!list.length) return { candidate: null, why: "no_candidates" };
  if (list.length === 1) return { candidate: list[0], why: "only_candidate" };

  const company = String(contactRow?.company ?? "").trim().toLowerCase();
  const city = String(contactRow?.city ?? "").trim().toLowerCase();
  if (company) {
    const agree = list.filter((c) => String(c.company ?? "").trim().toLowerCase() === company);
    if (agree.length === 1) return { candidate: agree[0], why: "company_agrees" };
  }
  if (city) {
    const agree = list.filter((c) => String(c.city ?? "").trim().toLowerCase() === city);
    if (agree.length === 1) return { candidate: agree[0], why: "city_agrees" };
  }
  return { candidate: null, why: "ambiguous" };
}

/**
 * Enrich one contact.
 *
 * Returns a plain result object in every case -- refused, spent-and-empty,
 * spent-and-filled, provider error. It does not throw, because the caller is a
 * route and a thrown vendor error there becomes a 500 on a request the user
 * made about their own address book.
 */
export async function enrichOneContact(
  ownerId,
  contactId,
  {
    provider = null,
    meter = meterModule,
    applyUnion = applyContactUnion,
    readContact = defaultReadContact,
    cost = 1,
    now = Date.now(),
  } = {},
) {
  const p = provider ?? makeClayProvider(process.env.CLAY_API_KEY || null);

  const contact = await readContact(ownerId, contactId).catch(() => null);
  if (!contact) return { ok: false, reason: "contact_not_found" };

  const [limits, spend] = await Promise.all([
    meter.getLimits(ownerId),
    meter.getSpend(ownerId, contactId),
  ]);
  const verdict = meter.decide({ ...spend, limits, cost, now });
  if (!verdict.allowed) {
    // A REFUSAL IS NOT A LEDGER ROW. Nothing was spent, and writing it would
    // both inflate the ledger and -- because the ledger is also the cooldown --
    // extend the refusal it recorded. A refused request must leave no trace
    // that changes the answer to the next one.
    return {
      ok: false,
      reason: verdict.reason,
      remaining: verdict.remaining,
      retryAfterHours: verdict.retryAfterHours ?? null,
    };
  }

  const name = String(contact.full_name ?? "").trim();
  if (!name) return { ok: false, reason: "no_name_to_search" };

  let found;
  try {
    found = await p.searchCandidates({ name, limit: 20 });
  } catch (err) {
    await meter.record({
      ownerId, contactId, provider: p.name ?? "unknown",
      outcome: "error", costUnits: 0, detail: err?.message,
    });
    return { ok: false, reason: "provider_error", detail: err?.message ?? null };
  }

  if (found?.configured === false) {
    // No key. Nothing was called and nothing was billed, so nothing is
    // recorded -- a ledger full of zero-cost rows from an unconfigured provider
    // is noise in the one table that has to stay readable.
    return { ok: false, reason: "provider_not_configured" };
  }

  const { candidate, why } = chooseCandidate(contact, found?.candidates);
  if (!candidate) {
    await meter.record({
      ownerId, contactId, provider: p.name ?? "unknown",
      outcome: "empty", costUnits: cost, detail: why,
    });
    return { ok: true, filled: {}, fieldsFilled: 0, reason: why, spent: cost };
  }

  const fill = fillableFields(contact, candidate);
  const fieldsFilled = Object.keys(fill).length;

  if (fieldsFilled > 0) {
    // The same writer every import uses, at vendor trust. `authoritative:
    // false` is what makes this fill-only; it is not a formality.
    await applyUnion(
      ownerId,
      contactId,
      { name, source: "clay", ...fill },
      { authoritative: false },
    ).catch(() => false);
  }

  await meter.record({
    ownerId, contactId, provider: p.name ?? "unknown",
    outcome: fieldsFilled > 0 ? "ok" : "empty",
    costUnits: cost, fieldsFilled, detail: why,
  });

  return { ok: true, filled: fill, fieldsFilled, reason: why, spent: cost };
}

/** The columns the decision above needs, and nothing else. */
async function defaultReadContact(ownerId, contactId) {
  const { rows } = await query(
    `SELECT id, full_name, company, title, city, linkedin_url
       FROM contacts WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [ownerId, contactId],
  );
  return rows[0] ?? null;
}
