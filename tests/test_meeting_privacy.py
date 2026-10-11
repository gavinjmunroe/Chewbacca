#!/usr/bin/env python3
"""meeting_privacy: one decoded value decides "private" and is what every path
prints. Security review findings 2026-10-11. Run: python3 tests/test_meeting_privacy.py"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "bin" / "lib" / "surfaces"))
import meeting_privacy as MP  # noqa: E402
import meeting_actions as MA  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


HIDDEN = ["Caleb&apos;s psychiatric intake", "Caleb&amp;apos;s therapy", "thera-py", "t.h.e.r.a.p.y",
          "Thеrapy", "psych​iatric check", "psych&amp;#8203;iatric", "Ｔｈｅｒａｐｙ",
          "Medication management", "counseling w Adrien", "the‮rapy"]
for title in HIDDEN:
    check(f"hidden: {title!r}", MP.safe_title(title) == "Private", MP.safe_title(title))
for title in ["Amber sync", "Firm Foundation", "TTS cabinet", "Caleb / Karthik"]:
    check(f"shown: {title!r}", MP.safe_title(title) == title, MP.safe_title(title))
check("the shown text is the decoded text", MP.safe_title("Caleb&apos;s sync") == "Caleb's sync")

meeting = {"id": "m1", "title": "Caleb&apos;s psych&#8203;iatric intake", "started_at": "2026-10-10T18:00:00Z"}
item = {"id": "i1", "text": "Refill the prescription by Friday"}
p = MA.plan(meeting, item, [], [], "you")
check("a plan never carries the private title", "psych" not in p["meeting_title"].lower() and p["private"], p["meeting_title"])
argv = MA.ledger_argv(p, {}, "meeting:m1:i1")
joined = " ".join(argv).lower()
check("the ledger row reads as private, title and note", "psych" not in joined and "prescription" not in joined
      and "Private follow-up" in " ".join(argv), argv)
plain = MA.plan({"id": "m2", "title": "Amber sync", "started_at": "2026-10-10T18:00:00Z"},
                {"id": "i2", "text": "Send Sagar the deck"}, [], [], "you")
check("an ordinary meeting keeps its title and task", plain["meeting_title"] == "Amber sync" and not plain["private"])
print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
