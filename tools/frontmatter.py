#!/usr/bin/env python3
"""Check that every SKILL.md frontmatter actually parses.

A skill whose YAML is malformed does not fail loudly. It fails by not being
registered, so the agent never sees it and the user concludes the skill is bad
at triggering. `life-ops` shipped that way: its description read

    description: The half of a week that is not code and not class: appointments, ...

and the unquoted colon makes YAML read `... not class` as a nested key. One
character, and a whole skill is invisible.

No pyyaml on a stock macOS python, so this checks the specific constructs that
break a frontmatter block rather than parsing the general language. That is a
narrower claim and an honest one.

  python3 tools/frontmatter.py                check the repo's skills
  python3 tools/frontmatter.py --installed    check ~/.claude/skills too
  python3 tools/frontmatter.py path/to/skills check any directory of skills
  python3 tools/frontmatter.py --staged       check the staged SKILL.md files
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REQUIRED = ("name", "description")
MAX_DESCRIPTION = 1024
# What a kit skill's description may cost in every session's skill listing.
# On 2026-10-11 the listing held 392 entries and Claude Code kept descriptions
# for only 56 of them, so a long description both costs tokens and crowds other
# skills down to a bare name. 67 of 69 kit skills ran past this, up to 1,015
# characters; the full routing text moved to `triggers:`, which routing reads
# and Claude Code never loads. 220 is the 200 asked for plus slack for one word.
MAX_LISTED = 220


def problems(path, text=None, listed_cap=True):
    """Every reason this file's frontmatter would not load, or costs too much.

    listed_cap holds kit skills to MAX_LISTED; other people's skills in
    ~/.claude/skills are checked only for whether they load."""
    if text is None:
        text = path.read_text(encoding="utf-8", errors="replace")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return ["no frontmatter block (must open on line 1 with ---)"]

    out = []
    seen = set()
    for raw in m.group(1).split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[0] in " \t":          # a continuation or nested value, not a key
            continue
        if ":" not in raw:
            out.append(f"line is not a key/value pair: {raw[:60]}")
            continue
        key, _, value = raw.partition(":")
        seen.add(key.strip())
        value = value.strip()
        if not value:
            continue
        # The one that bit us. An unquoted scalar containing ": " is read as a
        # nested mapping and the whole block fails.
        if value[0] not in "\"'[{" and ": " in value:
            out.append(f"{key.strip()}: unquoted value contains ': ' — wrap it in quotes")
        # An unbalanced quote swallows the rest of the block.
        if value[0] in "\"'" and not value.endswith(value[0]):
            out.append(f"{key.strip()}: opening quote is never closed")
        # Claude Code, Codex and Perplexity all cap a skill description at
        # 1024 characters. Past that the skill is rejected or cut off.
        if key.strip() == "description" and len(value.strip("\"'")) > MAX_DESCRIPTION:
            out.append(f"description is {len(value.strip(chr(34)+chr(39)))} chars; the limit is {MAX_DESCRIPTION}")
        elif key.strip() == "description" and listed_cap and len(value.strip("\"'")) > MAX_LISTED:
            out.append(f"description is {len(value.strip(chr(34)+chr(39)))} chars; kit skills keep it under "
                       f"{MAX_LISTED} and put the full routing text in a `triggers: >-` block")

    for r in REQUIRED:
        if r not in seen:
            out.append(f"missing required key '{r}'")
    return out


def staged():
    """Check the SKILL.md bytes about to be committed, not the working tree.

    The push gate caught screen-time's unquoted colon on 2026-10-09, but only
    after the commit was already on main: another tab's push had carried it
    there, and every Stop hook after that was blocked on a file nobody in that
    tab had touched. Checking at commit time stops it in the tab that wrote it.
    The index is read, so an unstaged fix doesn't hide a staged break.
    """
    import subprocess
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
        capture_output=True, check=True).stdout.decode().split("\0")
    bad = 0
    for name in names:
        if not name.endswith("SKILL.md"):
            continue
        text = subprocess.run(["git", "show", ":" + name], capture_output=True,
                              check=True).stdout.decode("utf-8", "replace")
        for p in problems(Path(name), text):
            bad += 1
            print(f"{name}: {p}")
    if bad:
        print(f"\n{bad} problem(s) in staged skills. "
              f"A skill that does not parse is a skill that never fires.")
        return 1
    return 0


def main():
    if "--staged" in sys.argv:
        return staged()
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    # An explicit path wins, so this can check a directory it does not live in.
    # Defaulting to the repo made the tool untestable against a deliberately
    # broken fixture, which is the only way to know the check can fail at all.
    roots = [Path(a).resolve() for a in args] or [REPO / "skills"]
    if "--installed" in sys.argv:
        roots.append(Path.home() / ".claude" / "skills")

    bad = 0
    checked = 0
    installed = (Path.home() / ".claude" / "skills").resolve()
    for root in roots:
        for path in sorted(root.glob("*/SKILL.md")):
            checked += 1
            for p in problems(path, listed_cap=root.resolve() != installed):
                bad += 1
                rel = path if not str(path).startswith(str(REPO)) else path.relative_to(REPO)
                print(f"{rel}: {p}")

    if bad:
        print(f"\n{bad} problem(s) in {checked} skill(s). "
              f"A skill that does not parse is a skill that never fires.")
        return 1
    print(f"ok  {checked} skill frontmatter block(s) parse")
    return 0


if __name__ == "__main__":
    sys.exit(main())
