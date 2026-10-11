"""lessons audit: a correction counts as enforced only when a registered hook, a
git hook or a test names it (or it names them). A hook nobody registers is
unwired, and a lesson nothing names is context only. Fixture repo only."""
import importlib.util
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
path = Path(__file__).resolve().parent.parent / "tools" / "lessons_audit.py"
spec = importlib.util.spec_from_file_location("lessons_audit", path)
la = importlib.util.module_from_spec(spec)
spec.loader.exec_module(la)

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


root = Path(tempfile.mkdtemp())
for d in (".claude/hooks", ".githooks", "tests", "config/settings", "memory"):
    (root / d).mkdir(parents=True)
la.HOOKS, la.GITHOOKS, la.TESTS = root / ".claude/hooks", root / ".githooks", root / "tests"
la.SETUP, la.SETTINGS = root / "setup.sh", root / "config/settings/settings.json"

(root / ".claude/hooks/vibe-guard.sh").write_text("# 2026-09-21: claimed fixed three times\n")
(root / ".claude/hooks/orphan-guard.sh").write_text("# feedback_orphan\n")
(root / ".claude/hooks/tabs.sh").write_text("echo board\n")
(root / ".githooks/pre-commit").write_text("# feedback_stage_by_name\n")
(root / "tests/test_lists.py").write_text("# covers feedback_lists\n")
(root / "setup.sh").write_text('_register("Stop", hooks_dir + "/vibe-guard.sh")\n')
(root / "config/settings/settings.json").write_text('{"hooks": {"UserPromptSubmit": [{"hooks": [{"command": "~/.claude/hooks/tabs.sh"}]}]}}')

mem = root / "memory"
(mem / "feedback_vibe.md").write_text("vibe-guard now refuses it.\n")
(mem / "feedback_orphan.md").write_text("a hook was written for this.\n")
(mem / "feedback_stage_by_name.md").write_text("stage files by name.\n")
(mem / "feedback_lists.md").write_text("dedupe lists.\n")
(mem / "feedback_prose.md").write_text("open the tabs before you answer.\n")
(mem / "project_ignored.md").write_text("vibe-guard\n")

rows, kit = la.audit([mem])
by = {r["lesson"]: r["bucket"] for r in rows}
check("a lesson naming a hook setup.sh registers is enforced by hook", by.get("feedback_vibe") == "hook")
check("a hook naming the slug but never registered is unwired", by.get("feedback_orphan") == "unwired")
check("a git hook counts as wired", by.get("feedback_stage_by_name") == "hook")
check("a test naming the slug counts as a test", by.get("feedback_lists") == "test")
check("an ordinary word like 'tabs' does not match the tabs.sh hook", by.get("feedback_prose") == "context")
check("only feedback_ files are lessons", "project_ignored" not in by)
check("the settings template registers hooks too", "tabs.sh" in la.wired_hook_names())
check("hooks citing a dated incident are counted", kit["hooks_citing_a_date"] == 1)
total, counts, enforced = la.summarize(rows)
check("summary adds up", total == 5 and enforced == 3 and counts["unwired"] == 1 and counts["context"] == 1)

# The loop (2026-10-11): durable-check records each correction turn, `lessons
# why` records a reason, and the summary counts the last outcome per prompt.
import json, time  # noqa: E401,E402
lessons = root / "lessons"
rc = la.record_why("feedback_aura: taste, no rule code can check", folder=lessons, session="s1")
check("lessons why records a reason under the session", rc == 0 and
      json.loads((lessons / "why-not.jsonl").read_text())["session"] == "s1")
check("lessons why refuses an empty reason", la.record_why("x", folder=lessons, session="s1") == 2)
now = time.time()
(lessons / "corrections.jsonl").write_text("".join(json.dumps(r) + "\n" for r in [
    {"t": now - 60, "session": "s1", "prompt": "p1", "outcome": "none", "said": "fix chewbs"},
    {"t": now - 30, "session": "s1", "prompt": "p1", "outcome": "enforced", "said": "fix chewbs"},
    {"t": now - 20, "session": "s2", "prompt": "p2", "outcome": "why", "said": "never x"},
    {"t": now - 10, "session": "s3", "prompt": "p3", "outcome": "prose", "said": "never y"},
    {"t": now - 40 * 86400, "session": "s4", "prompt": "p4", "outcome": "none", "said": "old"},
]))
turns, outcomes = la.loop(folder=lessons)
check("the loop keeps the last outcome per prompt, inside the window",
      outcomes == {"enforced": 1, "why": 1, "prose": 1, "none": 0} and len(turns) == 3)

sys.exit(1 if failed else 0)