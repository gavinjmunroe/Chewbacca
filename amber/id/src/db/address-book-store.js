/**
 * LANDING THE SYNCED ADDRESS BOOK, AND MAKING IT FINDABLE.
 *
 * "If someone syncs their Apple contacts, they have the right to assume that
 *  information is being utilized to make the app better for them, but it's not
 *  at all."
 *
 * Two jobs, and they are separate because one of them cannot be done a row at a
 * time.
 *
 * storeAppleCardDetails writes the rich fields a sync now carries -- addresses,
 * job title, department, URLs, dates, relationships, notes -- FILL-ONLY. Never
 * overwriting is the whole contract with the user: the device may add what Amber
 * does not have and may never replace what it does. That makes this safe to run
 * on every sync, forever, with no baseline and no three-way logic, which is why
 * it sits beside the merge in store.js rather than inside it.
 *
 * retagAddressBook derives the two things that can only be known by looking at
 * the whole book at once:
 *
 *   contact_tags   The labels a person types into a contact NAME. "USC" on
 *                  thirty cards belonging to thirty different people is a label.
 *                  "Park" on three is a family. One card cannot tell you which,
 *                  so this is not computable at insert -- it needs the corpus,
 *                  and the corpus is the owner's whole address book.
 *
 *   area_code /    The metro a phone number implies. Row-local, but written here
 *   area_metro     because it is the same pass and the same UPDATE.
 *
 * BOTH ARE IDEMPOTENT AND BOTH SKIP NO-OPS. A retag that changes nothing issues
 * no UPDATE, because this runs after every sync and a book of four thousand
 * contacts must not be rewritten -- and reshuffled, since a contacts list orders
 * by updated_at -- every time somebody hits refresh.
 */

import { query } from "./sql.js";
import { buildNameCorpus, splitName } from "../lib/name-split.js";
import { areaCodeOf, metroOf } from "../lib/address-book.js";

/** Batch size for the tag/area writes. Same shape as the other batched updates. */
const RETAG_CHUNK = 400;

const _s = (v) => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t || null;
};

/**
 * The blob half of a synced card: everything real that no query filters on.
 *
 * Deliberately built from a whitelist rather than by copying the request body.
 * A client that starts sending something new should not silently start writing
 * it into the database.
 */
export function appleCardBlob(record) {
  const pick = (v) => (Array.isArray(v) && v.length > 0 ? v : undefined);
  const blob = {
    middleName: _s(record?.middleName) ?? undefined,
    country: _s(record?.country) ?? undefined,
    addresses: pick(record?.addresses),
    urls: pick(record?.urls),
    dates: pick(record?.dates),
    relationships: pick(record?.relationships),
  };
  for (const k of Object.keys(blob)) if (blob[k] === undefined) delete blob[k];
  return Object.keys(blob).length > 0 ? blob : null;
}

/**
 * Write the fill-only half of a sync: the scalars a query filters on, plus the
 * blob. One statement per chunk, keyed by external_id.
 *
 * FILL-ONLY, EVERY FIELD, EVERY TIME. `COALESCE(NULLIF(col,''), incoming)` for
 * text and `c.col || incoming` for the blob, so:
 *   - a column Amber has is never touched, whatever the device says;
 *   - a column Amber lacks takes the device's value;
 *   - the blob GAINS keys and never loses them.
 * There is no case in which this can destroy something a person typed, which is
 * what lets it run unconditionally.
 */
export async function storeAppleCardDetails(ownerId, records) {
  if (!ownerId || !Array.isArray(records) || records.length === 0) return 0;

  const rows = [];
  for (const r of records) {
    const externalId = _s(r?.externalId);
    if (!externalId) continue; // nothing to key on; the merge handles those
    const blob = appleCardBlob(r);
    const city = _s(r?.city);
    const region = _s(r?.region);
    const title = _s(r?.title);
    const department = _s(r?.department);
    const notes = _s(r?.notes);
    if (!blob && !city && !region && !title && !department && !notes) continue;
    rows.push({ externalId, city, region, title, department, notes, blob });
  }
  if (rows.length === 0) return 0;

  let applied = 0;
  for (let i = 0; i < rows.length; i += RETAG_CHUNK) {
    const chunk = rows.slice(i, i + RETAG_CHUNK);
    const params = [ownerId];
    const groups = chunk.map((r, n) => {
      const b = params.length;
      params.push(r.externalId, r.city, r.region, r.title, r.department, r.notes, r.blob ? JSON.stringify(r.blob) : null);
      const cast = n === 0 ? ["::text", "::text", "::text", "::text", "::text", "::text", "::jsonb"] : ["", "", "", "", "", "", ""];
      return `($${b + 1}${cast[0]}, $${b + 2}${cast[1]}, $${b + 3}${cast[2]}, $${b + 4}${cast[3]}, $${b + 5}${cast[4]}, $${b + 6}${cast[5]}, $${b + 7}${cast[6]})`;
    });
    const sql = `UPDATE contacts AS c SET
           city        = COALESCE(NULLIF(c.city, ''),        v.city),
           region      = COALESCE(NULLIF(c.region, ''),      v.region),
           title       = COALESCE(NULLIF(c.title, ''),       v.title),
           department  = COALESCE(NULLIF(c.department, ''),  v.department),
           apple_notes = COALESCE(NULLIF(c.apple_notes, ''), v.notes),
           -- The blob MERGES. The jsonb concatenation operator is a
           -- right-biased key union, so COALESCE(c.apple_card,'{}') with
           -- v.card folded in adds what the device now sends and keeps every
           -- key it has stopped sending.
           --
           -- NO BACKTICKS IN THIS STRING, EVER, AND THIS IS NOT A STYLE NOTE.
           -- This comment used to spell that operator inside backticks, as
           -- prose. It is sitting in a JavaScript template literal, so the
           -- first backtick CLOSED the string here -- and what followed parsed
           -- as truncatedSql OR anotherTemplateLiteral, which is valid
           -- JavaScript that short-circuits to the truncated half. The whole
           -- statement below was silently discarded, Postgres answered "syntax
           -- error at end of input", the catch swallowed it, and this function
           -- wrote NOTHING for anybody, ever: no synced city, no title, no
           -- department, and no apple_notes -- which is the column holding the
           -- hundreds of Apple contact notes testers kept asking about and
           -- being told "I don't have any information" for.
           -- tsc, eslint and the whole unit suite passed, because the string was
           -- a valid string and sql-fake.js pattern-matches instead of parsing.
           -- See the guard in src/db/sql-template-integrity.test.js.
           apple_card  = CASE WHEN v.card IS NULL THEN c.apple_card
                              ELSE COALESCE(c.apple_card, '{}'::jsonb) || v.card END
         FROM (VALUES ${groups.join(", ")}) AS v(external_id, city, region, title, department, notes, card)
        WHERE c.owner_id = $1::uuid
          AND c.external_id = v.external_id
          AND c.deleted_at IS NULL
          -- NOTHING TO DO IS NOT A WRITE. Without this the whole address book is
          -- UPDATEd on every refresh, and a contacts list ordered by updated_at
          -- reshuffles itself for no reason the user can see.
          AND (
            (v.city       IS NOT NULL AND COALESCE(NULLIF(c.city, ''), '')       = '') OR
            (v.region     IS NOT NULL AND COALESCE(NULLIF(c.region, ''), '')     = '') OR
            (v.title      IS NOT NULL AND COALESCE(NULLIF(c.title, ''), '')      = '') OR
            (v.department IS NOT NULL AND COALESCE(NULLIF(c.department, ''), '') = '') OR
            (v.notes      IS NOT NULL AND COALESCE(NULLIF(c.apple_notes, ''), '') = '') OR
            (v.card IS NOT NULL AND COALESCE(c.apple_card, '{}'::jsonb) <> COALESCE(c.apple_card, '{}'::jsonb) || v.card)
          )`;
    try {
      const res = await query(sql, params);
      applied += res.rowCount ?? 0;
    } catch (err) {
      // A detail write is enrichment. Losing it must never fail a sync that has
      // already landed the people themselves.
      console.warn(`APPLE_CARD_DETAILS_FAILED owner=${ownerId} ${(err?.message || err).toString().slice(0, 160)}`);
      return applied;
    }
  }
  return applied;
}

/**
 * Recompute contact_tags, area_code and area_metro for one owner's whole book.
 *
 * Called after a sync. Reads every row, builds the name corpus once, and writes
 * only the rows whose derived values actually moved.
 *
 * WHY NOT AT INSERT: a tagline is only distinguishable from a name by comparing
 * a card against its neighbors, and at insert there are no neighbors. See
 * src/lib/name-split.js.
 */
export async function retagAddressBook(ownerId, { chunk = RETAG_CHUNK } = {}) {
  if (!ownerId) return { scanned: 0, changed: 0 };
  let rows;
  try {
    const res = await query(
      `SELECT id, full_name, first_name, last_name, nickname,
              phone_primary, phone_primary_normalized, phones_all,
              contact_tags, area_code, area_metro
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    );
    rows = res.rows || [];
  } catch (err) {
    console.warn(`RETAG_READ_FAILED owner=${ownerId} ${(err?.message || err).toString().slice(0, 160)}`);
    return { scanned: 0, changed: 0 };
  }
  if (rows.length === 0) return { scanned: 0, changed: 0 };

  const corpus = buildNameCorpus(rows);
  const updates = [];
  for (const row of rows) {
    const tags = splitName(row, corpus).tags.map((t) => t.trim()).filter(Boolean);
    const phone =
      row.phone_primary_normalized ||
      row.phone_primary ||
      String(row.phones_all ?? "").split(/[,;|]/)[0] ||
      null;
    const areaCode = areaCodeOf(phone);
    const areaMetro = areaCode ? metroOf(phone) : null;

    const sameTags =
      Array.isArray(row.contact_tags) &&
      row.contact_tags.length === tags.length &&
      row.contact_tags.every((t, i) => t === tags[i]);
    if (sameTags && (row.area_code ?? null) === areaCode && (row.area_metro ?? null) === areaMetro) {
      continue;
    }
    updates.push({ id: String(row.id), tags, areaCode, areaMetro });
  }
  if (updates.length === 0) return { scanned: rows.length, changed: 0 };

  let changed = 0;
  for (let i = 0; i < updates.length; i += chunk) {
    const slice = updates.slice(i, i + chunk);
    const params = [ownerId];
    const groups = slice.map((u, n) => {
      const b = params.length;
      params.push(u.id, u.tags, u.areaCode, u.areaMetro);
      const cast = n === 0 ? ["::uuid", "::text[]", "::text", "::text"] : ["", "", "", ""];
      return `($${b + 1}${cast[0]}, $${b + 2}${cast[1]}, $${b + 3}${cast[2]}, $${b + 4}${cast[3]})`;
    });
    try {
      // updated_at IS DELIBERATELY NOT TOUCHED. Nothing a person can see changed
      // -- these are derived values -- and the contacts list orders by it.
      const res = await query(
        `UPDATE contacts AS c SET
             contact_tags = v.tags,
             area_code    = v.area_code,
             area_metro   = v.area_metro
           FROM (VALUES ${groups.join(", ")}) AS v(id, tags, area_code, area_metro)
          WHERE c.id = v.id AND c.owner_id = $1::uuid AND c.deleted_at IS NULL`,
        params,
      );
      changed += res.rowCount ?? slice.length;
    } catch (err) {
      console.warn(`RETAG_WRITE_FAILED owner=${ownerId} ${(err?.message || err).toString().slice(0, 160)}`);
      break;
    }
  }
  return { scanned: rows.length, changed };
}
