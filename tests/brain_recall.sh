#!/bin/bash
# brain-recall stays silent without `brain`, on short prompts, on machine
# traffic and in lexical mode, and prints only hits over the threshold.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/brain-recall.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  pass  $1"; else fail=$((fail+1)); echo "  FAIL  $1"; echo "        got: $2"; fi; }
fake() { mkdir -p "$T/bin"; printf '#!/bin/sh\ncat <<OUT\n%s\nOUT\n' "$1" > "$T/bin/brain"; chmod +x "$T/bin/brain"; }
run() { printf '{"prompt":"%s"}' "$1" | PATH="$T/bin:/usr/bin:/bin" bash "$HOOK"; }

ok "silent with no brain on PATH" "$(printf '{"prompt":"what did my mentor say"}' | PATH="/usr/bin:/bin" bash "$HOOK")" ""
fake "# brain mode=hybrid files=2 chunks=2

[1] memory/user_a.md cos=0.76
    the strong one

[2] memory/user_b.md#part cos=0.41
    the weak one"
out=$(run "what did my mentor say about loneliness")
ok "strong hit shown" "$(echo "$out" | grep -c user_a.md)" "1"
ok "weak hit dropped" "$(echo "$out" | grep -c user_b.md)" "0"
ok "short prompt silent" "$(run "hi there")" ""
ok "machine traffic silent" "$(run "SYSTEM NOTIFICATION task done here")" ""
fake "# brain mode=lexical degraded=ollama_down files=2 chunks=2

[1] memory/user_a.md cos=16.63
    bm25 score, not a cosine"
ok "lexical mode silent" "$(run "what did my mentor say about loneliness")" ""
echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
