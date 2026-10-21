/**
 * TEST-ONLY in-memory stand-in for src/db/sql.js. Nothing in the runtime graph
 * imports this — it is swapped in for sql.js by sql-fake-harness.js so the
 * contact write path can be exercised (and its query count measured) without
 * Cloud SQL credentials.
 *
 * It is not a Postgres emulator. It models exactly the statements the contact
 * paths issue, and the properties those statements exist for:
 *
 *   - INSERT … ON CONFLICT (owner_id, external_id) DO UPDATE is keyed upsert, so
 *     re-sending the same external_id updates the same row (same synthetic id)
 *     rather than adding one. NULL external_id rows are NOT in that partial
 *     index, so each of them is a plain append — matching the real DDL.
 *   - contact_identity_keys enforces its NON-partial unique index on
 *     (owner_id, key_type, key_hash), so "the second writer loses the claim and
 *     merges instead" is observable rather than asserted.
 *   - the batched field-UNION UPDATE … FROM (VALUES …) actually mutates rows, so
 *     "one row per person carrying both sources' data" is checkable.
 *
 * Rows are stored column-name-keyed (INSERT column lists are parsed), which is
 * what lets one implementation serve every INSERT shape in store.js and
 * user-store.js.
 */

export const state = {
  calls: [], // every statement, in order: { text, params }
  rows: new Map(), // contact id → { ...columns }
  identityKeys: new Map(), // "owner|type|hashHex" → { contact_id, key_hash, ... }
  contactSources: new Map(), // "owner|source|external_id" → row (param array)
  reviewCandidates: new Map(), // "owner|a|b|reason" → row
  nextId: 1,
  // Optional fault injection: (text, params) => true forces that statement to
  // throw, which is how the per-row fallback path gets tested.
  failWhen: null,
  // Contact ids hidden from the OWNER-SCOPED index load only (a by-id read still
  // sees them). This models the one race that matters: another transaction
  // committed a row AFTER our index snapshot, so resolution cannot see it but the
  // unique index on contact_identity_keys still enforces it.
  hiddenFromIndexLoad: new Set(),
  // phone → amber_id, for the owner resolver the contact ROUTES go through
  // (resolveAmberIdByPhone). Seed it in a test to make a session resolvable.
  users: new Map(),
  owners: new Set(),
};

export function resetFakeSql() {
  state.calls = [];
  state.rows = new Map();
  state.identityKeys = new Map();
  state.contactSources = new Map();
  state.reviewCandidates = new Map();
  state.nextId = 1;
  state.failWhen = null;
  state.hiddenFromIndexLoad = new Set();
  state.users = new Map();
  state.owners = new Set();
}

/** Statements only, ignoring transaction bookkeeping. */
/**
 * Forget the statements recorded so far, KEEPING the data.
 *
 * resetFakeSql() throws the rows away too, which is useless when the question is
 * "given this state, does the next call write anything". Several tests reached
 * for `resetFakeSqlCalls?.()` with an optional call, it did not exist, and the
 * no-op meant they were asserting against every statement since the start of the
 * test -- so "issues zero updates" quietly meant "issued some updates earlier".
 */
/** Make `amberId` resolve as an existing account for DID lookups. */
export function registerFakeOwner(amberId) {
  state.owners.add(String(amberId));
  return String(amberId);
}

export function resetFakeSqlCalls() {
  state.calls = [];
}

export function statementCalls() {
  return state.calls.filter(
    (c) => !["BEGIN", "COMMIT", "ROLLBACK"].includes(c.text.trim()),
  );
}

// ── Test-facing views ───────────────────────────────────────────────────────

/** Live (not soft-deleted) contact rows. */
export function liveContacts(ownerId = null) {
  return [...state.rows.values()].filter(
    (r) => !r.deleted_at && (ownerId == null || r.owner_id === ownerId),
  );
}

/**
 * Back-compat view for tests written against the previous fake: live rows that
 * carry an external_id, keyed "owner|external_id" → { id, row }. `row` is the
 * 12-column upsert param order those tests index into positionally.
 */
export const UPSERT_COLUMN_ORDER = [
  "owner_id", "owner_phone", "external_id", "full_name", "first_name", "last_name",
  "phone_primary", "phones_all", "emails", "company", "source",
  "phone_primary_normalized",
  // APPENDED, NOT INSERTED. Existing tests index into this positionally, so new
  // columns go last and 0-11 keep their meaning.
  "nickname",
  "birthday",
  "sync_snapshot",
];

function contactsView() {
  const out = new Map();
  for (const r of liveContacts()) {
    if (r.external_id == null) continue;
    out.set(`${r.owner_id}|${r.external_id}`, {
      id: r.id,
      row: UPSERT_COLUMN_ORDER.map((c) => r[c] ?? null),
    });
  }
  return out;
}

/** Live rows with no external_id (what the old no-conflict branch produced). */
function noExternalIdView() {
  return liveContacts()
    .filter((r) => r.external_id == null)
    .map((r) => UPSERT_COLUMN_ORDER.map((c) => r[c] ?? null));
}

Object.defineProperty(state, "contacts", { get: contactsView, enumerable: true });
Object.defineProperty(state, "contactsNoExternalId", {
  get: noExternalIdView,
  enumerable: true,
});

// ── Statement handling ──────────────────────────────────────────────────────

function rowsOf(params, colCount) {
  const out = [];
  for (let i = 0; i < params.length; i += colCount) {
    out.push(params.slice(i, i + colCount));
  }
  return out;
}

/** Column list of an INSERT, in order. */
function insertColumns(text) {
  const m = /INSERT INTO \w+\s*\(([^)]*)\)/i.exec(text);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

const strip = (v) => (typeof v === "string" ? v : v);

function insertContacts(text, params) {
  const cols = insertColumns(text);
  if (!cols) return { rows: [] };
  const hasConflict = /ON CONFLICT \(owner_id, external_id\)/.test(text);
  const returned = [];
  for (const values of rowsOf(params, cols.length)) {
    const incoming = {};
    cols.forEach((c, i) => {
      incoming[c] = strip(values[i]);
    });
    // The unique index is PARTIAL: external_id IS NOT NULL AND deleted_at IS NULL.
    let existing = null;
    if (hasConflict && incoming.external_id != null) {
      existing = liveContacts().find(
        (r) =>
          r.owner_id === incoming.owner_id && r.external_id === incoming.external_id,
      );
    }
    if (existing) {
      // FILL-ONLY, WHEN THE STATEMENT SAYS FILL-ONLY.
      //
      // This used to Object.assign() unconditionally, which is a blanket merge
      // no matter what the DO UPDATE list said -- so a test of the fill-only
      // tail passed whatever the tail actually was. That is the worst kind of
      // green: the suite agreeing with itself instead of with Postgres.
      const fillOnly = /COALESCE\(NULLIF\(contacts\./.test(text);
      const selfAssignOnly = /DO UPDATE SET external_id = contacts\.external_id/.test(text);
      if (selfAssignOnly) {
        // insert-only: the row is returned and nothing changes.
      } else if (fillOnly) {
        for (const [k, v] of Object.entries(incoming)) {
          if (k === "sync_snapshot") {
            // COALESCE(EXCLUDED.sync_snapshot, contacts.sync_snapshot)
            if (v != null) existing[k] = v;
            continue;
          }
          const cur = existing[k];
          const blank = cur == null || (typeof cur === "string" && cur === "");
          if (blank && v != null) existing[k] = v;
        }
        existing.updated_at = new Date().toISOString();
      } else {
        Object.assign(existing, incoming);
      }
      returned.push({ id: existing.id, external_id: existing.external_id, ...existing });
    } else {
      const id = state.nextId++;
      const row = { id, deleted_at: null, ...incoming };
      state.rows.set(String(id), row);
      returned.push({ id, external_id: row.external_id ?? null, ...row });
    }
  }
  return { rows: returned, rowCount: returned.length };
}

function selectContacts(text, params) {
  // Owner-scoped index load, or a single-row read by id.
  const byId = /WHERE id = \$1/.test(text);
  if (byId) {
    const row = state.rows.get(String(params[0]));
    const ok = row && !row.deleted_at && row.owner_id === params[1];
    return { rows: ok ? [{ ...row }] : [] };
  }
  // THE CAST IS NOT PART OF THE MEANING. This matched the literal string
  // `id = ANY($2::bigint[])`, so the day contacts.id became a uuid and the query
  // said ::uuid[], this double stopped recognising it: idFilter went null, the
  // index-load filter applied to a targeted read, and the dedup collapse test
  // failed with "no twin survives" -- a test double disagreeing with the code
  // about SQL text, dressed up as a logic bug.
  //
  // Matching any cast keeps the double honest about what it is actually
  // detecting: an id-list read, whatever type the ids happen to be this year.
  const idFilter = /id = ANY\(\$2::\w+\[\]\)/.test(text) ? params[1].map(String) : null;
  const rows = liveContacts(params[0])
    .filter((r) => !idFilter || idFilter.includes(String(r.id)))
    // Only the unfiltered owner-scoped form is an index load, so this cannot
    // affect a targeted read (collapse, single-row merge) — see hiddenFromIndexLoad.
    .filter((r) => idFilter || !state.hiddenFromIndexLoad.has(String(r.id)))
    .map((r) => ({ ...r }));
  return { rows };
}

/**
 * SELECT coalesce(source,'unknown'), count(*) … GROUP BY 1 — the per-source
 * breakdown the sync routes return. Aggregation is modelled explicitly because
 * the generic row select would hand back raw rows and every count would read 0.
 */
function countContactsBySource(params) {
  const tally = new Map();
  for (const r of liveContacts(params[0])) {
    const key = r.source ?? "unknown";
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  return {
    rows: [...tally.entries()].map(([source, n]) => ({ source, n })),
  };
}

/** UPDATE contacts AS c SET … FROM (VALUES …) AS v(id, …) WHERE c.id = v.id … */
function updateContactsFromValues(text, params) {
  const m = /AS v\(([^)]*)\)/i.exec(text);
  if (!m) return { rows: [], rowCount: 0 };
  const cols = m[1].split(",").map((c) => c.trim());
  const owner = params[params.length - 1];
  const tuples = rowsOf(params.slice(0, params.length - 1), cols.length);
  let rowCount = 0;
  for (const t of tuples) {
    const patch = {};
    cols.forEach((c, i) => {
      patch[c] = strip(t[i]);
    });
    const row = state.rows.get(String(patch.id));
    if (!row || row.deleted_at || row.owner_id !== owner) continue;
    for (const c of cols) {
      if (c === "id" || c === "touch") continue;
      if (c === "sync_snapshot") {
        // COALESCE(v.sync_snapshot, c.sync_snapshot) -- a writer that knows
        // nothing about the baseline passes NULL and must not wipe it. Modelled
        // rather than assigned, because a blanket assign here is exactly the bug
        // the COALESCE exists to prevent and the fake would have hidden it.
        if (patch[c] != null) row[c] = patch[c];
        continue;
      }
      row[c] = patch[c];
    }
    // updated_at = CASE WHEN v.touch THEN now() ELSE c.updated_at END
    if (cols.includes("touch")) {
      if (patch.touch === true || patch.touch === "true") {
        row.updated_at = new Date().toISOString();
      }
    } else {
      row.updated_at = new Date().toISOString();
    }
    rowCount += 1;
  }
  return { rows: [], rowCount };
}

/** The plain single-row UPDATE contacts SET … WHERE id = $1 AND owner_id = $2 forms. */
function updateContactsById(text, params) {
  const row = state.rows.get(String(params[0]));
  if (!row || row.owner_id !== params[1]) return { rows: [], rowCount: 0 };
  const assignments = [...text.matchAll(/(\w+)\s*=\s*(?:COALESCE\(\s*)?\$(\d+)/g)];
  for (const [, col, idx] of assignments) {
    if (col === "id" || col === "owner_id" || col === "updated_at") continue;
    const value = params[Number(idx) - 1];
    const isCoalesceKeepExisting = new RegExp(
      `${col}\\s*=\\s*COALESCE\\(\\s*${col}\\b`,
    ).test(text);
    if (isCoalesceKeepExisting) {
      if (row[col] == null) row[col] = value;
    } else if (
      new RegExp(`${col}\\s*=\\s*COALESCE\\(\\s*\\$${idx}`).test(text)
    ) {
      if (value != null) row[col] = value;
    } else {
      row[col] = value;
    }
  }
  if (/deleted_at = now\(\)/.test(text)) row.deleted_at = new Date().toISOString();
  if (/linked_amber_id = \$3/.test(text)) row.linked_amber_id = params[2];
  return { rows: [{ ...row }], rowCount: 1 };
}

function softDeleteContacts(text, params) {
  const ids = (params[1] || []).map(String);
  let rowCount = 0;
  for (const id of ids) {
    const row = state.rows.get(id);
    if (!row || row.owner_id !== params[0] || row.deleted_at) continue;
    row.deleted_at = new Date().toISOString();
    rowCount += 1;
  }
  return { rows: [], rowCount };
}

// Keys are stored HASHED now: params carry a 16-byte Buffer where they used to
// carry the number. The fake keys its map on the hex of those bytes, because two
// Buffers holding identical bytes are different Map keys and the whole point of
// this table is that one key belongs to one contact.
const _hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : String(v));

function insertIdentityKeys(text, params) {
  const rows = rowsOf(params, 4);
  const returned = [];
  for (const [owner, type, keyHash, contactId] of rows) {
    const k = `${owner}|${type}|${_hex(keyHash)}`;
    if (state.identityKeys.has(k)) continue; // ON CONFLICT DO NOTHING
    state.identityKeys.set(k, {
      owner_id: owner,
      key_type: type,
      key_hash: Buffer.isBuffer(keyHash) ? keyHash : Buffer.from(String(keyHash)),
      contact_id: String(contactId),
    });
    returned.push({
      key_type: type,
      key_hash: state.identityKeys.get(k).key_hash,
      contact_id: String(contactId),
    });
  }
  return { rows: returned, rowCount: returned.length };
}

function selectIdentityKeys(text, params) {
  const owner = params[0];
  let rows = [...state.identityKeys.values()].filter((k) => k.owner_id === owner);
  if (/key_type = ANY/.test(text)) {
    const types = new Set(params[1] || []);
    const hashes = new Set((params[2] || []).map(_hex));
    rows = rows.filter((k) => types.has(k.key_type) && hashes.has(_hex(k.key_hash)));
  }
  return { rows: rows.map((r) => ({ ...r })) };
}

function deleteIdentityKeysDuplicatingSurvivor(params) {
  const [owner, survivor, absorbed] = params;
  const ids = (absorbed || []).map(String);
  const removed = [];
  for (const [k, row] of [...state.identityKeys.entries()]) {
    if (row.owner_id !== owner || !ids.includes(String(row.contact_id))) continue;
    const survivorHolds = [...state.identityKeys.values()].some(
      (s) =>
        s.owner_id === owner &&
        s.key_type === row.key_type &&
        _hex(s.key_hash) === _hex(row.key_hash) &&
        String(s.contact_id) === String(survivor),
    );
    if (survivorHolds) {
      state.identityKeys.delete(k);
      removed.push({ ...row });
    }
  }
  return { rows: removed, rowCount: removed.length };
}

function repointIdentityKeys(params) {
  const [owner, survivor, absorbed] = params;
  const ids = (absorbed || []).map(String);
  const moved = [];
  for (const row of state.identityKeys.values()) {
    if (row.owner_id !== owner || !ids.includes(String(row.contact_id))) continue;
    moved.push({ ...row });
    row.contact_id = String(survivor);
  }
  return { rows: moved, rowCount: moved.length };
}

function insertReviewCandidates(params) {
  const rows = rowsOf(params, 5);
  for (const [owner, a, b, reason, detail] of rows) {
    state.reviewCandidates.set(`${owner}|${a}|${b}|${reason}`, {
      owner_id: owner,
      contact_id: String(a),
      candidate_contact_id: String(b),
      reason,
      detail,
    });
  }
  return { rows: [], rowCount: rows.length };
}

function exec(text, params = []) {
  state.calls.push({ text, params });
  if (state.failWhen && state.failWhen(text, params)) {
    throw new Error("fake-sql: injected failure");
  }

  // `users`: only the two statements the owner resolver issues. A phone the test
  // did not seed resolves to a fresh amber_id, mirroring resolveAmberIdByPhone's
  // create-if-missing behavior.
  if (/FROM users\b/.test(text) && /^\s*SELECT/i.test(text)) {
    const phone = params[0];
    if (/WHERE phone = \$1/.test(text)) {
      const amberId = state.users.get(phone);
      return { rows: amberId ? [{ amber_id: amberId, phone }] : [] };
    }
    // The DID resolver's lookup: SELECT amber_id FROM users WHERE amber_id = $1.
    // Answers only for owners a test registered with registerFakeOwner(), so an
    // unregistered id still resolves to null exactly as it did before this branch
    // existed -- otherwise every owner would spring into existence on lookup and
    // "this DID is not linked yet" would become untestable.
    if (/WHERE amber_id = \$1/.test(text)) {
      const id = params[0] == null ? null : String(params[0]);
      return { rows: id && state.owners.has(id) ? [{ amber_id: id }] : [] };
    }
    return { rows: [] };
  }
  if (/INSERT INTO users\b/.test(text)) {
    const phone = params[0];
    if (!state.users.has(phone)) {
      state.users.set(phone, `owner-${state.users.size + 1}`);
    }
    return { rows: [{ amber_id: state.users.get(phone) }] };
  }

  if (/INSERT INTO contact_identity_keys\b/.test(text)) return insertIdentityKeys(text, params);
  if (/FROM contact_identity_keys\b/.test(text) && /^\s*SELECT/i.test(text)) {
    return selectIdentityKeys(text, params);
  }
  if (/DELETE FROM contact_identity_keys\b/.test(text)) {
    return deleteIdentityKeysDuplicatingSurvivor(params);
  }
  if (/UPDATE contact_identity_keys\b/.test(text)) return repointIdentityKeys(params);
  if (/INSERT INTO contact_review_candidates\b/.test(text)) {
    return insertReviewCandidates(params);
  }

  if (/INSERT INTO contacts\b/.test(text)) return insertContacts(text, params);
  if (
    /^\s*SELECT/i.test(text) &&
    /FROM contacts\b/.test(text) &&
    /count\(\*\)/i.test(text) &&
    /GROUP BY/i.test(text)
  ) {
    return countContactsBySource(params);
  }
  if (/^\s*SELECT/i.test(text) && /FROM contacts\b/.test(text)) {
    return selectContacts(text, params);
  }
  if (/UPDATE contacts AS c SET/.test(text)) return updateContactsFromValues(text, params);
  if (/UPDATE contacts SET deleted_at = now\(\)/.test(text)) {
    return softDeleteContacts(text, params);
  }
  if (/UPDATE contacts SET/.test(text)) return updateContactsById(text, params);

  if (/INSERT INTO contact_sources\b/.test(text)) {
    for (const row of rowsOf(params, 9)) {
      state.contactSources.set(`${row[0]}|${row[2]}|${row[3]}`, row);
    }
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE contact_sources\b/.test(text)) return { rows: [], rowCount: 0 };
  if (/FROM contact_sources\b/.test(text)) return { rows: [] };

  return { rows: [] };
}

export async function query(text, params) {
  return exec(text, params);
}

export async function withTransaction(fn) {
  state.calls.push({ text: "BEGIN", params: [] });
  try {
    const result = await fn({ query: async (t, p) => exec(t, p) });
    state.calls.push({ text: "COMMIT", params: [] });
    return result;
  } catch (err) {
    state.calls.push({ text: "ROLLBACK", params: [] });
    throw err;
  }
}
