#!/usr/bin/env bash
# closeout answers as it goes, --fast answers the git half in about a second,
# gates are reused only for the exact commit they passed on, and vibe-guard
# runs the answer itself instead of printing a command nobody runs.
#
# 2026-09-26: closeout ran past four minutes printing nothing, was killed, and
# the closing question never got an answer. Everything here runs against a
# throwaway kit and brain under a temporary HOME.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home" CHEWBACCA_LOG_DIR="$T/logs" TMPDIR="$T"
mkdir -p "$HOME"
fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }

repo() {                        # path: a repo with an upstream, one commit
  git init -q --bare "$1.origin"
  git -C "$1.origin" symbolic-ref HEAD refs/heads/main
  git clone -q "$1.origin" "$1" 2>/dev/null
  git -C "$1" config user.email t@t; git -C "$1" config user.name t
  git -C "$1" checkout -qb main
}
KIT="$T/kit"; repo "$KIT"
mkdir -p "$KIT/bin" "$KIT/tests" "$KIT/.claude/hooks"
cp "$ROOT/bin/closeout" "$KIT/bin/"
cp "$ROOT/.claude/hooks/vibe-guard.sh" "$ROOT/.claude/hooks/lib.sh" "$KIT/.claude/hooks/"
cat > "$KIT/tests/run.sh" <<'SH'
group() { [ "${1:-}" = "$ONLY" ]; }
ONLY="${1:-}"
if group "quick"; then echo quick; fi
if group "slow"; then sleep 3; echo slow; fi
SH
git -C "$KIT" add -A; git -C "$KIT" commit -qm kit; git -C "$KIT" push -q -u origin main
repo "$HOME/second-brain"
mkdir -p "$HOME/second-brain/memory"; echo note > "$HOME/second-brain/memory/lesson.md"
git -C "$HOME/second-brain" add -A; git -C "$HOME/second-brain" commit -qm b
git -C "$HOME/second-brain" push -q -u origin main

# ── the real suite's groups are found, or the fan-out never runs ────────────
n=$(python3 -c "
import importlib.machinery, sys
m = importlib.machinery.SourceFileLoader('closeout', '$ROOT/bin/closeout').load_module()
print(len(m.Checks.groups(__import__('pathlib').Path('$ROOT/tests/run.sh'))))" 2>/dev/null)
want=$(grep -cE '^\s*if group "' "$ROOT/tests/run.sh")
[ "${n:-0}" -gt 5 ] && [ "$n" = "$want" ] \
  && ok "closeout finds all $n groups in the real suite" || bad "closeout found ${n:-0} of $want groups"

# ── streaming: the git half is on screen before the slow group finishes ────
python3 - "$KIT/bin/closeout" <<'PY' > "$T/stream"
import subprocess, sys, time
p = subprocess.Popen(["python3", sys.argv[1]], stdout=subprocess.PIPE, text=True)
start, first = time.time(), None
for line in p.stdout:
    if "kit: no uncommitted" in line and first is None:
        first = time.time() - start
p.wait()
print(f"{first if first is not None else 99:.2f} {time.time() - start:.2f} {p.returncode}")
PY
read -r first total code < "$T/stream"
python3 -c "import sys; sys.exit(0 if $first < 1.5 and $total >= 3 else 1)" \
  && ok "the first check prints at ${first}s while the suite takes ${total}s" \
  || bad "the first line waited for the gates: first ${first}s of ${total}s"
[ "$code" = 0 ] && ok "a clean kit with green gates passes" || bad "full closeout exited $code"

# ── --fast reuses a pass on this exact commit, and nothing else ────────────
out=$(python3 "$KIT/bin/closeout" --fast); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "gates: passed on .*reused" \
  && ok "--fast reuses the gates that passed on this commit" || bad "--fast after a pass: $code $out"

echo "# next" >> "$KIT/tests/run.sh"
git -C "$KIT" commit -qam next; git -C "$KIT" push -q
start=$(python3 -c 'import time; print(time.time())')
out=$(python3 "$KIT/bin/closeout" --fast); code=$?
secs=$(python3 -c "import time; print(f'{time.time() - $start:.1f}')")
[ "$code" = 1 ] && printf '%s' "$out" | grep -q '????  gates: not run on this commit' \
  && ok "a new commit makes the gates unknown, never a pass" || bad "--fast on a new commit: $code $out"
python3 -c "import sys; sys.exit(0 if $secs < 5 else 1)" \
  && ok "--fast answered in ${secs}s, inside vibe-guard's 10 s watchdog" || bad "--fast took ${secs}s"

# ── vibe-guard runs --fast itself ──────────────────────────────────────────
guard() { printf '{"last_assistant_message":"We are safe to close.","prompt_id":"p-%s"}' "$RANDOM" \
  | bash "$KIT/.claude/hooks/vibe-guard.sh" 2>"$T/err"; }
rm -f "$HOME/.chewbacca/closeout-receipt.json"
guard; code=$?
[ "$code" = 2 ] && grep -q "gates: not run on this commit" "$T/err" \
  && ! grep -q "bin/closeout$" "$T/err" \
  && ok "vibe-guard blocks with the failing checks, not a command to run" || bad "vibe-guard: exit $code $(cat "$T/err")"
python3 "$KIT/bin/closeout" --quiet >/dev/null
rm -f "$HOME/.chewbacca/closeout-receipt.json"
guard; code=$?
[ "$code" = 0 ] && ok "vibe-guard lets the claim through when --fast passes" || bad "vibe-guard after a pass: exit $code $(cat "$T/err")"

# ── a project decision in memory today has to reach the team board ─────────
# 2026-10-06: three decisions went to memory only, and Caleb had to ask for
# the shared todo: "I should never have to say this ever again."
echo decided > "$HOME/second-brain/memory/project_cohort.md"
git -C "$HOME/second-brain" add -A; git -C "$HOME/second-brain" commit -qm p
git -C "$HOME/second-brain" push -q
out=$(python3 "$KIT/bin/closeout" --fast)
printf '%s' "$out" | grep -q "FAIL  board: today's project decisions" \
  && ok "a project note with no board commit fails the board check" || bad "board check missed it: $out"
mkdir -p "$KIT/team/tasks"; echo t > "$KIT/team/tasks/CHW-1.md"
git -C "$KIT" add -A; git -C "$KIT" commit -qm "team: CHW-1 created"; git -C "$KIT" push -q
out=$(python3 "$KIT/bin/closeout" --fast)
printf '%s' "$out" | grep -q "PASS  board: today's project decisions" \
  && ok "a board commit today clears it" || bad "board check after a task: $out"

echo
[ "$fail" = 0 ] && echo "closeout answers as it goes, and fast   ok" || echo "$fail failed"
exit "$fail"
