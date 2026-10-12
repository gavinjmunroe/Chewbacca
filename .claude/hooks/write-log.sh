#!/bin/bash
# Resolve both checkout hooks and copies installed in ~/.claude/hooks.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python_write_log() {
  python3 -I -c '
import os
from pathlib import Path
import runpy
import shutil
import sys
roots = [Path(sys.argv[1])]
# The kit runtime (origin/main) before a checkout: a shared checkout can sit
# far behind, and on 2026-10-11 its write_log.py cost 1.6 s CPU per call to
# 0.37 s for the runtime copy.
kit = Path.home() / ".chewbacca/kit/current"
if (kit / "tools/write_log.py").is_file():
    roots.insert(0, kit)
if os.environ.get("CHEWBACCA_ROOT"):
    roots.insert(0, Path(os.environ["CHEWBACCA_ROOT"]).expanduser())
launchers = [Path.home() / ".local/bin/chewbacca"]
if shutil.which("chewbacca"):
    launchers.append(Path(shutil.which("chewbacca")))
roots.extend(path.resolve().parent.parent for path in launchers if path.is_file())
for root in roots:
    script = root / "tools/write_log.py"
    if script.is_file():
        runpy.run_path(str(script), run_name="__main__")
        break
else:
    print("write-log: shared checkout unavailable; durability evidence may be incomplete.", file=sys.stderr)
' "$ROOT"
}

# chewbacca-writelog (crates/writelog) answers the same hook in Rust and reads
# the brain from an FSEvents journal instead of `git status`. The mode file
# picks who writes the real log:
#   python  write_log.py only (the default, and what runs with no binary)
#   shadow  write_log.py writes the log; the binary writes write-log.shadow.tsv
#           beside it, for tools/writelog_parity.py to compare
#   rust    the binary, with write_log.py for any payload it hands back (exit 75)
H="${CHEWBACCA_HOME:-$HOME/.chewbacca}"
BIN="${CHEWBACCA_WRITELOG_BIN:-$HOME/.local/bin/chewbacca-writelog}"
MODE="${CHEWBACCA_WRITELOG_MODE:-}"
if [ -z "$MODE" ]; then
  if [ -r "$H/writelog.mode" ]; then
    read -r MODE < "$H/writelog.mode"
  elif [ -n "${CHEWBACCA_WRITELOG_BIN:-}" ]; then
    MODE=rust
  fi
fi
if [ ! -x "$BIN" ] || { [ "$MODE" != rust ] && [ "$MODE" != shadow ]; }; then
  python_write_log
  exit $?
fi

if [ "$MODE" = rust ]; then
  # exec, no pipe: on 2026-10-11 at load 10 each extra process here cost
  # 4.5 ms of CPU, and cat plus a printf subshell were two of them. The
  # binary runs this script again in python mode for a payload it hands back.
  exec "$BIN" hook --fallback "${BASH_SOURCE[0]}"
fi

payload=$(cat)
if [ "$MODE" = shadow ]; then
  # The binary's window encloses Python's (it starts first and finishes
  # last), so a row only Python logs is a real miss, not timing.
  # The event from its first mention: hosts put hook_event_name before
  # tool_input, and a command can quote the phrase itself.
  event="${payload#*\"hook_event_name\"}"
  event="${event#"${event%%[![:space:]:]*}"}"
  case "$event" in
    '"PreToolUse"'*)
      printf '%s' "$payload" | "$BIN" hook --shadow 2>/dev/null
      python_write_log <<<"$payload"
      ;;
    *)
      python_write_log <<<"$payload"
      rc=$?
      printf '%s' "$payload" | "$BIN" hook --shadow 2>/dev/null
      exit $rc
      ;;
  esac
fi
exit 0
