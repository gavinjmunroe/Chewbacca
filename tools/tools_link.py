#!/usr/bin/env python3
"""Put every command-line tool setup.sh would link onto PATH, without rerunning setup.

setup.sh symlinks each tool from bin/ into ~/.local/bin, and a symlink follows
the repo, so a fix to an existing tool lands on the next pull. A NEW tool does
not: it has no link until somebody reruns setup, and nobody does. On
2026-10-10 this Mac's links dated from a 10/3 install, so gtme-reply,
gtme-dedupe, gtme-signals and dozens more were on main and "command not found"
here. kit-autopull already said "run chewbacca setup" after every pull, and
the message changed nothing.

So this reads setup.sh, collects every name it passes to link_tool (literal
calls and the names in a `for x in ...; do link_tool "$x"` loop), and sorts
each one:

  linked    ~/.local/bin/<name> exists (anything at all: never touched)
  missing   bin/<name> is in the repo and nothing is at ~/.local/bin/<name>
  absent    setup names it but bin/<name> isn't in this checkout yet

`scan` (the default) reports. `apply` creates the missing symlinks, the same
link setup.sh's link_tool makes, and nothing else: it never replaces or
removes a file that's already there, so a tool someone installed another way
stays theirs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

LITERAL = re.compile(r"\blink_tool\s+([A-Za-z0-9][A-Za-z0-9_.-]*)\b")
LOOP = re.compile(r"^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]+);\s*do\b")
DONE = re.compile(r"^\s*done\b")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def names_from_setup(text: str) -> list[str]:
    """Every tool name setup.sh hands to link_tool, in file order, once each."""
    found: list[str] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("#"):
            i += 1
            continue
        loop = LOOP.match(line)
        if loop:
            var, items = loop.group(1), loop.group(2).split()
            body = []
            j = i + 1
            while j < len(lines) and not DONE.match(lines[j]):
                body.append(lines[j])
                j += 1
            calls = re.compile(r'\blink_tool\s+"?\$\{?' + re.escape(var) + r'\}?"?')
            if any(calls.search(b) for b in body):
                found += [n for n in items if NAME.match(n)]
            i = j + 1
            continue
        found += LITERAL.findall(line)
        i += 1
    seen: set[str] = set()
    return [n for n in found if not (n in seen or seen.add(n))]


def sort_tools(repo: Path, live: Path, names: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {"linked": [], "missing": [], "absent": []}
    for name in names:
        dst = live / name
        if dst.exists() or dst.is_symlink():
            out["linked"].append(name)
        elif (repo / "bin" / name).is_file():
            out["missing"].append(name)
        else:
            out["absent"].append(name)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tools_link", description=__doc__.splitlines()[0])
    parser.add_argument("mode", nargs="?", choices=("scan", "apply"), default="scan")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--live", default=str(Path.home() / ".local" / "bin"))
    parser.add_argument("--setup", help="read setup.sh from here (default: <repo>/setup.sh); - for stdin")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    repo, live = Path(args.repo).resolve(), Path(args.live)
    if args.setup == "-":
        text = sys.stdin.read()
    else:
        setup = Path(args.setup) if args.setup else repo / "setup.sh"
        if not setup.is_file():
            print(f"tools_link: no setup.sh at {setup}", file=sys.stderr)
            return 2
        text = setup.read_text(encoding="utf-8", errors="replace")

    state = sort_tools(repo, live, names_from_setup(text))
    made: list[str] = []
    if args.mode == "apply" and state["missing"]:
        live.mkdir(parents=True, exist_ok=True)
        for name in state["missing"]:
            dst = live / name
            # Re-check right before writing: another session may have linked it.
            if dst.exists() or dst.is_symlink():
                continue
            os.symlink(repo / "bin" / name, dst)
            made.append(name)

    if args.json:
        print(json.dumps({**state, "linked_now": made}))
    elif args.mode == "apply":
        print(f"linked {len(made)}: {' '.join(made)}" if made else "nothing to link")
    else:
        print(f"{len(state['linked'])} linked, {len(state['missing'])} missing, "
              f"{len(state['absent'])} not in this checkout")
        if state["missing"]:
            print("missing: " + " ".join(state["missing"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
