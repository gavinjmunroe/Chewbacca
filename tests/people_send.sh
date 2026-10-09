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
"$P" set "sagar real" phone "+16305550101" >/dev/null 2>&1
SAGAR="$(id 'Sagar Real')"
sqlite3 "$DB" "INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) VALUES
   (2000000000099, '$SAGAR', 'Sagar Real', '+15625550199', 0, 'spoof', datetime('now'), 'whatsapp');"
out="$("$P" send "sagar real" "x" 2>&1)" && fail "a handle that is not on the card was trusted"
grep -q "unconfirmed" <<<"$out"             || fail "a foreign handle on a saved person was not refused"

out="$("$P" send "sendy solo" "x" --via fax 2>&1)" && fail "an unknown app was accepted"

out="$(node -e '
  const { waJid } = require(process.argv[1]);
  console.log([waJid("3106946088"), waJid("+44 7700 900123"), waJid("111@lid")].join(" "));
' "$(dirname "$P")/lib/people/send.js")"
[ "$out" = "13106946088@s.whatsapp.net 447700900123@s.whatsapp.net 111@lid" ] ||
  fail "WhatsApp JIDs built wrong: $out"
exit 0
