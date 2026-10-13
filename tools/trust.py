#!/usr/bin/env python3
"""What stays on this Mac and what leaves it, in plain words.

    chewbacca trust            the statement, for a person
    chewbacca trust --json     the same, for a page or an agent

The words live in config/trust.json, one entry per thing Chewbacca reads.
tests/test_trust.py fails when a new source is added to the OS graph without
an entry here, or when an entry slips into jargon, so the statement cannot
fall behind what the code actually reads.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRUST = ROOT / "config" / "trust.json"


def load(path: Path = TRUST) -> dict:
    data = json.loads(path.read_text())
    if data.get("schema_version") != 1:
        raise ValueError("unsupported trust.json version")
    return data


def render(data: dict) -> str:
    lines = ["What stays on this Mac", "", data["kept_on_mac"], "",
             "What leaves it", "", data["assistant"], ""]
    for line in data["never"]:
        lines.append(f"- {line}")
    lines += ["", "Each thing Chewbacca can read", ""]
    for source in data["sources"].values():
        lines.append(f"- {source['name']}: reads {source['reads']}. Leaves: {source['leaves']}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chewbacca trust", description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print the statement as JSON")
    args = parser.parse_args(argv)
    data = load()
    sys.stdout.write(json.dumps(data, indent=1) + "\n" if args.json else render(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
