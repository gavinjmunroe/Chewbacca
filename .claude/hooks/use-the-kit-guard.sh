#!/bin/bash
# hookd skips this guard for a Bash call without the flag it refuses.
# Proven by tools/hookd_replay.py: 0.060 s of CPU on every Bash call before
# (2026-10-12).
# gate: print-to-pdf api.todoist.com text/html
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init use-the-kit-guard.sh 5
# PreToolUse on Bash: a hand-rolled pipeline for a job the kit already does
# well is refused with the one command that does it.
#
# 2026-10-11 9:56pm: four briefs to PDF took minutes because a pandoc + Chrome
# --print-to-pdf pipeline waited on a Chrome that never exits after printing.
# The fix for exactly that had shipped the day before inside the GTM report,
# where nobody making a PDF looked. Caleb: "Fix chewb so u never take forever on
# smth that should take 2 seconds". Each row below is a job with a tested
# command; add a row whenever a solved job gets rebuilt by hand.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# The kit's own tools may use the primitives they wrap.
printf '%s' "$cmd" | grep -qE 'chewbacca-pdf|tests/' && exit 0

refuse() {
  echo "use-the-kit-guard: $1" >&2
  exit 2
}
printf '%s' "$cmd" | grep -qE -- '--print-to-pdf' &&
  refuse "making a PDF by hand. Run: chewbacca pdf <file.md>... [--out <folder>] (about 2 s a file, never waits on Chrome)."
# 2026-10-29: a Meridian call doc uploaded as HTML with a <style> block came
# into Google Docs as one cramped black block, because a Docs import drops
# classes ("Cancer ahh formatting"). An HTML upload to Drive whose file still
# carries a <style> block or class= is pointed at the tool that inlines it all.
if printf '%s' "$cmd" | grep -q 'drive files' && printf '%s' "$cmd" | grep -q 'text/html'; then
  up="$(printf '%s' "$cmd" | sed -nE "s/.*--upload[ =]+(\"([^\"]+)\"|'([^']+)'|([^ ]+)).*/\\2\\3\\4/p")"
  up="${up/#\~/$HOME}"
  if [ -f "$up" ] && grep -qiE '<style|class=' "$up"; then
    refuse "that HTML uses a <style> block or classes, which Google Docs drops. For a call, pitch or meeting doc run: chewbacca call-doc <script.txt> (\"say\" lines, ! actions, ## steps, ### beats). Otherwise inline every style."
  fi
fi
# 2026-10-13: "save to the todo" landed nine tasks in Todoist, a week after
# Caleb said "For rn I don't use todoist, chewbacca is my digital life"
# (2026-10-07). The memory said so; the agent read which apps were configured
# instead. A person whose ~/.chewbacca/todo-backend says "ledger" gets every
# Todoist write refused with the command that puts the task where they look.
backend="$(head -n1 "${CHEWBACCA_HOME:-$HOME/.chewbacca}/todo-backend" 2>/dev/null)"
if [ "$backend" = "ledger" ] && printf '%s' "$cmd" | grep -q 'api\.todoist\.com' &&
  printf '%s' "$cmd" | grep -qiE -- '-X *(POST|DELETE)|--data|-d |data=|method=|urlopen'; then
  printf '%s' "$cmd" | grep -qiE -- '-X *DELETE|method="?DELETE' ||
    refuse "this person doesn't use Todoist (~/.chewbacca/todo-backend says ledger). Run: work-ledger add --scope ~ --owner <name> --source-key <slug> --title \"<task>\" --next-action \"<link or step>\""
fi
exit 0
