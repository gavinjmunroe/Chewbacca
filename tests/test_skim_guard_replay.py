"""Replay real 2026-10-22 replies through .claude/hooks/skim-guard.sh.

Corpus: tests/fixtures/steering/skim_replies_2026_10_22.json, the ACAD 185
ingest reply that claimed everything after a head -260 read (must refuse),
the honest follow-up that named the skimmed decks (must pass), and two
unrelated closings from the same session (must pass).
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude/hooks/skim-guard.sh")
CORPUS = os.path.join(ROOT, "tests/fixtures/steering/skim_replies_2026_10_22.json")


def run(case, tmp):
    # Whether the reply claims a full read is Jev's call, scored in
    # tests/eval_reply_judges_jev.py. The stub carries the recorded verdict, so this
    # replay checks the part in code: which reads count as partial.
    t = os.path.join(tmp, "t.jsonl")
    with open(t, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": "ingest all of it"}}) + "\n")
        for tool in case["tools"]:
            (name, val), = tool.items()
            inp = {"command": val} if name == "Bash" else {"file_path": val}
            fh.write(json.dumps({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": name, "input": inp}]}}) + "\n")
    payload = json.dumps({"last_assistant_message": case["reply"], "transcript_path": t})
    env = dict(os.environ, CHEWBACCA_LOG_DIR=os.path.join(tmp, "logs"), HOOK_JUDGE_STUB="0.9" if case["expect"] == 2 else "0.1")
    return subprocess.run(["bash", HOOK], input=payload, text=True, capture_output=True, env=env).returncode


def main():
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        for case in json.load(open(CORPUS)):
            got = run(case, tmp)
            ok = got == case["expect"]
            fails += not ok
            print(("  ok    " if ok else "  FAIL  ") + case["name"] + ("" if ok else f": wanted {case['expect']} got {got}"))
    print("ok: skim-guard replay" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
