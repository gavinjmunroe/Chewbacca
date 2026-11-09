#!/usr/bin/env python3
"""Outbound in the needs-you surface: a frozen batch waiting for the ok and a
lead's reply that needs a person show up; a sent batch, a batch past its 2
hour window, an opt-out and an answered reply don't. Synthetic files only."""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import osgraph_ingest  # noqa: E402
import osgraph_walks as W  # noqa: E402
from osgraph import Graph, Identities  # noqa: E402

NOW = datetime(2026, 10, 12, 16, 0, tzinfo=timezone.utc)
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


class Ctx:
    def now(self):
        return NOW


def write(path: Path, body) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if isinstance(body, str) else json.dumps(body))


def at(minutes: int) -> str:
    return (NOW - timedelta(minutes=minutes)).isoformat()


tmp = Path(tempfile.mkdtemp())
os.environ["GTME_HOME"] = str(tmp)
d = tmp / "clients" / "dana-co"
write(d / "plan.json", {"client": "Dana Co"})
mail = {"to": "a@shop.test", "step": 1, "subject": "s", "body": "b"}
write(d / "batches" / "aaaa.json", {"id": "aaaa", "made_at": at(10), "mails": [mail, mail]})
write(d / "batches" / "bbbb.json", {"id": "bbbb", "made_at": at(10), "sent_at": at(5), "mails": [mail]})
write(d / "batches" / "cccc.json", {"id": "cccc", "made_at": at(180), "mails": [mail]})
replies = [
    {"email": "maria@crumb.test", "from": "maria@crumb.test", "gmail_id": "r1", "kind": "interested", "at": at(30)},
    {"email": "lou@roll.test", "from": "lou@roll.test", "gmail_id": "r2", "kind": "unsubscribe", "at": at(30)},
    {"email": "pat@cafe.test", "from": "pat@cafe.test", "gmail_id": "r3", "kind": "question", "at": at(30)},
]
write(d / "replies.jsonl", "\n".join(json.dumps(r) for r in replies) + "\n")
write(d / "drafted.jsonl", json.dumps({"to": "pat@cafe.test"}) + "\n")

g = Graph(":memory:")
report = osgraph_ingest.ingest_all(g, Ctx(), days=7, ids=Identities(), only=["gtme"])
check("the gtme source ran without an error", "error" not in report["gtme"], report["gtme"])
rows = [r for r in W.needs_you(g, NOW)["rows"] if r["app"] == "Outbound"]
labels = sorted(r["label"] for r in rows)
check("one batch waiting for the ok and one reply that needs a person",
      labels == ["2 cold emails for Dana Co ready to send", "maria@crumb.test wants to talk"], labels)
check("both rank as blocked on him", all(r["tier"] == W.BLOCKED for r in rows), [r["tier"] for r in rows])
check("reply text never lands in the graph", all("text" not in r["props"] for r in rows))

empty = Graph(":memory:")
os.environ["GTME_HOME"] = str(tmp / "nobody")
report = osgraph_ingest.ingest_all(empty, Ctx(), days=7, ids=Identities(), only=["gtme"])
check("no gtme set up is an empty source, not an error", "error" not in report["gtme"], report["gtme"])

print("ingest_gtme:", "all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
