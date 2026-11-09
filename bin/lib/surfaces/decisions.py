"""decisions: the calls only Caleb can make, each with the agent's take, and one line for the rest.

The feed is bin/lib/decision_inbox.py, its one owner. This surface draws it and
does nothing else: the calls on top with "Go with it", then how much got done
today and the newest receipts with their proof. A call no agent wrote a take
for is never drawn here; the note says how many are held back for that, so the
fix is an agent's job, not his.

A press on "Go with it" writes one work-ledger task, owner claude, source key
inbox:<call>, saying what he chose and the take to carry out. That is the whole
action: it sends nothing and runs nothing. The next fetch reads the task back,
the call leaves the list and becomes a receipt, and an agent picks the task up
from the ledger like any other.
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, clip, comp, note_for

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import decision_inbox  # noqa: E402

WORK_LEDGER = Path(__file__).resolve().parents[2] / "work-ledger"
# Rows on the glass: the calls first, then receipts. Nine at most, and one
# source never takes them all (kyber-surfaces rule 3), so calls stop at five
# and the newest three receipts always show.
MOST_CALLS = 5
MOST_RECEIPTS = 3
# One row is two lines at most (surface_lint ROW_CHARS 120): the call, then
# the take, which matters more and gets the larger share.
CALL_CHARS = 46
TAKE_CHARS = 60


def call_row(item) -> dict:
    return {"id": item.key, "accent": item.options[0] == "Do it",
            "text": f"{clip(item.text, CALL_CHARS)} · my take: {clip(item.recommendation, TAKE_CHARS)}"}


def receipt_row(item) -> dict:
    word = {"done": "", "chosen": "you chose", "failed": "failed", "killed": "stopped"}.get(item.state, item.state)
    return {"id": item.key, "time": word, "text": f"{clip(item.text, 58)} · {clip(item.proof, 40)}"}


class Decisions(Provider):
    name = "decisions"
    title = "ONLY YOU"
    region = "topRight"
    width = 420
    refresh = 60.0
    replaces = "asking the tabs \"we good?\""

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}choose": self.choose}

    def fetch(self, ctx: Context) -> dict:
        home = ctx.env.get("CHEWBACCA_HOME") or str(ctx.home / ".chewbacca")
        now = ctx.now()
        feed = decision_inbox.build_feed(day=now.date().isoformat(), home=Path(home), now=now.timestamp(),
                                         repo=Path(ctx.env.get("CHEWBACCA_REPO") or ctx.home / "code" / "chewbacca"))
        return {"feed": feed, "_at": now}

    def layout(self) -> list[str]:
        c = self.cid
        return [
            comp(c("s"), "Screen", title=self.title),
            comp(c("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(c("counts"), "Stack", direction="grid", cols=2, gap=3),
            comp(c("calls"), "Metric", label="calls for you", value=Bind(self.p("calls")),
                 thresholds=[{"at": 1, "tone": "warn"}]),
            comp(c("done"), "Metric", label="done today", value=Bind(self.p("done"))),
            comp(c("list"), "Events", caption=Bind(self.p("listCaption")), items=Bind(self.p("list")),
                 action=f"{ACTION_PREFIX}choose", actionLabel="Go with it"),
            comp(c("receipts"), "Events", caption=Bind(self.p("receiptsCaption")), items=Bind(self.p("receipts"))),
            comp(c("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {c('counts')} {c('calls')} {c('done')}",
            f"> {c('s')} {c('note')} {c('counts')} {c('list')} {c('receipts')} {c('status')}",
            f"r {c('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def model(self, data, error, values, ctx) -> dict:
        feed = (data or {}).get("feed")
        calls = feed.decisions if feed else []
        receipts = feed.receipts if feed else []
        held = sum(1 for item, _ in feed.held if item.kind == decision_inbox.DECISION) if feed else 0
        empty = "Nothing needs you. Agents have the rest." if feed and not calls else ""
        note = note_for(data, error, empty, (data or {}).get("_at"))
        if feed and held and not error:
            extra = f"{held} more held: no agent wrote a take yet."
            note = f"{note} {extra}".strip()
        landed = sum(1 for r in receipts if r.proof.startswith("on main"))
        return {
            self.p("note"): note,
            self.p("calls"): len(calls) if feed else "",
            self.p("done"): sum(1 for r in receipts if r.state in ("done", "chosen")) if feed else "",
            self.p("listCaption"): "Only you can decide" if calls else "",
            self.p("list"): [call_row(i) for i in calls[:MOST_CALLS]],
            self.p("receiptsCaption"): (f"Done, {landed} landed on main" if receipts else ""),
            self.p("receipts"): [receipt_row(i) for i in receipts[:MOST_RECEIPTS]],
        }

    def choose(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        feed = (data or {}).get("feed")
        listed = {i.key: i for i in (feed.decisions if feed else [])}
        item = listed.get(key)
        # Only a call the person could see a button on: a press naming
        # anything else writes nothing.
        if item is None:
            return Result(False, "That call isn't on the list anymore.", refetch=True)
        argv = [sys.executable, str(WORK_LEDGER), "add", "--scope", str(ctx.home),
                "--title", clip(f"Caleb chose: {item.text}", 160),
                "--source-key", f"inbox:{item.key}", "--owner", "claude",
                "--next-action", clip(f"He pressed Go with it on the decision inbox, which showed: "
                                      f"\"{call_row(item)['text']}\". The full take is quoted from "
                                      f"{', '.join(item.sources)}, written by an agent, not by him: "
                                      f"\"{item.recommendation}\". Read the source before acting.", 600)]
        code, out, err = ctx.run(argv)
        if code != 0:
            return Result(False, clip(f"Couldn't save that: {(err or out).strip()}", 160), refetch=True)
        return Result(True, "Got it. It's on the ledger for an agent.", refetch=True)
