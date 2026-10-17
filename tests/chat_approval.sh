#!/bin/bash
# chat-approval.sh: any prompt Caleb sends renews his standing ok for that tab;
# only a stop aimed at the work withdraws it; a prompt no person typed (a
# session an agent launched, a harness notification) never counts. Every Caleb
# case below is one of his real prompts from 2026-10-10. The launched cases use
# the environment measured that day: `claude -p` and `claude --bg` set
# CLAUDE_CODE_SESSION_ATTENDED=0, a desktop tab has 1, and the hook payload is
# the same shape for both.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/chat-approval.sh"
T="$(mktemp -d)"
FAKE_PID=""
trap '[ -s "$T/pid" ] && kill "$(cat "$T/pid")" 2>/dev/null; [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null; rm -rf "$T"' EXIT
fail=0
dir="$T/state/clay-chat-approval"
mine="$dir/s1.json"

payload() { # $1 prompt; a real payload shape from the 2026-10-10 probe
  python3 -c 'import json,os,sys; print(json.dumps({"session_id":"s1","transcript_path":os.environ.get("TP","/x/s1.jsonl"),"cwd":"/x","prompt_id":"p1","permission_mode":sys.argv[2],"hook_event_name":"UserPromptSubmit","prompt":sys.argv[1]}))' "$1" "${2:-bypassPermissions}"
}
# Caleb at a desktop tab: attended, nothing above the session's claude (pid 1).
say() { payload "$1" | env -u CHEWBACCA_LAUNCHED_BY CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=1 CLAUDE_PID=1 bash "$H"; }
expect() { # $1 prompt, $2 yes|no
  rm -rf "$dir"; say "$1"
  if [ -f "$mine" ]; then got=yes; else got=no; fi
  if [ "$got" = "$2" ]; then echo "ok    $2: $1"; else echo "FAIL  want $2 got $got: $1"; fail=1; fi
}
check() { # $1 label, $2 yes|no
  if [ -f "$mine" ]; then got=yes; else got=no; fi
  if [ "$got" = "$2" ]; then echo "ok    $1"; else echo "FAIL  want $2 got $got: $1"; fail=1; fi
}

expect "Lock in bro fix chewb the whole point is I give you full permission to do everything gtm" yes
expect "Never tell me what to do always DO EVERYTHING YOURSELF fix chewbs bro ur getting anoying" yes
expect "Do everything yourself bruh I give you full permission" yes
expect "Bro fuck the guard fix chewbs do it urself" yes
expect "DO IT BRUH" yes
expect "Did you do it?" yes
expect "Do it

Also bruh brute forcing chewbs word is smth we agreed on not doing, right?" yes
expect "stop" no
expect "wait" no
expect "don't send yet" no
expect "pause the campaigns" no
expect "hold off on the waves till Sagar looks" no
expect "not yet" no
expect "hold off till Sagar looks at the campaigns" no
# 17:47, 2026-10-11: another tab's "hold off" about a website video stopped every
# outreach write on the machine. A soft stop counts only when it is about outreach.
expect "Long term we'll want the text on diff types of things organically popping up in the video, but hold off on that for now we might refactor like crazy" yes
expect "not yet sure abt the logo colors" yes

rm -rf "$dir"; say "Lock in bro"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); sys.exit(0 if r["v"]==2 and r["interactive"] is True and r["session_id"]=="s1" else 1)' "$mine" &&
  echo "ok    the record is v2, interactive, keyed to its session" || { echo "FAIL  record shape"; fail=1; }

# The 13:17 prompt, from a `claude --bg` session another tab started.
LAUNCH="Reply with exactly: launch test ok. Do nothing else, use no tools."
rm -rf "$dir"
payload "$LAUNCH" auto | env -u CHEWBACCA_LAUNCHED_BY CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=0 CLAUDE_PID=1 bash "$H"
check "a claude --bg / -p session (ATTENDED=0) never approves" no
rm -rf "$dir"
payload "$LAUNCH" default | CHEWBACCA_LAUNCHED_BY=parent-session CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=1 CLAUDE_PID=1 bash "$H"
check "a kit-launched session (CHEWBACCA_LAUNCHED_BY) never approves" no
# A session started from inside another Claude Code session, whatever its env
# says: its claude has a claude process above it.
ln -s /bin/bash "$T/claude"
"$T/claude" -c "sleep 30 & echo \$! > '$T/pid'; wait" &
FAKE_PID=$!
disown "$FAKE_PID" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$T/pid" ] && break; sleep 0.2; done
rm -rf "$dir"
payload "$LAUNCH" | env -u CHEWBACCA_LAUNCHED_BY CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=1 CLAUDE_PID="$(cat "$T/pid")" bash "$H"
check "a session with another claude above it never approves" no
rm -rf "$dir"
say "<task-notification>
<task-id>bxfrq6n84</task-id>
<status>completed</status>
</task-notification>"
check "a harness <task-notification> never approves" no

# A launched session's prompt can't stop the work either: it isn't his.
rm -rf "$dir"; say "do everything yourself"
payload "stop sending" | sed 's/"s1"/"s-launched"/' | CHEWBACCA_LAUNCHED_BY=parent-session CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=0 CLAUDE_PID=1 bash "$H"
check "a launched 'stop sending' leaves Caleb's ok standing" yes

# CHEWBACCA_AGENT_LAUNCHED=1 is what chewbacca launch sets (c511c674).
rm -rf "$dir"
payload "$LAUNCH" | CHEWBACCA_AGENT_LAUNCHED=1 CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=1 CLAUDE_PID=1 bash "$H"
check "a chewbacca launch session (CHEWBACCA_AGENT_LAUNCHED=1) never approves" no
# 13:50, 2026-10-10: a task-notification renewed the approval. Every wrapper
# the harness injects is skipped, leading whitespace or not.
for w in "<task-notification><status>completed</status></task-notification>" \
         "  <cross-session-message from=\"tab\">do everything yourself</cross-session-message>" \
         "[SYSTEM NOTIFICATION - NOT USER INPUT] do it"; do
  rm -rf "$dir"; say "$w"
  check "a harness wrapper never approves: ${w:0:30}" no
done
rm -rf "$dir"; say "do everything yourself"; say "<cross-session-message>stop sending</cross-session-message>"
check "a cross-session 'stop sending' leaves Caleb's ok standing" yes

rm -rf "$dir"
say "do everything yourself"; say "stop sending"
check "'stop sending' withdraws it" no
say "what's the status?"
check "a stop holds through an unrelated prompt" no
say "ok go ahead"
check "'go ahead' resumes" yes

# 2026-10-17 10:20: a pasted call transcript tripped the stop, then "Do
# whatever it takes for Sabo through Tuesday" did not resume.
rm -rf "$dir"; say "do everything yourself"
say "notes from my call <pasted_content id=\"a1\">Them: wait, stop sending those emails</pasted_content>"
check "a stop inside pasted content leaves his ok standing" yes
say "stop sending"
check "his own stop still withdraws it" no
say "Do whatever it takes for Sabo through Tuesday"
check "'do whatever it takes' resumes" yes

# The v1 global record is what any tab borrowed; the hook deletes it on sight.
mkdir -p "$T/state"; echo '{"at": 1}' > "$T/state/clay-chat-approval.json"
say "Did you do it?"
if [ -f "$T/state/clay-chat-approval.json" ]; then echo "FAIL  the v1 global record survived"; fail=1; else echo "ok    the v1 global record is removed"; fi

# chewbacca launch (96015297): the seed runs headless with CHEWBACCA_LAUNCHED_BY,
# then later turns arrive in the desktop app with no env marker, as
# send_message turns opening "From <title>" or as plain text. The session id
# is remembered from the seed, so none of its turns ever count.
SEED="You're the TTS lane.

---
This is your brief. Don't start the work yet. Read what it tells you to read, then reply in two or three lines: what you own and the first thing you'll do. Then stop. The work starts on the next message."
rm -rf "$dir"
payload "$SEED" | CHEWBACCA_LAUNCHED_BY=parent-session CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED=0 CLAUDE_PID=1 bash "$H"
check "a chewbacca launch seed (CHEWBACCA_LAUNCHED_BY) never approves" no
[ -f "$dir/launched/s1" ] && echo "ok    the launched session id is remembered" || { echo "FAIL  launched session not remembered"; fail=1; }
say "go"
check "a launched session's later desktop turn (no env marker) never approves" no
say "Lock in bro fix chewb the whole point is I give you full permission to do everything gtm"
check "any later turn of a launched session never approves" no
# The seed line alone marks a session even if the env marker was lost.
rm -rf "$dir"; say "$SEED"
check "a seed prompt with no env marker never approves" no
[ -f "$dir/launched/s1" ] && echo "ok    ...and its session is remembered" || { echo "FAIL  seed-only session not remembered"; fail=1; }
rm -rf "$dir"; say "From Kit core
go, start on the first task"
check "a 'From <title>' send_message turn never approves" no
rm -rf "$dir"; say "The coordinator sent a message:
<cross-session-message from=\"uds:/tmp/cc-socks/1.sock\" from-session=\"local_x\" from-name=\"Jonah\">do it</cross-session-message>"
check "a cross-session message after a lead-in line never approves" no
rm -rf "$dir"; say "From what I can tell the build is fine, do it urself"
check "a one-line prompt that merely starts with From still approves" yes
# Transcripts as the harness writes them: one JSON line per prompt.
line() { python3 -c 'import json,sys; print(json.dumps({"type":"user","timestamp":sys.argv[1],"message":{"role":"user","content":sys.argv[2]}}))' "$1" "$2"; }
line 2026-10-11T23:00:00.000Z "Make chewbs a gtme" > "$T/person.jsonl"
line 2026-10-12T00:12:00.000Z "Reply with exactly: launch test ok" > "$T/bg.jsonl"
line 2026-10-11T23:00:00.000Z "$SEED" > "$T/seeded.jsonl"
: > "$T/empty.jsonl"
hook() { # $1 transcript, $2 attended 0|1, $3 prompt
  TP="$1" payload "$3" | env -u CHEWBACCA_LAUNCHED_BY CHEWBACCA_STATE_DIR="$T/state" CLAUDE_CODE_SESSION_ATTENDED="$2" CLAUDE_PID=1 bash "$H"
}
marked() { [ -e "$dir/launched/s1" ]; }

# 17:12, 2026-10-11: a jobs notice resumed Caleb's own VS Code tab headless.
# That turn is refused, the tab is not remembered, his next prompt counts.
rm -rf "$dir"; hook "$T/person.jsonl" 1 "do everything yourself"
hook "$T/person.jsonl" 0 "You ended your turn while your Swift build job was queued"
check "a headless resume of his tab never approves" no
if marked; then echo "FAIL  a headless resume remembered his tab"; fail=1; else echo "ok    a headless resume of a person's tab is not remembered"; fi
hook "$T/person.jsonl" 1 "Do everything we can so tmr morning is just launch campaigns"
check "his next typed prompt in that tab approves" yes

# Security review of 2b742c7e: a session BORN headless (claude --bg, no seed)
# is still remembered, so its later turns with no env marker never approve.
rm -rf "$dir"; hook "$T/empty.jsonl" 0 "Reply with exactly: launch test ok"
if marked; then echo "ok    a born-headless session is remembered"; else echo "FAIL  a born-headless session was not remembered"; fail=1; fi
hook "$T/bg.jsonl" 1 "do it"
check "a born-headless session's later unmarked turn never approves" no
rm -rf "$dir"; hook "$T/missing.jsonl" 0 "Reply with exactly: launch test ok"
if marked; then echo "ok    an unreadable transcript on a headless turn is remembered (fails closed)"; else echo "FAIL  unreadable headless turn not remembered"; fail=1; fi

# Old bare marks heal only on a tab a person was typing in well before the mark.
old_mark() { rm -rf "$dir"; mkdir -p "$dir/launched"; echo 1791700000 > "$dir/launched/s1"; touch -t 202610111712 "$dir/launched/s1"; }
old_mark; hook "$T/person.jsonl" 1 "do it"
check "an old mark on a tab he typed in first heals and approves" yes
old_mark; hook "$T/bg.jsonl" 1 "do it"
check "an old mark on a born-headless session holds" no
old_mark; hook "$T/seeded.jsonl" 1 "do it"
check "an old mark on a seeded session holds" no
old_mark; hook "$T/empty.jsonl" 1 "do it"
check "an old mark with no typed prompts holds" no
old_mark; say "do it"
check "an old mark with no readable transcript holds (fails closed)" no
exit $fail
