#!/usr/bin/env python3
"""Do the per-prompt notes work? Asks a cheap model, not part of the suite.

    python3 tests/eval_intent_notes.py [--limit N] [--out results.json]

Runs the real hooks to get the notes a session sees, gives haiku all of them
together, then asks what each note means for one labeled message. Together on
purpose: a note can read fine alone and get lost in the pile. Prints the old
word matcher's score on the same messages, so a note that scores under the
regex it replaced shows up here.

Why: 2026-11-05, archive-learn. A long note scored 5 of 10 on haiku and a short
one 12 of 13, and nothing would have shown that without running it. This
measures reading the note, not obeying it in a long session.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOOKS = ROOT / ".claude" / "hooks"
CASES = ROOT / "tests" / "fixtures" / "intent_note_cases.json"
NOTE_HOOKS = ["archive-learn.sh", "method-guard.sh", "kit-route.sh", "design-context.sh"]
# Copied from the hooks and bin/method as they stood on 2026-11-05: the baseline.
OLD_TAKE = (r"\b(i think|i feel like|we should|should we|we gotta|we needa|we need to|it should|maybe we|i wanna|"
            r"lets do|let.s do|we can totally|best strat|strategy|strat\b|pricing|should be free|charge a|instead of)\b")
OLD_RENDER_A = r"design|animat|scroll|hover|layout|landing|component|website|gizmo|motion|typograph|spacing"
OLD_RENDER_B = r"\b(ui|ux|css|hero|page|pages|site|sites|svg|color|colour)\b"
OLD_PROCESS = [
    ("debug", r"\b(bug|broken|fails?|failing|error|crash|wrong|regress|why (is|does|isn'?t|doesn'?t)|not work|stopped work)\b"),
    ("experiment", r"\b(measure|experiment|benchmark|a/?b test|hypothes|validate|verify|prove|false positive|baseline|sample size)\b"),
    ("research", r"\b(research|prior art|has anyone|who else|state of the art|literature|find out|look into|investigate|survey)\b"),
    ("creative", r"\b(design|creative|aesthetic|look|style|beautiful|taste|cool|slop|brand|layout|typography|animation)\b"),
    ("decision", r"\b(should (i|we)|which (one|approach|option)|decide|choose between|worth it|trade ?off|pros and cons)\b"),
    ("build", r"\b(build|implement|create|add|write|make|ship|set ?up|wire|refactor|port|generate)\b"),
]
ASK = (
    'He just sent the message below. Going by your instructions, answer with JSON only, keys: '
    '"done_with_tab" (bool), "take" (bool: does it carry a take), '
    '"route" (the kit or project name to go work in, or null), '
    '"renders" (bool: will this turn change something that renders), '
    '"process" (one of debug, experiment, research, creative, decision, build, or null if it isn\'t real work).\n\n'
    "Message: "
)


def notes():
    out = []
    for hook in NOTE_HOOKS:
        payload = json.dumps({"prompt": "placeholder prompt for the eval", "session_id": "intent-eval", "cwd": "/tmp"})
        run = subprocess.run(["bash", str(HOOKS / hook)], input=payload, capture_output=True, text=True, timeout=30)
        try:
            out.append(json.loads(run.stdout)["hookSpecificOutput"]["additionalContext"])
        except (ValueError, KeyError) as exc:
            sys.exit(f"{hook} gave no note ({exc}): {run.stderr[:200]}")
    return out


def briefing():
    """The kit use-when lines a session gets at start, from the real markers."""
    run = subprocess.run(["kits", "--paths"], capture_output=True, text=True)
    lines = []
    for d in run.stdout.split("\n"):
        marker = pathlib.Path(d) / ".kit"
        if d.strip() and marker.exists():
            text = marker.read_text(errors="replace")
            name = re.search(r"^name:\s*(.+)$", text, re.M)
            use = re.search(r"^use-when:\s*(.+)$", text, re.M)
            if name and use:
                lines.append(f"{name.group(1).strip()}: {use.group(1).strip()[:240]}")
    return "Kits on this machine, and when each applies:\n" + "\n".join(lines)


def ask(system, message):
    run = subprocess.run(
        ["claude", "-p", "--model", "haiku", "--setting-sources", "", "--strict-mcp-config", "--tools", "",
         "--system-prompt", system, ASK + json.dumps(message)],
        capture_output=True, text=True, timeout=90)
    match = re.search(r"\{.*\}", run.stdout, re.S)
    return json.loads(match.group(0)) if match else None


def old_answers(message):
    low = message.lower()
    process = next((name for name, rx in OLD_PROCESS if re.search(rx, low)), None)
    return {"take": bool(re.search(OLD_TAKE, low)),
            "renders": bool(re.search(OLD_RENDER_A, low) or re.search(OLD_RENDER_B, low)),
            "process": process}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out")
    args = ap.parse_args()
    cases = json.loads(CASES.read_text())[:args.limit]
    system = briefing() + "\n\n" + "\n\n".join(notes())
    print(f"{len(system)} characters of notes and briefing\n")
    new, old, total, misses = {}, {}, {}, []
    for case in cases:
        got = ask(system, case["message"]) or {}
        base = old_answers(case["message"])
        for key, want in case.items():
            if key == "message":
                continue
            total[key] = total.get(key, 0) + 1
            if got.get(key) == want:
                new[key] = new.get(key, 0) + 1
            else:
                misses.append({"key": key, "want": want, "got": got.get(key), "message": case["message"][:90]})
            if key in base and base[key] == want:
                old[key] = old.get(key, 0) + 1
        time.sleep(0.2)
    for key in total:
        line = f"{key:14} note {new.get(key, 0)}/{total[key]}"
        if key in ("take", "renders", "process"):
            line += f"   old regex {old.get(key, 0)}/{total[key]}"
        print(line)
    print()
    for miss in misses:
        print(f"MISS {miss['key']}: want {miss['want']} got {miss['got']}: {miss['message']}")
    if args.out:
        pathlib.Path(args.out).write_text(json.dumps({"new": new, "old": old, "total": total, "misses": misses}, indent=1))


if __name__ == "__main__":
    main()
