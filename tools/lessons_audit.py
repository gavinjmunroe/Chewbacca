#!/usr/bin/env python3
"""Which corrections are enforced by code, and which are only remembered.

  chewbacca lessons              counts: hook, test, unwired, context only
  chewbacca lessons --list       every lesson with its bucket and what enforces it
  chewbacca lessons --context    only the ones nothing enforces (the fix queue)
  chewbacca lessons --json       the same as data
  chewbacca lessons --loop       corrections caught this fortnight and what each turn did
  chewbacca lessons why "<lesson>: <reason>"
                                 record why code can't catch a correction made
                                 in this session (bin/durable-check accepts it)

A correction lives in a feedback_*.md memory file. It is enforced when a hook
the kit installs or a test names it, or when the lesson names that hook or
test. A hook that exists but is not registered (by setup.sh or the settings
template in config/settings/settings.json) never runs, so it counts as unwired, not enforced.

Jake asked on 2026-10-10 "how much of that correction history is enforced
deterministically through hooks and tests versus just being stored as context
for the agent", and the honest answer was that nobody had counted. This counts.

Matching is by file name and memory slug, so it can miss a hook that enforces
a lesson without either naming the other. Those show as context only, which
errs toward the less flattering number on purpose.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOKS = ROOT / ".claude" / "hooks"
TESTS = ROOT / "tests"
GITHOOKS = ROOT / ".githooks"
SETTINGS = ROOT / "config" / "settings" / "settings.json"
# setup.sh registers most hooks itself with _register(...), so the settings
# template alone undercounts: it named 15 of 61 hooks on 2026-10-10.
SETUP = ROOT / "setup.sh"
REGISTERED = re.compile(r'hooks_dir \+ "/([\w.-]+)"|shared_checks\.py run ([\w.-]+)')
DATE = re.compile(r"20\d\d-\d\d-\d\d")


def default_memory_dirs():
    dirs = [ROOT / "team" / "memory"]
    private = Path.home() / "second-brain" / "memory"
    if private.is_dir():
        dirs.append(private)
    return dirs


def lesson_files(dirs):
    seen = {}
    for d in dirs:
        for f in sorted(Path(d).glob("feedback_*.md")):
            seen.setdefault(f.stem, f)
    return seen


def wired_hook_names(settings_path=None, setup_path=None):
    settings_path = settings_path or SETTINGS
    setup_path = setup_path or SETUP
    names = set()
    try:
        for m in REGISTERED.finditer(setup_path.read_text(errors="ignore")):
            names.add(m.group(1) or m.group(2))
    except OSError:
        pass
    # lib.sh is sourced by the hooks, never registered itself: it runs inside
    # every registered hook that sources it.
    if any((HOOKS / n).is_file() and "lib.sh" in (HOOKS / n).read_text(errors="ignore")
           for n in list(names)):
        names.add("lib.sh")
    try:
        data = json.loads(settings_path.read_text())
    except (OSError, ValueError):
        return names
    for matchers in (data.get("hooks") or {}).values():
        for matcher in matchers:
            for hook in matcher.get("hooks", []):
                for token in re.split(r"[\s'\"]+", hook.get("command", "")):
                    if token:
                        names.add(Path(token).name)
    return names


def enforcers():
    """Each hook and test: name, kind, the words a lesson could use for it, text."""
    out = []
    for kind, folder in (("hook", HOOKS), ("githook", GITHOOKS), ("test", TESTS)):
        if not folder.is_dir():
            continue
        for f in sorted(folder.iterdir()):
            if not f.is_file() or f.name.startswith("."):
                continue
            try:
                text = f.read_text(errors="ignore")
            except OSError:
                continue
            aliases = {f.name}
            # A hook stem like vibe-guard is distinctive on its own; a stem
            # like tabs or backlog is an ordinary word, so it needs the extension.
            if kind == "hook" and "-" in f.stem and len(f.stem) >= 6:
                aliases.add(f.stem)
            out.append({"name": f.name, "kind": kind, "aliases": aliases, "text": text})
    return out


def mentions(text, alias):
    return re.search(r"(?<![\w.-])" + re.escape(alias) + r"(?![\w-])", text) is not None


def audit(memory_dirs, settings_path=None):
    wired = wired_hook_names(settings_path)
    found = enforcers()
    rows = []
    for slug, path in lesson_files(memory_dirs).items():
        body = path.read_text(errors="ignore")
        hits = []
        for e in found:
            if any(mentions(body, a) for a in e["aliases"]) or slug in e["text"]:
                hits.append(e)
        hooks = [e["name"] for e in hits if e["kind"] == "hook"]
        # core.hooksPath runs every .githooks file on each commit or push
        live = [h for h in hooks if h in wired] + [e["name"] for e in hits if e["kind"] == "githook"]
        tests = [e["name"] for e in hits if e["kind"] == "test"]
        if live:
            bucket = "hook"
        elif tests:
            bucket = "test"
        elif hooks:
            bucket = "unwired"
        else:
            bucket = "context"
        rows.append({
            "lesson": slug,
            "shared": path.parent.name == "memory" and path.parent.parent.name == "team",
            "bucket": bucket,
            "hooks": hooks,
            "wired_hooks": live,
            "tests": tests,
        })
    hook_files = [e for e in found if e["kind"] == "hook"]
    cites = sum(1 for e in hook_files if DATE.search(e["text"]))
    return rows, {
        "hooks": len(hook_files),
        "hooks_wired": sum(1 for e in hook_files if e["name"] in wired),
        "hooks_citing_a_date": cites,
        "tests": sum(1 for e in found if e["kind"] == "test"),
    }


def lessons_dir():
    home = Path(os.environ.get("CHEWBACCA_HOME") or Path.home() / ".chewbacca").expanduser()
    return Path(os.environ.get("CHEWBACCA_LESSONS_DIR") or home / "lessons").expanduser()


# Two weeks, the window the repeat-mistake ranking on 2026-10-11 used, so the
# loop line and docs/plans/REPEAT-MISTAKES.md count the same stretch.
LOOP_DAYS = 14


def loop(days=LOOP_DAYS, folder=None):
    """What each correction turn did, newest outcome per prompt.

    bin/durable-check appends a row every Stop that follows a correction; the
    last row for a prompt is what the turn ended with.
    """
    folder = folder or lessons_dir()
    cut = time.time() - days * 86400
    last = {}
    try:
        lines = (folder / "corrections.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("t", 0) >= cut:
            last[(r.get("session"), r.get("prompt"))] = r
    rows = sorted(last.values(), key=lambda r: r.get("t", 0))
    counts = {k: sum(1 for r in rows if r.get("outcome") == k) for k in ("enforced", "why", "prose", "none")}
    return rows, counts


def record_why(reason, folder=None, session=None):
    """Append a reason this session's correction cannot be enforced in code."""
    reason = " ".join((reason or "").split())
    if len(reason) < 12:
        print("lessons why: say which lesson and why code can't catch it, in a sentence", file=sys.stderr)
        return 2
    session = session or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_SESSION_ID") or ""
    if not session:
        print("lessons why: no session id in the environment (CLAUDE_CODE_SESSION_ID)", file=sys.stderr)
        return 2
    folder = folder or lessons_dir()
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "why-not.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"t": round(time.time(), 3), "session": session, "reason": reason[:400]}) + "\n")
    print(f"recorded: {reason[:120]}")
    return 0


def summarize(rows):
    total = len(rows)
    counts = {b: sum(1 for r in rows if r["bucket"] == b)
              for b in ("hook", "test", "unwired", "context")}
    enforced = counts["hook"] + counts["test"]
    return total, counts, enforced


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["why"]:
        return record_why(" ".join(argv[1:]))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--memory", action="append", type=Path,
                   help="a memory folder to read (repeatable); default team/memory plus ~/second-brain/memory")
    p.add_argument("--settings", type=Path)
    p.add_argument("--list", action="store_true")
    p.add_argument("--context", action="store_true", help="only lessons nothing enforces")
    p.add_argument("--shared-only", action="store_true",
                   help="list team lessons only, so the output is safe to show a teammate")
    p.add_argument("--json", action="store_true")
    p.add_argument("--loop", action="store_true", help="list this fortnight's correction turns")
    a = p.parse_args(argv)

    rows, kit = audit(a.memory or default_memory_dirs(), a.settings)
    total, counts, enforced = summarize(rows)
    shown = [r for r in rows if not a.shared_only or r["shared"]]
    if a.context:
        shown = [r for r in shown if r["bucket"] in ("context", "unwired")]

    turns, outcomes = loop()
    if a.json:
        print(json.dumps({"total": total, "enforced": enforced, "buckets": counts,
                          "kit": kit, "loop": outcomes,
                          "lessons": shown if (a.list or a.context) else []}, indent=2))
        return 0

    if not total:
        print("no feedback_*.md lessons found")
        return 0
    pct = round(100 * enforced / total)
    print(f"{total} corrections on file, {enforced} enforced by code ({pct}%)")
    print(f"  {counts['hook']:>4}  a wired hook refuses it")
    print(f"  {counts['test']:>4}  a test covers it, no hook")
    print(f"  {counts['unwired']:>4}  a hook names it but the kit never registers that hook")
    print(f"  {counts['context']:>4}  context only: the agent has to read it and choose to obey")
    print(f"kit: {kit['hooks']} hooks ({kit['hooks_wired']} registered, "
          f"{kit['hooks_citing_a_date']} cite a dated incident), {kit['tests']} test files")
    caught = sum(outcomes.values())
    print(f"loop, last {LOOP_DAYS} days: {caught} correction turns caught by durable-guard; "
          f"{outcomes['enforced']} landed a gate or test, {outcomes['why']} recorded why not, "
          f"{outcomes['prose']} prose only, {outcomes['none']} nothing")
    if a.loop and not a.shared_only:
        print()
        for r in turns:
            when = time.strftime("%m-%d %H:%M", time.localtime(r.get("t", 0)))
            print(f"  {when}  {r.get('outcome', '?'):<8}  {(r.get('said') or '').replace(chr(10), ' ')[:70]}")
    if a.list or a.context:
        print()
        for r in sorted(shown, key=lambda r: (r["bucket"], r["lesson"])):
            via = ", ".join(r["wired_hooks"] or r["tests"] or r["hooks"])
            print(f"  {r['bucket']:<8} {r['lesson']}" + (f"  <- {via}" if via else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
