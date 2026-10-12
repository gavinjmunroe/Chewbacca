#!/usr/bin/env python3
"""Which always-loaded rules have a check, and the share that do.

Reads docs/plans/rule-checks.json. `share` prints the number reengineer step 15
names; `verify` fails when a rule claims a check that doesn't exist, isn't
executable, isn't registered, or when the share drops under the floor.

    tools/rule_checks.py share [--json]
    tools/rule_checks.py verify
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "docs" / "plans" / "rule-checks.json"
STATUSES = {"check", "prose", "propose-delete", "propose-move"}


def load(path: Path = REGISTRY) -> dict:
    return json.loads(path.read_text())


def share(reg: dict) -> tuple:
    rules = reg["rules"]
    checked = sum(1 for r in rules if r["status"] == "check")
    return checked, len(rules)


def problems(reg: dict, root: Path = ROOT) -> list:
    out = []
    setup = (root / "setup.sh").read_text() if (root / "setup.sh").exists() else ""
    ids = set()
    for r in reg["rules"]:
        rid = r.get("id", "?")
        if rid in ids:
            out.append(f"{rid}: listed twice")
        ids.add(rid)
        if r.get("status") not in STATUSES:
            out.append(f"{rid}: unknown status {r.get('status')!r}")
            continue
        if r["status"] != "check":
            if r.get("checks"):
                out.append(f"{rid}: status {r['status']} but names checks")
            continue
        if not r.get("checks"):
            out.append(f"{rid}: status check with no checks named")
        for c in r.get("checks", []):
            p = root / c
            if not p.is_file():
                out.append(f"{rid}: {c} does not exist")
            elif not c.startswith(".claude/hooks/") and not os.access(p, os.X_OK):
                # git skips a hook without the bit, and bin/ runs by name.
                # .claude/hooks are copied and chmodded by setup (essay-gate.sh
                # is 0644 in git and 0755 live), so their bit isn't judged.
                out.append(f"{rid}: {c} is not executable")
            elif c.startswith(".claude/hooks/") and f"/{p.name}" not in setup:
                # A hook nothing registers never fires (feedback_built_but_never_fires).
                out.append(f"{rid}: {c} is not registered in setup.sh")
    checked, total = share(reg)
    if total and checked / total + 1e-9 < float(reg.get("floor", 0)):
        out.append(f"share {checked}/{total} = {checked / total:.3f} is under the floor {reg['floor']}")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["share", "verify"])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--registry", type=Path, default=REGISTRY)
    ap.add_argument("--root", type=Path, default=ROOT)
    a = ap.parse_args(argv)
    reg = load(a.registry)
    checked, total = share(reg)
    if a.cmd == "share":
        by = {}
        for r in reg["rules"]:
            by.setdefault(r["status"], []).append(r["id"])
        if a.json:
            print(json.dumps({"checked": checked, "rules": total,
                              "share": round(checked / total, 3) if total else 0,
                              "floor": reg.get("floor"), "by_status": by}))
        else:
            print(f"{checked} of {total} rules have a check ({checked / total:.1%}), floor {reg.get('floor')}")
            for status in ("prose", "propose-move", "propose-delete"):
                if by.get(status):
                    print(f"  {status}: {', '.join(by[status])}")
        return 0
    bad = problems(reg, a.root)
    for b in bad:
        print(f"rule-checks: {b}", file=sys.stderr)
    if not bad:
        print(f"rule-checks: ok, {checked} of {total} with a check")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
