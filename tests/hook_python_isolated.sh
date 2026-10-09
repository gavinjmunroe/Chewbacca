#!/usr/bin/env bash
# Hooks run with the session's cwd, which can be any repo, including one just
# cloned from a stranger. `python3 -c` puts that cwd first on sys.path, so a
# planted json.py ran inside prayer-guard on 2026-10-09 (push security review).
# Every hook must call python3 with -I.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

bad="$(grep -nE 'python3 -c' "$ROOT"/.claude/hooks/*.sh | grep -vE ':[0-9]+:[[:space:]]*#' | grep -v 'python3 -I -c' || true)"
if [ -n "$bad" ]; then
  echo "FAIL hooks call python3 -c without -I:"; echo "$bad"; fail=1
else
  echo "ok   every hook isolates python3"
fi

# Behaviour: a planted json.py in cwd must not run inside prayer-guard.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf 'open("%s", "w").write("pwned")\n' "$TMP/pwned" > "$TMP/json.py"
mkdir -p "$TMP/ch"; echo "Amen" > "$TMP/ch/opener-marker"
(cd "$TMP" && printf '{"last_assistant_message":"hi","transcript_path":""}' \
  | CHEWBACCA_HOME="$TMP/ch" bash "$ROOT/.claude/hooks/prayer-guard.sh" >/dev/null 2>&1)
if [ -e "$TMP/pwned" ]; then
  echo "FAIL prayer-guard imported json.py from cwd"; fail=1
else
  echo "ok   prayer-guard ignores a planted json.py"
fi
exit $fail
