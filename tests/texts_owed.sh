#!/usr/bin/env bash
# `people texts owed` must answer "who am I leaving on read" in one fast call,
# and `people texts drafts` must hold replies across tabs and send only by number.
#
# On 2026-10-09 "clear out my texts" took eleven tool calls: a sync that hit the
# timeout, chat.db queries that returned nothing, a WAL database that refused a
# read-only open, then 25 threads read one at a time. The drafts that came out
# of it lived only in that chat, so "save this for tmr" had nowhere to go.
set -uo pipefail
export CHEWBACCA_NO_SEND=1
P="${1:?path to bin/people}"
DB="${PEOPLE_DIR:?PEOPLE_DIR must be set}/people.db"

"$P" add "Owed Olive" >/dev/null 2>&1; "$P" add "Answered Andy" >/dev/null 2>&1
id() { sqlite3 "$DB" "SELECT id FROM people WHERE name='$1'"; }
OLIVE="$(id 'Owed Olive')"; ANDY="$(id 'Answered Andy')"
sqlite3 "$DB" "
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source, room) VALUES
   (770001, '$OLIVE', 'Owed Olive', '+15550201', 1, 'u around?', datetime('now','-3 hour'), 'imessage', NULL),
   (770002, '$OLIVE', 'Owed Olive', '+15550201', 0, 'OLIVEASKS how are you', datetime('now','-2 hour'), 'imessage', NULL),
   (770003, '$ANDY', 'Answered Andy', '+15550202', 0, 'ANDYQ', datetime('now','-2 hour'), 'imessage', NULL),
   (770004, '$ANDY', 'Answered Andy', '+15550202', 1, 'ANDYREPLIED', datetime('now','-1 hour'), 'imessage', NULL),
   (770005, NULL, 'Group Gal', 'chat1', 0, 'GROUPASK anyone allergic', datetime('now','-1 hour'), 'imessage', 'Den Group'),
   (770006, NULL, '+19165550000', '+19165550000', 0, 'SPAMVOTE vote yes', datetime('now','-1 hour'), 'imessage', NULL),
   (770007, '$OLIVE', 'Owed Olive', '+15550201', 0, 'ANCIENTASK', datetime('now','-40 day'), 'imessage', NULL),
   (770008, NULL, 'Den Group', 'chatDEN42', 1, 'earlier from me', datetime('now','-5 hour'), 'imessage', 'Den Group'),
   (20000000101, NULL, 'Wa Crew', '1203630000@g.us', 1, 'yo', datetime('now','-5 hour'), 'whatsapp', 'Wa Crew'),
   (770009, NULL, 'Paul', 'chatPAUL1', 1, 'a', datetime('now','-5 hour'), 'imessage', 'Paul'),
   (20000000102, NULL, 'Paul', '1203639999@g.us', 1, 'b', datetime('now','-5 hour'), 'whatsapp', 'Paul');"
# A stand-in chat.db: the GUID has to be read from it, never built.
export CHEWBACCA_CHAT_DB="$PEOPLE_DIR/chat.db"
sqlite3 "$CHEWBACCA_CHAT_DB" "CREATE TABLE chat (guid TEXT, chat_identifier TEXT); INSERT INTO chat VALUES ('any;+;chatDEN42', 'chatDEN42');"

fail() { echo "$1" >&2; printf '%s\n' "$out" | tail -8 >&2; exit 1; }

out="$("$P" texts owed 2>&1)"
grep -q "OLIVEASKS" <<<"$out"   || fail "a thread whose last message is theirs was not listed"
grep -q "u around" <<<"$out"    || fail "owed did not show the context before their message"
grep -q "ANDYQ" <<<"$out"       && fail "a thread already answered was listed as owed"
grep -q "Den Group" <<<"$out"   || fail "a group waiting on a reply was not listed under the group name"
grep -q "Group:" <<<"$out"      || fail "group lines did not name who said them"
grep -q "SPAMVOTE" <<<"$out"    && fail "an unsaved number was printed without --all"
grep -q "1 unsaved" <<<"$out"   || fail "hidden unsaved numbers were not counted"
grep -q "ANCIENTASK" <<<"$out"  && fail "a message outside the window leaked in"
out="$("$P" texts owed --json 2>&1)"
python3 -c 'import json,sys; d=json.load(sys.stdin); t={x["thread"]:x for x in d["threads"]}; assert t["Den Group"]["group"] and t["Owed Olive"]["messages"][-1]["body"].startswith("OLIVEASKS")' <<<"$out" || fail "--json is not the owed list as data"
out="$("$P" texts owed --all 2>&1)"
grep -q "SPAMVOTE" <<<"$out"    || fail "--all did not show unsaved numbers"

out="$("$P" texts drafts 2>&1)"
grep -q "no drafts" <<<"$out"   || fail "empty queue did not say so"
"$P" texts drafts add "owed olive" "Doing good! hbu" --why "how are you" >/dev/null || fail "draft add failed"
"$P" texts drafts add "Den Group" "No allergies here" --group >/dev/null || fail "group draft add failed"
out="$("$P" texts drafts 2>&1)"
grep -q "#1" <<<"$out" && grep -q "Doing good! hbu" <<<"$out" || fail "drafts did not list what was saved"
grep -q "re: how are you" <<<"$out" || fail "the reason a draft exists was lost"
out="$("$P" texts drafts send 2 --dry-run 2>&1)" || fail "a group draft did not dry-run"
grep -q "any;+;chatDEN42" <<<"$out" || fail "group draft did not resolve to the chat GUID read from chat.db"
out="$("$P" texts drafts send 2 2>&1)" && fail "CHEWBACCA_NO_SEND did not stop a group send"
out="$("$P" texts drafts 2>&1)"
grep -q "No allergies" <<<"$out" || fail "a refused group send still removed the draft"

# Group sends: exact room name, room id never a member, ambiguity refused.
out="$("$P" send --room "den group" "hi" --dry-run 2>&1)" || fail "room send by name failed"
grep -q "group via imessage, any;+;chatDEN42" <<<"$out" || fail "room send did not name the GUID"
out="$("$P" send --room "Den" "hi" --dry-run 2>&1)" && fail "a partial room name was allowed"
out="$("$P" send --room "Wa Crew" "hi" --dry-run 2>&1)" || fail "WhatsApp room failed"
grep -q "1203630000@g.us" <<<"$out" || fail "WhatsApp room did not use the group JID"
out="$("$P" send --room "Paul" "hi" --dry-run 2>&1)" && fail "a room name two apps share was not refused"
grep -q "Pick one with --via" <<<"$out" || fail "shared room name did not say how to choose"
out="$("$P" send --room "Paul" "hi" --via whatsapp --dry-run 2>&1)" || fail "--via did not pick the room"
grep -q "1203639999@g.us" <<<"$out" || fail "--via picked the wrong Paul"
out="$("$P" send "Paul" "hi" --room --dry-run 2>&1)" && fail "flag-last form ignored --via ambiguity"

out="$("$P" texts drafts send 1 --dry-run 2>&1)" || fail "dry-run send of a draft failed"
grep -q "+15550201" <<<"$out"   || fail "draft send did not resolve to Olive's exact address"
out="$("$P" texts drafts 2>&1)"
grep -q "Doing good" <<<"$out"  || fail "a dry run removed the draft"
"$P" texts drafts drop 1 >/dev/null || fail "drop failed"
out="$("$P" texts drafts 2>&1)"
grep -q "Doing good" <<<"$out"  && fail "dropped draft is still listed"
grep -q "No allergies" <<<"$out" || fail "drop removed the wrong draft"
out="$("$P" texts drafts send 9 2>&1)" && fail "a missing draft number did not refuse"
exit 0
