#!/bin/bash
# Resolve both checkout hooks and copies installed in ~/.claude/hooks.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 -I -c '
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
