#!/bin/bash
# closeout fans the suite out by group. If _groups() finds none, it falls back
# to one sequential run that took 9 to 14 minutes (BACKLOG 116, 2026-09-28),
# because the regex missed every `if group "..."` line. This pins the count.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import importlib.machinery, importlib.util, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
loader = importlib.machinery.SourceFileLoader("closeout", str(root / "bin" / "closeout"))
spec = importlib.util.spec_from_loader("closeout", loader)
mod = importlib.util.module_from_spec(spec)
sys.argv = ["closeout", "--help"]
try:
    loader.exec_module(mod)
except SystemExit:
    pass
suite = root / "tests" / "run.sh"
want = sorted(set(re.findall(r'group "([^"]+)"', suite.read_text())))
cls = next(v for v in vars(mod).values() if isinstance(v, type) and hasattr(v, "_groups"))
got = sorted(cls._groups(suite))
if got != want or not got:
    print(f"FAIL  closeout found {len(got)} groups, run.sh has {len(want)}: missing {sorted(set(want)-set(got))}")
    raise SystemExit(1)
print(f"ok    closeout fans out all {len(got)} groups in run.sh")
PY
