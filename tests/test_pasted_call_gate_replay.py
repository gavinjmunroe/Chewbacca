"""Replay pasted-call-gate's transcript detector over a labeled corpus.

Every item must come out the way it is labeled: a pasted call gets the method
handed over at prompt time, anything else gets nothing. The positives are the
shapes Caleb actually pastes (Granola on 2026-10-29), the negatives are his own
follow-up messages and the pastes that look closest (text threads, email
headers, notes full of "Why:" lines).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude/hooks/pasted-call-gate.sh")
CORPUS = os.path.join(ROOT, "tests/fixtures/pasted_call/corpus.json")


def flagged(prompt):
    payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt})
    out = subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True, timeout=20)
    return "pasted-call" in out.stdout


def main():
    items = json.load(open(CORPUS))["items"]
    wrong = [i["id"] for i in items if flagged(i["prompt"]) != i["label"]]
    for w in wrong:
        print("  FAIL", w)
    print(f"pasted-call-gate replay: {len(items) - len(wrong)}/{len(items)} match their label")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
