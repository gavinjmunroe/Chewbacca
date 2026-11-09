#!/usr/bin/env python3
"""Skip the kit's project CLAUDE.md and rules where ~/.claude already loads the same text.

    python3 tools/claude_md_dedupe.py excludes             the duplicate files, dry run
    python3 tools/claude_md_dedupe.py excludes --apply     write them to ~/.claude/settings.json

bin/context-budget measures where turn 1 goes; this removes one line item. Inside the kit's own checkout, Claude Code loaded the kit twice: once
from ~/.claude (setup copies CLAUDE.md's kit section and the always-on rules
there) and again as the project's CLAUDE.md and .claude/rules. On 2026-10-16
bin/context-budget put the project copies at 14,624 tokens on turn 1 of every kit session,
the same text twice. Claude Code's claudeMdExcludes skips project files by
path. Only a project file whose global twin has the same bytes (or, for
CLAUDE.md, whose text the global CLAUDE.md contains) is excluded, so nothing
loads less than it did, and a rule the global copy lacks keeps loading.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def kit_duplicates(root: Path, home: Path) -> list[str]:
    """Project instruction files under the kit root that ~/.claude already loads."""
    out = []
    g = home / ".claude" / "CLAUDE.md"
    p = root / "CLAUDE.md"
    try:
        if p.is_file() and g.is_file() and p.read_text().strip() in g.read_text():
            out.append("CLAUDE.md")
    except OSError:
        pass
    for rule in sorted((root / ".claude" / "rules").glob("*.md")):
        twin = home / ".claude" / "rules" / rule.name
        try:
            if twin.is_file() and twin.read_bytes() == rule.read_bytes():
                out.append(f".claude/rules/{rule.name}")
        except OSError:
            continue
    return out


def patterns(root: Path, names: list[str]) -> list[str]:
    """The kit checkout and every worktree under it."""
    pats = []
    for name in names:
        pats.append(f"{root}/{name}")
        pats.append(f"{root}/.claude/worktrees/*/{name}")
    return pats


def apply(settings_path: Path, pats: list[str], root: Path) -> list[str]:
    try:
        settings = json.loads(settings_path.read_text())
    except (OSError, ValueError):
        settings = {}
    keep = [p for p in settings.get("claudeMdExcludes", []) if not p.startswith(str(root) + "/")]
    settings["claudeMdExcludes"] = keep + pats
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")
    return settings["claudeMdExcludes"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("excludes")
    e.add_argument("--apply", action="store_true")
    e.add_argument("--root", default=str(ROOT))
    e.add_argument("--home", default=str(Path.home()))
    a = ap.parse_args()
    root, home = Path(a.root).resolve(), Path(a.home)
    names = kit_duplicates(root, home)
    pats = patterns(root, names)
    if a.apply:
        apply(home / ".claude" / "settings.json", pats, root)
    for p in pats:
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
