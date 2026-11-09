#!/usr/bin/env python3
"""What the kit costs you before you type a single word.

CLAUDE.md is 957 lines and loads into every session. Nobody had ever measured
what that costs, so every argument about whether a rule earns its place was an
argument about taste.

  chewbacca context           per-file cost of everything always loaded
  chewbacca context --json    the same as data
  chewbacca context --budget  exit 1 if the always-on total is over budget

Token counts are characters/4, the standard rough estimate. It is an estimate
and it is labeled as one. Being approximately right beats having no number.
"""

import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()

CLAUDE = HOME / ".claude"
# What the kit may spend before the user's own work starts. Raise it in
# ~/.chewbacca/context-budget if you deliberately load a large personal
# context; a budget you cannot meet and will not change is just noise.
def _budget():
    f = Path.home() / ".chewbacca/context-budget"
    try:
        return int(f.read_text().strip())
    except (OSError, ValueError):
        return 15000


BUDGET_TOKENS = _budget()


def est_tokens(text):
    return len(text) // 4


def read(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def imports_of(text, base):
    """@~/path imports in a CLAUDE.md, resolved."""
    out = []
    for m in re.finditer(r"^@(\S+)", text, re.M):
        p = Path(os.path.expanduser(m.group(1)))
        if not p.is_absolute():
            p = base / p
        out.append(p)
    return out


def conditional_rules(claude_md):
    """Rules that actually load on demand, read from the mechanism that defers them.

    Counting a rule that only loads for UI work as always-on made a backend
    session look like it was paying for the animation rules. It is not, and
    saying it is would send someone trimming the wrong file.

    What defers a rule is `paths:` frontmatter on the rule itself. This used to
    read a table in CLAUDE.md instead, which is a description of the deferral
    rather than the deferral. The two agreed by luck, and a tool that measures a
    proxy can be satisfied by editing the proxy: adding a table row would have
    dropped 1,176 tokens off this report without changing what any session
    actually loads. A number that can be fixed by editing prose is not a
    measurement.
    """
    names = set()
    for f in sorted((CLAUDE / "rules").glob("*.md")):
        # Read enough for a whole frontmatter block, not a fixed prefix. A
        # 400-byte window silently stopped matching the moment a rule carried a
        # comment in its frontmatter, and the rule then counted as always-on
        # while actually being deferred.
        try:
            head = f.read_text(encoding="utf-8", errors="ignore")[:8000]
        except OSError:
            continue
        if not head.startswith("---"):
            continue
        end = head.find("\n---", 3)
        if end == -1:
            continue
        if re.search(r"^\s*(paths|globs)\s*:", head[3:end], re.M):
            names.add(f.name)
    return names


def collect():
    items = []
    root = CLAUDE / "CLAUDE.md"
    body = ""
    if root.is_file():
        body = read(root)
        items.append(("CLAUDE.md", root, est_tokens(body), "every session"))
        for imp in imports_of(body, CLAUDE):
            if imp.is_file():
                items.append((f"  import {imp.name}", imp, est_tokens(read(imp)), "every session"))
    on_demand = conditional_rules(body)
    for f in sorted((CLAUDE / "rules").glob("*.md")):
        when = "on demand" if f.name in on_demand else "every session"
        items.append((f"rule {f.name}", f, est_tokens(read(f)), when))
    mem = HOME / "second-brain/memory/MEMORY.md"
    if mem.is_file():
        items.append(("MEMORY.md", mem, est_tokens(read(mem)), "every session"))
    # Skill descriptions load for routing even when the skill body does not.
    desc = 0
    n = 0
    for f in list((CLAUDE / "skills").glob("*/SKILL.md")) + list((CLAUDE / "commands").glob("*.md")):
        d = description(read(f))
        if d:
            desc += est_tokens(d)
            n += 1
    if n:
        items.append((f"{n} skill and command descriptions", CLAUDE / "skills", desc, "every session"))
    # Enabled plugins list their skills and commands in the same listing. This
    # counted only ~/.claude/skills until 2026-10-11, when the real listing in a
    # transcript held 392 entries against the 203 counted here.
    pdesc = 0
    pn = 0
    for root in plugin_roots():
        for f in list(root.glob("skills/*/SKILL.md")) + list(root.glob("commands/*.md")):
            d = description(read(f))
            if d:
                pdesc += est_tokens(d)
                pn += 1
    if pn:
        items.append((f"{pn} plugin skill descriptions", CLAUDE / "plugins", pdesc, "every session"))
    return items


def description(text):
    """The frontmatter description, folded onto one line when it is a YAML block."""
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    head = text[3:end] if end != -1 else ""
    m = re.search(r"^description:[ \t]*(.*)$", head, re.M)
    if not m:
        return ""
    first = m.group(1).strip()
    if first and first not in (">", "|", ">-", "|-"):
        return first.strip("\"'")
    more = []
    for line in head[m.end():].splitlines()[1:]:
        if line and not line[0].isspace():
            break
        more.append(line.strip())
    return " ".join(x for x in more if x)


def plugin_roots():
    """Install folders of every plugin settings.json enables, plus account-synced ones."""
    try:
        enabled = json.loads(read(CLAUDE / "settings.json") or "{}").get("enabledPlugins", {})
        installed = json.loads(read(CLAUDE / "plugins/installed_plugins.json") or "{}").get("plugins", {})
    except ValueError:
        enabled, installed = {}, {}
    roots, seen = [], set()
    for key, on in enabled.items():
        for entry in installed.get(key, [])[-1:] if on is True else []:
            p = Path(entry.get("installPath", ""))
            if p.is_dir():
                roots.append(p)
                seen.add(key.split("@")[0])
    # Plugins synced from the claude.ai account (figma, cowork-plugin-management)
    # sit in buckets with one folder per generation, `name~g4` beside `name`.
    for manifest in sorted((CLAUDE / "plugins/synced").glob("*/manifest.json")):
        try:
            plugins = json.loads(read(manifest) or "{}").get("plugins", [])
        except ValueError:
            continue
        for p in plugins:
            name = p.get("name", "")
            if not name or name in seen:
                continue
            for cand in (f"{name}~g{p.get('generation')}", name):
                folder = manifest.parent / cand
                if folder.is_dir():
                    roots.append(folder)
                    seen.add(name)
                    break
    return roots


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    items = collect()
    total = sum(i[2] for i in items if i[3] == "every session")
    deferred = sum(i[2] for i in items if i[3] != "every session")

    if arg == "--json":
        print(json.dumps({
            "budget_tokens": BUDGET_TOKENS,
            "total_tokens": total,
            "on_demand_tokens": deferred,
            "over_budget": total > BUDGET_TOKENS,
            "items": [{"name": a.strip(), "path": str(b), "tokens": c, "when": d}
                      for a, b, c, d in items],
        }, indent=2))
        return 0

    if arg == "--budget":
        if total > BUDGET_TOKENS:
            print(f"over budget: {total:,} tokens loaded before the user types "
                  f"(budget {BUDGET_TOKENS:,})", file=sys.stderr)
            return 1
        print(f"ok  {total:,} tokens always-on, budget {BUDGET_TOKENS:,}")
        return 0

    print("What loads before you type a word\n")
    for name, path, tokens, when in sorted(items, key=lambda i: -i[2]):
        if when != "every session":
            continue
        bar = "#" * min(40, tokens // 200)
        print(f"  {name:<32} {tokens:>7,} tok  {bar}")
    print(f"\n  {'ALWAYS ON':<32} {total:>7,} tok   budget {BUDGET_TOKENS:,}")
    later = [i for i in items if i[3] != "every session"]
    if later:
        print(f"\n  Loaded only when the task calls for it, not counted above:")
        for name, path, tokens, when in sorted(later, key=lambda i: -i[2]):
            print(f"  {name:<32} {tokens:>7,} tok")
        print(f"  {'':<32} {deferred:>7,} tok deferred")
    if total > BUDGET_TOKENS:
        over = total - BUDGET_TOKENS
        print(f"\n  Over by {over:,} tokens. Every session pays this before it starts.")
        print("  The largest file is the first place to look.")
    print("\n  Estimate: characters divided by four.")
    # Measured 2026-10-11: the transcript's skill listing held 392 entries, 56
    # of them with a description, 29,974 characters. Past its own cap Claude
    # Code drops descriptions and keeps names, so the skill rows above are an
    # upper bound on tokens and a lower bound on what a long description costs
    # in routing: the skill it crowds out is listed by name alone.
    print("  Skill rows are an upper bound: Claude Code drops descriptions past its")
    print("  listing cap. `context-budget` reads what one session was actually sent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
