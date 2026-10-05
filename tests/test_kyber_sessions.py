#!/usr/bin/env python3
"""kyber-sessions without Claude Code, a socket or the real transcripts:
built entries in, decisions out. Run: python3 tests/test_kyber_sessions.py"""
import importlib.machinery
import json
import re
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
ks = importlib.machinery.SourceFileLoader("kyber_sessions", str(ROOT / "bin" / "kyber-sessions")).load_module()

PASSED = 0
FAILED = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  pass  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


def user(text, **kw):
    return {"type": "user", "uuid": kw.pop("uuid", "u1"), "message": {"role": "user", "content": text}, **kw}


def assistant(blocks, stop=None, uuid="a1", **kw):
    return {"type": "assistant", "uuid": uuid,
            "message": {"role": "assistant", "model": "claude-opus-5-5", "stop_reason": stop, "content": blocks}, **kw}


def tool(name, **args):
    return {"type": "tool_use", "id": "t1", "name": name, "input": args}


def result(text="ok", error=False):
    return {"type": "user", "uuid": "r1", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": text, "is_error": error}]}}


def test_classify() -> None:
    print("state from a transcript tail")
    done = [user("fix it"), assistant([{"type": "text", "text": "Fixed."}], stop="end_turn")]
    check("an answered turn is finished", ks.classify(done, 600)[0] == "finished")
    check("a finished turn's sign-off is not shown as its status", ks.classify(done, 600)[1] == "")
    mid = [user("run tests"), assistant([tool("Bash", command="npm test")], stop="tool_use")]
    check("a fresh tool call is working", ks.classify(mid, 5)[0] == "working")
    check("a stalled tool call needs a person", ks.classify(mid, 300) == ("needs", "Bash: npm test"))
    check("a tool call stalled for hours is not waiting on anyone", ks.classify(mid, 3 * 3600)[0] == "failed")
    waiting = [user("go"), assistant([tool("Read", file_path="/x")]), result()]
    check("a tool result just back is working", ks.classify(waiting, 10)[0] == "working")
    check("a question nobody answered for long is failed", ks.classify(waiting, 3600)[0] == "failed")
    schema = [user("review"), assistant([tool("StructuredOutput", verdict="ok")]), result("Structured output provided successfully")]
    check("a --json-schema run that returned is finished, not stalled",
          ks.classify(schema, 3600)[0] == "finished")
    api = [user("go"), assistant([{"type": "text", "text": "API Error: 529 overloaded"}], isApiErrorMessage=True)]
    check("an API error is failed", ks.classify(api, 60)[0] == "failed")
    side = [user("go"), assistant([{"type": "text", "text": "done"}], stop="end_turn"),
            assistant([tool("Bash", command="x")], isSidechain=True)]
    check("a subagent's sidechain does not decide the state", ks.classify(side, 600)[0] == "finished")


def test_meta_and_rows() -> None:
    print("titles, projects and rows")
    entries = [{"type": "ai-title", "aiTitle": "Old"}, user("hello", cwd="/Users/x/code/chewbacca/.claude/worktrees/agent-1", entrypoint="claude-vscode"),
               assistant([{"type": "text", "text": "hi"}]), {"type": "ai-title", "aiTitle": "Kyber glass"}]
    m = ks.meta(entries)
    check("the newest title wins", m["title"] == "Kyber glass", m)
    check("a VS Code session is interactive", m["interactive"])
    check("a scripted run is not",
          not ks.meta([user("x", entrypoint="sdk-py")])["interactive"])
    check("a worktree is its repo", ks.project_of("/Users/x/code/chewbacca/.claude/worktrees/agent-1") == "chewbacca")
    check("a plain folder is itself", ks.project_of("/Users/x/code/lemma") == "lemma")
    rows = [{"id": "b", "state": "finished", "last": 9}, {"id": "a", "state": "needs", "last": 1},
            {"id": "c", "state": "working", "last": 5}, {"id": "d", "state": "failed", "last": 8}]
    check("needs you first, then working, failed, finished",
          [r["id"] for r in ks.order(rows)] == ["a", "c", "d", "b"])
    shown = ks.session_rows([{"id": "a", "state": "needs", "project": "lemma", "title": "Ship it",
                              "model": "opus", "last": 100.0}], now=400.0)
    check("a row says what it needs, the model and the age",
          shown[0]["time"] == "needs you · opus · 5m" and shown[0]["accent"], shown)


def test_card_items() -> None:
    print("a transcript as rows on the glass")
    entries = [
        user("<command-name>/clear</command-name>"),
        user("make the rail glass"),
        assistant([{"type": "text", "text": "On it."}, tool("Edit", file_path="/Users/x/a.swift",
                                                             old_string="a", new_string="b")], uuid="a2"),
        result("boom", error=True),
        assistant([tool("Bash", command="swift test")], uuid="a3"),
    ]
    items = ks.card_items(entries)
    roles = [i["role"] for i in items]
    check("a command wrapper is not shown as something they typed", roles[0] == "user" and items[0]["text"] == "make the rail glass", items)
    check("prose, a folded tool call and an error", roles == ["user", "assistant", "tool", "error", "tool"], roles)
    check("an edit can be opened as a diff", items[2].get("open") is True)
    check("a shell call cannot", "open" not in items[4])
    use = ks.tool_use_by_key(entries, items[2]["id"])
    diff = ks.edit_diff(use)
    check("an edit renders as - then +", "-a" in diff and "+b" in diff and diff.startswith("--- /Users/x/a.swift"), diff)


def test_safety() -> None:
    print("nothing in a transcript decides anything")
    with tempfile.TemporaryDirectory(dir=Path.home()) as d:
        f = Path(d) / "x.txt"
        f.write_text("hi")
        check("a file under home can be viewed", ks.under_home(str(f)) == str(f.resolve()))
    check("a file outside home cannot", ks.under_home("/etc/hosts") is None)
    with tempfile.TemporaryDirectory() as d:
        cwd = Path(d)
        check("status and diff are allowlisted", ks.allowlisted("status", cwd)[:2] == ["git", "status"]
              and ks.allowlisted("diff", cwd)[:2] == ["git", "diff"])
        check("tests run only what the folder declares", ks.allowlisted("tests", cwd) is None)
        (cwd / "package.json").write_text(json.dumps({"scripts": {"test": "vitest"}}))
        check("a declared npm test runs as npm test", ks.allowlisted("tests", cwd) == ["npm", "test", "--silent"])
        check("anything else is refused", ks.allowlisted("rm", cwd) is None)
        base = {"agent": "claude", "cwd": d, "id": "abc", "config": ""}
        check("a finished session can be sent to", ks.can_send({**base, "state": "finished"}) is None)
        check("a working one cannot", ks.can_send({**base, "state": "working"}) is not None)
        check("one waiting on a permission cannot", ks.can_send({**base, "state": "needs"}) is not None)
        check("codex is read-only", ks.can_send({**base, "agent": "codex", "state": "finished"}) is not None)
    argv = ks.send_argv({"id": "abc"}, "run the tests")
    check("a send resumes the session with no permission flag",
          argv[:5] == ["claude", "-p", "run the tests", "--resume", "abc"]
          and not any("permission" in a or "dangerously" in a for a in argv), argv)


def test_env_matches_hud_listen() -> None:
    print("the same session scrubbing as hud-listen")
    src = (ROOT / "bin" / "hud-listen").read_text()
    names = set(re.findall(r'"([A-Z_]+)"', re.search(r"INHERITED_SESSION_VARS = frozenset\((.*?)\)", src, re.S).group(1)))
    prefixes = re.search(r"INHERITED_SESSION_PREFIXES = \((.*?)\)", src, re.S).group(1)
    check("the variable list is hud-listen's", names == set(ks.INHERITED_SESSION_VARS), names)
    check("the prefixes are hud-listen's", '"CLAUDE_CODE_"' in prefixes and ks.INHERITED_SESSION_PREFIXES == ("CLAUDE_CODE_",))


def test_stream_and_events() -> None:
    print("the reply stream and the display's presses")
    seen = []
    lines = [json.dumps({"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "Run"}}}),
             "not json",
             json.dumps({"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "ning."}}}),
             json.dumps({"type": "result", "result": "Running.", "permission_denials": [{"tool_name": "Bash"}]})]
    out = ks.stream_reply(lines, seen.append)
    check("deltas fold into the reply so far", seen == ["Run", "Running."], seen)
    check("a refused permission comes back to be shown", out["permission_denials"][0]["tool_name"] == "Bash")
    ev = ks.parse_event('e action send row=s-abc surface=s-abc text="run the tests, then \\"push\\""')
    check("a typed message is read with its quotes intact",
          ev == {"name": "send", "component": "send", "row": "s-abc", "surface": "s-abc",
                 "text": 'run the tests, then "push"'}, ev)
    ev = ks.parse_event("e action open row=6d901cd1-aaaa surface=sessions")
    check("a row press names the session", ev["name"] == "open" and ev["row"] == "6d901cd1-aaaa")
    check("anything not an event is ignored", ks.parse_event('h "hello"') is None)
    route = ks.route("tell the lemma session to run the tests", sessions=[
        {"id": "L1", "project": "lemma-replica", "title": "Lemma site"},
        {"id": "C1", "project": "chewbacca", "title": "Kyber"}])
    check("a named session is picked without a model",
          route == {"session": "L1", "message": "run the tests", "why": "named lemma"}, route)


def main() -> int:
    test_classify()
    test_meta_and_rows()
    test_card_items()
    test_safety()
    test_env_matches_hud_listen()
    test_stream_and_events()
    print("all passed" if not FAILED else f"{FAILED} failed")
    return 1 if FAILED else 0


def test_all() -> None:
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
