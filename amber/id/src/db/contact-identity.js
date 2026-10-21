/**
 * Contact identity resolution — DB layer.
 *
 * Wraps the pure decision layer (lib/contact-identity.js) in the three things it
 * cannot do for itself: load an owner's key index, claim keys under the unique
 * index, and execute field-UNION merges. Every contact writer routes through
 * `resolveContactIdentity` (single record) or `loadIdentityIndex` + `planPayload`
 * (bulk), so there is exactly ONE person-matching cascade in the service.
 *
 * SECURITY INVARIANT (same as db/store.js): every statement here is owner-scoped.
 * owner_id appears in every WHERE and is the first column of every INSERT.
 *
 * KEYS ARE STORED HASHED. contact_identity_keys is, by row count, the most
 * sensitive table in the system -- a list of the phone numbers and addresses of
 * people who never signed up for anything -- so it holds HMAC(pepper, value)
 * truncated to 128 bits instead of the value. Nothing about matching changes: a
 * match key is an opaque token that is only ever compared, so this layer passes
 * `identityToken` into the pure decision layer as its tokenizer and both halves
 * of the index -- keys derived from live contact rows, keys read back out of the
 * table -- land in the same keyspace. CLAIM DESCRIPTORS STAY PLAINTEXT: a
 * conflict returned to a caller says "phone|4150000004 is already held by
 * contact X", because a conflict a human cannot read is a conflict nobody fixes.
 * The plaintext exists in memory for the length of one request and is never
 * written.
 *
 * DEGRADED MODE: if the `contact_identity_keys` migration has not been applied,
 * the key queries fail with 42P01. That must not 500 every contact sync, so the
 * first such failure logs once and flips `_identityTablesReady` to false —
 * resolution then falls back to what it can derive from the live `contacts` rows
 * (which still catches the phone/email/name cases; only cross-sync key CLAIMS
 * are lost). Check `identityTablesReady()` to assert the healthy path in tests.
 */

import { query } from "./sql.js";
import {
  KEY_TYPE_BY_NAME,
  KEY_NAME_BY_TYPE,
  hashIdentityKey,
  identityToken,
} from "../lib/identity-keys.js";
import {
  buildIdentityIndex,
  extractFacts,
  factKeys,
  phoneKey,
  planPayload,
  resolveFacts,
  unionEmailStrings,
  unionPhoneStrings,
} from "../lib/contact-identity.js";

export { planPayload };

const KEY_CHUNK = 500;

let _identityTablesReady = true;
let _warned = false;

export function identityTablesReady() {
  return _identityTablesReady;
}

/** TEST-ONLY: reset the degraded-mode latch between cases. */
export function _resetIdentityTableState() {
  _identityTablesReady = true;
  _warned = false;
}

function _isMissingTable(err) {
  return err?.code === "42P01";
}

function _noteMissingTable(err, where) {
  if (!_isMissingTable(err)) return false;
  _identityTablesReady = false;
  if (!_warned) {
    _warned = true;
    console.error(
      `[contact-identity] contact_identity_keys missing (${where}) — write-time ` +
        "dedup is running in DEGRADED mode (no cross-sync key claims). Apply " +
        "db/migrations/20260804_add_contact_identity_keys.sql.",
    );
  }
  return true;
}

const CONTACT_MATCH_COLUMNS = `id, full_name, first_name, last_name, company, title, city,
          phone_primary, phones_all, emails, source, external_id, linked_amber_id,
          sync_snapshot, nickname, birthday`;

/**
 * Owner-scoped index cache.
 *
 * The single-record entry point is called in TIGHT LOOPS — the Google/LinkedIn/
 * GitHub scrapers walk thousands of contacts one at a time — and reloading a
 * 4,000-row index per record would be quadratic. The cache is kept coherent
 * within a loop by `noteContactWrite`, which folds each freshly written row into
 * the live index so the next iteration can match against it.
 *
 * STALENESS BOUND: a concurrent writer's rows can be up to INDEX_TTL_MS old to
 * this process. That cannot produce a duplicate row, because the identity keys'
 * unique index is the real arbiter — a stale miss loses the key claim and the
 * caller collapses its row into the winner. The cache trades a rare extra
 * collapse for not being quadratic.
 */
const INDEX_TTL_MS = 30_000;
const _indexCache = new Map(); // ownerId → { index, rowsById, at }

export function invalidateIdentityIndex(ownerId) {
  if (ownerId) _indexCache.delete(String(ownerId));
  else _indexCache.clear();
}

/**
 * Fold a row this process just wrote into the cached index, so a loop that
 * inserts "Sam Patel" at iteration 3 matches him at iteration 400 instead of
 * inserting a second row.
 */
export function noteContactWrite(ownerId, contactId, record, { index } = {}) {
  const idx = index || _indexCache.get(String(ownerId))?.index;
  if (!idx || contactId == null) return;
  const id = String(contactId);
  const incoming = extractFacts(record, { id });
  const prev = idx.facts.get(id);
  idx.facts.set(id, prev ? _foldFacts(prev, incoming) : incoming);
  const merged = idx.facts.get(id);
  // TOKENIZE THE WAY THIS INDEX WAS BUILT. Folding plaintext keys into a
  // hash-keyed index is silent: nothing errors, the lookup a moment later simply
  // misses, and the record resolves as new -- which is a duplicate row per import
  // loop. A dedup test caught exactly that.
  for (const key of factKeys(merged, idx.keyOf ?? identityToken)) {
    let set = idx.byKey.get(key);
    if (!set) idx.byKey.set(key, (set = new Set()));
    set.add(id);
    if (!idx.keyOwner.has(key)) idx.keyOwner.set(key, id);
  }
  for (const nk of [merged.nameKey, merged.nameKeyCanon]) {
    if (!nk) continue;
    let set = idx.byNameKey.get(nk);
    if (!set) idx.byNameKey.set(nk, (set = new Set()));
    set.add(id);
  }
}

function _foldFacts(a, b) {
  return {
    ...a,
    name: a.name || b.name,
    nameKey: a.nameKey || b.nameKey,
    nameKeyCanon: a.nameKeyCanon || b.nameKeyCanon,
    phones: new Set([...a.phones, ...b.phones]),
    emails: new Set([...a.emails, ...b.emails]),
    company: a.company || b.company,
    city: a.city || b.city,
    linkedAmberId: a.linkedAmberId || b.linkedAmberId,
  };
}

/**
 * Load everything the matcher needs for one owner in TWO queries, regardless of
 * address-book size. A 4,000-contact owner therefore costs 2 round trips, not
 * 8,000 — the property that lets the bulk Apple path stay on its existing
 * chunked-statement budget.
 *
 * Returns { index, rowsById } — `rowsById` keeps the raw rows so a merge can
 * union against the STORED display strings, not just the normalized keys.
 *
 * `fresh: true` bypasses (and refills) the cache — what a whole-address-book
 * sync uses, since it must not plan against a snapshot it did not read itself.
 */
export async function loadIdentityIndex(ownerId, { fresh = false } = {}) {
  if (!ownerId) {
    return { index: buildIdentityIndex({ keyOf: identityToken }), rowsById: new Map() };
  }
  const cacheKey = String(ownerId);
  if (!fresh) {
    const hit = _indexCache.get(cacheKey);
    if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit;
  }

  let contactRows = [];
  try {
    const res = await query(
      `SELECT ${CONTACT_MATCH_COLUMNS}
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    );
    contactRows = res.rows || [];
  } catch (err) {
    // A contacts read failure is real — surface it rather than silently
    // resolving every record as "new" and duplicating the whole book.
    throw err;
  }

  let keyRows = [];
  if (_identityTablesReady) {
    try {
      const res = await query(
        `SELECT key_type, key_hash, contact_id
           FROM contact_identity_keys
          WHERE owner_id = $1`,
        [ownerId],
      );
      // Straight to the token. The hash IS the key here -- there is nothing to
      // reverse and nothing that needs reversing.
      keyRows = (res.rows || []).map((r) => ({
        token: r.key_hash.toString("hex"),
        contact_id: r.contact_id,
      }));
    } catch (err) {
      if (!_noteMissingTable(err, "loadIdentityIndex")) throw err;
    }
  }

  const rowsById = new Map(contactRows.map((r) => [String(r.id), r]));
  const loaded = {
    index: buildIdentityIndex({ contactRows, keyRows, keyOf: identityToken }),
    rowsById,
    at: Date.now(),
  };
  _indexCache.set(cacheKey, loaded);
  return loaded;
}

/**
 * Resolve ONE record for an owner. The single-record entry point every non-bulk
 * writer uses (upsertContact, mergeContact, createContactForOwner).
 *
 * Pass a preloaded `index` to avoid the two-query load (the bulk path does).
 * Returns { contactId, action: 'update'|'merge'|'insert', rule, reviewLinks, facts }.
 */
export async function resolveContactIdentity(ownerId, record, { index } = {}) {
  const facts = extractFacts(record);
  if (!ownerId) {
    return { contactId: null, action: "insert", rule: null, reviewLinks: [], facts };
  }
  const idx = index || (await loadIdentityIndex(ownerId)).index;
  const res = resolveFacts(facts, idx);
  return {
    contactId: res.contactId,
    action: res.contactId ? (res.rule === "source" ? "update" : "merge") : "insert",
    rule: res.rule,
    reviewLinks: res.reviewLinks,
    facts,
  };
}

// ── Field-UNION merge (invariant I3) ────────────────────────────────────────

/**
 * Compute the merged column values for `row` absorbing `record`.
 *
 * TWO MODES, and the difference matters:
 *
 * `authoritative: true` — rule 1 resolved this (same source, same external id),
 * so the source is restating a card it owns. Scalars take the incoming value
 * when it has one, which is how a contact RENAMED on the device still renames
 * here (the old ON CONFLICT DO UPDATE overwrote unconditionally). Lists union
 * INCOMING-FIRST: the incoming order and primary win, but a value only the row
 * had — a Google email merged onto an Apple contact, say — is appended rather
 * than dropped. The old code replaced the list outright and would have lost it.
 *
 * `authoritative: false` — an identity merge (phone / email / corroborated
 * name). This is enrichment from a DIFFERENT card, so it may only FILL: blank
 * scalars fill, populated scalars are never overwritten, and the row keeps its
 * primary phone. The first source to claim a field keeps it.
 *
 * Either way phones and emails UNION and nothing is ever dropped (invariant I3).
 * Returns null when nothing would change, so a no-op re-sync issues no UPDATE.
 */
/**
 * The fields a baseline records. Deliberately not every column: only the ones a
 * source-authoritative sync writes and a person can edit by hand.
 */
export const SNAPSHOT_COLUMNS = [
  "full_name",
  "first_name",
  "last_name",
  "company",
  "phone_primary",
  "phones_all",
  "emails",
  "nickname",
  "birthday",
];

/**
 * A baseline, with a FIXED KEY ORDER so a jsonb round-trip compares by string
 * equality.
 *
 * This is the single most load-bearing detail in the whole three-way merge. If
 * the serialization is not byte-stable, `row != snapshot` is true forever, every
 * field reads as hand-edited, no upstream change is ever picked up again, and --
 * worse -- every sync issues an UPDATE for every row in the address book,
 * reshuffling a contacts list that orders by updated_at. Both sides of every
 * comparison go through this function and only this function.
 */
export function serializeSnapshot(values) {
  const flat = {};
  for (const c of SNAPSHOT_COLUMNS) flat[c] = values?.[c] ?? null;
  return JSON.stringify(flat);
}

/** null/undefined/whitespace are all "the user has nothing here". */
const _blank = (v) => v == null || (typeof v === "string" && v.trim() === "");

export function mergedColumnValues(
  row,
  record,
  { authoritative = false, snapshotAware = false } = {},
) {
  const facts = extractFacts(record);
  const curPhones = _splitList(row.phones_all).length
    ? _splitList(row.phones_all)
    : row.phone_primary
      ? [row.phone_primary]
      : [];
  const curEmails = _splitList(row.emails);

  const incomingPhones = _displayList(
    record.phoneNumbers, record.phones, record.phonesAll, record.phones_all,
    record.phone, record.phonePrimary, record.phone_primary,
  );
  const incomingEmails = _displayList(record.emails, record.email);


  // ── THE THREE-WAY PICK ────────────────────────────────────────────────────
  //
  // `snapshotAware` is off for every caller that does not own this row's source,
  // so an identity merge and a Google import behave exactly as they did before.
  // On the authoritative path with a baseline present, each scalar asks one
  // question: has anybody changed this in Amber since we last wrote it?
  //
  //   Amber blank                  -> take the incoming (fill a gap)
  //   Amber == what we last wrote  -> untouched here, take the incoming
  //   Amber != what we last wrote  -> edited here, Amber wins
  //   no baseline for this field   -> Amber wins
  // TWO DIFFERENT THINGS, AND CONFLATING THEM WAS A HOLE.
  //
  // `snapshotMode` is "this caller does three-way merges". `snap` is "and this
  // row has a baseline to compare against". The first version treated a missing
  // baseline as "fall back to the old authoritative behavior", which meant the
  // FIRST sync after this shipped would still have overwritten every name --
  // destroying exactly the edits the safe-first-run property exists to protect.
  // A test caught it. Without a baseline the answer is Amber wins, full stop.
  const snapshotMode = snapshotAware && authoritative;
  const snap = snapshotMode ? _readSnapshot(row.sync_snapshot) : null;

  const pick = (existing, incoming, column) => {
    if (!snapshotMode) {
      return authoritative ? (incoming ?? existing ?? null) : (existing ?? incoming ?? null);
    }
    if (_blank(incoming)) return _blank(existing) ? null : existing;
    if (_blank(existing)) return incoming; // fill a gap, always safe
    const base = snap?.[column];
    if (_blank(base)) return existing; // no baseline: Amber wins
    return existing === base ? incoming : existing;
  };

  // Lists are never overwritten and never lose a value -- the union is an
  // invariant of this function. What the baseline decides is ORDER, i.e. whose
  // primary wins. A row whose phone list is untouched since we wrote it takes
  // the device's order; one the user has reordered keeps theirs.
  const listUntouched = (column, current) =>
    !!snap && !_blank(snap[column]) && (current ?? null) === snap[column];
  const phonesUntouched = snapshotMode
    ? listUntouched("phones_all", row.phones_all)
    : authoritative;
  const emailsUntouched = snapshotMode ? listUntouched("emails", row.emails) : authoritative;

  const phones = phonesUntouched
    ? unionPhoneStrings(incomingPhones, curPhones)
    : unionPhoneStrings(curPhones, incomingPhones);
  const emails = emailsUntouched
    ? unionEmailStrings(incomingEmails, curEmails)
    : unionEmailStrings(curEmails, incomingEmails);

  const phonePrimary = phonesUntouched
    ? incomingPhones[0] || row.phone_primary || phones[0] || null
    : row.phone_primary || phones[0] || null;

  const next = {
    id: String(row.id),
    full_name: pick(row.full_name, facts.name, "full_name"),
    first_name: pick(row.first_name, _str(record.firstName), "first_name"),
    last_name: pick(row.last_name, _str(record.lastName), "last_name"),
    company: pick(row.company, _str(record.company) || _str(record.organization), "company"),
    // TITLE IS MERGED HERE BECAUSE IT IS WRITTEN BELOW.
    //
    // Adding "title" to UNION_COLUMNS without adding it here is worse than not
    // adding it at all: the statement then assigns `title = v.title` from an
    // object that has no title, so every re-sync wrote NULL over a job title
    // that had landed correctly on insert. Caught by importing the same Google
    // export twice -- "Orthodontist" after the first import, null after the
    // second. Any column in that list needs a line in this object.
    title: pick(row.title, _str(record.title), "title"),
    // city and source are FILL-ONLY on every path. Neither is a field the device
    // has an opinion about here, and `authoritative` used to let source flip.
    city: row.city ?? _str(record.city) ?? null,
    source: row.source ?? _str(record.source) ?? null,
    nickname: pick(row.nickname, _str(record.nickname), "nickname"),
    birthday: pick(_comparable(row.birthday), _str(record.birthday), "birthday"),
    phone_primary: phonePrimary,
    phone_primary_normalized: phonePrimary
      ? String(phonePrimary).replace(/\D/g, "") || null
      : null,
    phones_all: phones.join(", ") || null,
    emails: emails.join(", ") || null,
  };

  // `_touch` is what keeps updated_at honest. A sync where only the BASELINE
  // moved -- the device changed a field Amber had already diverged on -- is not
  // a change to the person, and a contacts list orders by updated_at, so
  // bumping it would silently reshuffle the user's list for no visible reason.
  // A DATE IS NOT A STRING. pg returns timestamptz as a JS Date, and the
  // incoming value is "YYYY-MM-DD", so a raw !== comparison is ALWAYS unequal --
  // which would make every sync issue an UPDATE for every contact that has a
  // birthday, forever. Both sides are normalized to a day before comparing.
  const touched = UNION_COLUMNS.some((c) => _comparable(next[c]) !== _comparable(row[c] ?? null));
  if (!snapshotMode) return touched ? next : null;

  const nextSnapshot = serializeSnapshot(next);
  const currentSnapshot = row.sync_snapshot ? serializeSnapshot(_readSnapshot(row.sync_snapshot)) : null;
  if (!touched && nextSnapshot === currentSnapshot) return null;
  return { ...next, sync_snapshot: nextSnapshot, _touch: touched };
}

/** A value in a form two sources can be compared in. Dates become their day. */
function _comparable(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return v;
}

/** pg may hand back jsonb as an object or as a string, depending on the driver. */
function _readSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function _str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function _splitList(s) {
  return typeof s === "string" && s
    ? s.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
}

// Display strings (not keys) for the union, from any writer's record shape.
function _displayList(...vals) {
  const out = [];
  for (const v of vals) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
        else if (item && typeof item.value === "string" && item.value.trim()) {
          out.push(item.value.trim());
        }
      }
    } else if (typeof v === "string" && v.trim()) {
      out.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

const UNION_COLUMNS = [
  "full_name",
  "first_name",
  "last_name",
  "company",
  // TITLE MERGES LIKE COMPANY, and it did not. It sat next to company in every
  // record shape the writers produce -- the Apple payload, the Google
  // normalizer, the CSV ingest -- and was in none of the columns this list
  // writes, so the only path that ever set it was storeAppleCardDetails. Apple
  // users got job titles from that separate fill-only statement; everybody else
  // got none, and a question about a profession found nobody.
  "title",
  "city",
  "source",
  "phone_primary",
  "phone_primary_normalized",
  "phones_all",
  "emails",
  // "If I update his nickname or his birthday in Apple and hit resync, Amber
  //  should see that update." Both go through the same three-way merge as every
  //  other field, so an Amber-edited nickname still wins.
  //
  // apple_notes is DELIBERATELY ABSENT. user-store.js:960 already assigns it in
  // the same UPDATE this list feeds, and two assignments to one column in one
  // statement is a hard Postgres error -- so it needs that duplicate removed
  // first. Reading Apple's Notes also needs an entitlement Apple grants by
  // request form, so the column would be empty either way today.
  "nickname",
  "birthday",
];

/**
 * Columns that are not text. Postgres infers a VALUES column's type from the
 * first tuple, so a timestamptz sitting in an all-text list fails the whole
 * statement the moment the first row's birthday happens to be NULL.
 */
const UNION_COLUMN_CASTS = { birthday: "::timestamptz" };

/**
 * Apply merged values to many contacts in ONE statement per chunk.
 *
 * The bulk path can merge thousands of rows in a single sync (one owner's second
 * sync resolved 1,877 records onto existing rows), so a per-row UPDATE would put
 * the round-trip count straight back where the chunked insert removed it.
 */
export async function applyContactUnionBatch(ownerId, updates) {
  if (!ownerId || !Array.isArray(updates) || updates.length === 0) return 0;
  let applied = 0;
  for (const chunk of _chunk(updates.filter(Boolean), KEY_CHUNK)) {
    const params = [];
    const groups = [];
    // THE BASELINE RIDES ALONG ONLY WHEN SOMEONE COMPUTED ONE. A batch built by
    // a writer that knows nothing about sync_snapshot (a Google import, a
    // single-record merge) carries no snapshot on any row, and this statement
    // then reduces to exactly what it was before.
    const carriesSnapshot = chunk.some((u) => u.sync_snapshot != null || u._touch != null);
    const EXTRA = carriesSnapshot ? 2 : 0;
    chunk.forEach((u, i) => {
      const base = i * (UNION_COLUMNS.length + 1 + EXTRA);
      // Cast the first tuple only; Postgres infers the rest of the VALUES list.
      // jsonb and boolean need naming: inferring `text` from the first tuple
      // fails the whole statement.
      const cast =
        i === 0
          ? [
              "::uuid",
              ...UNION_COLUMNS.map((c) => UNION_COLUMN_CASTS[c] ?? "::text"),
              "::jsonb",
              "::boolean",
            ]
          : [];
      const cols = [`$${base + 1}${cast[0] || ""}`];
      UNION_COLUMNS.forEach((_, c) => {
        cols.push(`$${base + 2 + c}${cast[c + 1] || ""}`);
      });
      if (carriesSnapshot) {
        const at = base + 2 + UNION_COLUMNS.length;
        cols.push(`$${at}${cast[UNION_COLUMNS.length + 1] || ""}`);
        cols.push(`$${at + 1}${cast[UNION_COLUMNS.length + 2] || ""}`);
      }
      groups.push(`(${cols.join(", ")})`);
      params.push(u.id, ...UNION_COLUMNS.map((c) => u[c] ?? null));
      if (carriesSnapshot) params.push(u.sync_snapshot ?? null, u._touch !== false);
    });
    params.push(ownerId);
    const ownerParam = `$${params.length}`;
    const valueCols = carriesSnapshot
      ? `id, ${UNION_COLUMNS.join(", ")}, sync_snapshot, touch`
      : `id, ${UNION_COLUMNS.join(", ")}`;
    // COALESCE, NOT ASSIGNMENT, on the baseline. A row updated by a writer that
    // passes NULL must keep the baseline it has; a blanket assignment would wipe
    // it, after which Amber wins every field forever and no upstream change is
    // ever picked up again. The degradation has to be "leave it alone".
    const tail = carriesSnapshot
      ? `sync_snapshot = COALESCE(v.sync_snapshot, c.sync_snapshot),
           updated_at = CASE WHEN v.touch THEN now() ELSE c.updated_at END`
      : `updated_at = now()`;
    const sql = `UPDATE contacts AS c SET
           ${UNION_COLUMNS.map((c) => `${c} = v.${c}`).join(",\n           ")},
           ${tail}
         FROM (VALUES ${groups.join(", ")}) AS v(${valueCols})
        WHERE c.id = v.id AND c.owner_id = ${ownerParam}::uuid`;
    const res = await query(sql, params);
    applied += res.rowCount ?? chunk.length;
  }
  return applied;
}

/** Single-row union merge. Reads the row, computes the union, writes if changed. */
export async function applyContactUnion(ownerId, contactId, record, opts = {}) {
  if (!ownerId || !contactId) return false;
  const { rows } = await query(
    `SELECT ${CONTACT_MATCH_COLUMNS}
       FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [contactId, ownerId],
  );
  if (!rows[0]) return false;
  const merged = mergedColumnValues(rows[0], record, opts);
  if (!merged) return true; // already a superset — nothing to write
  await applyContactUnionBatch(ownerId, [merged]);
  return true;
}

// ── Key claims ──────────────────────────────────────────────────────────────

/**
 * Claim identity keys for contacts. Returns
 *   { claimed, conflicts: [{ keyType, keyValue, contactId, winnerContactId }] }
 *
 * A conflict means another contact already holds that key — either a row this
 * sync did not know about, or a CONCURRENT sync that inserted first. The caller
 * turns a conflict into a merge (collapsing its own row into the winner), which
 * is what stops two simultaneous syncs from leaving a twin behind. Keys are
 * claimed AFTER the contact rows are committed, so a claim never points at a row
 * that does not exist.
 */
export async function claimIdentityKeys(ownerId, claims) {
  const out = { claimed: 0, conflicts: [] };
  if (!ownerId || !Array.isArray(claims) || claims.length === 0) return out;
  if (!_identityTablesReady) return out;

  // Dedupe within the batch: one statement cannot hit a conflict target twice.
  const wanted = new Map();
  for (const c of claims) {
    if (!c?.keyType || !c?.keyValue || c.contactId == null) continue;
    if (KEY_TYPE_BY_NAME[c.keyType] == null) continue;
    // Hash ONCE, here, and carry both forms: the hash is what the statement
    // binds, the plaintext is what a conflict report has to be able to say.
    const keyHash = hashIdentityKey(c.keyType, c.keyValue);
    if (!keyHash) continue;
    const k = keyHash.toString("hex");
    if (!wanted.has(k)) wanted.set(k, { ...c, keyHash, token: k });
  }
  if (wanted.size === 0) return out;

  for (const chunk of _chunk([...wanted.values()], KEY_CHUNK)) {
    const params = [];
    const groups = [];
    chunk.forEach((c, i) => {
      const b = i * 4;
      const cast = i === 0 ? ["::uuid", "::smallint", "::bytea", "::uuid"] : ["", "", "", ""];
      groups.push(
        `($${b + 1}${cast[0]}, $${b + 2}${cast[1]}, $${b + 3}${cast[2]}, $${b + 4}${cast[3]})`,
      );
      params.push(ownerId, KEY_TYPE_BY_NAME[c.keyType], c.keyHash, String(c.contactId));
    });
    let inserted = [];
    try {
      const res = await query(
        `INSERT INTO contact_identity_keys (owner_id, key_type, key_hash, contact_id)
         VALUES ${groups.join(", ")}
         ON CONFLICT (owner_id, key_type, key_hash) DO NOTHING
         RETURNING key_type, key_hash, contact_id`,
        params,
      );
      inserted = res.rows || [];
    } catch (err) {
      if (_noteMissingTable(err, "claimIdentityKeys")) return out;
      throw err;
    }
    out.claimed += inserted.length;
    if (inserted.length === chunk.length) continue;

    // Some keys were already held. Find out by whom.
    const insertedKeys = new Set(inserted.map((r) => r.key_hash.toString("hex")));
    const missing = chunk.filter((c) => !insertedKeys.has(c.token));
    const owners = await _lookupKeyOwners(ownerId, missing);
    for (const c of missing) {
      const winner = owners.get(c.token);
      if (winner != null && String(winner) !== String(c.contactId)) {
        out.conflicts.push({
          keyType: c.keyType,
          keyValue: c.keyValue,
          contactId: String(c.contactId),
          winnerContactId: String(winner),
        });
      }
    }
  }
  return out;
}

// Superset lookup (key_type = ANY, key_hash = ANY) then exact-filter in JS —
// index-friendly and avoids a row-constructor IN list. Keyed on the hash hex, so
// the caller can look a conflict up by the token it already computed.
async function _lookupKeyOwners(ownerId, claims) {
  const out = new Map();
  if (claims.length === 0) return out;
  const types = [...new Set(claims.map((c) => KEY_TYPE_BY_NAME[c.keyType]))];
  const hashes = [...new Map(claims.map((c) => [c.token, c.keyHash])).values()];
  const wanted = new Set(claims.map((c) => c.token));
  try {
    const { rows } = await query(
      `SELECT key_type, key_hash, contact_id
         FROM contact_identity_keys
        WHERE owner_id = $1 AND key_type = ANY($2::smallint[]) AND key_hash = ANY($3::bytea[])`,
      [ownerId, types, hashes],
    );
    for (const r of rows || []) {
      const k = r.key_hash.toString("hex");
      if (wanted.has(k)) out.set(k, r.contact_id);
    }
  } catch (err) {
    if (!_noteMissingTable(err, "_lookupKeyOwners")) throw err;
  }
  return out;
}

/** Every key a record claims, as claim rows for `claimIdentityKeys`. */
export function claimsForRecord(contactId, record) {
  const facts = extractFacts(record);
  return factKeys(facts).map((k) => {
    const idx = k.indexOf("|");
    return { keyType: k.slice(0, idx), keyValue: k.slice(idx + 1), contactId };
  });
}

/** Claim rows derived from a stored contacts row (used by the backfill). */
export function claimsForRow(row) {
  return claimsForRecord(String(row.id), row);
}

/**
 * Repoint an absorbed contact's keys onto the survivor, for collapse/cleanup.
 *
 * Keys the survivor already holds are DELETED rather than repointed (the unique
 * index forbids two rows for one key); the rest move. Returns
 * { repointed, dropped } as key descriptors so a manifest can undo it.
 */
// A manifest row a human can read. The VALUE is gone -- it was never stored --
// so a descriptor names the kind of key and which card holds it, which is what
// an undo needs and all an operator can act on.
function _keyRowDescriptor(r) {
  return {
    keyType: KEY_NAME_BY_TYPE[r.key_type] ?? String(r.key_type),
    keyHash: r.key_hash.toString("hex"),
    contactId: String(r.contact_id),
  };
}

/**
 * `client` lets a caller already inside withTransaction() hand its own connection
 * in, so the key moves commit or roll back WITH the rest of the merge. Without it
 * collapseContactGroup would repoint keys on a different pooled connection,
 * outside its own transaction: keys moved, everything else rolled back. Omitted,
 * this behaves exactly as it did.
 */
export async function repointIdentityKeys(ownerId, survivorId, absorbedIds, { client } = {}) {
  const out = { repointed: [], dropped: [] };
  if (!ownerId || !survivorId || !Array.isArray(absorbedIds) || absorbedIds.length === 0) {
    return out;
  }
  if (!_identityTablesReady) return out;
  const ids = absorbedIds.map(String);
  const run = client ? (t, p) => client.query(t, p) : query;
  try {
    const dropped = await run(
      `DELETE FROM contact_identity_keys k
        WHERE k.owner_id = $1 AND k.contact_id = ANY($3::uuid[])
          AND EXISTS (
            SELECT 1 FROM contact_identity_keys s
             WHERE s.owner_id = k.owner_id AND s.key_type = k.key_type
               AND s.key_hash = k.key_hash AND s.contact_id = $2::uuid)
        RETURNING key_type, key_hash, contact_id`,
      [ownerId, String(survivorId), ids],
    );
    out.dropped = (dropped.rows || []).map(_keyRowDescriptor);
    const moved = await run(
      `UPDATE contact_identity_keys
          SET contact_id = $2::uuid
        WHERE owner_id = $1 AND contact_id = ANY($3::uuid[])
        RETURNING key_type, key_hash, contact_id`,
      [ownerId, String(survivorId), ids],
    );
    out.repointed = (moved.rows || []).map(_keyRowDescriptor);
  } catch (err) {
    if (!_noteMissingTable(err, "repointIdentityKeys")) throw err;
  }
  return out;
}

/**
 * READ BACK THE PAIRS THE RESOLVER REFUSED TO MERGE.
 *
 * recordReviewCandidates has been writing these since it shipped and nothing has
 * ever read them. Every time the matcher found two cards with the same folded
 * name and not enough corroboration to merge them, it wrote the pair down and
 * the person was never asked. That is the one moment the app genuinely needs a
 * human -- the matcher saying "I think this is the same person and I will not
 * bet your notes on it" -- and it was going into a table nobody opened.
 *
 * THESE ARE NOT THE SAME AS THE PROVABLE DUPLICATES, and must not be mixed in
 * with them. A provable pair shares a phone number or an email, so the person can
 * open their contacts and see both cards. These are softer by construction: the
 * resolver already decided the evidence was insufficient. Offered as if they were
 * facts they would repeat the failure the duplicates endpoint was corrected for,
 * where people looked, found one card, and concluded the app was inventing
 * things.
 *
 * So each row comes back WITH the evidence that made it uncertain -- both names,
 * what each card actually holds, and the reason the merge was refused -- so a
 * screen can show the person what the matcher saw and let them decide. A review
 * queue whose items cannot be checked is worse than no review queue.
 */
export async function listReviewCandidates(ownerId, { limit = 25 } = {}) {
  if (!ownerId) return [];
  if (!_identityTablesReady) return [];
  try {
    const { rows } = await query(
      `SELECT r.id, r.reason, r.detail, r.created_at,
              a.id AS a_id, a.full_name AS a_name, a.company AS a_company,
              a.phone_primary AS a_phone, a.emails AS a_emails,
              a.source AS a_source, a.created_at AS a_created,
              b.id AS b_id, b.full_name AS b_name, b.company AS b_company,
              b.phone_primary AS b_phone, b.emails AS b_emails,
              b.source AS b_source, b.created_at AS b_created
         FROM contact_review_candidates r
         JOIN contacts a
           ON a.owner_id = r.owner_id AND a.id = r.contact_id AND a.deleted_at IS NULL
         JOIN contacts b
           ON b.owner_id = r.owner_id AND b.id = r.candidate_contact_id
          AND b.deleted_at IS NULL
        WHERE r.owner_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2`,
      [ownerId, Math.min(Number(limit) || 25, 100)],
    );
    // The JOINs are inner on purpose: a pair whose other half has since been
    // merged away or deleted is no longer a question anyone can answer, and
    // asking it would be asking about a card that is not there.
    return rows.map((r) => ({
      reviewId: Number(r.id),
      reason: r.reason,
      detail: r.detail ?? null,
      seenAt: r.created_at,
      a: {
        contactId: String(r.a_id),
        name: r.a_name,
        company: r.a_company ?? null,
        phone: r.a_phone ?? null,
        emails: r.a_emails ?? null,
        source: r.a_source ?? null,
        createdAt: r.a_created,
      },
      b: {
        contactId: String(r.b_id),
        name: r.b_name,
        company: r.b_company ?? null,
        phone: r.b_phone ?? null,
        emails: r.b_emails ?? null,
        source: r.b_source ?? null,
        createdAt: r.b_created,
      },
    }));
  } catch (err) {
    if (_noteMissingTable(err, "listReviewCandidates")) return [];
    return [];
  }
}

/** Forget a pair the person said is NOT the same person. */
export async function dismissReviewCandidate(ownerId, reviewId) {
  if (!ownerId || !reviewId) return false;
  try {
    const res = await query(
      `DELETE FROM contact_review_candidates WHERE owner_id = $1 AND id = $2`,
      [ownerId, reviewId],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    if (_noteMissingTable(err, "dismissReviewCandidate")) return false;
    return false;
  }
}

/** Record refused-merge pairs. Best-effort: never fails the contact write. */
export async function recordReviewCandidates(ownerId, links) {
  if (!ownerId || !Array.isArray(links) || links.length === 0) return 0;
  if (!_identityTablesReady) return 0;
  const wanted = new Map();
  for (const l of links) {
    if (l?.contactId == null || l?.candidateContactId == null || !l?.reason) continue;
    if (String(l.contactId) === String(l.candidateContactId)) continue;
    wanted.set(`${l.contactId}|${l.candidateContactId}|${l.reason}`, l);
  }
  if (wanted.size === 0) return 0;
  let written = 0;
  for (const chunk of _chunk([...wanted.values()], KEY_CHUNK)) {
    const params = [];
    const groups = [];
    chunk.forEach((l, i) => {
      const b = i * 5;
      const cast = i === 0
        ? ["::uuid", "::uuid", "::uuid", "::text", "::jsonb"]
        : ["", "", "", "", ""];
      groups.push(
        `($${b + 1}${cast[0]}, $${b + 2}${cast[1]}, $${b + 3}${cast[2]}, ` +
          `$${b + 4}${cast[3]}, $${b + 5}${cast[4]})`,
      );
      params.push(
        ownerId,
        String(l.contactId),
        String(l.candidateContactId),
        l.reason,
        l.detail != null ? JSON.stringify(l.detail) : null,
      );
    });
    try {
      const res = await query(
        `INSERT INTO contact_review_candidates
           (owner_id, contact_id, candidate_contact_id, reason, detail)
         VALUES ${groups.join(", ")}
         ON CONFLICT (owner_id, contact_id, candidate_contact_id, reason)
         DO UPDATE SET detail = EXCLUDED.detail, updated_at = now()`,
        params,
      );
      written += res.rowCount ?? chunk.length;
    } catch (err) {
      if (_noteMissingTable(err, "recordReviewCandidates")) return written;
      // A review row is diagnostic — never let it fail a contact sync.
      return written;
    }
  }
  return written;
}

function _chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Re-export so callers need only one import for the phone key convention. */
export { phoneKey };
