"""text-command: which texts become commands. A fake Messages database and
stubbed answer and send: nothing real is read, asked or sent."""
import importlib.machinery
import importlib.util
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("text_command", str(ROOT / "bin" / "text-command"))
spec = importlib.util.spec_from_loader("text_command", loader)
tc = importlib.util.module_from_spec(spec)
sys.modules["text_command"] = tc
loader.exec_module(tc)

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def archived(words: str) -> bytes:
    """What iOS stores: no `text`, the words inside attributedBody."""
    raw = words.encode()
    size = bytes([len(raw)]) if len(raw) < 0x80 else b"\x81" + len(raw).to_bytes(2, "little")
    return b"streamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+" + size + raw + b"\x86\x84"


def main() -> int:
    work = Path(tempfile.mkdtemp())
    db_path = work / "chat.db"
    db = sqlite3.connect(db_path)
    db.executescript("""
        create table message (ROWID integer primary key, text text, attributedBody blob, is_from_me integer, date integer, service text);
        create table chat (ROWID integer primary key, chat_identifier text, service_name text);
        create table chat_message_join (chat_id integer, message_id integer);
        insert into chat values (1, '+15550100', 'iMessage'), (2, '+15550199', 'iMessage'), (3, '+15550100', 'SMS');
    """)

    clock = [800_000_000]

    def add(chat, words, mine=1, in_body=False, later=60, service="iMessage"):
        clock[0] += later
        cur = db.execute("insert into message (text, attributedBody, is_from_me, date, service) values (?, ?, ?, ?, ?)",
                         (None if in_body else words, archived(words) if in_body else None, mine,
                          clock[0] * 1_000_000_000, service))
        db.execute("insert into chat_message_join values (?, ?)", (chat, cur.lastrowid))
        db.commit()

    tc.CONFIG = work / "config.json"
    tc.STATE = work / "state.json"
    tc.LOG = work / "log.txt"
    tc.CONFIG.write_text(json.dumps({"handles": ["+15550100"]}))
    asked, sent = [], []
    ask = lambda words: asked.append(words) or f"answer to {words}"  # noqa: E731
    send = lambda handle, words, trigger: sent.append((handle, words)) or True  # noqa: E731

    add(1, "Kyber what was on yesterday", later=0)
    add(1, "Kyber what do I have today", later=600)
    tc.run(False, db_path, ask, send, now=lambda: clock[0] + 5)
    check("the first run answers the text that woke it, not history",
          asked == ["what do I have today"], asked)
    asked.clear()

    add(1, "Kyber what do I have today")
    add(1, "kyber, open sheets", in_body=True)
    add(1, "kyber, open sheets", mine=0, in_body=True, later=1)
    add(1, "just a note to self")
    add(2, "Kyber text mom")
    add(3, "Kyber read my mail aloud", service="SMS")
    add(1, "Kyber")
    tc.run(False, db_path, ask, send, now=lambda: clock[0])
    check("only iMessage trigger texts in my own thread run, a forged SMS and a second copy skipped",
          asked == ["what do I have today", "open sheets"], asked)
    check("words kept only in attributedBody are read", "open sheets" in asked, asked)
    check("the answer goes back to my own thread", sent and all(h == "+15550100" for h, _ in sent), sent)

    tc.run(False, db_path, ask, send)
    check("nothing is answered twice", len(asked) == 2, asked)
    add(1, "Kyber open sheets", later=120)
    tc.run(False, db_path, ask, send)
    check("the same words later are a new command", asked[-1] == "open sheets" and len(asked) == 3, asked)

    argv = tc.model_argv("hi")
    check("the model may only run listed commands",
          "dontAsk" in argv and "--allowedTools" in argv and "auto" not in argv, argv)
    check("no listed command writes, sends or opens a shell",
          not any(w in rule for rule in tc.ALLOW for w in ("send", "delete", " add", "edit", "append", "bash -c", "python", "osascript", "Bash(*")),
          tc.ALLOW)
    check("every rule names a subcommand, never a whole tool",
          all(rule.count(" ") >= 1 and not rule.startswith("Bash(date") for rule in tc.ALLOW), tc.ALLOW)
    check("the trigger is a whole word", tc.command_in("Kyberish thing", "kyber") is None)
    check("the trigger takes punctuation after it", tc.command_in("Kyber: hi", "kyber") == "hi")

    tc.CONFIG.write_text(json.dumps({}))
    check("with no handles configured nothing is read", tc.run(False, db_path, ask, send) == 2)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
