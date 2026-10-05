// @ts-nocheck
// people store: opening the SQLite file under $PEOPLE_DIR, migrations and
// seeds on every open, scoring params, ids, timestamps, and sync_state.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { die } = require("./output");
const {
  SCHEMA, SEED_DIMENSIONS, SEED_PARAMS, SCHEMA_V3, SCHEMA_V2, SCHEMA_V4, SCHEMA_V5, SEED_TEMPLATE,
} = require("./schema");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  die(
    "This needs Node 22.5 or newer (node:sqlite).\n" +
      `You are on ${process.version}. Try: brew upgrade node`,
  );
}

const HOME = os.homedir();
const DIR = process.env.PEOPLE_DIR || path.join(HOME, ".chewbacca", "people");
const DB_PATH = path.join(DIR, "people.db");

// ---------------------------------------------------------------- db

let _db = null;
function db() {
  if (_db) return _db;
  fs.mkdirSync(DIR, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA journal_mode = WAL");
  // Without this, ANY contention throws SQLITE_BUSY on the spot instead of
  // waiting. WAL lets readers and a writer coexist, but two writers still take
  // turns, and a long `events scan` plus the user running `people show` in
  // another terminal is two writers. A multi-hour scan died on exactly that.
  _db.exec("PRAGMA busy_timeout = 15000");
  _db.exec(SCHEMA);
  migrate(_db);
  seed(_db);
  return _db;
}

// Columns added after someone already has a database. CREATE TABLE IF NOT
// EXISTS will not add them, and a missing column is a crash rather than a
// degraded feature, so this runs on every open. It is cheap and idempotent.
function ensureColumn(d, table, column, decl) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
}

function migrate(d) {
  ensureColumn(d, "people", "cadence_days", "cadence_days INTEGER");
  ensureColumn(d, "people", "source", "source TEXT");
  ensureColumn(d, "people", "external_id", "external_id TEXT");
  // An event-driven override on top of cadence. Cadence answers "how often",
  // this answers "because something is happening to them in November".
  ensureColumn(d, "people", "next_check_at", "next_check_at TEXT");
  ensureColumn(d, "people", "next_check_reason", "next_check_reason TEXT");
  // MUTED IS NOT DELETED. An ex you archived, a shortcode, a service number,
  // a landline that once got an auto-observation: all real rows worth keeping
  // and all wrong to be nudged about. Deleting them loses the message history,
  // so they get excluded from reconnect and ranking instead.
  ensureColumn(d, "people", "muted_at", "muted_at TEXT");
  ensureColumn(d, "people", "muted_reason", "muted_reason TEXT");
  ensureColumn(d, "people", "linkedin", "linkedin TEXT");
  // The date LinkedIn stamped on the connection. Its own column because
  // how_we_met gets overwritten the moment a contact card matches ("USC"),
  // and this is the only field in an export that the member cannot edit.
  ensureColumn(d, "people", "li_connected_on", "li_connected_on TEXT");
  // Per-person, not one global watermark. A run that dies halfway through a
  // rate limit used to throw away everything it had already paid for.
  ensureColumn(d, "people", "distilled_at", "distilled_at TEXT");
  // WHAT THEY GO BY, next to what they are called on paper. A phone contact
  // says "Mike Chung" and LinkedIn says "Michael Chung"; both are correct and
  // neither is the other's typo. Keeping only one loses a real match later:
  // search for the formal name and the contact is invisible, search for the
  // familiar one and the professional record is.
  ensureColumn(d, "people", "nickname", "nickname TEXT");
  // The Apple Contacts row this person came from or was matched to, so a
  // re-sync updates rather than duplicates.
  ensureColumn(d, "people", "apple_contact_id", "apple_contact_id TEXT");
  d.exec(SCHEMA_V2);
  d.exec(SCHEMA_V3);
  d.exec(SCHEMA_V4);
  d.exec(SCHEMA_V5);
  // AFTER the CREATE TABLEs, not before. `messages` is created by SCHEMA_V3, so
  // running this above that exec threw "no such table: messages" on every open
  // of a FRESH database and took every subcommand down with it. An existing
  // database already had the table, which is why it survived this long: the one
  // machine it broke was the one nobody had set up yet.
  //
  // WHERE A MESSAGE CAME FROM. iMessage rows key on chat.db's ROWID; anything
  // imported from elsewhere is offset well past it so one FTS index can cover
  // every channel without the ids colliding.
  ensureColumn(d, "messages", "source", "source TEXT NOT NULL DEFAULT 'imessage'");
  // WHICH ROOM A MESSAGE WAS SAID IN, when it was a group.
  //
  // The sender owns the message and the room is context, not an owner. Keeping
  // both is what lets "Stone Family" stop being a person with 8,571 messages
  // and become eight people who talk in the same thread.
  ensureColumn(d, "messages", "room", "room TEXT");
  seedTemplate(d);
}

function seedTemplate(d) {
  const ins = d.prepare(
    "INSERT INTO quick_fact_template (key, prompt, sort_order) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING",
  );
  for (const row of SEED_TEMPLATE) ins.run(...row);
}

function seed(d) {
  const n = d.prepare("SELECT count(*) AS n FROM dimensions").get().n;
  if (n === 0) {
    const ins = d.prepare(
      "INSERT INTO dimensions (id, code, label, sort_order, half_life_days, base_weight) VALUES (?,?,?,?,?,?)",
    );
    for (const row of SEED_DIMENSIONS) ins.run(...row);
    const w = d.prepare("INSERT INTO dimension_weights (dimension_id, weight) VALUES (?, 1.0)");
    for (const row of SEED_DIMENSIONS) w.run(row[0]);
  }
  const ip = d.prepare(
    "INSERT INTO scoring_params (key, value, note) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING",
  );
  for (const p of SEED_PARAMS) ip.run(...p);
  d.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING",
  ).run();
}

function params() {
  const out = {};
  for (const r of db().prepare("SELECT key, value FROM scoring_params").all()) out[r.key] = r.value;
  return out;
}

const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

function syncState(key, val) {
  const d = db();
  if (val === undefined)
    return (d.prepare("SELECT value FROM sync_state WHERE key=?").get(key) || {}).value;
  d.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, String(val), nowISO());
}

module.exports = {
  DatabaseSync, HOME, DIR, DB_PATH, db, params, uuid, nowISO, daysBetween, syncState,
};
