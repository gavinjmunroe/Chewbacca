// @ts-nocheck
// One SQLite file for the state tabs race on: the Node half of
// bin/lib/statedb.py. Same file, same rules, same tables. Read that file's
// header for why (10 tabs adding 50 drafts at once lost 19 to 22 of them).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

// Same wait as statedb.py's BUSY_MS; the number that set it is there.
const BUSY_MS = 30000;

// Same rule as statedb.py's path_for, whose header says why: the shared file
// only for the store's exact default folder, found from HOME.
function home() {
  return path.join(os.homedir(), ".chewbacca");
}

function pathFor(storeDir, name) {
  if (process.env.CHEWBACCA_STATE_DB) return process.env.CHEWBACCA_STATE_DB;
  let isDefault = false;
  try {
    isDefault = fs.realpathSync(storeDir) === fs.realpathSync(path.join(home(), name));
  } catch {}
  return isDefault
    ? path.join(home(), "state.sqlite")
    : path.join(storeDir, ".state.sqlite");
}

// WAL is a property of the file, so once set it stays. Switching to it is the
// one step SQLite's busy wait doesn't cover (12 processes opening a fresh file
// at once, 1 died on "database is locked", 10/12), so it retries until another
// opener has done it.
function wal(db) {
  const deadline = Date.now() + BUSY_MS;
  for (;;) {
    try {
      if (db.prepare("PRAGMA journal_mode").get().journal_mode === "wal") return;
      db.exec("PRAGMA journal_mode = WAL");
      return;
    } catch (e) {
      if (Date.now() > deadline || !/locked|busy/i.test(String(e.message))) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function connect(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = process.umask(0o077);
  try {
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout = ${BUSY_MS}`);
    wal(db);
    db.exec(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, mirror_ns INTEGER);
             CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    return db;
  } finally {
    process.umask(previous);
  }
}

// One writer at a time, from the first read to the commit.
function write(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function getDoc(db, name) {
  const row = db.prepare("SELECT body FROM docs WHERE name = ?").get(name);
  return row ? JSON.parse(row.body) : undefined;
}

function putDoc(db, name, value) {
  db.prepare("INSERT OR REPLACE INTO docs (name, body) VALUES (?, ?)").run(
    name,
    JSON.stringify(value),
  );
}

// A JSON mirror for readers, private, renamed into place from this process's
// own tmp file: a shared `.tmp` let one tab rename another's file away and
// crash.
function mirror(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = {
  BUSY_MS,
  home,
  pathFor,
  connect,
  write,
  getDoc,
  putDoc,
  mirror,
};
