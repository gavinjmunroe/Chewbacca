"""The HUD's runtime, account and model switcher (bin/lib/hud_accounts.py).

Everything here runs in a fake home with fake config directories and fake
values; nothing reads ~/.claude, a token or the Keychain. The end-to-end
checks run the real hud-listen against a fake display with a fake `claude`
that answers with the weekly-limit notice as account A and with an answer as
account B, which is the 2026-10-09 18:10 failure ("Capital of Australia"
answered with "You've hit your weekly limit").

Run: python3 tests/test_hud_accounts.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tests"))
import hud_accounts as h  # noqa: E402

failures: list[str] = []
passed = 0
LIMIT = "You've hit your weekly limit · resets 9am (America/Los_Angeles)"
FAKE_TOKEN = "fake-oauth-token-never-shown"


def check(name: str, ok: bool, detail: object = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(name)
        print(f"  FAIL {name} {detail}")


def fake_home(root: Path, second: bool = True, third_signed_out: bool = False) -> Path:
    home = root / "home"
    (home / ".claude").mkdir(parents=True)
    (home / ".bob").mkdir()
    # The default account keeps its state in ~/.claude.json; the token-shaped
    # field is there to prove it never reaches the glass.
    (home / ".claude.json").write_text(json.dumps(
        {"oauthAccount": {"emailAddress": "a@example.com", "accessToken": FAKE_TOKEN}}))
    (home / ".claude" / "settings.json").write_text(json.dumps({"model": "opus[1m]"}))
    if second:
        (home / ".claude-2").mkdir()
        (home / ".claude-2" / ".claude.json").write_text(json.dumps(
            {"oauthAccount": {"emailAddress": "b@example.com", "accessToken": FAKE_TOKEN}}))
    if third_signed_out:
        (home / ".claude-3").mkdir()
    return home


def in_home(home: Path):
    return patch.dict(os.environ, {"HOME": str(home), "HUD_ACCOUNTS_STORE": str(home / ".bob" / "hud-accounts.json"),
                                   "HUD_CODEX_BIN": "/nonexistent/codex", "HUD_GEMINI_BIN": "/nonexistent/gemini",
                                   "HUD_OLLAMA_BIN": "/nonexistent/ollama", "GEMINI_API_KEY": ""})


def test_reset_parsing() -> None:
    la = dt.timezone(dt.timedelta(hours=-7))
    evening = dt.datetime(2026, 10, 9, 18, 10, tzinfo=la)
    until, label = h.parse_reset(LIMIT, evening)
    when = dt.datetime.fromtimestamp(until, dt.timezone.utc)
    check("9am after 6pm is tomorrow at 9 in Los Angeles", label == "9am"
          and when == dt.datetime(2026, 10, 10, 16, 0, tzinfo=dt.timezone.utc), (label, when))
    until, label = h.parse_reset("You've hit your weekly limit · resets Sep 26 at 1pm",
                                 dt.datetime(2026, 9, 22, 17, 53, tzinfo=la))
    check("a dated reset keeps its date", label == "Sep 26 at 1pm"
          and dt.datetime.fromtimestamp(until, la).day == 26, label)
    until, label = h.parse_reset("hit your usage limit", evening)
    check("no reset time is an hour, said as 'for now'", label == ""
          and abs(until - evening.timestamp() - h.UNKNOWN_RESET_S) < 1
          and h.back_at({"until": until, "reset": label}) == "for now")
    check("a reply mentioning a limit is not a notice", not h.LIMIT_RE.search("The speed limit on I-35 is 75."))


def test_discovery_and_names() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d), third_signed_out=True)
        (home / ".claude-relay").mkdir()
        with in_home(home):
            accounts = h.discover_accounts()
            check("~/.claude then every ~/.claude-<n>, numbered dirs only",
                  [p.name for p in accounts] == [".claude", ".claude-2", ".claude-3"], accounts)
            check("the default account's email comes from ~/.claude.json", h.email(accounts[0]) == "a@example.com")
            check("another account's from its own .claude.json", h.email(accounts[1]) == "b@example.com")
            check("an empty config dir is signed out", h.email(accounts[2]) is None)
            (home / ".bob" / "accounts").write_text(f"# mine\n{accounts[1]}\n")
            check("~/.bob/accounts wins when it lists any", h.discover_accounts() == [accounts[1]])
            check("a new account takes the next free number", h.new_account_dir(accounts).name == ".claude-4")


def test_intents() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d))
        with in_home(home):
            accounts = h.discover_accounts()
            cases = {
                "Which account?": ("show", ""), "what model am I on": ("show", ""),
                "switch account": ("next", ""), "Use my other account": ("next", ""),
                "use sonnet": ("model", "claude|sonnet"), "Switch to Opus.": ("model", "claude|opus"),
                "use haiku": ("model", "claude|haiku"),
                "use codex": ("runtime", "codex"), "use gemini": ("runtime", "gemini"),
                "use claude": ("runtime", "claude"), "use local": ("runtime", "ollama"),
                "use b@example.com": ("account", str(accounts[1])), "use b": ("account", str(accounts[1])),
                "use account 2": ("account", str(accounts[1])),
                "add an account": ("add", ""), "use llama3.1": ("model", "ollama|llama3.1:8b"),
            }
            for said, want in cases.items():
                got = h.parse(said, accounts, ["llama3.1:8b"])
                check(f"{said!r} is {want[0]}", got is not None and (got.verb, got.value) == want, got)
            for said in ("Capital of Australia", "use sonnet to summarise this", "use the force",
                         "what account should I bill this to", "use account 9"):
                check(f"{said!r} stays a request", h.parse(said, accounts, []) is None, h.parse(said, accounts, []))


def test_failover_order() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d))
        with in_home(home):
            accounts = h.discover_accounts()
            data = h.load()
            target, picked = h.effective(data, accounts, "claude")
            check("nothing picked answers on the first account", target == picked and target.account == accounts[0])
            h.mark_limited(data, picked.key, LIMIT)
            target, picked = h.effective(data, accounts, "claude")
            check("a limited account is skipped for the next one", target and target.account == accounts[1], target)
            h.mark_limited(data, target.key, LIMIT)
            target, _ = h.effective(data, accounts, "claude")
            check("both out and no runtime signed in is nothing", target is None, target)
            with patch.object(h, "runtime_status", lambda r, fresh=False: h.Status("ok", models=["llama3.2:latest"])
                              if r == "ollama" else h.Status("signed out")):
                target, _ = h.effective(data, accounts, "claude")
                check("then a signed-in runtime answers, skipping signed-out ones",
                      target and target.runtime == "ollama" and target.model == "llama3.2:latest", target)
            later = h.limited(data, h.account_key(accounts[0]))["until"] + 1
            target, _ = h.effective(data, accounts, "claude", now=later)
            check("after the reset the pick answers again", target and target.account == accounts[0], target)
            h.pick_account(data, accounts[0])
            check("an explicit pick clears its own limit mark", h.limited(data, h.account_key(accounts[0])) is None)
            h.pick_runtime(data, "codex")
            target, picked = h.effective(data, accounts, "claude")
            check("a picked runtime wins over the hook's", picked.runtime == "codex")
            h.pick_runtime(data, "auto")
            _, picked = h.effective(data, accounts, "codex")
            check("auto follows the last foreground session again", picked.runtime == "codex")


def test_card() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d), third_signed_out=True)
        with in_home(home):
            accounts = h.discover_accounts()
            data = h.load()
            h.mark_limited(data, h.account_key(accounts[0]), LIMIT)
            target, picked = h.effective(data, accounts, "claude")
            target = h.Target("claude", target.account, "opus[1m]")
            with patch.object(h, "runtime_status", lambda r, fresh=False: {
                    "codex": h.Status("signed out"), "gemini": h.Status("missing"),
                    "ollama": h.Status("ok", "2 local models", ["llama3.1:8b", "qwen"])}[r]):
                card = h.card(data, accounts, target, picked, "claude")
            text = "\n".join(card.lines)
            print("    switcher draw lines:", *card.lines, sep="\n      ")
            check("one surface, top right", card.lines[0] == "@ accounts at=topRight w=440")
            check("the head names runtime, account and model",
                  'd /now "Claude Code · b@example.com · Opus 1M"' in card.lines, text)
            check("the note says why it moved", "Answering on b@example.com: a@example.com is out until 9am" in text)
            check("the spent account says when it is back", "a@example.com · limit hit, back 9am" in text)
            check("a signed-out account and runtime get Sign in", '"~/.claude-3 · signed out"' in text
                  and '"Codex · signed out"' in text and 'actionLabel="Sign in"' in text)
            check("a missing runtime is not drawn", "Gemini" not in text)
            check("model buttons, the current one primary",
                  'c m-0 Button label="Opus 1M" action=acct-model variant=primary' in text
                  and 'label="Sonnet" action=acct-model' in text)
            check("Add account is there", 'c add Button label="Add account" action=acct-add' in text)
            check("a press can only name a row it drew", set(card.rows) ==
                  {"acct-0", "acct-1", "in-2", "in-codex", "rt-ollama", "rt-auto"}, set(card.rows))
            check("no token ever reaches the glass", FAKE_TOKEN not in text)


def fake_claude(path: Path, log: Path) -> str:
    """A `claude` that speaks stream-json: the limit notice as the default
    account (CLAUDE_CONFIG_DIR unset), an answer as any other. Warm-up turns
    are answered on both, as when the limit is hit after launch."""
    return f"""#!{sys.executable}
import json, os, sys
config = os.environ.get("CLAUDE_CONFIG_DIR", "")
for raw in sys.stdin:
    try:
        text = json.loads(raw)["message"]["content"][0]["text"]
    except Exception:
        continue
    if "Warm-up for this session" in text:
        reply = "ready"
    elif not config:
        reply = {LIMIT!r}
    else:
        reply = "Canberra."
    with open({str(log)!r}, "a") as out:
        out.write((config or "default") + " " + reply + "\\n")
    print(json.dumps({{"type": "assistant", "message": {{"content": [{{"type": "text", "text": reply}}]}}}}), flush=True)
    print(json.dumps({{"type": "result", "result": reply, "is_error": False}}), flush=True)
"""


def run_listener(home: Path, script: str, say: list, until, timeout: float = 30.0):
    import test_hud_listen as t
    original = t.listener_env

    def env_in_home(directory: str, path: str) -> dict:
        env = original(directory, path)
        entry = Path(env["HUD_TEST_ENTRY"])
        # The real account code: only the accounts' location is faked, by HOME.
        entry.write_text("\n".join(
            line for line in entry.read_text().splitlines()
            if not any(k in line for k in ("ACCOUNTS_FILE", "ACCOUNT_STATE", "DEFAULT_CONFIG", "claude_accounts"))
        ) + "\n")
        env["HOME"] = str(home)
        env["HUD_ACCOUNTS_STORE"] = str(home / ".bob" / "hud-accounts.json")
        env["HUD_CODEX_BIN"] = env["HUD_GEMINI_BIN"] = env["HUD_OLLAMA_BIN"] = "/nonexistent"
        env["GEMINI_API_KEY"] = ""
        return env

    t.listener_env = env_in_home
    try:
        received, _ = t.run_against(script, say, until, timeout=timeout, name="claude")
    finally:
        t.listener_env = original
    return [line for _, line in received]


def test_end_to_end_failover() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d))
        log = Path(d) / "model.log"
        lines = run_listener(home, fake_claude(Path(d), log),
                             [(1.0, 'h "Capital of Australia" via=typed')],
                             lambda got: any(l.startswith('s "Answered on') for l in got))
        pills = [l for l in lines if l.startswith("s ")]
        print("    pill lines:", *pills, sep="\n      ")
        ran = log.read_text().splitlines() if log.exists() else []
        print("    model runs:", *ran, sep="\n      ")
        check("A was asked and gave the limit notice",
              any(r.startswith("default You've hit your weekly limit") for r in ran), ran)
        check("the same request was rerun once on B",
              sum(r.endswith("Canberra.") for r in ran) == 1 and any(".claude-2 Canberra." in r for r in ran), ran)
        check("the pill shows B's answer and which account answered",
              's "Answered on b@example.com, a@example.com is out until 9am. Canberra."' in lines, pills)
        check("the panel's answer is B's", 'w "Canberra." done=true' in lines,
              [l for l in lines if l.startswith("w ")])
        store = json.loads((home / ".bob" / "hud-accounts.json").read_text())
        check("A is remembered as out until its reset",
              store["limits"].get(f"claude:{home / '.claude'}", {}).get("reset") == "9am", store)


def test_end_to_end_nothing_left() -> None:
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d), second=False)
        log = Path(d) / "model.log"
        lines = run_listener(home, fake_claude(Path(d), log),
                             [(1.0, 'h "Capital of Australia" via=typed')],
                             lambda got: any(l.startswith('s "Nothing left') for l in got))
        pills = [l for l in lines if l.startswith("s ")]
        print("    pill lines:", *pills, sep="\n      ")
        check("the pill says nothing is left, who is out, and what to do",
              any(l.startswith('s "Nothing left to answer: a@example.com is out until 9am')
                  and "add an account" in l for l in lines), pills)
        check("the switcher opened with the account marked out",
              "@ accounts at=topRight w=440" in lines
              and any("a@example.com · limit hit, back 9am" in l for l in lines if l.startswith("d /use")))
        check("the dead notice never reached the pill alone",
              not any(l == 's ' + json.dumps(LIMIT) for l in lines[-6:]), lines[-6:])


def test_end_to_end_switcher() -> None:
    """'which account', a Use press on B, a press on a row never drawn, and
    'use sonnet', all with no model turn; Escape's `x` forgets the card."""
    with tempfile.TemporaryDirectory() as d:
        home = fake_home(Path(d))
        log = Path(d) / "model.log"
        state = {"card": False, "used": False}

        def drawn() -> bool:
            return state["card"]

        def until(got: list[str]) -> bool:
            state["card"] = any(l.startswith("d /use") for l in got)
            state["used"] = any("Using Claude Code on b@example.com" in l for l in got)
            return any("Sonnet" in l and l.startswith('s "Using') for l in got)

        lines = run_listener(home, fake_claude(Path(d), log), [
            (1.0, 'h "which account" via=typed'),
            (drawn, 'e action acct-use row="acct-9" surface="accounts"'),
            (drawn, 'e action acct-use row="acct-1" surface="accounts"'),
            (lambda: state["used"], 'h "use sonnet" via=typed'),
        ], until)
        pills = [l for l in lines if l.startswith("s ")]
        print("    pill lines:", *pills, sep="\n      ")
        ran = [r for r in (log.read_text().splitlines() if log.exists() else []) if not r.endswith("ready")]
        check("'which account' drew the card", "@ accounts at=topRight w=440" in lines)
        check("Use on B switched to B", any("Using Claude Code on b@example.com" in l for l in pills), pills)
        check("'use sonnet' picked the model", any("Sonnet" in l for l in pills), pills)
        store = json.loads((home / ".bob" / "hud-accounts.json").read_text())
        check("the pick is in ~/.bob, not in ~/.claude/settings.json",
              store["pick"].get("account") == str(home / ".claude-2") and store["models"].get("claude") == "sonnet"
              and json.loads((home / ".claude" / "settings.json").read_text()) == {"model": "opus[1m]"}, store)
        check("no model turn ran for any of it", ran == [], ran)


def test_adapters() -> None:
    """hud-gemini and hud-ollama keep hud-codex's contract (prompt on stdin,
    answer on stdout), and a spent quota comes back as a limit notice."""
    import subprocess
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        argv_log = root / "argv"
        gemini = root / "gemini"
        gemini.write_text(f"#!/bin/sh\necho \"$@\" > {argv_log}\n"
                          "if [ \"$FAKE\" = quota ]; then echo 'RESOURCE_EXHAUSTED: quota' >&2; exit 1; fi\n"
                          "echo 'Canberra.'\n")
        ollama = root / "ollama"
        ollama.write_text("#!/bin/sh\nif [ \"$1\" = list ]; then\n"
                          "printf 'NAME ID SIZE MODIFIED\\nnomic-embed-text:latest x 1 now\\nllama3.2:latest y 2 now\\n'\n"
                          f"else echo \"$@\" > {argv_log}; cat > /dev/null; printf '\\033[?25lCanberra.\\n'; fi\n")
        for f in (gemini, ollama):
            f.chmod(0o755)
        env = dict(os.environ, HUD_GEMINI_BIN=str(gemini), HUD_OLLAMA_BIN=str(ollama))

        def run(name: str, args: list[str], **extra) -> subprocess.CompletedProcess:
            return subprocess.run([str(ROOT / "bin" / name), *args], input="Capital of Australia?",
                                  capture_output=True, text=True, env=dict(env, **extra), timeout=30)

        got = run("hud-gemini", ["--model", "gemini-x"])
        check("hud-gemini prints the answer", got.returncode == 0 and got.stdout.strip() == "Canberra.", got)
        check("and passes the model", "-m gemini-x" in argv_log.read_text(), argv_log.read_text())
        got = run("hud-gemini", [], FAKE="quota")
        check("a Gemini quota error reads as a limit notice",
              got.returncode == 3 and h.LIMIT_RE.search(got.stdout) and "RESOURCE" not in got.stdout, got)
        got = run("hud-ollama", [])
        check("hud-ollama answers on the first chat model, not an embedding one",
              got.stdout.strip() == "Canberra." and argv_log.read_text().strip() == "run llama3.2:latest",
              (got, argv_log.read_text()))
        check("the runtime commands name the adapters",
              h.runtime_command("ollama", "llama3.2:latest").endswith("bin/hud-ollama --model llama3.2:latest")
              and h.runtime_of(h.runtime_command("gemini")) == "gemini"
              and h.runtime_command("claude") == "claude -p --strict-mcp-config")


def main() -> int:
    for name, test in [("adapters", test_adapters),("reset times", test_reset_parsing), ("accounts and names", test_discovery_and_names),
                       ("what was said", test_intents), ("failover order", test_failover_order),
                       ("the card", test_card),
                       ("end to end: limit on A, answer on B", test_end_to_end_failover),
                       ("end to end: nothing left", test_end_to_end_nothing_left),
                       ("end to end: the switcher", test_end_to_end_switcher)]:
        print(name)
        test()
    print(f"{passed} passed, {len(failures)} failed" + (f": {', '.join(failures)}" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
