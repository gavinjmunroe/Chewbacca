#!/usr/bin/env bash
# voice-check, the drafts queue and voice-guard refuse a text that doesn't
# read like Caleb, and pass one that does. A synthetic store stands in for
# his sent texts. 2026-10-09: "Attached is one more page..." went to him as a
# text to send Jonah, and he said he should never send one that isn't his.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export PEOPLE_DIR="$T/people" VOICE_PROFILE="$T/profile.json" CHEWBACCA_NO_SEND=1 TMPDIR="$T"
mkdir -p "$PEOPLE_DIR"
fail=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fail=1; }

"$ROOT/bin/people" texts drafts >/dev/null 2>&1   # creates the schema
python3 -I - "$PEOPLE_DIR/people.db" <<'PY'
import sqlite3, sys, random
c = sqlite3.connect(sys.argv[1])
random.seed(1)
lines = [
    "Will stop the campaigns in an hour I hv a group project right now",
    "Kaushik responded to maggie directly, no clue why he didn't answer the channel?",
    "Was helping my family with something this evening, just got back will set it up now",
    "Refactoring the agent so when you wake up tmr the ux will be super intuitive with the emails forwarded",
    "I think it's too early to make conclusions, 2 emails is barely anything",
    "Can we sync for your approval on the updated campaigns so we can get those running?",
    "Not sure when I'll be free tmr, prob in the evening",
    "I reached out to a bunch, no meetings set up yet tho waiting on those",
]
for i in range(400):
    who = "Jonah Graham" if i % 4 == 0 else "Mark Lin"
    c.execute("insert into messages (msg_id, who, from_me, body, sent_at, source) values (?,?,?,?,?,?)",
              (i + 1, who, 1, random.choice(lines), "2026-03-01T10:00:00", "whatsapp"))
c.execute("insert into messages_fts(messages_fts) values ('rebuild')")
c.commit()
PY

FORMAL="Attached is one more page, six quick questions that only you can answer: the data room, your warm investors so we never cold email them, and which numbers I can put in writing for each company."
CASUAL="Made a quick one pager with the last few things I need from you, no rush on it"

"$ROOT/bin/voice-check" "$FORMAL" >/dev/null; [ $? -eq 1 ] && ok "a formal colon-list draft is refused" || bad "formal draft passed"
"$ROOT/bin/voice-check" "$CASUAL" >/dev/null; [ $? -eq 0 ] && ok "a draft shaped like his texts passes" || bad "casual draft refused"
out="$("$ROOT/bin/voice-check" --to jonah "$FORMAL")"
grep -q "what you actually send jonah" <<<"$out" && ok "a refusal shows his own texts to that person" || bad "no examples: $out"
grep -q '"attached is"' <<<"$out" && ok "a phrase he never texted is named" || bad "never-his phrase not named"

"$ROOT/bin/people" texts drafts add jonah "$FORMAL" >/dev/null 2>&1
[ $? -ne 0 ] && ok "drafts add refuses it" || bad "drafts add queued the formal draft"
"$ROOT/bin/people" texts drafts add jonah "$CASUAL" >/dev/null 2>&1 && ok "drafts add queues the casual one" || bad "drafts add refused the casual draft"
"$ROOT/bin/people" texts drafts add jonah "$FORMAL" --voice-ok >/dev/null 2>&1 && ok "--voice-ok lets his own wording through" || bad "--voice-ok ignored"

# voice-guard reads the reply, finds quoted drafts in a reply about sending.
export PATH="$ROOT/bin:$PATH"
hook="$ROOT/.claude/hooks/voice-guard.sh"
reply=$(python3 -I -c 'import json,sys; print(json.dumps({"prompt_id": sys.argv[2], "last_assistant_message": "Text for Jonah on WhatsApp:\n\n> " + sys.argv[1]}))' "$FORMAL" p1)
printf '%s' "$reply" | bash "$hook" >/dev/null 2>&1; [ $? -eq 2 ] && ok "voice-guard refuses a quoted draft that isn't him" || bad "voice-guard let it through"
printf '%s' "$reply" | bash "$hook" >/dev/null 2>&1; [ $? -eq 0 ] && ok "voice-guard refuses once per turn" || bad "voice-guard refused twice"
reply=$(python3 -I -c 'import json,sys; print(json.dumps({"prompt_id": "p2", "last_assistant_message": "Text for Jonah:\n\n> " + sys.argv[1]}))' "$CASUAL")
printf '%s' "$reply" | bash "$hook" >/dev/null 2>&1; [ $? -eq 0 ] && ok "voice-guard passes a draft that is him" || bad "voice-guard refused a good draft"
reply=$(python3 -I -c 'import json,sys; print(json.dumps({"prompt_id": "p3", "last_assistant_message": "The doc says:\n\n> " + sys.argv[1]}))' "$FORMAL")
printf '%s' "$reply" | bash "$hook" >/dev/null 2>&1; [ $? -eq 0 ] && ok "a quote in a reply about something else is left alone" || bad "voice-guard fired on a plain quote"
exit $fail
