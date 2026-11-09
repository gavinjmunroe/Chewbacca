#!/usr/bin/env python3
"""Sealed eval for .claude/hooks/ask-lookup-guard.sh.

  tools/ask_lookup_eval.py harvest [--set DIR]   every next-step question ever asked on this Mac
  tools/ask_lookup_eval.py score [--set DIR]     run each through the guard with no lookup in the turn

The set is real: the `ask` of every mcp__ccd_turn__wrap_up call in
~/.claude/projects, labeled by hand. It holds Caleb's own conversations, so it
lives outside the repo (default ~/.chewbacca/evals/ask-lookup/asks.json).
Labels: fact=true when the answer was findable by a lookup (calendar,
contacts, people, mail). Harvest keeps existing labels and adds new asks as
fact=false until someone labels them.

Floor: every labeled fact refused, and at most 1% of the rest refused. Measured
2026-10-28 on 196 real asks: the one fact ("What time Friday?", about a call
on his calendar) refused, 0 of the other 195 refused.
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
HOOK = os.path.join(ROOT, ".claude", "hooks", "ask-lookup-guard.sh")
DEFAULT_SET = os.path.expanduser("~/.chewbacca/evals/ask-lookup")
MAX_FALSE_RATE = 0.01


def set_dir(argv):
    return os.path.expanduser(argv[argv.index("--set") + 1]) if "--set" in argv else DEFAULT_SET


def harvest(d):
    asks = set()
    for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        try:
            lines = open(f, encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in lines:
            if '"ask"' not in line or "wrap_up" not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            for c in (row.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and "wrap_up" in c.get("name", ""):
                    ask = (c.get("input") or {}).get("ask")
                    if ask:
                        asks.add(ask)
    path = os.path.join(d, "asks.json")
    try:
        old = {r["ask"]: r for r in json.load(open(path))}
    except (OSError, ValueError):
        old = {}
    rows = [old.get(a, {"ask": a, "fact": False}) for a in sorted(asks | set(old))]
    os.makedirs(d, exist_ok=True)
    json.dump(rows, open(path, "w"), indent=1)
    print(f"{len(rows)} asks in {path}, {sum(r['fact'] for r in rows)} labeled fact")


def refused(ask, transcript):
    inp = json.dumps({"tool_name": "mcp__ccd_turn__wrap_up", "tool_input": {"ask": ask},
                      "transcript_path": transcript})
    r = subprocess.run(["bash", HOOK], input=inp, capture_output=True, text=True, timeout=30)
    return r.returncode == 2


def score(d):
    try:
        rows = json.load(open(os.path.join(d, "asks.json")))
    except (OSError, ValueError):
        print(f"ask-lookup eval: no set at {d}; run harvest first")
        return 0
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as t:
        t.write(json.dumps({"type": "user", "message": {"content": "next"}}) + "\n")
        t.write(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n")
    facts = [r for r in rows if r.get("fact")]
    rest = [r for r in rows if not r.get("fact")]
    caught = sum(refused(r["ask"], t.name) for r in facts)
    false = [r["ask"] for r in rest if refused(r["ask"], t.name)]
    os.unlink(t.name)
    rate = len(false) / max(1, len(rest))
    print(f"facts refused {caught}/{len(facts)}, others refused {len(false)}/{len(rest)} ({rate:.1%})")
    for a in false[:10]:
        print("  false refusal:", a[:100])
    ok = caught == len(facts) and rate <= MAX_FALSE_RATE
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["harvest"]:
        harvest(set_dir(args))
    elif args[:1] == ["score"]:
        sys.exit(score(set_dir(args)))
    else:
        print(__doc__.strip())
        sys.exit(2)
