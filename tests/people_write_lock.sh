#!/usr/bin/env bash
# Every write transaction in the people store must be BEGIN IMMEDIATE.
#
# On 2026-10-09 `people texts sync` died with "database is locked" while
# another sync ran, despite busy_timeout 15000. A deferred BEGIN reads first;
# when another connection commits in between, SQLite refuses the upgrade to a
# write at once (SQLITE_BUSY_SNAPSHOT) and never calls the busy handler.
# BEGIN IMMEDIATE takes the write lock up front, so it waits instead.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# The mechanism, so the rule below has its reason on record.
cat > "$T/r.js" <<'JS'
const { DatabaseSync } = require("node:sqlite");
const [f, mode] = process.argv.slice(2);
const mk = () => { const d = new DatabaseSync(f); d.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000"); return d; };
const a = mk(); a.exec("CREATE TABLE IF NOT EXISTS t (x)"); const b = mk();
try { b.exec(mode); b.prepare("SELECT count(*) FROM t").get();
  if (mode === "BEGIN") a.exec("INSERT INTO t VALUES (1)");
  b.exec("INSERT INTO t VALUES (2)"); b.exec("COMMIT"); console.log("ok"); }
catch (e) { console.log("locked"); }
JS
[ "$(node "$T/r.js" "$T/a.db" BEGIN 2>/dev/null)" = locked ] || { echo "deferred BEGIN no longer reproduces the lock; recheck this test" >&2; exit 1; }
[ "$(node "$T/r.js" "$T/b.db" "BEGIN IMMEDIATE" 2>/dev/null)" = ok ] || { echo "BEGIN IMMEDIATE failed to write" >&2; exit 1; }

bad="$(grep -rnE 'exec\("BEGIN( DEFERRED)?"\)' "$ROOT/bin/lib/people" || true)"
[ -z "$bad" ] || { echo "deferred write transaction in the people store:" >&2; echo "$bad" >&2; exit 1; }
exit 0
