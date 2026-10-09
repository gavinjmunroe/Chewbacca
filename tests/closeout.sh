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

# ── scoped gates: only the checks that name what changed (CHW-153) ─────────
# Every closeout ran all 26 groups, six minutes at best and 30 under load, for
# a change to one file. A second kit with a suite shaped like the real one:
# the hermetic preamble, then groups of check lines.
K2="$T/kit2"; repo "$K2"
mkdir -p "$K2/bin" "$K2/tests"
cp "$ROOT/bin/closeout" "$K2/bin/"
cat > "$K2/tests/run.sh" <<'SH'
#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLY="${1:-}"; PASS=0; FAIL=0; declare -a FAILURES=()
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_NO_SEND=1
group() { CURRENT="$1"; [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return 1; return 0; }
check() {
  local name="$1"; shift
  if "$@" >"$TMP/out" 2>"$TMP/err"; then PASS=$((PASS+1)); echo "  pass  $name"
  else FAIL=$((FAIL+1)); FAILURES+=("$CURRENT: $name"); echo "  FAIL  $name"; fi
}

if group "alpha"; then
  check "alpha passes" bash "$ROOT/tests/alpha.sh"
fi
if group "beta"; then
  check "beta passes" bash "$ROOT/tests/beta.sh"
fi
for f in "${FAILURES[@]:-}"; do [ -n "$f" ] && echo "  - $f"; done
exit "$FAIL"
SH
printf 'bash "$(dirname "$0")/../bin/alpha"\n' > "$K2/tests/alpha.sh"
printf 'sleep 4; bash "$(dirname "$0")/../bin/beta"\n' > "$K2/tests/beta.sh"
printf '#!/bin/bash\nexit 0\n' > "$K2/bin/alpha"; cp "$K2/bin/alpha" "$K2/bin/beta"
git -C "$K2" add -A; git -C "$K2" commit -qm kit2; git -C "$K2" push -q -u origin main
c2() { CHEWBACCA_HOME="$T/state2" python3 "$K2/bin/closeout" "$@"; }
land() { git -C "$K2" add -A; git -C "$K2" commit -qm "$1"; git -C "$K2" push -q; }

out=$(c2); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "alpha passes" && printf '%s' "$out" | grep -q "beta passes" \
  && ok "no earlier pass: today's changes select both checks" || bad "first scoped run: $code $out"

printf '#!/bin/bash\n# reworded\nexit 0\n' > "$K2/bin/alpha"; land "alpha only"
start=$(python3 -c 'import time; print(time.time())')
out=$(c2); code=$?
secs=$(python3 -c "import time; print(f'{time.time() - $start:.1f}')")
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "alpha passes" && ! printf '%s' "$out" | grep -q "beta" \
  && ok "a change to bin/alpha runs alpha's check and not beta's 4 s one (${secs}s)" || bad "scoped run: $code $out"

out=$(c2); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "gates: passed on this tree" \
  && ok "a second closeout on the same tree runs nothing" || bad "rerun on same tree: $code $out"

# THE GUARANTEE. A check that fails still fails closeout, scoped or not.
printf '#!/bin/bash\nexit 1\n' > "$K2/bin/alpha"; land "break alpha"
out=$(c2); code=$?
[ "$code" = 1 ] && printf '%s' "$out" | grep -q "FAIL  gates" && printf '%s' "$out" | grep -q "alpha passes" \
  && [ ! -f "$T/state2/closeout-receipt.json" ] \
  && ok "a broken bin/alpha fails closeout and leaves no receipt" || bad "broken alpha passed: $code $out"
out=$(c2 --fast); code=$?
[ "$code" = 1 ] && printf '%s' "$out" | grep -q '????  gates: not run on this commit' \
  && ok "--fast never reuses a pass across a failing change" || bad "--fast after failure: $code $out"

# A changed file no check names still has to parse.
printf '#!/bin/bash\nexit 0\n' > "$K2/bin/alpha"
printf '#!/bin/bash\nif then fi\n' > "$K2/bin/gamma"; land "gamma"
out=$(c2); code=$?
[ "$code" = 1 ] && printf '%s' "$out" | grep -q "FAIL  .*parses: bin/gamma" \
  && ok "a syntax error in a file no check names fails closeout" || bad "gamma parse: $code $out"
printf '#!/bin/bash\nexit 0\n' > "$K2/bin/gamma"; land "fix gamma"
c2 >/dev/null; code=$?
[ "$code" = 0 ] && ok "fixing it passes again" || bad "after the fix: $code"

# A check line added to the suite runs on the next closeout.
printf 'if group "delta"; then\n  check "delta runs" true\nfi\n' >> "$K2/tests/run.sh"; land "delta"
out=$(c2); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "delta runs" \
  && ok "a check added to run.sh is selected by its own diff" || bad "added check: $code $out"

# Board edits cannot break a script, so they keep the last pass.
mkdir -p "$K2/team/tasks"; echo t > "$K2/team/tasks/CHW-9.md"; land "team: CHW-9"
out=$(c2 --fast); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "gates: passed on .*reused" \
  && ok "a team-board commit keeps the pass for --fast" || bad "--fast after a board edit: $code $out"

out=$(c2 --all); code=$?
[ "$code" = 0 ] && printf '%s' "$out" | grep -q "beta passes\|\[.*\] beta" && printf '%s' "$out" | grep -q "groups" \
  && ok "--all runs every group" || bad "--all: $code $out"

# The real suite: its preamble is found and most check lines run alone.
python3 - "$ROOT" <<'PY' && ok "the real run.sh splits into standalone checks" || bad "real run.sh did not split"
import importlib.machinery, importlib.util, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
loader = importlib.machinery.SourceFileLoader("closeout", str(root / "bin" / "closeout"))
mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("closeout", loader))
loader.exec_module(mod)
s = mod.Scope(root / "tests" / "run.sh")
assert s.preamble and "CHEWBACCA_NO_SEND=1" in s.preamble, "preamble not found"
alone = [u for u in s.units if u[2]]
assert len(alone) > 200, f"only {len(alone)} standalone checks"
g, line, _ = alone[0]
assert subprocess.run(["bash", "-n", "-c", s.script(g, line)]).returncode == 0
a, groups, _ = s.select(["bin/closeout"], set())
assert any("closeout" in ln for _, ln in a), "bin/closeout selects no check"
PY

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
