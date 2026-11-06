#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init plan-commit-guard.sh 20
# PreToolUse on Write and Edit: a big plan's Status only becomes COMMITTED when a
# person's own last message commits it, and then this writes plan-check's receipt.
#
# 2026-11-05: Caleb asked "Did you stress test it". A filler plan marked "committed
# by Agent" passed plan-check, so the promise that a person commits was only text.
#
# Jev reads his message, so there's no phrase list: three earlier versions of
# chat-approval tried to spot a yes in his words and each missed a real reply. A
# message no person typed never counts, by the same rules chat-approval uses. If
# Jev can't run, this refuses, because a wrong commit is worse than one more ask.
#
# WHAT IT DOESN'T DO. A shell command can still write the word, though plan-check
# then fails it for having no receipt. And an agent that writes the receipt file by
# hand would get past both. This stops an honest mistake, not a determined forger.
set -uo pipefail
PAYLOAD="$(cat)"
PAYLOAD="$PAYLOAD" HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" python3 -I - <<'PY'
import importlib.util, json, os, re, sys, time

try:
    payload = json.loads(os.environ["PAYLOAD"])
except ValueError:
    sys.exit(0)
tool = payload.get("tool_input") or {}
path = tool.get("file_path") or ""
new = tool.get("content") if "content" in tool else tool.get("new_string")
if not path or not isinstance(new, str):
    sys.exit(0)
COMMIT = re.compile(r"(?m)^\s*COMMITTED\b")
if not COMMIT.search(new):
    sys.exit(0)
try:
    before = open(path, errors="replace").read()
except OSError:
    before = ""
# Only a big-plan file. A doc that happens to say COMMITTED isn't this guard's business.
if "## Riskiest assumptions" not in (new if "content" in tool else before):
    sys.exit(0)


def status_of(text):
    m = re.search(r"(?ms)^##\s+Status\s*$(.*?)(?=^##\s|\Z)", text)
    return m.group(1) if m else ""


if COMMIT.search(status_of(before)):
    sys.exit(0)  # already committed, and this edit isn't what committed it
if "content" in tool and not COMMIT.search(status_of(new)):
    sys.exit(0)  # the word appears, but not as the plan's status

INJECTED = re.compile(r"^\s*(<task-notification|<cross-session-message|<system-reminder>|\[SYSTEM NOTIFICATION|"
                      r"Stop hook feedback:|<local-command-|<teammate-message|\[Request interrupted)", re.I)


def typed(entry):
    if entry.get("type") != "user" or entry.get("isMeta"):
        return None
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, list):
        if any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
            return None
        content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    if not isinstance(content, str):
        return None
    content = re.sub(r"\A(?:\s*<system-reminder>.*?</system-reminder>)+\s*", "", content, flags=re.S)
    if not content.strip() or INJECTED.search(content) or re.search(r"<cross-session-message\b", content):
        return None
    return content.strip()


said = None
try:
    with open(payload.get("transcript_path") or "", errors="replace") as fh:
        for line in fh:
            try:
                got = typed(json.loads(line))
            except ValueError:
                continue
            if got:
                said = got
except OSError:
    pass


def refuse(why):
    print(f"plan-commit-guard: refusing to mark {os.path.basename(path)} COMMITTED. {why} "
          "Show the person the chosen shape, its bets and the one-way doors, and let them say it.", file=sys.stderr)
    sys.exit(2)


if not said:
    refuse("No message from a person was found.")
if os.environ.get("CLAUDE_CODE_SESSION_ATTENDED") == "0" or os.environ.get("CHEWBACCA_AGENT_LAUNCHED"):
    refuse("This session wasn't started by a person.")
question = {"commits": {"type": "noul", "instructions":
                        "Does this message clearly tell the agent to commit to this plan now, as a decision? "
                        "Discussing it, asking a question or praising it isn't committing."}}


def lib_path():
    home = os.path.expanduser("~/.chewbacca/kit/current/bin/lib/jev.py")
    near = os.path.join(os.environ.get("HOOK_DIR", ""), "..", "..", "bin", "lib", "jev.py")
    return near if os.path.exists(near) else home


score = None
fake = os.environ.get("PLAN_COMMIT_FAKE_SCORE")
if fake is not None:
    score = float(fake)
else:
    try:
        spec = importlib.util.spec_from_file_location("kit_jev", lib_path())
        jev = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(jev)
        answers = jev.ask({"message": said[:2000]}, question, decision="plan-commit-guard")
        score = jev.probability((answers or {}).get("commits", {}).get("noul"))
    except Exception:
        score = None
if score is None:
    refuse("Jev couldn't read their last message, so nobody can say it commits.")
# Measured on 21 messages, 2026-11-05 (tests/fixtures/plan_commit/corpus.json): at 0.8
# "Yes, fix it" and "Ok start making hall real" both counted as commits, at 0.81. The
# real commits scored 0.88 and up, apart from "I commit" at 0.59, which gets refused
# and costs one more ask. A wrong commit costs more than that. A small set, so re-measure.
if score < 0.85:
    refuse(f"Their last message doesn't read as committing ({score:.2f}): {said[:80]!r}.")
# The plan as it'll read after this write, so the receipt covers what they agreed to.
after = new if "content" in tool else before.replace(tool.get("old_string") or "", new, 1)
sys.path.insert(0, os.path.dirname(lib_path()))
import plan_core
with open(plan_core.receipt_path(path), "w") as out:
    json.dump({"core": plan_core.core_hash(after), "said": said[:500], "score": score, "at": time.time()}, out, indent=1)
sys.exit(0)
PY
