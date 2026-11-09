"""The call on the glass while it's happening: what was just said, and one press
to ask about it. This surface reads and asks. It never records: Record lives on
the meetings surface and the consent line belongs to room-capture.

Rules, privacy and the prompts: bin/lib/meeting_live.py.
"""
from __future__ import annotations

import sys
import textwrap
import threading
from datetime import timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import meeting_capture as MC  # noqa: E402
import meeting_live as ML  # noqa: E402

from . import ACTION_PREFIX, Bind, Context, Provider, Result, clip, comp, note_for  # noqa: E402

# A chunk lands every 15 s (bin/room-capture CHUNK_S), so 5 s shows it within a
# third of a chunk. The read is one small JSON file. Guessed, cheap either way.
REFRESH_S = 5.0
# surface_lint.ROW_CHARS is 120, and 7 rows of it is the first view's 1,000 chars.
ROW_WIDTH = 110
HEARD_ROWS = 4
ANSWER_ROWS = 5


def rows(text: str, count: int, width: int = ROW_WIDTH) -> list[dict]:
    """An answer as rows that read at a glance, cut with a pointer to the rest."""
    wrapped = [part for raw in str(text or "").splitlines() for part in textwrap.wrap(raw, width)]
    if len(wrapped) > count:
        wrapped = wrapped[:count - 1] + ["More with: meeting-live ask, same question."]
    return [{"id": f"a{n}", "text": part} for n, part in enumerate(wrapped)]


class Live(Provider):
    name = "live"
    title = "On this call"
    region = "topRight"
    width = 400
    refresh = REFRESH_S
    replaces = "Granola, copied by hand"

    def __init__(self) -> None:
        super().__init__()
        self.answer = ""
        self.asking = ""
        self.lock = threading.Lock()
        self.actions = {f"{ACTION_PREFIX}ask{n}": self._preset(n) for n in range(3)}
        self.actions[f"{ACTION_PREFIX}ask"] = self.typed
        self.actions[f"{ACTION_PREFIX}mode"] = self.next_mode

    def fetch(self, ctx: Context):
        home = Path(ctx.home)
        now = ctx.now().astimezone(timezone.utc)
        body = ML.status(home, now)
        if body.get("live") and not body.get("private"):
            meeting = ML.current(home, now)
            body["heard"] = [{"who": ML.who(x), "text": ML.heard_text(x), "clock": MC.clean(x.get("clock"), 12)}
                             for x in (ML.lines_of(meeting)[-HEARD_ROWS:] if meeting else [])]
        return body

    def layout(self) -> list[str]:
        ids = ["s", "state", "note", "heard", "presses", "answer", "field", "go", "status"]
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("state"), "Text", value=Bind(self.p("state")), tone=Bind(self.p("tone"))),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("heard"), "Transcript", items=Bind(self.p("heard"))),
            comp(self.cid("presses"), "Stack", direction="horizontal", align="center", gap=2),
            comp(self.cid("p0"), "Button", label=Bind(self.p("label0")), action=f"{ACTION_PREFIX}ask0"),
            comp(self.cid("p1"), "Button", label=Bind(self.p("label1")), action=f"{ACTION_PREFIX}ask1"),
            comp(self.cid("p2"), "Button", label=Bind(self.p("label2")), action=f"{ACTION_PREFIX}ask2"),
            comp(self.cid("pm"), "Button", label=Bind(self.p("modeLabel")), action=f"{ACTION_PREFIX}mode"),
            comp(self.cid("answer"), "List", items=Bind(self.p("answer"))),
            comp(self.cid("field"), "Field", label="Ask about the call", placeholder="Ask anything", value=Bind(self.p("q"))),
            comp(self.cid("go"), "Button", label=Bind(self.p("goLabel")), action=f"{ACTION_PREFIX}ask", variant="primary"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {self.cid('presses')} {self.cid('p0')} {self.cid('p1')} {self.cid('p2')} {self.cid('pm')}",
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("q"): "", self.p("status"): ""}

    def blank(self) -> dict:
        out = {self.p(k): "" for k in ("state", "tone", "label0", "label1", "label2", "modeLabel", "goLabel")}
        out.update({self.p("heard"): [], self.p("answer"): []})
        return out

    def model(self, data, error: str | None, values: dict, ctx: Context) -> dict:
        out = self.blank()
        live = isinstance(data, dict) and data.get("live")
        if live and data.get("private"):
            out[self.p("state")] = "Private call"
            out[self.p("note")] = "Nothing from it shows here or reaches a tab."
            return out
        if not live:
            out[self.p("note")] = note_for(data, error, "No call recording. It starts when a call takes the mic.")
            return out
        out[self.p("state")] = f"Recording {data.get('minutes', 0)}m: {clip(data.get('title'), 44)}"
        out[self.p("tone")] = "recording"
        heard = data.get("heard") or []
        out[self.p("note")] = "" if heard else "First words land about 20 seconds in."
        out[self.p("heard")] = [{"id": f"h{n}", "role": "assistant" if h["who"] != "you" else "user",
                                 "text": clip(h["text"], ROW_WIDTH)} for n, h in enumerate(heard)]
        mode = data.get("mode") if data.get("mode") in ML.MODES else ML.DEFAULT_MODE
        for n, key in enumerate(ML.MODES[mode]["asks"]):
            out[self.p(f"label{n}")] = ML.ASKS[key][0]
        out[self.p("modeLabel")] = ML.MODES[mode]["label"]
        out[self.p("goLabel")] = "Ask"
        with self.lock:
            out[self.p("answer")] = rows(f"Asking: {self.asking}", 1) if self.asking else rows(self.answer, ANSWER_ROWS)
        return out

    # ── presses ──────────────────────────────────────────────────────────

    def _start(self, ctx: Context, label: str, question: str) -> Result:
        """The ask takes seconds, so it runs on its own thread and the answer
        arrives through poke, the way a search does. One at a time."""
        with self.lock:
            if self.asking:
                return Result(False, "Still answering the last one.")
            self.asking = label

        def work() -> None:
            try:
                ok, answer = ML.ask(Path(ctx.home), question, now=ctx.now().astimezone(timezone.utc))
            except Exception as err:  # noqa: BLE001  the panel says so rather than hanging on "Asking"
                ok, answer = False, f"That failed: {err}"
            with self.lock:
                self.answer = answer
                self.asking = ""
            self.poke()

        threading.Thread(target=work, daemon=True).start()
        return Result(True, "")

    def _preset(self, slot: int):
        def press(ctx: Context, data, values: dict) -> Result:
            mode = data.get("mode") if isinstance(data, dict) and data.get("mode") in ML.MODES else ML.DEFAULT_MODE
            label, question = ML.ASKS[ML.MODES[mode]["asks"][slot]]
            return self._start(ctx, label, question)
        return press

    def typed(self, ctx: Context, data, values: dict) -> Result:
        question = " ".join(str(values.get(self.p("q")) or "").split())
        if not question:
            return Result(False, "Type a question first.")
        result = self._start(ctx, clip(question, 60), question)
        if result.ok:
            result.updates = {self.p("q"): ""}
        return result

    def next_mode(self, ctx: Context, data, values: dict) -> Result:
        names = list(ML.MODES)
        now = ML.mode_of(Path(ctx.home))
        mode = names[(names.index(now) + 1) % len(names)]
        ML.set_setting(Path(ctx.home), "mode", mode)
        return Result(True, "", refetch=True)
