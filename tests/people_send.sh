#!/usr/bin/env bash
# `people send` must reach the right person through the right app, and refuse
# rather than guess. Every call here is --dry-run: nothing is sent.
#
# On 2026-10-08 the first dry run of `people send dad` resolved to "prestons
# dad", because send borrowed the reader's rule of picking the most recently
# texted match. That rule is fine for reading and wrong for sending.
set -uo pipefail
# Belt and braces: even a send that gets past a broken check cannot leave.
export CHEWBACCA_NO_SEND=1
P="${1:?path to bin/people}"
DB="${PEOPLE_DIR:?PEOPLE_DIR must be set}/people.db"

for n in "Prestons Dad" "Nates Dad" "Sendy Solo"; do "$P" add "$n" >/dev/null 2>&1; done
id() { sqlite3 "$DB" "SELECT id FROM people WHERE name='$1'"; }
SOLO="$(id 'Sendy Solo')"; PRESTON="$(id 'Prestons Dad')"
sqlite3 "$DB" "
  INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) VALUES
   (880001, '$PRESTON', 'Prestons Dad', '+15550101', 0, 'hi', datetime('now','-1 minute'), 'imessage'),
   (880002, '$SOLO', 'Sendy Solo', '+15550102', 0, 'old imsg', datetime('now','-2 day'), 'imessage'),
   (20000000001, '$SOLO', 'Sendy Solo', '+15550102', 0, 'new wa', datetime('now','-1 hour'), 'whatsapp'),
   (20000000002, NULL, 'Group Chat', 'x@g.us', 1, 'grp', datetime('now'), 'whatsapp'),
   (20000000003, NULL, 'Unsaved Jonah', '+12035550100', 0, 'yo', datetime('now','-5 minute'), 'whatsapp');"

fail() { echo "$1" >&2; printf '%s\n' "$out" | tail -5 >&2; exit 1; }

out="$("$P" send dad "x" --dry-run 2>&1)" && fail "an ambiguous name was allowed to send"
grep -q "matches" <<<"$out"                 || fail "ambiguity did not list the candidates"

out="$("$P" send "sendy solo" "x" --dry-run 2>&1)" || fail "dry run failed"
grep -q "via whatsapp, 15550102@s.whatsapp.net" <<<"$out" || fail "did not reply in the app of the latest one-to-one message"

out="$("$P" send "sendy solo" "x" --via imessage --dry-run 2>&1)" || fail "--via dry run failed"
grep -q "via imessage, +15550102" <<<"$out" || fail "--via did not pick that app's thread"

out="$("$P" send "unsaved jonah" "x" --dry-run 2>&1)" || fail "an unsaved thread could not be addressed"
grep -q "via whatsapp, 12035550100@s.whatsapp.net, not a saved contact" <<<"$out" || fail "unsaved WhatsApp thread resolved wrong"

# A thread no card owns was reached through a name its sender chose. It must
# refuse to send unless --to repeats the exact address.
out="$("$P" send "unsaved jonah" "x" 2>&1)" && fail "an unsaved thread sent without --to"
grep -q "Nothing was sent" <<<"$out"        || fail "the refusal did not say nothing was sent"
out="$("$P" send "unsaved jonah" "x" --to 19999999999@s.whatsapp.net 2>&1)" && fail "a mismatched --to was accepted"
grep -q "unconfirmed" <<<"$out"             || fail "a mismatched --to was not refused as unconfirmed"
out="$("$P" send "unsaved jonah" "x" --to 12035550100@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out"       || fail "a matching --to did not reach the dispatcher"

# A WhatsApp stranger whose push name copies a saved contact must not be
# filed under that contact, or send would reach him. Linking is by address.
"$P" add "Sagar Real" >/dev/null 2>&1
"$P" update "sagar real" --phone "+16305550101" >/dev/null 2>&1
SAGAR="$(id 'Sagar Real')"
sqlite3 "$DB" "INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) VALUES
   (2000000000099, '$SAGAR', 'Sagar Real', '+15625550199', 0, 'spoof', datetime('now'), 'whatsapp');"
out="$("$P" send "sagar real" "x" 2>&1)" && fail "a handle that is not on the card was trusted"
grep -q "unconfirmed" <<<"$out"             || fail "a foreign handle on a saved person was not refused"

out="$("$P" send "sendy solo" "x" --via fax 2>&1)" && fail "an unknown app was accepted"

# A foreign number that merely ENDS in a contact's ten digits is not them.
sqlite3 "$DB" "INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) VALUES
   (2000000000098, '$SAGAR', 'Sagar Real', '+9116305550101', 0, 'tail', datetime('now'), 'whatsapp');"
out="$("$P" send "sagar real" "x" --via whatsapp 2>&1)" && fail "a number sharing only the last ten digits was trusted"
grep -q "unconfirmed" <<<"$out"             || fail "a tail-matching foreign number was not refused"

# Mail whose From failed Gmail's own check is filed under "unverified:" plus
# the claimed address (mac/lib/gmail.py). Replying to it would answer whoever
# forged the name, so send refuses it even when --to repeats it exactly.
"$P" add "Mail Sagar" >/dev/null 2>&1
"$P" set "mail sagar" email "sagar@example.test" >/dev/null 2>&1
MAIL="$(id 'Mail Sagar')"
sqlite3 "$DB" "INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) VALUES
   (4000000000097, '$MAIL', 'Mail Sagar', 'unverified:sagar@example.test', 0, 'wire here', datetime('now'), 'email');"
out="$("$P" send "mail sagar" "x" --via email --dry-run 2>&1)" && fail "a dry run to an unverified email sender succeeded"
grep -q "failed Gmail's sender check" <<<"$out" || fail "an unverified email sender was not named as the reason"
out="$("$P" send "mail sagar" "x" --via email --to unverified:sagar@example.test 2>&1)" &&
  fail "--to repeating an unverified email handle was accepted"
grep -q "Nothing was sent" <<<"$out"        || fail "the unverified refusal did not say nothing was sent"

out="$(node -e '
  const { waJid } = require(process.argv[1]);
  console.log([waJid("3106946088"), waJid("+44 7700 900123"), waJid("111@lid")].join(" "));
' "$(dirname "$P")/lib/people/send.js")"
[ "$out" = "13106946088@s.whatsapp.net 447700900123@s.whatsapp.net 111@lid" ] ||
  fail "WhatsApp JIDs built wrong: $out"

# Quiet hours: a person who asked for no direct texts after a time gets none.
# Sagar's own rule (2026-10-11): 11pm weeknights, 7pm Friday and Saturday.
QH="$PEOPLE_DIR/quiet-hours.json"
printf '[{"name":"Sendy Solo","tz":"UTC","after":"00:00","source":"test"}]' >"$QH"
out="$("$P" send "sendy solo" "late one" 2>&1)" && fail "a send inside quiet hours went through"
grep -q "hours they asked not to get a direct text" <<<"$out" || fail "quiet hours refusal did not say why"
out="$("$P" send "sendy solo" "late one" --dry-run 2>&1)" || fail "a dry run inside quiet hours failed"
grep -q "A send now is refused" <<<"$out" || fail "the dry run did not warn about quiet hours"
rm -f "$QH"
out="$("$P" send "sendy solo" "day one" --to 15550102@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" || fail "with no quiet hours the send did not reach the dispatch gate"

# people send asks config/send-policy.cedar (tools/send_policy.py) before it
# sends. A stub policy stands in for the Cedar binary here: a rule only the
# policy knows refuses the send, and a quiet-hours no from the policy holds
# even with no quiet-hours.json for the inline backstop to read. Before
# 2026-10-12 people send never asked, and both went through to dispatch.
STUB="$(mktemp -d)/chewbacca-sendpolicy"
printf '#!/bin/sh\ncat >/dev/null\necho %s\nexit 3\n' \
  "'{\"decision\":\"deny\",\"rules\":[{\"id\":\"test-rule\",\"reason\":\"a rule only the policy has\"}],\"errors\":[]}'" >"$STUB"
chmod +x "$STUB"
out="$(CHEWBACCA_SENDPOLICY="$STUB" "$P" send "sendy solo" "x" --to 15550102@s.whatsapp.net 2>&1)" &&
  fail "a send the policy refused went through"
grep -q "The send policy says no: a rule only the policy has (test-rule)" <<<"$out" ||
  fail "people send did not ask the send policy"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" && fail "a send the policy refused reached the dispatcher"
printf '#!/bin/sh\ncat >/dev/null\necho %s\nexit 3\n' \
  "'{\"decision\":\"deny\",\"rules\":[{\"id\":\"quiet-hours\",\"reason\":\"quiet\"}],\"errors\":[]}'" >"$STUB"
out="$(CHEWBACCA_SENDPOLICY="$STUB" "$P" send "sendy solo" "x" --to 15550102@s.whatsapp.net 2>&1)" &&
  fail "a policy quiet-hours no went through"
grep -q "quiet hours. Nothing was sent" <<<"$out" || fail "the policy's quiet-hours no was not named"
# A deny that names no rule is a reader that broke, never a refusal: the
# inline checks stand and the send reaches dispatch, which NO_SEND holds here.
# Agents send by default (Caleb, 2026-10-12 9:54am).
printf '#!/bin/sh\ncat >/dev/null\necho %s\nexit 3\n' "'{\"decision\":\"deny\",\"rules\":[],\"errors\":[\"boom\"]}'" >"$STUB"
out="$(CHEWBACCA_SENDPOLICY="$STUB" "$P" send "sendy solo" "x" --to 15550102@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" || fail "a broken policy reader refused a send: $out"
printf '#!/bin/sh\nexit 101\n' >"$STUB"
out="$(CHEWBACCA_SENDPOLICY="$STUB" "$P" send "sendy solo" "x" --to 15550102@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" || fail "a crashing policy reader refused a send: $out"
# No binary at all: the inline checks stand alone, exactly as before.
out="$(CHEWBACCA_SENDPOLICY=/nonexistent/chewbacca-sendpolicy "$P" send "sendy solo" "x" --to 15550102@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out" || fail "with no policy binary the send did not reach the dispatch gate"

out="$(node -e '
  const { quietFor } = require(process.argv[1]);
  const r = [{ name: "Sagar Tiwari", tz: "America/Los_Angeles", after: "23:00",
               after_by_day: { Fri: "19:00", Sat: "19:00" } }];
  const at = (iso) => (quietFor("sagar tiwari", new Date(iso), r) ? "Q" : "-");
  console.log([
    at("2026-10-07T05:30:00Z"),  // Tue 22:30 PDT, before 11pm
    at("2026-10-07T06:30:00Z"),  // Tue 23:30 PDT
    at("2026-10-07T13:00:00Z"),  // Wed 06:00 PDT, still the night before
    at("2026-10-07T16:00:00Z"),  // Wed 09:00 PDT
    at("2026-10-10T03:48:00Z"),  // Fri 20:48 PDT, the 10/10 texts were Sat but same rule
    at("2026-10-10T01:00:00Z"),  // Fri 18:00 PDT
    at("2026-10-11T08:00:00Z"),  // Sun 01:00 PDT, after Saturday 7pm
  ].join(""));
' "$(dirname "$P")/lib/people/quiet-hours.js")"
[ "$out" = "-QQ-Q-Q" ] || fail "quiet hours computed wrong: $out"

# --file: a real attachment, checked before anything resolves, and bound into
# the approval by digest. 10/31 Colin's PDF went as a Drive link because send
# took text only.
DOC="$(mktemp -d)/rec.pdf"; printf 'pdf bytes' >"$DOC"
out="$("$P" send "sendy solo" "x" --via imessage --file /nonexistent/rec.pdf --dry-run 2>&1)" && fail "a missing file was accepted"
grep -q "No file at" <<<"$out"              || fail "a missing file was not named"
out="$("$P" send "sendy solo" "here it is" --via imessage --file "$DOC" --dry-run --approval-binding 2>&1)" || fail "a file dry run failed"
grep -q "attach rec.pdf" <<<"$out"          || fail "the dry run did not show the attachment"
SHA="$(shasum -a 256 "$DOC" | cut -c1-16)"
grep -q "sha256:$SHA" <<<"$out"             || fail "the approval binding did not carry the file digest"
# The approved bytes are frozen at check time: a file swapped at the original
# path afterwards must not be what stages (security review, 10/31).
out="$(node -e '
  const fs = require("fs"), a = require(process.argv[1]);
  const f = a.fileInfo(process.argv[2]);
  fs.writeFileSync(process.argv[2], "swapped");
  const snap = fs.readFileSync(f.path, "utf8");
  fs.writeFileSync(f.path, "tampered");
  let staged; try { a.stage(f); staged = "staged-tampered"; } catch { staged = "refused"; }
  fs.writeFileSync(process.argv[2], "pdf bytes");
  console.log(snap === "pdf bytes" && f.path !== process.argv[2] ? "frozen" : "live", staged);
' "$(dirname "$P")/lib/people/attach.js" "$DOC")"
[ "$out" = "frozen refused" ] || fail "the attachment was not frozen at approval time: $out"
out="$("$P" send "sendy solo" --via imessage --file "$DOC" --dry-run 2>&1)" || fail "a file-only send was refused"
grep -q "attach rec.pdf" <<<"$out"          || fail "a file-only dry run did not show the file"
out="$("$P" send "mail sagar" "x" --via email --file "$DOC" --dry-run 2>&1)" && fail "a file over email was accepted"
grep -q "Files go over" <<<"$out"           || fail "the email refusal did not say where files go"
# Internal flags must be out of argv's reach: a string key "approved" let
# `--approved` skip the press until review caught it (10/31).
grep -nE 'flags(\.|\[")(approved|fileInfo)' "$(dirname "$P")/lib/people/send.js" &&
  fail "send.js reads an internal flag argv can set"
out="$("$P" send "sendy solo" "x" --file "$DOC" --to 15550102@s.whatsapp.net 2>&1)"
grep -q "CHEWBACCA_NO_SEND" <<<"$out"       || fail "a file send did not reach the dispatch gate"

# Readback: a send is checked against chat.db's own rows, not the people store.
CDB="$(mktemp -d)/chat.db"
sqlite3 "$CDB" "
  CREATE TABLE message (ROWID INTEGER PRIMARY KEY, handle_id INTEGER, is_from_me INTEGER, date INTEGER,
                        error INTEGER, cache_has_attachments INTEGER, is_sent INTEGER, text TEXT);
  CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT);
  CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
  INSERT INTO handle VALUES (1, '+15550102'), (2, '+15550109');
  INSERT INTO chat VALUES (1, 'iMessage;-;+15550102', '+15550102'), (2, 'iMessage;-;+15550109', '+15550109');
  INSERT INTO message VALUES (1, 1, 1, (strftime('%s','now') - 978307200) * 1000000000, 0, 0, 1, 'here it is'),
                             (2, 1, 1, (strftime('%s','now') - 978307200) * 1000000000, 0, 1, 1, NULL),
                             (3, 2, 1, (strftime('%s','now') - 978307200) * 1000000000, 22, 0, 0, 'x'),
                             (4, 1, 1, (strftime('%s','now') - 978307200 - 3600) * 1000000000, 0, 0, 1, 'old');
  INSERT INTO chat_message_join VALUES (1,1),(1,2),(2,3),(1,4);"
out="$(CHEWBACCA_CHAT_DB="$CDB" node -e '
  const { verifySent } = require(process.argv[1]);
  const since = Date.now() - 60000, o = { waitMs: 0 };
  console.log([
    verifySent("+15550102", since, { ...o, expect: 2, wantFile: true }).state,
    verifySent("+15550102", since, { ...o, expect: 3 }).state,
    verifySent("+15550109", since, o).state,
    verifySent("+15550199", since, o).state,
  ].join(" "));
' "$(dirname "$P")/lib/people/attach.js")"
[ "$out" = "landed missing failed missing" ] || fail "chat.db readback judged wrong: $out"
out="$(CHEWBACCA_CHAT_DB=/nonexistent/chat.db node -e '
  console.log(require(process.argv[1]).verifySent("+1", 0, { waitMs: 0 }).state);
' "$(dirname "$P")/lib/people/attach.js")"
[ "$out" = "unreadable" ] || fail "an unreadable chat.db was not reported as unreadable: $out"
exit 0
