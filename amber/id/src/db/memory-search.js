/**
 * ONE PLACE THAT REMEMBERS EVERYTHING.
 *
 * Information about the people in someone's life lands in six different tables
 * depending on how it arrived: a fact extracted from chat, a note typed on a
 * card, an experience, something the user said about themselves, a raw thing
 * said to Amber in a thread, and the audience a note was shared with. Until now
 * a question only ever reached whichever of those the particular code path
 * happened to know about, which is why "this person likes Chinese food" could be
 * saved and then "who likes Chinese food" would find nothing: the answer was in
 * contact_notes and the query was looking at contact_facts.
 *
 * This searches all of them in one statement, and every hit carries WHERE it came
 * from, so an answer can say "you wrote that on his card in June" rather than
 * asserting it from nowhere. Provenance is not decoration: a memory you cannot
 * attribute is one the user cannot correct.
 *
 * Each source is a separate SELECT in a UNION ALL, so a table this deployment
 * does not have takes out only its own branch (see searchMemory's degrade path)
 * rather than the whole question.
 */

import { query } from "./sql.js";
import { isTaggablePerson } from "../lib/people-rank-realness.js";

// FOUR TABLES BECAME ONE, AND THE FIVE BRANCHES STAY FIVE.
//
// contact_facts, contact_notes, contact_experiences and user_facts are all
// observations now, separated by `kind` and by whether anyone is attached. The
// obvious move was to collapse this into a single branch -- but the `only`
// retry mechanism below reruns the union without a named kind, so a branch that
// returned three kinds at once could not be excluded one at a time. Five
// branches, one table underneath.
//
// contact_ids is uuid[] where it used to be bigint[], and EVERY branch must
// agree on that or the UNION will not type-check. The subject of an observation
// is also a participant row, so aggregating participants covers both the "fact
// about Maggie" and "note mentioning Maggie" cases that used to need two shapes.
const _PARTICIPANTS = `COALESCE(
    (SELECT array_agg(op.contact_id)
       FROM observation_participants op
      WHERE op.observation_id = o.observation_id),
    '{}'::uuid[]) AS contact_ids`;

const _HAS_PEOPLE = `EXISTS (SELECT 1 FROM observation_participants op
                              WHERE op.observation_id = o.observation_id)`;

const _obsBranch = (kind, filter) => ({
  kind,
  sql: `SELECT '${kind}' AS kind, o.body AS text, o.created_at AS at,
               ${_PARTICIPANTS}, o.source_conversation_id::text AS conversation_id
          FROM observations o
         WHERE o.owner_id = $1 AND o.deleted_at IS NULL AND o.body ILIKE $Q
           AND ${filter}`,
});

const SOURCES = [
  _obsBranch("fact", `o.kind = 'fact' AND ${_HAS_PEOPLE}`),
  _obsBranch("note", `o.kind = 'note' AND ${_HAS_PEOPLE}`),
  _obsBranch("experience", `o.kind = 'experience' AND ${_HAS_PEOPLE}`),
  // The user's own facts: an observation about nobody in particular. It is the
  // ABSENCE of participants that makes it self-knowledge, not a separate table.
  _obsBranch("self", `NOT ${_HAS_PEOPLE}`),
  {
    // What the user actually SAID to Amber, whether or not anything was extracted
    // from it. This is the backstop that makes "I know I told you this" true:
    // extraction can miss, the transcript cannot.
    kind: "said",
    sql: `SELECT 'said' AS kind, m.content AS text, m.created_at AS at,
                 '{}'::uuid[] AS contact_ids, m.conversation_id::text AS conversation_id
            FROM conversation_messages m
           WHERE m.owner_id = $1::uuid AND m.deleted_at IS NULL
             AND m.role = 'user' AND m.content ILIKE $Q`,
  },
];

/**
 * Build the union. Returns { sql, params } or null with no search term, because
 * an empty term would match every row the user has ever written.
 *
 * `only` restricts which sources are included — used to retry without a branch
 * whose table is missing.
 */
export function buildMemorySearchSql({ ownerId, q, limit = 60, only = null } = {}) {
  if (!ownerId) return null;
  // `q` MAY BE A LIST, and when it is, the branches OR together.
  //
  // A place has more than one name. Someone asking about San Francisco has notes
  // that say "SF", notes that say "the Bay Area" and notes that say "Oakland", and
  // a single ILIKE finds one third of them. Passing the aliases as a list turns
  // one term into one predicate over all of them, still in a single statement —
  // the alternative was seven round trips or two thirds of the memory missed.
  const terms = (Array.isArray(q) ? q : [q])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  if (terms.length === 0) return null;
  const kinds = Array.isArray(only) && only.length > 0 ? only : SOURCES.map((s) => s.kind);
  const used = SOURCES.filter((s) => kinds.includes(s.kind));
  if (used.length === 0) return null;

  // SHORT TERMS ARE MATCHED AS WORDS, LONG ONES AS SUBSTRINGS.
  //
  // "%sf%" matches "tran-sf-er", "%la%" matches "planning", "%dc%" matches almost
  // nothing but would match "abcdcba". Place abbreviations are exactly the terms
  // this function now gets handed, and a false positive here is a contact card for
  // someone the note never mentioned — worse than a miss, because it looks like
  // recall. So a term of three characters or fewer is matched with a word boundary.
  //
  // Longer terms keep ILIKE substring behavior deliberately: "chinese food" must
  // still find "loves chinese foods", and a boundary would break that.
  const SHORT = 3;
  const rxEscape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const params = [
    ownerId,
    ...terms.map((t) => (t.length <= SHORT ? `\\y${rxEscape(t)}\\y` : `%${t}%`)),
  ];
  // $Q is the placeholder each branch writes as `<column> ILIKE $Q`. With several
  // terms it becomes a parenthesised OR over the same column, so the branch shape
  // and every existing test still hold for the single-term ILIKE case.
  const opFor = (i) => (terms[i].length <= SHORT ? "~*" : "ILIKE");
  const branches = used.map((s) =>
    s.sql.replace(
      /(\S+)\s+ILIKE\s+\$Q/g,
      (_m, col) =>
        terms.length === 1 && opFor(0) === "ILIKE"
          ? `${col} ILIKE $2`
          : `(${terms.map((_t, i) => `${col} ${opFor(i)} $${i + 2}`).join(" OR ")})`,
    ),
  );
  const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 300) : 60;
  params.push(lim);

  return {
    sql: `WITH hits AS (
            ${branches.join("\n            UNION ALL\n            ")}
          )
          SELECT kind, text, at, contact_ids, conversation_id, count(*) OVER () AS total
            FROM hits
           ORDER BY at DESC NULLS LAST
           LIMIT $${params.length}`,
    params,
    kinds: used.map((s) => s.kind),
  };
}

const MISSING_SCHEMA = new Set(["42P01", "42703"]);

/**
 * Everything the user has ever recorded that mentions `q`, newest first, with the
 * people each hit involves and the source it came from.
 *
 *   searchMemory(ownerId, { q: "chinese food" })
 *     -> { total, hits: [{ kind, text, at, contactIds, conversationId }], skipped }
 *
 * `skipped` names any source that could not be searched, so a thin answer is
 * explainable instead of looking like an empty memory.
 */
export async function searchMemory(ownerId, { q, limit = 60 } = {}) {
  const empty = { total: 0, hits: [], skipped: [] };
  let kinds = SOURCES.map((s) => s.kind);
  const skipped = [];
  // At most one retry per source, so a broken deployment cannot spin here.
  for (let attempt = 0; attempt <= SOURCES.length; attempt++) {
    const built = buildMemorySearchSql({ ownerId, q, limit, only: kinds });
    if (!built) return { ...empty, skipped };
    try {
      const { rows } = await query(built.sql, built.params);
      return {
        total: rows[0] ? Number(rows[0].total) || rows.length : 0,
        hits: rows.map((r) => ({
          kind: r.kind,
          text: r.text ?? "",
          at: r.at ?? null,
          contactIds: Array.isArray(r.contact_ids)
            ? r.contact_ids.filter((v) => v != null).map(String)
            : [],
          conversationId: r.conversation_id ?? null,
        })),
        skipped,
      };
    } catch (err) {
      if (!MISSING_SCHEMA.has(err?.code) || kinds.length <= 1) {
        console.error(`[memory] search failed: ${err?.code || ""} ${err?.message || err}`);
        return { ...empty, skipped };
      }
      // Drop one branch and retry. Which one is not knowable from the error, so
      // drop from the end and record it; the alternative is answering nothing.
      const dropped = kinds[kinds.length - 1];
      kinds = kinds.slice(0, -1);
      skipped.push(dropped);
      console.error(`[memory] source "${dropped}" unavailable (${err.code}) — retrying without it`);
    }
  }
  return { ...empty, skipped };
}

/**
 * Who can see a given note, and why. "Who knows about this?" is a question about
 * the note's AUDIENCE, which is a relation (note_shares -> circle members /
 * connections / one contact), not text — so no amount of searching note bodies
 * can answer it.
 *
 * Resolved at read time against CURRENT membership, exactly like the feeds, so a
 * member who left a circle is not reported as knowing.
 */
export async function whoKnowsAboutNote(ownerId, conversationId) {
  const none = { shared: false, scopeType: null, scopeName: null, people: [] };
  if (!ownerId || !conversationId) return none;
  try {
    const { rows } = await query(
      `SELECT scope_type, scope_ref FROM shares
        WHERE owner_id = $1::uuid AND item_type = 'conversation' AND item_id = $2::uuid
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [ownerId, conversationId],
    );
    const share = rows[0];
    if (!share) return none; // no row at all IS private, by design
    const scopeType = share.scope_type;
    const scopeRef = share.scope_ref;

    if (scopeType === "circle") {
      const { rows: members } = await query(
        `SELECT c.name AS circle_name, ct.id AS contact_id, ct.full_name AS name
           FROM circles c
           JOIN circle_members cm ON cm.circle_id = c.id
           LEFT JOIN contacts ct ON ct.id = cm.contact_id AND ct.deleted_at IS NULL
          WHERE c.owner_id = $1::uuid AND c.id = $2::uuid`,
        [ownerId, scopeRef],
      );
      return {
        shared: true,
        scopeType,
        scopeName: members[0]?.circle_name ?? null,
        people: members
          .filter((m) => m.contact_id != null)
          .map((m) => ({ contactId: String(m.contact_id), name: m.name ?? null })),
      };
    }
    if (scopeType === "contact") {
      const { rows: one } = await query(
        `SELECT id, full_name FROM contacts
          WHERE owner_id = $1::uuid AND id = $2 AND deleted_at IS NULL`,
        [ownerId, scopeRef],
      );
      return {
        shared: true,
        scopeType,
        scopeName: one[0]?.full_name ?? null,
        people: one.map((c) => ({ contactId: String(c.id), name: c.full_name ?? null })),
      };
    }
    // network: everyone the owner is connected to. Named, not counted, because
    // "your network" is not an answer to "who knows".
    const { rows: conns } = await query(
      // connections IS (a_amber_id, b_amber_id, status, established_at). It has
      // never had user_a / user_b, so this query threw on every call and the
      // catch below turned "your network" into an empty answer. Same columns and
      // the same `status = 'active'` filter viewer-reach.js uses, because two
      // spellings of one authorization-shaped question is how they drift.
      `SELECT ct.id AS contact_id, ct.full_name AS name
         FROM connections cn
         JOIN contacts ct
           ON ct.owner_id = $1::uuid
          AND ct.linked_amber_id = CASE WHEN cn.a_amber_id = $1::uuid
                                        THEN cn.b_amber_id ELSE cn.a_amber_id END
        WHERE cn.status = 'active'
          AND (cn.a_amber_id = $1::uuid OR cn.b_amber_id = $1::uuid)
          AND ct.deleted_at IS NULL`,
      [ownerId],
    );
    return {
      shared: true,
      scopeType: "network",
      scopeName: "your network",
      people: conns.map((c) => ({ contactId: String(c.contact_id), name: c.name ?? null })),
    };
  } catch (err) {
    console.error(`[memory] whoKnowsAboutNote failed: ${err?.message || err}`);
    return none;
  }
}

/**
 * The people connected to a place, drawn from what the user has actually said.
 *
 * This is the retrieval behind "help me plan a dinner in San Francisco" showing
 * contact cards. Two kinds of evidence, both real:
 *
 *   - MEMORY. Facts, notes, experiences and raw transcripts mentioning any of the
 *     terms, with the contacts each one involves. This is the half that makes a
 *     voice note recorded in March answer a question asked in August.
 *   - THE CONTACT RECORD. Someone whose city or location column names the place.
 *     They may never have been mentioned in a note and still be the right answer.
 *
 * Ranked by how many separate things point at a person, because someone mentioned
 * in four notes about SF is a better answer than someone mentioned once — and the
 * card list is short, so the ordering is most of the value.
 *
 * Never throws: this runs beside a reply that is already streaming, and a failure
 * here must cost the user nothing but the cards.
 */
export async function findPeopleByPlaceTerms(ownerId, terms, { limit = 8 } = {}) {
  if (!ownerId || !Array.isArray(terms) || terms.length === 0) return [];
  const score = new Map(); // contactId -> weight

  const bump = (id, by) => {
    if (id == null) return;
    const k = String(id);
    if (!k || k === "null") return;
    score.set(k, (score.get(k) ?? 0) + by);
  };

  const memory = searchMemory(ownerId, { q: terms, limit: 120 })
    .then((res) => {
      for (const hit of res.hits || []) {
        // A transcript line is weaker evidence than an extracted fact: it is what
        // was said, not what was understood, and it carries no participants of its
        // own — so it only reinforces someone another source already named.
        const weight = hit.kind === "said" ? 0 : 1;
        for (const cid of hit.contactIds || []) bump(cid, weight || 0.25);
      }
    })
    .catch(() => {});

  // Long terms only. A city column is a short string, so a word-boundary regex on
  // "sf" buys nothing there and the substring risk ("transfer") is the same.
  const columnTerms = terms.filter((t) => t.length > 3);
  const byColumn =
    columnTerms.length === 0
      ? Promise.resolve()
      : query(
          `SELECT id, full_name FROM contacts
             WHERE owner_id = $1::uuid AND deleted_at IS NULL
               AND (city ILIKE ANY($2::text[]) OR location ILIKE ANY($2::text[]))
             LIMIT 60`,
          [ownerId, columnTerms.map((t) => `%${t}%`)],
        )
          .then(({ rows }) => {
            for (const r of rows) bump(r.id, 2);
          })
          .catch(() => {});

  await Promise.all([memory, byColumn]);
  if (score.size === 0) return [];

  // A CONTACT ID IS A UUID, so /^\d+$/ matched none of them: `ids` came out empty
  // on every call and this function returned [] unconditionally. The query below
  // casts ::uuid[] correctly -- the filter above it was throwing every id away
  // before the query could run.
  const ids = [...score.keys()].filter((k) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(k)));
  if (ids.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT id, full_name FROM contacts
         WHERE owner_id = $1::uuid AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [ownerId, ids],
    );
    return rows
      .map((r) => ({
        contactId: String(r.id),
        name: r.full_name,
        score: score.get(String(r.id)) ?? 0,
      }))
      // A nameless contact cannot be rendered as a card — and neither can a help
      // desk. An address book is full of organisations whose city column says "San
      // Francisco"; recalling them for "plan a dinner in the Bay Area" is worse
      // than recalling nobody, because it looks like the app thinks they are your
      // friend.
      .filter((p) => p.name && isTaggablePerson(p))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  } catch {
    return [];
  }
}
