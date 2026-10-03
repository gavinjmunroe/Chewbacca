#!/bin/bash
# closeout fans the suite out by group. If Checks.groups() finds none, it falls back
# to one sequential run that took 9 to 14 minutes (BACKLOG 116, 2026-09-28),
# because the regex missed every `if group "..."` line. This pins the count.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import importlib.machinery, importlib.util, pathlib, subprocess, sys, tempfile
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
want = subprocess.run(["bash", str(suite), "--list"], check=True,
                      capture_output=True, text=True).stdout.splitlines()
got = mod.Checks.groups(suite)
if got != want or not got:
    print(f"FAIL  closeout found {len(got)} groups, run.sh has {len(want)}: missing {sorted(set(want)-set(got))}")
    raise SystemExit(1)
print(f"ok    closeout fans out all {len(got)} groups in run.sh")
with tempfile.TemporaryDirectory() as directory:
    fixture = pathlib.Path(directory) / "run.sh"
    fixture.write_text('''# group "comment"
echo 'group "string"'
if group "second"; then
  group "first"
if group "second"; then
''')
    assert mod.Checks.groups(fixture) == ["second", "first"], "order, deduplication or false-match regression"
    fixture.write_text("# no declarations\n")
    assert mod.Checks.groups(fixture) == [], "empty suite must use sequential fallback"
    assert mod.Checks.groups(fixture.with_name("missing.sh")) == [], "missing suite must use sequential fallback"
print("ok    group discovery preserves order, deduplicates and ignores non-declarations")
PY
