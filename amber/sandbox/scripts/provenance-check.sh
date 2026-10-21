#!/usr/bin/env bash
# Validate provenance JSON files and expected source SHAs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MEDHA_SANDBOX_ROOT="$ROOT"

python3 <<'PY'
import json, os, sys
from pathlib import Path

root = Path(os.environ["MEDHA_SANDBOX_ROOT"])
expected = {
    root / "domains/peoplerank/.provenance.json": {
        "source_repo": "amber-organization/peoplerank-sandbox",
        "source_sha": "ddb3117",
    },
    root / "domains/tizzy/.provenance.json": {
        "source_repo": "amber-organization/tizzy",
        "source_sha": "b8e19c5",
    },
}

errors = []
for path, fields in expected.items():
    if not path.exists():
        errors.append(f"missing {path}")
        continue
    data = json.loads(path.read_text())
    for k, v in fields.items():
        if data.get(k) != v:
            errors.append(f"{path}: expected {k}={v!r}, got {data.get(k)!r}")

messaging = root / "domains/messaging/.provenance.json"
if not messaging.exists():
    errors.append(f"missing {messaging}")
else:
    data = json.loads(messaging.read_text())
    if data.get("messages2", {}).get("source_sha") != "59be9b4":
        errors.append("messages2 sha mismatch")
    if data.get("messages2kit", {}).get("source_sha") != "c2d2a74":
        errors.append("messages2kit sha mismatch")

ventures = root / "ventures/.provenance.json"
if not ventures.exists():
    errors.append(f"missing {ventures}")
else:
    json.loads(ventures.read_text())

clearout = root / "domains/clearout/.provenance.json"
if not clearout.exists():
    errors.append(f"missing {clearout}")
else:
    data = json.loads(clearout.read_text())
    if data.get("source_sha") != "04d361b":
        errors.append("clearout sha mismatch")
    if data.get("source_path") != "social/clearout":
        errors.append("clearout source_path mismatch")

if errors:
    print("provenance-check FAILED:")
    for e in errors:
        print(" -", e)
    sys.exit(1)

print("provenance-check PASS")
PY
