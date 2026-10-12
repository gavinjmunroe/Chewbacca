#!/usr/bin/env bash
# link-guard refuses a reply whose file links don't open from the session root.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/link-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
unset CLAUDE_PROJECT_DIR
fail=0

ROOT="$TMP/home"
mkdir -p "$ROOT/Downloads" "$ROOT/code/work/TTS-Dev/blender/logo-helmet"
touch "$ROOT/Downloads/TTS logo helmet nalana v16.png" "$ROOT/notes.md"

# The transcript records the root as the first cwd, then the shell drifts.
T="$TMP/t.jsonl"
{
  jq -cn --arg c "$ROOT" '{type:"attachment",cwd:$c}'
  jq -cn '{type:"user",message:{role:"user",content:"render the logo"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Updating. See [old](missing-mid-turn.md)."}]}}'
} > "$T"
T2="$TMP/t2.jsonl"
{
  jq -cn --arg c "$ROOT" '{type:"attachment",cwd:$c}'
  jq -cn '{type:"user",message:{role:"user",content:"render the logo"}}'
} > "$T2"

probe() {        # name, expected exit, reply, transcript
  local name="$1" want="$2" reply="$3" t="${4:-$T2}"
  jq -cn --arg m "$reply" --arg t "$t" --arg c "$ROOT/Downloads" \
      '{last_assistant_message:$m,transcript_path:$t,cwd:$c}' \
    | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "  ok    $name"; else echo "  FAIL  $name: wanted $want got $got"; fail=$((fail+1)); fi
}

echo "refuses links that don't open:"
probe "the 2026-10-11 render link, relative to the drifted cwd" 2 \
  "v16: [render](TTS%20logo%20helmet%20nalana%20v16.png)"
probe "a ../ folder link off the drifted cwd" 2 \
  "Kit in [logo-helmet/](../code/work/TTS-Dev/blender/logo-helmet/)"
probe "a broken link in a mid-turn update" 2 "All good, [notes](notes.md)" "$T"
# A corrected retry after a refusal: the refused text sits above a Stop hook
# feedback row and must not be held against the retry (2026-10-11, 6 loops).
T3="$TMP/t3.jsonl"
{
  jq -cn --arg c "$ROOT" '{type:"attachment",cwd:$c}'
  jq -cn '{type:"user",message:{role:"user",content:"give him the md"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Here: [md](../Downloads/x.md)"}]}}'
  jq -cn '{type:"user",isMeta:true,message:{role:"user",content:"Stop hook feedback:\n[link-guard.sh]: refusing"}}'
} > "$T3"
echo "lets through:"
probe "a corrected retry after a refusal" 0 "Fixed: [notes](notes.md)" "$T3"
probe "relative to the session root" 0 \
  "v16: [render](Downloads/TTS%20logo%20helmet%20nalana%20v16.png) and [kit](code/work/TTS-Dev/blender/logo-helmet/)"
probe "a line anchor on a real file" 0 "See [notes.md:3](notes.md#L3)"
probe "an absolute path" 0 "See [render]($ROOT/Downloads/TTS%20logo%20helmet%20nalana%20v16.png)"
probe "URLs and anchors" 0 "[site](https://usctts.com) [mail](mailto:a@b.c) [top](#top)"
probe "a link inside code" 0 'Write it as `[x](nope.md)` in docs'
probe "no links" 0 "Done, v16 is in Downloads"

[ "$fail" = 0 ] && echo "link-guard: all passed" || { echo "link-guard: $fail failed"; exit 1; }
