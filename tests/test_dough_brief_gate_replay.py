#!/usr/bin/env python3
"""Replay real Agent briefs through .claude/hooks/dough-brief-gate.sh and check each recorded verdict.

Corpus: tests/fixtures/dough_brief/corpus.json, real briefs from 2026-10-28 and 10-29 (the
Medrano enrichment brief that started the gate, its engine redirect, and research briefs
that do no lead work and must pass).
"""
import json
import os
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude/hooks/dough-brief-gate.sh")
FIX = os.path.join(ROOT, "tests/fixtures/dough_brief")


def main():
    cases = json.load(open(os.path.join(FIX, "corpus.json")))
    env = dict(os.environ, CHEWBACCA_LOG_DIR=os.path.join("/tmp", "dough-brief-replay-logs"))
    fail = 0
    for c in cases:
        payload = json.dumps({"tool_name": "Agent", "tool_input": {"prompt": c["prompt"]}})
        out = subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True,
                             env=dict(env, HOOK_JUDGE_STUB="0.9" if c.get("lead_work", c["expect"] == "deny") else "0.1")).stdout
        got = "deny" if '"permissionDecision": "deny"' in out else "allow"
        ok = got == c["expect"]
        fail += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {c['name']}: {got} (want {c['expect']}, {c['why']})")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
