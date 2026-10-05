#!/usr/bin/env bash
# `people texts <name>` must answer "read my texts with X" in one call.
#
# On 2026-10-05 it took eight. Three bugs, each pinned here:
# - ORDER BY ASC LIMIT kept the oldest rows, so the newest message was the one
#   dropped. 310 rows against the default limit of 300 reproduces it.
# - LIKE on the thread name pulled "Jake Gavin's Friend" into Gavin's log.
# - bodies were cut at 100 characters; the message that mattered was 1,400.
# Plus: five people named Gavin, so the reader has to pick the one texted
# most recently instead of refusing.
set -uo pipefail
P="${1:?path to bin/people}"
DB="${PEOPLE_DIR:?PEOPLE_DIR must be set}/people.db"

for n in "Gavin Munroe" "Gavin Chow" "Jake Gavin's Friend"; do "$P" add "$n" >/dev/null 2>&1; done
id() { sqlite3 "$DB" "SELECT id FROM people WHERE name='$1'"; }
MUNROE="$(id 'Gavin Munroe')"; CHOW="$(id 'Gavin Chow')"; JAKE="$(id "Jake Gavin''s Friend")"

LONG="$(printf 'x%.0s' $(seq 1 300))TAILMARK"
sqlite3 "$DB" "
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 310)
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at)
  SELECT 900000+i, '$MUNROE', 'Gavin Munroe', '+15550001', 0, 'filler ' || i,
         datetime('now', '-' || (i + 1) || ' hours') FROM n;
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at) VALUES (990001, '$MUNROE', 'Gavin Munroe', '+15550001', 0, 'NEWEST', datetime('now','-1 minute'));
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at) VALUES (990002, '$MUNROE', 'Gavin Munroe', '+15550001', 0, '$LONG', datetime('now','-2 minute'));
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at) VALUES (990003, '$JAKE', 'Jake Gavin''s Friend', '+15550002', 0, 'JAKELINE', datetime('now','-3 minute'));
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at) VALUES (990004, '$CHOW', 'Gavin Chow', '+15550003', 0, 'CHOWLINE', datetime('now','-30 day'));"

fail() { echo "$1" >&2; printf '%s\n' "$out" | tail -5 >&2; exit 1; }

out="$("$P" texts gavin 2>&1)"
grep -q "= Gavin Munroe" <<<"$out"  || fail "did not resolve gavin to the most recently texted Gavin"
grep -q "NEWEST" <<<"$out"          || fail "newest message dropped (limit kept the oldest rows)"
grep -q "TAILMARK" <<<"$out"        || fail "long message truncated for a single-person read"
grep -q "JAKELINE" <<<"$out"        && fail "another person's thread leaked in by name match"
grep -q "CHOWLINE" <<<"$out"        && fail "a different Gavin's messages leaked in"

out="$("$P" texts --days 30 --who gavin 2>&1)"
grep -q "NEWEST" <<<"$out"          || fail "--days with --who still drops the newest message"
exit 0
