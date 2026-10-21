/**
 * THE CUTOVER — move the pre-rebuild database into the new schema.
 *
 *   railway run node scripts/cutover.js --from amber                 DRY RUN
 *   railway run node scripts/cutover.js --from amber --apply         write
 *   railway run node scripts/cutover.js --from amber --apply --phase observations
 *   railway run node scripts/cutover.js --from amber --verify        check only
 *
 * DRY RUN BY DEFAULT. It reads the source, does every transformation in memory,
 * reports exactly what it would write and what it would refuse -- and writes
 * nothing. Run it, read it, then run it again with --apply.
 *
 * TWO DATABASES, AND ONLY ONE OF THEM IS WRITTEN.
 *
 *   SOURCE   --from <db>, opened read-only on its own connection. Never written.
 *   TARGET   whatever AMBER_SQL_DB points at. Written through the APPLICATION'S
 *            OWN POOL, which is not an implementation detail -- see below.
 *
 * The old database is left exactly as it is, so the cutover is reversible by
 * pointing AMBER_SQL_DB back at it. That is the whole rollback plan and it is one
 * environment variable.
 *
 * ── WHY OBSERVATIONS GO THROUGH insertObservation ──────────────────────────────
 *
 * The four fact tables -- contact_facts, contact_notes, contact_experiences,
 * user_facts -- all become `observations`, and observations are what the six
 * dimensions are computed from. It would be faster to bulk-INSERT them. It would
 * also be wrong, twice over:
 *
 *   THE ROW WOULD HAVE NO DIMENSIONS. A raw INSERT leaves dimension_status at its
 *   default 'pending', which is the worker's queue -- so all 1,076 migrated facts
 *   would go to the paid Perplexity endpoint one batch at a time. insertObservation
 *   runs classifyByLexicon first: the confident majority get their dimensions for
 *   free and synchronously, and only the genuinely ambiguous ones are left pending
 *   for the model. Same classifier, same thresholds, same lexicon that new voice
 *   notes go through.
 *
 *   THE ROW WOULD HAVE NO PARTICIPANTS. insertObservation writes the subject into
 *   observation_participants, which is one of the four arms of INTERACTION_STREAM
 *   and therefore half of what recency and cadence are computed from. A bulk
 *   insert that skips it under-counts every group fact forever.
 *
 * Migrated data must reach the dimensions the same way live data does, or the
 * scores are computed from two different pipelines and only one of them was
 * tested.
 *
 * ── THE FIVE FIELDS THAT DECIDE WHETHER THE SCORES MEAN ANYTHING ──────────────
 *
 * observed_at   DEFAULTS TO now(). Leave it and every backfilled fact looks like
 *               it happened today, which maxes `recency` for the entire corpus and
 *               makes warmth meaningless on day one. Mapped from occurred_at where
 *               the old row has one, otherwise created_at.
 * source        An unrecognised string scores 0.5 via
 *               scoring_params.'source_' || source, silently. Old `source` is free
 *               text. Known values are mapped; anything unmapped is REPORTED with
 *               its count rather than quietly averaged.
 * salience      NULL is scored as 0.5. Mapped from the old `weight`, clamped.
 * confidence    Multiplies the contribution directly. Mapped from `certainty`.
 * status        The rollups filter `status <> 'pending'`, so a fact written as
 *               pending is invisible to every score.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────────
 *
 * Rows the new foreign keys will not accept are SKIPPED AND RECORDED in
 * cutover_review, never dropped silently and never allowed to abort the run. An
 * empty cutover_review after a run means everything crossed.
 *
 * ── WHAT IS DELIBERATELY NOT MIGRATED ─────────────────────────────────────────
 *
 * The conversational and media tables are LEFT BEHIND ON PURPOSE, by decision,
 * not oversight:
 *
 *   app_conversation_messages  1058    conversation_messages  198
 *   note_audio                   34    note_shares             10
 *   note_comments                 4    note_reactions           3
 *
 * Every one is chat and voice-note traffic from a handful of accounts during
 * testing -- not onboarded user data, and not something anyone will look for. The
 * structure they hang off (contacts, circles, favorites, identity keys, the
 * observations the six dimensions score) all crosses; the test chatter does not.
 *
 * If that ever changes, each is a reshape rather than a remap -- a new field
 * mapping per table, not a new id scheme -- and the contact map this script
 * already writes is what they would join through.
 *
 * ── RESUMABLE ─────────────────────────────────────────────────────────────────
 *
 * Every phase asks cutover_map what it already moved and skips it, so a run that
 * dies half way is resumed by running it again. Nothing is migrated twice.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const APPLY = argv.includes("--apply");
const VERIFY_ONLY = argv.includes("--verify");
const ONLY_PHASE = flag("--phase");
const LIMIT = Number(flag("--limit")) || null;
const SOURCE_DB = flag("--from");

const pepper = process.env.IDENTITY_KEY_PEPPER;
if (typeof pepper !== "string" || pepper.length < 32) {
  console.error(
    `\n  IDENTITY_KEY_PEPPER is ${pepper ? `${pepper.length} characters` : "not set"}; ` +
    `hashing needs at least 32.\n\n` +
    `  contact_identity_keys stores plaintext in the old schema and HMAC(pepper, value)\n` +
    `  in the new one. A run with the wrong pepper writes 13,098 keys that match\n` +
    `  nothing and cannot be told from correct ones afterwards.\n`,
  );
  process.exit(2);
}

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-cutover.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const pg = (await import("pg")).default;

/**
 * THE SOURCE. Its own connection, and every statement against it is a SELECT.
 * Locally it is a DSN; against Cloud SQL it is a second Connector pointed at the
 * old database name, because the app pool can only be one database at a time.
 */
let srcPool;
if (process.env.CUTOVER_SOURCE_URL) {
  srcPool = new pg.Pool({ connectionString: process.env.CUTOVER_SOURCE_URL, max: 2 });
} else {
  if (!SOURCE_DB) {
    console.error(`\n  --from <database> is required: the OLD database to read.\n`);
    process.exit(2);
  }
  const { Connector } = await import("@google-cloud/cloud-sql-connector");
  const connector = new Connector();
  const opts = await connector.getOptions({
    instanceConnectionName: process.env.AMBER_SQL_CONNECTION_NAME,
    ipType: "PUBLIC",
  });
  srcPool = new pg.Pool({
    ...opts,
    database: SOURCE_DB,
    user: process.env.AMBER_SQL_USER,
    password: process.env.AMBER_SQL_PASSWORD,
    max: 2,
    statement_timeout: 120000,
  });
  srcPool.__connector = connector;
}
const src = (t, p) => srcPool.query(t, p);

/** THE TARGET: the application's own pool, so writes take the app's code path. */
let tgt, closeTarget;
if (process.env.SMOKE_DATABASE_URL) {
  const tp = new pg.Pool({ connectionString: process.env.SMOKE_DATABASE_URL, max: 4 });
  globalThis.__cutoverTargetPool = tp;
  const { __injectPoolForSmokeTests } = await import("../src/db/sql.js");
  __injectPoolForSmokeTests(tp);
  tgt = (t, p) => tp.query(t, p);
  closeTarget = () => tp.end();
} else {
  const sql = await import("../src/db/sql.js");
  tgt = sql.query;
  closeTarget = sql.closePool;
}

/** A transaction on the TARGET, whichever pool that is. */
let withTargetTransaction;
const _targetPool = globalThis.__cutoverTargetPool;
if (process.env.SMOKE_DATABASE_URL) {
  withTargetTransaction = async (fn) => {
    const c = await _targetPool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn((t, p) => c.query(t, p));
      await c.query("COMMIT");
      return out;
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
    finally { c.release(); }
  };
} else {
  const sql = await import("../src/db/sql.js");
  withTargetTransaction = (fn) => sql.withTransaction((c) => fn((t, p) => c.query(t, p)));
}

const { insertObservation } = await import("../src/db/observations-store.js");
const { hashIdentityKey, KEY_TYPE_BY_NAME } = await import("../src/lib/identity-keys.js");
const { phoneKey, emailKey } = await import("../src/lib/contact-identity.js");

// ── helpers ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padStart(n);
const clamp01 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.min(1, Math.max(0, Number(v))));

/**
 * scoring_params holds a trust weight per source as 'source_<name>'. A source
 * string with no matching row scores 0.5 -- not an error, just quietly average.
 * These are the seeded five; anything else is reported rather than guessed at.
 */
/**
 * READ FROM THE DATABASE, NOT FROM A LIST IN THIS FILE.
 *
 * This used to be a hardcoded set of the five migration 006 seeded. Migration 027
 * added six more, and the script went on reporting them as unrecognised while they
 * were scoring perfectly -- a warning that is wrong is worse than no warning,
 * because the next real one gets ignored. scoring_params IS the answer to "is this
 * source trusted"; anything else is a second copy of it that drifts.
 */
const KNOWN_SOURCES = new Set(
  (await tgt(`SELECT key FROM scoring_params WHERE key LIKE 'source\\_%'`)).rows
    .map((r) => r.key.slice("source_".length)),
);
/**
 * ONLY FOR SOURCES THAT ARE GENUINELY THE SAME THING UNDER ANOTHER SPELLING.
 *
 * The instinct is to map every unrecognised source onto a trusted one, and it is
 * wrong: `source` records WHERE A FACT ENTERED THE SYSTEM, and rewriting it makes
 * the row claim a provenance it does not have. How much an entry point is trusted
 * belongs in scoring_params, which is why migration 027 added weights for
 * soundboard, app_chat, contact_note, app_favorite, circle and imessage_dm rather
 * than renaming 243 rows into voice_note and told_directly.
 *
 * What is left here is spelling, not meaning: "voicenote" and "voice_note" are one
 * source written two ways.
 */
const SOURCE_MAP = {
  voicenote: "voice_note",
  sms: "imessage",
  enrich: "enrichment",
};
const unmappedSources = new Map();
function mapSource(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "manual";
  if (KNOWN_SOURCES.has(s)) return s;
  if (SOURCE_MAP[s]) return SOURCE_MAP[s];
  unmappedSources.set(s, (unmappedSources.get(s) ?? 0) + 1);
  return s; // preserved, and it will score 0.5 until a mapping is added
}

const SENTIMENTS = new Set(["positive", "negative", "neutral", "mixed"]);
const mapSentiment = (s) => {
  const v = String(s ?? "").trim().toLowerCase();
  return SENTIMENTS.has(v) ? v : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const review = [];
const note = (source_table, old_id, reason, detail = null) =>
  review.push({ source_table, old_id, reason, detail });

/**
 * A PHASE THAT PRINTS NOTHING FOR FIVE MINUTES IS INDISTINGUISHABLE FROM ONE THAT
 * HAS HUNG. contacts is 7,619 rows and identity_keys is 13,098; at one round trip
 * each over the Cloud SQL connector that is twenty minutes of silence, and the
 * first thing anyone does is kill it. Which used to lose the id map -- see
 * writeBatch.
 */
function progress(label, done, total, t0) {
  const per = (Date.now() - t0) / Math.max(done, 1);
  const left = Math.round((per * (total - done)) / 1000);
  // A newline per update, not a carriage return: `railway run` is often piped or
  // captured, and an in-place progress bar becomes one unreadable line there.
  console.log(
    `    ${label.padEnd(24)} ${String(done).padStart(6)} / ${total}` +
    `   ${per.toFixed(1)}ms each` + (done < total ? `   ~${left}s left` : `   done`),
  );
}

/**
 * ONE TRANSACTION PER CHUNK, ROWS AND THEIR MAP ENTRIES TOGETHER.
 *
 * The first version inserted every row one statement at a time and wrote the
 * whole id map at the END of the phase. Two problems, and the second is the
 * dangerous one:
 *
 *   SLOW. 26,000 rows across contacts, identity_keys and sources is 26,000
 *   round trips to Cloud SQL -- twenty minutes, for work Postgres does in
 *   seconds.
 *
 *   AND NOT ACTUALLY RESUMABLE. Kill it half way and the rows are committed
 *   while cutover_map is still empty, so the next run does not know they exist.
 *   Every contact gets a SECOND row under a NEW uuid, because the insert
 *   conflicts on nothing. The script advertised "resumable"; interrupting it
 *   would have doubled the address book.
 *
 * So a chunk of rows and the map entries that name them commit together, or
 * neither does. Interrupting now costs at most the chunk in flight, and re-running
 * skips everything already mapped.
 */
const CHUNK = 500;
async function writeBatch(table, rows, sqlFor, t0, total, doneSoFar) {
  let written = 0, landed = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    if (APPLY) {
      await withTargetTransaction(async (q) => {
        for (const r of chunk) {
          const [text, params] = sqlFor(r);
          // The ACTUAL row count, not the attempt count. Rows that already exist
          // hit ON CONFLICT DO NOTHING and write nothing, and reporting them as
          // "written" on a resumed run makes the report a fiction -- which is
          // exactly the kind of number somebody later trusts.
          const res = await q(text, params);
          if (res?.rowCount) landed += 1; else skipped += 1;
        }
        const pairs = chunk.filter((r) => r.__oldId != null && r.__newId)
                           .map((r) => [r.__oldId, r.__newId]);
        if (pairs.length) {
          await q(
            `INSERT INTO cutover_map (source_table, old_id, new_id)
             SELECT $1, * FROM unnest($2::bigint[], $3::uuid[])
             ON CONFLICT (source_table, old_id) DO NOTHING`,
            [table, pairs.map((x) => x[0]), pairs.map((x) => x[1])],
          );
        }
      });
    }
    written += chunk.length;
    for (const r of chunk) {
      if (r.__oldId != null && r.__newId) {
        if (!projected.has(table)) projected.set(table, new Map());
        projected.get(table).set(String(r.__oldId), String(r.__newId));
      }
    }
    if (APPLY) progress(table, doneSoFar + written, total, t0);
  }
  return written;
}

const stats = {};
const bump = (k, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };

/**
 * A DRY RUN THAT CANNOT SEE ITS OWN EARLIER PHASES IS WORSE THAN NO DRY RUN.
 *
 * The phases are a chain: contacts needs the users phase to have written, and
 * identity_keys, sources and observations all need the contact map. Reading only
 * the TARGET means a dry run against an empty database reports every contact
 * skipped for "owner has no users row" and every fact orphaned -- understating
 * the work, which is the dangerous direction to be wrong in. The first version of
 * this script did exactly that and claimed 6 skipped where the real run migrates
 * all 6.
 *
 * So both modes accumulate what they WOULD have written, and every later phase
 * reads the union. In --apply the two agree by construction; in a dry run the
 * in-memory half is the only half there is.
 */
const projected = new Map();      // source_table -> Map(old_id -> new_id)
const projectedUsers = new Set(); // amber_ids the users phase would have written

async function loadMap(table) {
  const { rows } = await tgt(
    `SELECT old_id, new_id FROM cutover_map WHERE source_table = $1`, [table]);
  const m = new Map(rows.map((r) => [String(r.old_id), String(r.new_id)]));
  for (const [k, v] of projected.get(table) ?? []) if (!m.has(k)) m.set(k, v);
  return m;
}
async function recordMap(table, pairs) {
  if (pairs.length === 0) return;
  if (!projected.has(table)) projected.set(table, new Map());
  const mem = projected.get(table);
  for (const [oldId, newId] of pairs) mem.set(String(oldId), String(newId));
  if (!APPLY) return;
  await tgt(
    `INSERT INTO cutover_map (source_table, old_id, new_id)
     SELECT $1, * FROM unnest($2::bigint[], $3::uuid[])
     ON CONFLICT (source_table, old_id) DO NOTHING`,
    [table, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
}

// ── phases ────────────────────────────────────────────────────────────────────

/**
 * USERS carry over unchanged: amber_id is already a uuid and already the primary
 * key in both schemas. This is the anchor everything else is remapped against, so
 * it runs first and a failure here stops the rest.
 */
async function phaseUsers() {
  const { rows } = await src(
    `SELECT amber_id, phone, full_name, handle, status, created_at, updated_at,
            deleted_at, current_city, occupation, bio, mbti, school, hometown,
            horoscope, avatar_url, timezone, username
       FROM users ORDER BY created_at`);
  bump("users:read", rows.length);
  for (const u of rows) {
    projectedUsers.add(String(u.amber_id));
    if (!APPLY) { bump("users:would_write"); continue; }
    // ON CONFLICT DO NOTHING rather than DO UPDATE: a target that already has this
    // account has newer data than the source does, and a resumed run must not
    // overwrite it with what the old database remembers.
    await tgt(
      `INSERT INTO users (amber_id, phone, full_name, handle, status, created_at,
                          updated_at, deleted_at, current_city, occupation, bio,
                          mbti, school, hometown, horoscope, avatar_url, timezone, username)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (amber_id) DO NOTHING`,
      [u.amber_id, u.phone, u.full_name, u.handle, u.status, u.created_at,
       u.updated_at, u.deleted_at, u.current_city, u.occupation, u.bio, u.mbti,
       u.school, u.hometown, u.horoscope, u.avatar_url, u.timezone, u.username],
    ).then((r) => bump(r.rowCount ? "users:written" : "users:already")).catch((e) => {
      note("users", null, "insert_failed", { code: e.code, amber_id: u.amber_id });
    });
  }
}

/**
 * CONTACTS, and the map every other phase depends on. bigserial -> uuid.
 *
 * A contact with no owner_id cannot cross: owner_id is NOT NULL in the new schema
 * and there is nobody to attribute the card to. A contact whose owner has no users
 * row cannot cross either -- the FK would reject it.
 */
async function phaseContacts() {
  const done = await loadMap("contacts");
  const { rows } = await src(
    `SELECT * FROM contacts ORDER BY id${LIMIT ? ` LIMIT ${LIMIT}` : ""}`);
  bump("contacts:read", rows.length);

  const { rows: userRows } = await tgt(`SELECT amber_id FROM users`);
  const users = new Set(userRows.map((r) => String(r.amber_id)));
  for (const id of projectedUsers) users.add(id);

  const todo = [];
  for (const c of rows) {
    if (done.has(String(c.id))) { bump("contacts:already"); continue; }
    if (!c.owner_id) { note("contacts", c.id, "no_owner_id"); bump("contacts:skipped"); continue; }
    if (!users.has(String(c.owner_id))) {
      note("contacts", c.id, "owner_has_no_users_row", { owner_id: c.owner_id });
      bump("contacts:skipped"); continue;
    }
    c.__oldId = c.id;
    c.__newId = crypto.randomUUID();
    todo.push(c);
  }
  if (!APPLY) { bump("contacts:would_write", todo.length); }
  const t0 = Date.now();
  const n = await writeBatch("contacts", todo, (c) => [
    `INSERT INTO contacts (id, owner_id, owner_phone, full_name, first_name,
       last_name, phone_primary, phones_all, emails, company, title, city,
       apple_notes, created_at, deleted_at, external_id, source, updated_at,
       linked_amber_id, location, birthday, avatar_url, linkedin_url,
       phone_primary_normalized)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24)
     ON CONFLICT (id) DO NOTHING`,
    [c.__newId, c.owner_id, c.owner_phone, c.full_name, c.first_name, c.last_name,
     c.phone_primary, c.phones_all, c.emails, c.company, c.title, c.city,
     c.apple_notes, c.created_at, c.deleted_at, c.external_id, c.source,
     c.updated_at, c.linked_amber_id, c.location, c.birthday, c.avatar_url,
     c.linkedin_url, c.phone_primary_normalized],
  ], t0, todo.length, 0);
  if (APPLY) {
    bump("contacts:written", n.landed);
    if (n.already) bump("contacts:already", n.already);
  }
}


/**
 * IDENTITY KEYS. The one phase that transforms the VALUE rather than the id: the
 * old table stores the phone number and the email address in the clear, the new
 * one stores HMAC(pepper, normalized value) and nothing else.
 *
 * The primary key changes too -- from a surrogate id to
 * (owner_id, key_type, key_hash) -- so two old rows can collapse into one. On
 * Karthik's data that is zero rows, measured; the ON CONFLICT is here because
 * "zero today" is not "zero on the day we run it".
 */
async function phaseIdentityKeys() {
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM contact_identity_keys ORDER BY id`);
  bump("identity_keys:read", rows.length);

  // Hash everything first, in memory, so a bad pepper or an unusable value
  // surfaces before a single write rather than 9,000 rows in.
  const todo = [];
  for (const k of rows) {
    const newContact = contacts.get(String(k.contact_id));
    if (!newContact) {
      note("contact_identity_keys", k.id, "contact_not_migrated", { contact_id: k.contact_id });
      bump("identity_keys:skipped"); continue;
    }
    const typeName = String(k.key_type);
    const t = KEY_TYPE_BY_NAME[typeName];
    if (!t) {
      note("contact_identity_keys", k.id, "unknown_key_type", { key_type: typeName });
      bump("identity_keys:skipped"); continue;
    }
    const normalized = typeName === "phone" ? phoneKey(k.key_value)
                     : typeName === "email" ? emailKey(k.key_value)
                     : String(k.key_value ?? "");
    const hash = normalized ? hashIdentityKey(t, normalized) : null;
    if (!hash) {
      note("contact_identity_keys", k.id, "value_not_hashable", { key_type: typeName });
      bump("identity_keys:skipped"); continue;
    }
    todo.push({ ...k, __contact: newContact, __type: t, __hash: hash });
  }
  if (!APPLY) { bump("identity_keys:would_write", todo.length); }
  const t0 = Date.now();
  const n = await writeBatch("contact_identity_keys", todo, (k) => [
    `INSERT INTO contact_identity_keys (owner_id, contact_id, key_type, key_hash, created_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (owner_id, key_type, key_hash) DO NOTHING`,
    [k.owner_id, k.__contact, k.__type, k.__hash, k.created_at],
  ], t0, todo.length, 0);
  if (APPLY) {
    bump("identity_keys:written", n.landed);
    if (n.already) bump("identity_keys:already", n.already);
  }
}


/**
 * PROVENANCE. owner_id text -> uuid, contact_id bigint -> uuid.
 *
 * contact_sources.id is a bigserial in BOTH schemas, so the row KEEPS ITS ID
 * rather than being given a new one. That makes the phase exactly idempotent
 * through ON CONFLICT (id) with no map entry to maintain -- and cutover_map could
 * not hold it anyway, since new_id is a uuid. The sequence is advanced afterwards
 * so the next real insert does not collide with a migrated id.
 *
 * An owner_id that is not a uuid is skipped and recorded. On the live data that is
 * zero rows out of 5,536, measured -- but the column is text and text holds
 * anything, so the run must not abort on the first surprise.
 */
async function phaseSources() {
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM contact_sources ORDER BY id`);
  bump("sources:read", rows.length);

  let maxId = 0;
  const todo = [];
  for (const r of rows) {
    const newContact = contacts.get(String(r.contact_id));
    if (!newContact) {
      note("contact_sources", r.id, "contact_not_migrated", { contact_id: r.contact_id });
      bump("sources:skipped"); continue;
    }
    if (!UUID_RE.test(String(r.owner_id ?? ""))) {
      note("contact_sources", r.id, "owner_id_not_uuid");
      bump("sources:skipped"); continue;
    }
    maxId = Math.max(maxId, Number(r.id));
    todo.push({ ...r, __contact: newContact });
  }
  if (!APPLY) { bump("sources:would_write", todo.length); }
  const t0 = Date.now();
  const n = await writeBatch("contact_sources", todo, (r) => [
    `INSERT INTO contact_sources (id, owner_id, contact_id, source, external_id,
       raw_full_name, raw_emails, raw_phones, raw_company, created_at, updated_at,
       deleted_at, raw)
     VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [r.id, r.owner_id, r.__contact, r.source, r.external_id, r.raw_full_name,
     r.raw_emails, r.raw_phones, r.raw_company, r.created_at, r.updated_at,
     r.deleted_at, r.raw],
  ], t0, todo.length, 0);
  if (APPLY) {
    bump("sources:written", n.landed);
    if (n.already) bump("sources:already", n.already);
  }
  // Without this the next application insert reuses an id a migrated row holds.
  if (APPLY && maxId > 0) {
    await tgt(`SELECT setval(pg_get_serial_sequence('contact_sources','id'), $1)`, [maxId]);
  }
}


/**
 * THE FOUR FACT TABLES BECOME observations, and this is the phase the whole
 * rebuild was for. Everything above moves ids around; this one is what makes the
 * six dimensions have anything to score.
 *
 * Each row goes through insertObservation -- the same function a voice note goes
 * through -- so the lexicon classifies it, the subject lands in
 * observation_participants, and anything the lexicon is unsure about is left
 * dimension_status='pending' for the model worker. See the file header.
 */
const FACT_SPECS = [
  {
    table: "contact_facts", kind: "fact",
    body: (r) => r.fact_text,
    contact: (r) => r.contact_id,
    when: (r) => r.created_at,
    participants: () => [],
    rawNames: (r) => (r.raw_name ? [r.raw_name] : []),
    extra: (r) => ({ rawName: r.raw_name, conditionText: r.condition_text }),
  },
  {
    table: "contact_notes", kind: "note",
    body: (r) => r.note_text,
    contact: (r) => (r.participant_ids?.length ? r.participant_ids[0] : null),
    when: (r) => r.created_at,
    participants: (r) => (r.participant_ids ?? []).slice(1),
    rawNames: (r) => r.raw_names ?? [],
    extra: () => ({}),
  },
  {
    table: "contact_experiences", kind: "experience",
    body: (r) => r.experience_text,
    contact: (r) => (r.participant_ids?.length ? r.participant_ids[0] : null),
    // An experience knows WHEN IT HAPPENED. Using created_at would date a holiday
    // from 2023 to the day it was typed up, and recency is computed from this.
    when: (r) => r.occurred_at ?? r.created_at,
    participants: (r) => (r.participant_ids ?? []).slice(1),
    rawNames: (r) => r.raw_names ?? [],
    extra: (r) => ({ placeText: r.location }),
  },
  {
    // A fact about the OWNER. contact_id and circle_id are both null, which
    // obs_subject_chk allows -- it forbids both being set, not both being unset.
    table: "user_facts", kind: "fact",
    body: (r) => r.fact_text,
    contact: () => null,
    when: (r) => r.created_at,
    participants: () => [],
    rawNames: () => [],
    extra: () => ({}),
  },
];

async function phaseObservations() {
  const contacts = await loadMap("contacts");
  for (const spec of FACT_SPECS) {
    const done = await loadMap(spec.table);
    const { rows } = await src(
      `SELECT * FROM ${spec.table} ORDER BY id${LIMIT ? ` LIMIT ${LIMIT}` : ""}`);
    bump(`${spec.table}:read`, rows.length);

    const pairs = [];
    const tPhase = Date.now();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (done.has(String(r.id))) { bump(`${spec.table}:already`); continue; }
      // A deleted fact was deleted on purpose. Carrying it over would resurrect
      // something the user removed, and the new schema would show it again.
      if (r.deleted_at) { bump(`${spec.table}:deleted`); continue; }
      const body = spec.body(r);
      if (typeof body !== "string" || !body.trim()) {
        note(spec.table, r.id, "empty_body"); bump(`${spec.table}:skipped`); continue;
      }

      const oldContact = spec.contact(r);
      let contactId = null;
      if (oldContact != null) {
        contactId = contacts.get(String(oldContact)) ?? null;
        if (!contactId) {
          note(spec.table, r.id, "contact_not_migrated", { contact_id: String(oldContact) });
          bump(`${spec.table}:orphan_contact`);
          // NOT skipped: the fact itself is still true and still the owner's. It
          // lands unattached rather than being thrown away, and cutover_review
          // says which card it lost.
        }
      }

      const participants = (spec.participants(r) ?? [])
        .map((id) => contacts.get(String(id)))
        .filter(Boolean)
        .map((cid) => ({ contactId: cid, role: "participant" }));

      const observedAt = spec.when(r) ?? r.created_at ?? null;
      const args = {
        ownerId: String(r.owner_id),
        contactId,
        kind: spec.kind,
        body: body.trim(),
        observedAt,
        source: mapSource(r.source),
        confidence: clamp01(r.certainty) ?? 1.0,
        salience: clamp01(r.weight),
        sentiment: mapSentiment(r.sentiment),
        sentimentStrength: clamp01(r.sentiment_strength),
        status: ["resolved", "pending", "soft"].includes(r.status) ? r.status : "resolved",
        participants,
        rawNames: spec.rawNames(r) ?? [],
        ...spec.extra(r),
      };

      if (!APPLY) { bump(`${spec.table}:would_write`); continue; }
      try {
        const res = await insertObservation(args);
        pairs.push([r.id, String(res.observationId ?? res.observation_id ?? res.id)]);
        bump(`${spec.table}:written`);
      } catch (e) {
        note(spec.table, r.id, "insert_failed", { code: e.code, message: String(e.message).slice(0, 120) });
        bump(`${spec.table}:skipped`);
      }
      // FLUSHED AS WE GO, for the same reason writeBatch commits its map with its
      // rows: an interrupted run must not re-insert what it already wrote.
      // insertObservation owns its own transaction, so this cannot join it -- the
      // worst case is one observation written and unmapped, which a re-run
      // duplicates. One row, not a thousand.
      if (pairs.length >= 200) { await recordMap(spec.table, pairs.splice(0)); }
      if (APPLY && (i % 100 === 0 || i === rows.length - 1)) {
        progress(spec.table, i + 1, rows.length, tPhase);
      }
    }
    await recordMap(spec.table, pairs);
  }
}


/**
 * CIRCLES. bigserial -> uuid, everything else carries. owner_id was already uuid.
 */
async function phaseCircles() {
  const done = await loadMap("circles");
  const { rows } = await src(`SELECT * FROM circles ORDER BY id`);
  bump("circles:read", rows.length);
  const { rows: userRows } = await tgt(`SELECT amber_id FROM users`);
  const users = new Set(userRows.map((r) => String(r.amber_id)));
  for (const id of projectedUsers) users.add(id);

  const pairs = [];
  for (const c of rows) {
    if (done.has(String(c.id))) { bump("circles:already"); continue; }
    if (!users.has(String(c.owner_id))) {
      note("circles", c.id, "owner_has_no_users_row"); bump("circles:skipped"); continue;
    }
    const newId = crypto.randomUUID();
    pairs.push([c.id, newId]);
    if (!APPLY) { bump("circles:would_write"); continue; }
    try {
      await tgt(
        `INSERT INTO circles (id, owner_id, name, color, created_at, updated_at,
           deleted_at, description, classified_kind, classified_fact, classified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [newId, c.owner_id, c.name, c.color, c.created_at, c.updated_at, c.deleted_at,
         c.description, c.classified_kind, c.classified_fact, c.classified_at],
      );
      bump("circles:written");
    } catch (e) { note("circles", c.id, "insert_failed", { code: e.code }); bump("circles:skipped"); pairs.pop(); }
  }
  await recordMap("circles", pairs);
}

/**
 * CIRCLE MEMBERSHIP. Both ids remap, and the surrogate id is dropped -- the new
 * primary key is (circle_id, contact_id), which is what the row always meant.
 */
async function phaseCircleMembers() {
  const circles = await loadMap("circles");
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM circle_members ORDER BY id`);
  bump("circle_members:read", rows.length);
  for (const m of rows) {
    const cir = circles.get(String(m.circle_id));
    const con = contacts.get(String(m.contact_id));
    if (!cir || !con) {
      note("circle_members", m.id, !cir ? "circle_not_migrated" : "contact_not_migrated");
      bump("circle_members:skipped"); continue;
    }
    if (!APPLY) { bump("circle_members:would_write"); continue; }
    const r = await tgt(
      `INSERT INTO circle_members (circle_id, contact_id, owner_id, added_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT (circle_id, contact_id) DO NOTHING`,
      [cir, con, m.owner_id, m.added_at],
    ).catch((e) => { note("circle_members", m.id, "insert_failed", { code: e.code }); return null; });
    if (r?.rowCount) bump("circle_members:written"); else if (r) bump("circle_members:duplicate");
  }
}

/**
 * FAVORITES. owner_id text -> uuid and contact_id TEXT -> uuid: the old column
 * held the bigserial rendered as a string, so a non-numeric value is possible and
 * two of them were found in testing. Keeps its bigserial id.
 */
async function phaseFavorites() {
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM contact_favorites ORDER BY id`);
  bump("favorites:read", rows.length);
  let maxId = 0;
  for (const f of rows) {
    const con = contacts.get(String(f.contact_id));
    if (!con) { note("contact_favorites", f.id, "contact_not_migrated"); bump("favorites:skipped"); continue; }
    if (!UUID_RE.test(String(f.owner_id ?? ""))) {
      note("contact_favorites", f.id, "owner_id_not_uuid"); bump("favorites:skipped"); continue;
    }
    maxId = Math.max(maxId, Number(f.id));
    if (!APPLY) { bump("favorites:would_write"); continue; }
    const r = await tgt(
      `INSERT INTO contact_favorites (id, owner_id, contact_id, tags, position, created_at)
       VALUES ($1,$2::uuid,$3,$4::text[],$5,$6)
       ON CONFLICT (owner_id, contact_id) DO NOTHING`,
      [f.id, f.owner_id, con, f.tags ?? [], f.position, f.created_at],
    ).catch((e) => { note("contact_favorites", f.id, "insert_failed", { code: e.code }); return null; });
    if (r?.rowCount) bump("favorites:written"); else if (r) bump("favorites:duplicate");
  }
  if (APPLY && maxId > 0) {
    await tgt(`SELECT setval(pg_get_serial_sequence('contact_favorites','id'), $1)`, [maxId]);
  }
}

/**
 * CONTACT EMBEDDINGS ARE NOT MIGRATED, AND THE PHASE THAT TRIED IS DELETED.
 *
 * It failed on all 13 rows in the live run, and it was right to. The old vectors
 * are 2560 dimensions from Perplexity (src/lib/embeddings.js:
 * PERPLEXITY_EMBEDDING_DIMS || 2560). The new column is halfvec(1536) filled by
 * OpenAI text-embedding-3-small. Those are different models, not different
 * shapes: there is no reshape, truncation or projection that turns one into a
 * valid vector in the other's space. A migrated vector would be a number that
 * looks like an embedding and means nothing, which is worse than an absent one --
 * absent, contact-vectors.js simply re-embeds the card.
 *
 * 13 rows. They regenerate on the next pass. The comment stays so nobody adds the
 * phase back.
 */

/**
 * VOICE VOCABULARY. The table that started this whole audit.
 *
 * Old: (owner_id text, term, term_key, hits). New: (owner_id uuid, heard,
 * corrected_to, hit_count) keyed on (owner_id, heard). `term_key` was the
 * normalized form the recognizer produced and `term` the corrected spelling, so
 * heard = term_key and corrected_to = term. A row where they are equal is a bare
 * term the user taught us to recognize, which is exactly how voice-vocab.js
 * stores one today.
 */
async function phaseVoiceVocab() {
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM voice_vocabulary`);
  bump("voice_vocabulary:read", rows.length);
  for (const v of rows) {
    if (!UUID_RE.test(String(v.owner_id ?? ""))) {
      note("voice_vocabulary", null, "owner_id_not_uuid"); bump("voice_vocabulary:skipped"); continue;
    }
    const heard = (v.term_key ?? v.term ?? "").trim();
    const corrected = (v.term ?? v.term_key ?? "").trim();
    if (!heard || !corrected) { note("voice_vocabulary", null, "empty_term"); bump("voice_vocabulary:skipped"); continue; }
    // A contact link only survives if the contact did; the FK is composite.
    const con = v.contact_id != null ? (contacts.get(String(v.contact_id)) ?? null) : null;
    if (v.contact_id != null && !con) note("voice_vocabulary", null, "contact_not_migrated");
    if (!APPLY) { bump("voice_vocabulary:would_write"); continue; }
    const r = await tgt(
      `INSERT INTO voice_vocabulary (owner_id, heard, corrected_to, hit_count, contact_id, updated_at)
       VALUES ($1::uuid,$2,$3,$4,$5,$6)
       ON CONFLICT (owner_id, heard) DO NOTHING`,
      [v.owner_id, heard, corrected, v.hits ?? 1, con, v.updated_at],
    ).catch((e) => { note("voice_vocabulary", null, "insert_failed", { code: e.code }); return null; });
    if (r?.rowCount) bump("voice_vocabulary:written"); else if (r) bump("voice_vocabulary:duplicate");
  }
}

/**
 * CONNECTIONS. (user_a, user_b) -> (a_amber_id, b_amber_id) with the pair ORDERED,
 * because the new table has CHECK (a_amber_id < b_amber_id) and a primary key on
 * the pair. The old table carries the same CHECK, so the pair arrives ordered
 * already -- the sort here is belt and braces, and it costs nothing.
 *
 * Status becomes 'active'. The old table had no status column at all: a row
 * existed or it did not, and one that existed meant the two were connected.
 */
async function phaseConnections() {
  const { rows } = await src(`SELECT * FROM connections ORDER BY id`);
  bump("connections:read", rows.length);
  const { rows: userRows } = await tgt(`SELECT amber_id FROM users`);
  const users = new Set(userRows.map((r) => String(r.amber_id)));
  for (const id of projectedUsers) users.add(id);

  for (const c of rows) {
    // A connection somebody removed stays removed. The new table has no
    // deleted_at -- status carries that meaning -- so a soft-deleted row would
    // otherwise come back as 'active'.
    if (c.deleted_at) { bump("connections:deleted"); continue; }
    const a = String(c.user_a), b = String(c.user_b);
    if (a === b) { note("connections", c.id, "self_connection"); bump("connections:skipped"); continue; }
    if (!users.has(a) || !users.has(b)) {
      note("connections", c.id, "user_has_no_users_row"); bump("connections:skipped"); continue;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!APPLY) { bump("connections:would_write"); continue; }
    const r = await tgt(
      `INSERT INTO connections (a_amber_id, b_amber_id, status, established_at)
       VALUES ($1,$2,'active',$3) ON CONFLICT (a_amber_id, b_amber_id) DO NOTHING`,
      [lo, hi, c.created_at],
    ).catch((e) => { note("connections", c.id, "insert_failed", { code: e.code }); return null; });
    if (r?.rowCount) bump("connections:written"); else if (r) bump("connections:duplicate");
  }
}

/**
 * NAME MEMORY. "when I say Maggie I mean this card". owner_id was already uuid.
 *
 * The old column is `current_contact_id` and it is TEXT -- the bigserial rendered
 * as a string -- while the new one is `contact_id uuid`. A rename AND a retype on
 * the same column, which is exactly the pair cutover-survey warns about, and the
 * kind of thing a migration written from the new schema alone gets silently
 * wrong: reading n.contact_id here returns undefined and every row is skipped as
 * an orphan, with a clean-looking report.
 */
async function phaseNameMemory() {
  const contacts = await loadMap("contacts");
  const { rows } = await src(`SELECT * FROM contact_name_memory`);
  bump("contact_name_memory:read", rows.length);
  for (const n of rows) {
    const con = contacts.get(String(n.current_contact_id));
    if (!con) { note("contact_name_memory", null, "contact_not_migrated"); bump("contact_name_memory:skipped"); continue; }
    if (!APPLY) { bump("contact_name_memory:would_write"); continue; }
    const r = await tgt(
      `INSERT INTO contact_name_memory (owner_id, name_key, contact_id, stable_streak, last_confirmed_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (owner_id, name_key) DO NOTHING`,
      [n.owner_id, n.name_key, con, n.stable_streak ?? 0, n.last_confirmed_at],
    ).catch((e) => { note("contact_name_memory", null, "insert_failed", { code: e.code }); return null; });
    if (r?.rowCount) bump("contact_name_memory:written"); else if (r) bump("contact_name_memory:duplicate");
  }
}

const PHASES = [
  ["users", phaseUsers],
  ["contacts", phaseContacts],
  ["identity_keys", phaseIdentityKeys],
  ["sources", phaseSources],
  ["observations", phaseObservations],
  ["circles", phaseCircles],
  ["circle_members", phaseCircleMembers],
  ["favorites", phaseFavorites],
  ["voice_vocabulary", phaseVoiceVocab],
  ["connections", phaseConnections],
  ["name_memory", phaseNameMemory],
];

// ── verification ──────────────────────────────────────────────────────────────

/**
 * Counts on both sides, and the question that actually matters: did the six
 * dimensions get populated? A cutover that moves every row and leaves every
 * observation unclassified has not achieved the thing it was for.
 */
async function verify() {
  console.log(`\n  VERIFY\n`);
  const [{ obs, dims, classified, pending, nodim, participants }] = (await tgt(
    `SELECT (SELECT count(*)::int FROM observations WHERE deleted_at IS NULL) AS obs,
            (SELECT count(*)::int FROM observation_dimensions) AS dims,
            (SELECT count(*)::int FROM observations WHERE dimension_status IN ('lexicon','llm','human')) AS classified,
            (SELECT count(*)::int FROM observations WHERE dimension_status = 'pending') AS pending,
            (SELECT count(*)::int FROM observations WHERE dimension_status = 'none') AS nodim,
            (SELECT count(*)::int FROM observation_participants) AS participants`)).rows;

  console.log(`    ${"observations".padEnd(34, ".")} ${pad(obs, 8)}`);
  console.log(`    ${"observation_participants".padEnd(34, ".")} ${pad(participants, 8)}`);
  console.log(`    ${"observation_dimensions".padEnd(34, ".")} ${pad(dims, 8)}   dimension rows written`);
  console.log(`    ${"  settled by the lexicon".padEnd(34, ".")} ${pad(classified, 8)}   confident, nothing more to do`);
  console.log(`    ${"  pending — BEST GUESS ALREADY WRITTEN".padEnd(34)} ${pad(pending, 8)}`);
  console.log(`    ${"".padEnd(34)}          the lexicon was unsure, so these carry its guess and`);
  console.log(`    ${"".padEnd(34)}          wait for the model. scripts/dimension-worker.js settles`);
  console.log(`    ${"".padEnd(34)}          them; until it runs they already score, just less well.`);
  console.log(`    ${"  no dimension applies".padEnd(34, ".")} ${pad(nodim, 8)}`);

  const [{ undim }] = (await tgt(
    `SELECT count(*)::int AS undim FROM observations o
      WHERE o.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM observation_dimensions od
                         WHERE od.observation_id = o.observation_id AND od.suppressed = false)`)).rows;
  console.log(`    ${"  WITH NO DIMENSION AT ALL".padEnd(34, ".")} ${pad(undim, 8)}   these contribute nothing to any score`);

  const { rows: byDim } = await tgt(
    `SELECT d.code, count(od.*)::int AS n
       FROM dimensions d
       LEFT JOIN observation_dimensions od ON od.dimension_id = d.dimension_id
                                          AND od.suppressed = false
      GROUP BY d.code, d.sort_order ORDER BY d.sort_order`);
  console.log(`\n    THE SIX DIMENSIONS, as populated:\n`);
  for (const r of byDim) console.log(`      ${r.code.padEnd(16, ".")} ${pad(r.n, 7)} observation(s)`);

  const [{ future }] = (await tgt(
    `SELECT count(*)::int AS future FROM observations
      WHERE observed_at > now() - interval '1 minute' AND deleted_at IS NULL`)).rows;
  if (future > 0) {
    console.log(`\n    ⚠ ${future} observation(s) are dated NOW. If these are migrated rows,`);
    console.log(`      observed_at did not carry over and every recency score is wrong.`);
  }

  // The structural tables: not scored, but their absence is what makes an app
  // look broken to a user who had circles and favorites yesterday.
  const { rows: struct } = await tgt(
    `SELECT 'circles' AS t, count(*)::int AS n FROM circles
      UNION ALL SELECT 'circle_members', count(*)::int FROM circle_members
      UNION ALL SELECT 'contacts', count(*)::int FROM contacts
      UNION ALL SELECT 'contact_identity_keys', count(*)::int FROM contact_identity_keys
      UNION ALL SELECT 'contact_sources', count(*)::int FROM contact_sources
      UNION ALL SELECT 'contact_favorites', count(*)::int FROM contact_favorites
      UNION ALL SELECT 'contact_embedding', count(*)::int FROM contact_embedding
      UNION ALL SELECT 'contact_name_memory', count(*)::int FROM contact_name_memory
      UNION ALL SELECT 'voice_vocabulary', count(*)::int FROM voice_vocabulary
      UNION ALL SELECT 'connections', count(*)::int FROM connections
      UNION ALL SELECT 'users', count(*)::int FROM users
      ORDER BY 1`);
  console.log(`\n    WHAT LANDED:\n`);
  for (const r of struct) console.log(`      ${r.t.padEnd(26, ".")} ${pad(r.n, 8)}`);

  const { rows: rev } = await tgt(
    `SELECT source_table, reason, count(*)::int AS n
       FROM cutover_review GROUP BY source_table, reason ORDER BY n DESC`);
  if (rev.length) {
    console.log(`\n    NOT MIGRATED — every one recorded, none dropped silently:\n`);
    for (const r of rev) console.log(`      ${`${r.source_table} / ${r.reason}`.padEnd(48, ".")} ${pad(r.n, 7)}`);
  } else {
    console.log(`\n    cutover_review is empty: everything crossed.`);
  }

  // Named out loud, so "where are my notes" is answered by the tool rather than
  // by someone reading the source six weeks from now.
  console.log(`\n    LEFT BEHIND ON PURPOSE: app_conversation_messages,`);
  console.log(`    conversation_messages, note_audio, note_shares, note_comments and`);
  console.log(`    note_reactions. Test-period chat and voice traffic, not onboarded`);
  console.log(`    user data. See the header.`);
}

// ── run ───────────────────────────────────────────────────────────────────────
let exitCode = 0;
try {
  const [{ tdb }] = (await tgt(`SELECT current_database() AS tdb`)).rows;
  const [{ sdb }] = (await src(`SELECT current_database() AS sdb`)).rows;

  console.log(`\n  ${APPLY ? "CUTOVER" : "DRY RUN"} — "${sdb}" -> "${tdb}"\n`);
  if (sdb === tdb) {
    console.error(
      `  ✗ Source and target are both "${sdb}". Refusing.\n\n` +
      `  --from names the OLD database to READ. The target is whatever AMBER_SQL_DB\n` +
      `  points at, and yours points at the same one, so this would have read and\n` +
      `  written the same rows.\n\n` +
      `  Point the target somewhere else for the run:\n\n` +
      `      railway run env AMBER_SQL_DB=amber_next node scripts/cutover.js --from ${sdb}\n\n` +
      `  The new schema lives in amber_next. Once the cutover verifies, the last step\n` +
      `  is renaming the databases so the live one is called "amber" again -- the\n` +
      `  app's connection string never changes, and the old data stays as a rollback.\n`,
    );
    process.exit(2);
  }
  const [{ ready }] = (await tgt(
    `SELECT to_regclass('public.cutover_map') IS NOT NULL AS ready`)).rows;
  if (!ready) {
    console.error(`  ✗ "${tdb}" has no cutover_map. Run the migrations first.\n`);
    process.exit(2);
  }

  if (!VERIFY_ONLY) {
    for (const [name, fn] of PHASES) {
      if (ONLY_PHASE && ONLY_PHASE !== name) continue;
      const t0 = Date.now();
      process.stdout.write(`  ${name.padEnd(16)}`);
      await fn();
      console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    if (APPLY && review.length) {
      // A RESUMED RUN MUST NOT RE-ACCUSE THE SAME ROW. The review table is a work
      // list, and a work list that triples every time you re-run the migration is
      // one nobody reads. Same (table, id, reason) is the same finding.
      await tgt(
        `INSERT INTO cutover_review (source_table, old_id, reason, detail)
         SELECT v.* FROM unnest($1::text[], $2::bigint[], $3::text[], $4::jsonb[])
                      AS v(source_table, old_id, reason, detail)
          WHERE NOT EXISTS (
            SELECT 1 FROM cutover_review r
             WHERE r.source_table = v.source_table
               AND r.reason = v.reason
               AND r.old_id IS NOT DISTINCT FROM v.old_id)`,
        [review.map((r) => r.source_table), review.map((r) => r.old_id),
         review.map((r) => r.reason), review.map((r) => JSON.stringify(r.detail))],
      );
    }

    console.log(`\n  COUNTS\n`);
    for (const k of Object.keys(stats).sort()) {
      console.log(`    ${k.padEnd(38, ".")} ${pad(stats[k], 8)}`);
    }

    if (unmappedSources.size) {
      console.log(`\n  UNRECOGNISED source VALUES — no scoring_params row named`);
      console.log(`  'source_<name>', so contact_dimension_state scores each of these 0.5,`);
      console.log(`  silently and forever. Give them weights in a migration (see 027)`);
      console.log(`  rather than renaming them: source records WHERE a fact entered,`);
      console.log(`  scoring_params records how much that entry point is trusted.\n`);
      for (const [s, n] of [...unmappedSources].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${s.padEnd(30, ".")} ${pad(n, 7)} row(s)`);
      }
    }

    if (!APPLY) {
      console.log(`\n  Nothing was written. Re-run with --apply.\n`);
    }
  }

  if (APPLY || VERIFY_ONLY) await verify();
  console.log("");
} catch (err) {
  console.error("\n  ✗ cutover failed:", err?.stack || err?.message || err, "\n");
  exitCode = 1;
} finally {
  await closeTarget().catch(() => {});
  await srcPool.end().catch(() => {});
  srcPool.__connector?.close?.();
}

process.exit(exitCode);
