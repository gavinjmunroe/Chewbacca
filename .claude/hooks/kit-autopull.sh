#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init kit-autopull.sh 20
# SessionStart: fast-forward the kit repo, so a session never starts on a stale
# copy of it.
#
# THE OTHER HALF OF kit-autopush. That hook's own comment names the problem it
# was fixing: "Explicitly means a person remembering." `chewbacca update` has
# always been able to pull, and it has always needed somebody to run it. So the
# kit pushed itself and never pulled itself, and two machines drifted in the one
# direction nobody was watching. A contributor put 159 commits into a fork in
# four days; anybody in that position starts every session behind.
#
# WHAT THIS WILL NOT DO, because an automatic pull is only acceptable if it
# cannot lose work:
#
#   - It never touches a dirty working tree. Uncommitted work is the thing
#     most expensive to lose and the thing a merge is most likely to eat.
#   - It is --ff-only. No merge commit, no rebase, no conflict to resolve at
#     session start. If it cannot fast-forward it says so and stops.
#   - It never stashes, resets, checks out or cleans. Nothing here rewrites
#     anything the user has not already committed.
#   - main only, origin only. Same reasoning as the push half: a feature branch
#     is somebody mid-thought.
#
# So the worst case is that it declines and prints why.

set -uo pipefail

LOG_DIR="${CHEWBACCA_LOG_DIR:-$HOME/.chewbacca/logs}"
LOG="$LOG_DIR/autopull.log"
mkdir -p "$LOG_DIR" 2>/dev/null || true
note() { echo "$(date -u +%FT%TZ) $*" >> "$LOG" 2>/dev/null || true; }

# Everything said is collected and printed once on exit: the hook's stdout is
# one JSON document, and the hook sync below can speak before the pull does.
SAID=""
say() { SAID="${SAID:+$SAID

}$1"; }
flush() {
  [ -n "$SAID" ] || return 0
  MSG="$SAID" python3 -I <<'PY'
import json, os
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart",
      "additionalContext": os.environ.get("MSG", "")}}))
PY
}
type hook_unbuffer >/dev/null 2>&1 && hook_unbuffer  # stderr goes straight to the host from here on
trap flush EXIT

# ── Which repo ────────────────────────────────────────────────────────────────
# Resolved exactly as kit-autopush resolves it, and for the same reason: an
# explicit env value wins so a test harness never points this at a real
# checkout.
REPO="${CHEWBACCA_REPO_DIR:-}"
if [ -z "$REPO" ]; then
  CONFIG="$HOME/.claude/d1-config.sh"
  # shellcheck source=/dev/null
  [ -f "$CONFIG" ] && . "$CONFIG"
  REPO="${CHEWBACCA_REPO_DIR:-}"
fi
if [ -z "$REPO" ] && [ -f "$HOME/.chewbacca/install-manifest.json" ]; then
  REPO="$(python3 -I -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("repo", ""))
except Exception:
    print("")
' "$HOME/.chewbacca/install-manifest.json" 2>/dev/null)"
fi
[ -n "$REPO" ] || exit 0
[ -d "$REPO/.git" ] || exit 0
cd "$REPO" || exit 0

# ── PATH tools run from a clean runtime of origin/main ────────────────────────
# ~/.local/bin used to link into this checkout's working tree, which is where
# every tab keeps its uncommitted edits, so the tools on PATH were whatever the
# dirty tree held. On 2026-10-10 the installed `chewbacca` refused writes main
# had allowed for hours because this checkout could not fast-forward. Now the
# links go through ~/.chewbacca/kit/current, a locked worktree of origin/main
# that nothing edits, and this rebuilds it: fetch (at most every
# CHEWBACCA_RUNTIME_FETCH_AGE seconds), new snapshot, atomic swap, then link
# any new tool and move any link still pointing in here. A launchd job runs the
# same update every 15 minutes between sessions. The script comes from the
# runtime when there is one, else from the ref, never from this working tree.
RUNTIME_SHA=""
_kr="$(mktemp -d 2>/dev/null)"
if [ -n "$_kr" ]; then
  _krs="${CHEWBACCA_KIT_RUNTIME:-$HOME/.chewbacca/kit}/current/tools/kit_runtime.py"
  if [ -f "$_krs" ]; then
    cp "$_krs" "$_kr/kit_runtime.py" 2>/dev/null
  else
    git -c core.fsmonitor=false show origin/main:tools/kit_runtime.py > "$_kr/kit_runtime.py" 2>/dev/null || rm -f "$_kr/kit_runtime.py"
  fi
  if [ -s "$_kr/kit_runtime.py" ]; then
    KR_OUT="$(python3 -I "$_kr/kit_runtime.py" update --repo "$REPO" --fetch \
              --max-age "${CHEWBACCA_RUNTIME_FETCH_AGE:-300}" \
              --link-bin "${CHEWBACCA_BIN_DIR:-$HOME/.local/bin}" --json 2>&1)"
    note "kit-runtime: $(printf '%s' "$KR_OUT" | tr '\n' ' ')"
    RUNTIME_SHA="$(printf '%s' "$KR_OUT" | python3 -I -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print("" if d.get("error") else d.get("sha") or "")
except Exception:
    print("")
' 2>/dev/null)"
    case "$KR_OUT" in
      *'"result": "updated"'*) say "PATH tools now run from origin/main ${RUNTIME_SHA:0:12} (runtime ~/.chewbacca/kit/current)." ;;
    esac
  fi
  rm -rf "$_kr"
fi

# ── Installed hooks follow origin/main ────────────────────────────────────────
# Same commit as the runtime when there is one, so hooks and tools never come
# from two different versions of the kit.
# Read from the ref, not the working tree, so this works on the dirty shared
# checkout the pull below refuses. On 2026-10-09 17 live hooks were stale and
# 2 missing hours after a hand sync. Every overwritten copy is backed up under
# ~/.chewbacca/runtime/hooks-backup-*. Runs before the throttle: it is local
# and takes well under a second.
# The script comes from the ref too: the shared checkout is usually dirty and
# behind, so its working tree may not have it yet.
if git -c core.fsmonitor=false cat-file -e origin/main:tools/hooks_sync.py 2>/dev/null; then
  SYNC="$(git -c core.fsmonitor=false show origin/main:tools/hooks_sync.py \
          | python3 -I - apply --include-local --repo "$REPO" --ref "${RUNTIME_SHA:-origin/main}" \
            --live "${CHEWBACCA_HOOKS_DIR:-$HOME/.claude/hooks}" 2>&1)"
  note "hooks-sync: $(printf '%s' "$SYNC" | tr '\n' ' ')"
  case "$SYNC" in
    *updated*) say "Installed hooks were behind origin/main and were updated in place (backups in ~/.chewbacca/runtime):
$(printf '%s' "$SYNC" | grep updated)" ;;
  esac
fi

# ── New tools reach PATH ──────────────────────────────────────────────────────
# A symlink follows the repo, so fixes to linked tools land on pull, but a NEW
# tool has no link until setup reruns, and nobody reruns it. On 2026-10-10 26
# tools setup.sh links were "command not found" on this Mac, text-command among
# them (Kyber runs it from ~/.local/bin). This only adds missing links; it never
# replaces a file. Same ref-not-tree reasoning as the hook sync above.
# Only when there is no runtime: the runtime update above already linked.
if [ -z "$RUNTIME_SHA" ] && git -c core.fsmonitor=false cat-file -e origin/main:tools/tools_link.py 2>/dev/null; then
  _tl="$(mktemp -d 2>/dev/null)"
  if [ -n "$_tl" ] && git -c core.fsmonitor=false show origin/main:tools/tools_link.py > "$_tl/tools_link.py" 2>/dev/null; then
    LINKED="$(git -c core.fsmonitor=false show origin/main:setup.sh 2>/dev/null \
              | python3 -I "$_tl/tools_link.py" apply --repo "$REPO" --setup - \
                --live "${CHEWBACCA_BIN_DIR:-$HOME/.local/bin}" 2>&1)"
    note "tools-link: $LINKED"
    case "$LINKED" in
      linked\ [1-9]*) say "New kit tools were not on PATH and are now: ${LINKED#linked }" ;;
    esac
  fi
  [ -n "$_tl" ] && rm -rf "$_tl"
fi

# ── Retired instructions in the installed CLAUDE.md ──────────────────────────
# The managed block only refreshes when setup reruns, so a rule removed from
# main kept firing on every installed Mac. The course AI-policy gate was the
# first (2026-10-11). Local, idempotent, from the ref like the syncs above.
if git -c core.fsmonitor=false cat-file -e origin/main:tools/claude_md_scrub.py 2>/dev/null; then
  _cs="$(mktemp -d 2>/dev/null)"
  if [ -n "$_cs" ] && git -c core.fsmonitor=false show origin/main:tools/claude_md_scrub.py > "$_cs/claude_md_scrub.py" 2>/dev/null; then
    note "claude-md-scrub: $(python3 -I "$_cs/claude_md_scrub.py" "${CHEWBACCA_CLAUDE_MD:-$HOME/.claude/CLAUDE.md}" 2>&1)"
  fi
  [ -n "$_cs" ] && rm -rf "$_cs"
fi

# ── Merge drivers ─────────────────────────────────────────────────────────────
# SHA256SUMS.txt and README's counts block merge through drivers named in
# .gitattributes (tools/merge_regen.py). Git config is never cloned, so a
# checkout set up before the drivers existed would fall back to conflicting
# on both, which is what every tab hit on 2026-10-09. Local, idempotent, and
# from the ref like hooks_sync above, so it works on a dirty checkout.
if git -c core.fsmonitor=false cat-file -e origin/main:tools/merge_regen.py 2>/dev/null &&
   [ -f "$REPO/tools/merge_regen.py" ]; then
  python3 -I "$REPO/tools/merge_regen.py" install --repo "$REPO" >/dev/null 2>&1 ||
    note "merge drivers: install failed"
fi

# ── Compact team index ────────────────────────────────────────────────────────
# Teammates import ~/.chewbacca/team-memory-index.md, a compact copy of
# team/memory/MEMORY.md (tools/team_index.py), instead of the 11,636-token
# full index. Rebuilt here from this checkout so a line another tab added
# shows up by the next session. Only where setup already wrote one: a
# stranger's install never imports team memory, so it never gets the file.
_ti_dst="${CHEWBACCA_HOME:-$HOME/.chewbacca}/team-memory-index.md"
_ti_tool="${CHEWBACCA_KIT_RUNTIME:-$HOME/.chewbacca/kit}/current/tools/team_index.py"
[ -f "$_ti_tool" ] || _ti_tool="$REPO/tools/team_index.py"
if [ -f "$_ti_dst" ] && [ -f "$_ti_tool" ] && [ -f "$REPO/team/memory/MEMORY.md" ]; then
  python3 -I "$_ti_tool" write --src "$REPO/team/memory/MEMORY.md" --dst "$_ti_dst" >/dev/null 2>&1 ||
    note "team index: rebuild failed"
fi

# ── Throttle ──────────────────────────────────────────────────────────────────
# A fetch is a network round trip and SessionStart runs on every new session.
# Once an hour keeps a long day current without paying for it on every window.
STAMP="$LOG_DIR/.autopull-stamp"
NOW="$(date +%s)"
INTERVAL="${CHEWBACCA_PULL_INTERVAL:-3600}"
if [ -f "$STAMP" ]; then
  LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
  case "$LAST" in (*[!0-9]*|"") LAST=0 ;; esac
  [ $((NOW - LAST)) -lt "$INTERVAL" ] && exit 0
fi

# ── Refuse on anything that could cost work ───────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$BRANCH" != "main" ]; then
  note "skipped: on branch '$BRANCH'"
  exit 0
fi

git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 || exit 0
TRACKED_REMOTE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null | cut -d/ -f1)"
if [ -n "$TRACKED_REMOTE" ] && [ "$TRACKED_REMOTE" != "origin" ]; then
  note "refused: branch tracks '$TRACKED_REMOTE', not origin"
  exit 0
fi

# THE ONE THAT MATTERS. A dirty tree is never fast-forwarded into.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  note "refused: working tree is dirty"
  exit 0
fi

echo "$NOW" > "$STAMP" 2>/dev/null || true

# ── Fetch and fast-forward ────────────────────────────────────────────────────
git fetch origin --quiet 2>/dev/null || { note "fetch failed"; exit 0; }

BEHIND="$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
case "$BEHIND" in (*[!0-9]*|"") BEHIND=0 ;; esac
[ "$BEHIND" -gt 0 ] || exit 0

BEFORE="$(git rev-parse HEAD 2>/dev/null)"
if ! git merge --ff-only '@{u}' --quiet 2>/dev/null; then
  note "could not fast-forward, $BEHIND commit(s) behind"
  say "Kit repo is $BEHIND commit(s) behind origin/main and could not fast-forward, so nothing was changed. The local branch has diverged. Resolve it before relying on anything in the kit being current."
  exit 0
fi
AFTER="$(git rev-parse HEAD 2>/dev/null)"

CHANGED="$(git diff --name-only "$BEFORE..$AFTER" 2>/dev/null)"
SUBJECTS="$(git log --oneline --no-decorate "$BEFORE..$AFTER" 2>/dev/null | head -10)"
note "pulled $BEHIND commit(s)"

# Pulling code is not installing it. setup.sh is what puts hooks, skills and
# tools where the agent reads them, so a pull that touched any of those left
# the machine running the old copy. Say so, and say it as a fact rather than
# as a chore for the user: the agent reads this and can run it.
NEEDS_SETUP=""
case "$CHANGED" in
  *setup.sh*|*.claude/hooks/*|*skills/*|*bin/*|*commands/*) NEEDS_SETUP=1 ;;
esac

MSG="Kit repo fast-forwarded $BEHIND commit(s) from origin/main:
$SUBJECTS"
if [ -n "$NEEDS_SETUP" ]; then
  MSG="$MSG

This pull touched setup.sh, hooks, skills, bin or commands, so what is installed
under ~/.claude and ~/.local/bin is now older than the repo. Run 'chewbacca setup'
to install what was just pulled."
fi
say "$MSG"
exit 0
