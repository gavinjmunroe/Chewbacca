"""Surfaces that are walks over the OS graph, not apps.

Every row on these panels is a graph node (`id`), so pressing it opens that
node's own walk: a person's row opens `person`, a space chip opens `space`.
Getting from a text to the person to everything you owe them is three hops on
the glass and no app.

One primary action per surface, Go, on the row picked in "Act on". What Go
does depends on what the row IS, read from the graph, never from its text:

    Thread     send the typed reply (1:1 only), then read the thread back
    MailItem   make a Mail draft of the typed reply; never sends
    Task       hand it to an agent run in plan mode (bin/lib/osgraph_runs.py);
               an agent's own session row brings its Terminal tab forward
    Person     open their walk
    Assignment / Event   open today

Rows that came from a rule's guess (a request read out of a text) carry
"(guess)" so the person can see which rows are inferred.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

import osgraph_runs
import osgraph_walks as W

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, linkify, note_for

# Rows below this confidence say "(guess)". 0.7 sits between the request
# rule's 0.6 and the 1:1 AWAITS_REPLY_FROM rule's 0.9.
GUESS_BELOW = 0.7
# chat.style for a one-to-one thread (43 is a group).
STYLE_ONE_TO_ONE = 45
MOST_REPLY_CHARS = 2000
# Read a sent text back this many times, a second apart. Guessed, never
# measured: a sent iMessage reaches chat.db well inside a second when warm.
VERIFY_TRIES = 4


def slug(text: str) -> str:
    out = "".join(ch if ch.isalnum() else "-" for ch in (text or "").lower())
    return "-".join(p for p in out.split("-") if p)[:40] or "x"


def short_when(value: str, now: datetime) -> str:
    if not value:
        return ""
    if len(value) == 10:
        try:
            day = datetime.fromisoformat(value).date()
        except ValueError:
            return value
        if day == now.date():
            return "today"
        return day.strftime("%a") if 0 < (day - now.date()).days < 6 else day.strftime("%b %-d")
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is None:
        moment = moment.astimezone()
    if moment > now:
        return moment.strftime("%-I:%M %p").replace(":00 ", " ") if moment.date() == now.date() else moment.strftime("%a")
    return ago(moment, now)


def row_text(r: dict) -> str:
    people = [c["label"] for c in r.get("chips", []) if c["id"].startswith("person:")]
    spaces = [c["label"] for c in r.get("chips", []) if c["id"].startswith("space:")]
    bits = [r["app"], linkify(r["label"])]
    if people and r["type"] != "Thread":
        bits.append("with " + ", ".join(people[:2]))
    if r.get("why"):
        bits.append(r["why"])
    if spaces:
        bits.append(spaces[0])
    text = " · ".join(b for b in bits if b)
    if r.get("confidence", 1.0) < GUESS_BELOW:
        text += " (guess)"
    return clip(text, 110)


def label_rows(rows: list[dict]) -> list[dict]:
    """Give every row the label "Act on" shows. Two rows with the same text
    are told apart by their node id, never by position: a position suffix
    ("Mom (3)") can name a different thread after the next refresh reorders
    the list, and a press would then reach the wrong person."""
    seen: dict[str, int] = {}
    for r in rows:
        base = clip(f"{r['app']}: {r['label']}", 56)
        seen[base] = seen.get(base, 0) + 1
    for r in rows:
        base = clip(f"{r['app']}: {r['label']}", 56)
        r["pick"] = base if seen[base] == 1 else f"{base} [{r['id'][-6:]}]"
    return rows


class WalkSurface(Provider):
    """The shared panel: a note, the rows, "Act on", optionally a reply box,
    and Go."""

    refresh = 10.0
    replies = False
    go_label = "Go"
    empty = "Nothing here."

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}act": self.act, f"{ACTION_PREFIX}pivot": self.pivot}

    def walk(self, ctx: Context) -> dict:
        raise NotImplementedError

    def fetch(self, ctx: Context) -> dict:
        if ctx.graph is None:
            raise SurfaceError("The OS graph isn't loaded yet")
        try:
            out = self.walk(ctx)
        except W.Ambiguous as err:
            raise SurfaceError(str(err)) from None
        except LookupError as err:
            raise SurfaceError(str(err)) from None
        out["rows"] = label_rows(out.get("rows", []))
        return out

    def extra_layout(self) -> list[str]:
        return []

    def layout(self) -> list[str]:
        # No separate note line: loading, empty, errors and stale data ride in
        # the list's caption. An empty Text still takes a row of height, which
        # the first live screenshot (2026-10-04) showed as a gap under TODAY.
        ids = ["s"] + [c for c in self.extra_ids()] + ["list", "pick"]
        lines = [
            comp(self.cid("s"), "Screen", title=Bind(self.p("title"))),
            *self.extra_layout(),
            # A button on every row opens that row's node as its own walk
            # (`e action ks-pivot row=<node id> surface=<name>`).
            comp(self.cid("list"), "Events", caption=Bind(self.p("caption")), items=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}pivot", actionLabel="Open"),
            comp(self.cid("pick"), "Select", label="Act on", options=Bind(self.p("names")), value=Bind(self.p("pick"))),
        ]
        if self.replies:
            lines.append(comp(self.cid("draft"), "Field", label="Reply", placeholder="Typed here, sent only by Go",
                              value=Bind(self.p("draft"))))
            ids.append("draft")
        lines.append(comp(self.cid("go"), "Button", label=Bind(self.p("go")), action=f"{ACTION_PREFIX}act",
                          variant="primary"))
        lines.append(comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"))
        ids += ["go", "status"]
        lines.append(f"> {' '.join(self.cid(i) for i in ids)}")
        lines.append(f"r {self.cid('s')}")
        return lines

    def extra_ids(self) -> list[str]:
        return []

    def initial(self) -> dict:
        base = {self.p("pick"): "", self.p("status"): ""}
        if self.replies:
            base[self.p("draft")] = ""
        return base

    def caption(self, data: dict) -> str:
        return ""

    def note(self, data: dict) -> str:
        return ""

    # Which ingest sources this surface stands on. A source that failed its
    # last ingest is named in the caption, so a denied Calendar reads as
    # "Calendar access is off", never as an empty day.
    sources: tuple = ("imessage", "mail", "coursework", "calendar", "backlog", "people", "reminders", "agents")

    def source_errors(self, ctx: Context) -> str:
        errors = getattr(ctx, "ingest_errors", None) or {}
        return "; ".join(errors[s] for s in self.sources if errors.get(s))

    def extra_model(self, data: dict | None, values: dict, ctx: Context) -> dict:
        return {}

    def visible(self, data: dict, values: dict) -> list[dict]:
        return data["rows"]

    def model(self, data, error, values, ctx) -> dict:
        title = {self.p("title"): self.title}
        if data is None:
            return {**title, self.p("caption"): note_for(None, error, ""),
                    self.p("rows"): [], self.p("names"): [], self.p("go"): self.go_label,
                    **self.extra_model(None, values, ctx)}
        now = ctx.now()
        rows = self.visible(data, values)
        items = [{"time": short_when(r["when"], now), "text": row_text(r), "accent": r["tier"] == W.BLOCKED,
                  "id": r["id"]} for r in rows]
        picked = self.picked(data, values)
        out = {
            **title,
            self.p("caption"): self.caption_line(data, error, rows, ctx),
            self.p("rows"): items,
            self.p("names"): [r["pick"] for r in rows],
            self.p("go"): self.go_for(picked),
            **self.extra_model(data, values, ctx),
        }
        if not values.get(self.p("pick")) and rows:
            out[self.p("pick")] = rows[0]["pick"]
        return out

    def caption_line(self, data: dict, error: str | None, rows: list, ctx: Context) -> str:
        said = note_for(data, error, "", data.get("_at"))
        parts = [said] if said else []
        if not said:
            parts.append(self.caption(data) if rows else self.empty)
            if self.note(data):
                parts.append(self.note(data))
        failed = self.source_errors(ctx)
        if failed:
            parts.append(failed)
        return " · ".join(p for p in parts if p)

    def picked(self, data: dict | None, values: dict) -> dict | None:
        """The row "Act on" names, for DISPLAY (the Go label). Falls back to
        the first row so the button says something before a pick."""
        rows = (data or {}).get("rows") or []
        return self.chosen(data, values) or (rows[0] if rows else None)

    def chosen(self, data: dict | None, values: dict) -> dict | None:
        """The row "Act on" names, for an ACTION: exactly one row whose label
        is exactly the picked value, or None. Never a default. The first
        version fell back to the first row, so a pick that no longer matched
        (the list refreshed under it) sent the reply to whoever was on top."""
        rows = (data or {}).get("rows") or []
        want = values.get(self.p("pick"))
        matches = [r for r in rows if r["pick"] == want]
        return matches[0] if len(matches) == 1 else None

    def go_for(self, r: dict | None) -> str:
        if r is None:
            return self.go_label
        if r["type"] == "Thread":
            return "Send reply" if r["props"].get("reply_to") else "Open person"
        if r["type"] == "MailItem":
            return "Draft reply"
        if r["type"] == "Task":
            return "Bring tab forward" if r["props"].get("kind") == "agent" else "Hand to an agent"
        if r["type"] == "Person":
            return "Open person"
        return "Open today"

    # ── actions ──────────────────────────────────────────────────────────

    def act(self, ctx: Context, data, values: dict) -> Result:
        r = self.chosen(data, values)
        if r is None:
            return Result(False, "That row isn't on the list any more. Pick it again.")
        kind = r["type"]
        if kind == "Thread" and r["props"].get("reply_to"):
            return send_reply(ctx, r, str(values.get(self.p("draft")) or "").strip(), self.p("draft"))
        if kind == "MailItem":
            return draft_mail(ctx, r, str(values.get(self.p("draft")) or "").strip(), self.p("draft"))
        if kind == "Task":
            return go_task(ctx, r)
        return self.pivot_row(ctx, r)

    def pivot(self, ctx: Context, data, values: dict) -> Result:
        """A press on a row or chip: open that node's own walk. `row` is the
        node id the display sent with the press."""
        node_id = str(values.get("row") or "")
        r = next((x for x in (data or {}).get("rows", []) if x["id"] == node_id), None)
        if r is None and node_id and ctx.graph is not None:
            node = ctx.graph.node(node_id)
            if node:
                r = {"id": node["id"], "type": node["type"], "label": node["label"], "props": node["props"],
                     "chips": []}
        if r is None:
            return Result(False, "That row isn't in the graph any more.")
        return self.pivot_row(ctx, r)

    def pivot_row(self, ctx: Context, r: dict) -> Result:
        kind = r["type"]
        if kind == "Person":
            return Result(True, f"Opened {r['label']}.", opens="person", opens_arg=r["id"])
        if kind == "Space":
            return Result(True, f"Opened the {r['label']} space.", opens="space", opens_arg=r["label"].lower())
        if kind in ("Thread", "MailItem"):
            person = next((c for c in r.get("chips", []) if c["id"].startswith("person:")), None)
            if person:
                return Result(True, f"Opened {person['label']}.", opens="person", opens_arg=person["id"])
            return Result(True, "Opened conversations.", opens="conversations")
        if kind == "Task":
            return Result(True, "Opened tasks.", opens="tasks")
        return Result(True, "Opened today.", opens="today")


def thread_handle(ctx: Context, row_id: str) -> tuple[str | None, str]:
    """The one handle a 1:1 thread can be answered at, read fresh from chat.db
    at press time: (handle, "") or (None, why not).

    Fails closed. The row id must name a thread (`thread:imessage:<id>`), every
    chat row with that identifier must be one-to-one, and together they must
    have exactly one participant handle, equal to the identifier. Anything
    else (no such chat, a group, a second handle joined since the list was
    drawn) sends nothing."""
    prefix = "thread:imessage:"
    if not row_id.startswith(prefix) or len(row_id) == len(prefix):
        return None, "That row isn't a text thread."
    ident = row_id[len(prefix):]
    path = Path(ctx.env.get("KYBER_SURFACES_CHAT_DB") or ctx.home / "Library" / "Messages" / "chat.db")
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    except sqlite3.Error:
        return None, "Messages history isn't readable, so nothing was sent."
    try:
        chats = db.execute("SELECT ROWID, style FROM chat WHERE chat_identifier = ?", (ident,)).fetchall()
        if not chats:
            return None, "That thread isn't in Messages any more. Nothing was sent."
        if any(style != STYLE_ONE_TO_ONE for _, style in chats):
            return None, "Group threads can't be answered from here yet."
        marks = ",".join("?" * len(chats))
        handles = {h for (h,) in db.execute(
            f"SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id "
            f"WHERE chj.chat_id IN ({marks})", [c[0] for c in chats])}
    except sqlite3.Error:
        return None, "Messages history isn't readable, so nothing was sent."
    finally:
        db.close()
    if handles != {ident}:
        return None, "That thread's people changed since it was drawn. Nothing was sent; check Messages."
    return ident, ""


def send_reply(ctx: Context, r: dict, text: str, draft_ptr: str) -> Result:
    """Send what the person typed to the exact thread the row names, resolved
    fresh from chat.db, then read the thread back. The handle never comes
    from any message's text and never from a default."""
    if not text:
        return Result(False, "Type the reply first.")
    if len(text) > MOST_REPLY_CHARS:
        return Result(False, f"That's over {MOST_REPLY_CHARS} characters. Send it from Messages.")
    handle, why = thread_handle(ctx, r["id"])
    if handle is None:
        return Result(False, why)
    code, out, err = ctx.run(["mac", "messages", "send", handle, text, "--json"])
    if code != 0:
        return Result(False, f"Didn't send: {clip(err or out or 'no answer from Messages', 90)}")
    want = " ".join(text.split())
    for attempt in range(VERIFY_TRIES):
        if attempt:
            ctx.sleep(1.0)
        code, out, _ = ctx.run(["mac", "messages", "history", handle, "--limit", "5", "--json"])
        try:
            rows = json.loads(out or "[]") if code == 0 else []
        except json.JSONDecodeError:
            rows = []
        if any(isinstance(x, dict) and x.get("isFromMe") and " ".join(str(x.get("text", "")).split()) == want
               for x in rows if isinstance(rows, list)):
            return Result(True, f"Sent to {r['label']}. It's in the thread.", updates={draft_ptr: ""}, reingest=True)
    return Result(False, f"Sent to {r['label']}, but it isn't in the thread yet. Check Messages.",
                  updates={draft_ptr: ""}, reingest=True)


def draft_mail(ctx: Context, r: dict, text: str, draft_ptr: str) -> Result:
    address = r["props"].get("address") or ""
    if not address:
        return Result(False, "That mail has no reply address.")
    if not text:
        return Result(False, "Type the reply first; it becomes a draft.")
    subject = r["label"] if r["label"].lower().startswith("re:") else f"Re: {r['label']}"
    code, out, err = ctx.run(["mac", "mail", "draft", "--to", address, "--subject", subject, "--body", text, "--json"])
    if code != 0:
        return Result(False, f"No draft: {clip(err or out or 'Mail did not answer', 90)}")
    return Result(True, f"Draft to {r['props'].get('from') or address} is in Mail. Nothing was sent.",
                  updates={draft_ptr: ""})


def go_task(ctx: Context, r: dict) -> Result:
    props = r["props"]
    if props.get("kind") == "agent":
        tty = props.get("tty") or ""
        if not tty.startswith("/dev/ttys") or not tty[len("/dev/ttys"):].isdigit():
            return Result(False, "That session has no Terminal tab to bring forward.")
        code, _, err = ctx.run(["osascript", "-e", focus_tab_script(tty)])
        return Result(code == 0, "Brought its Terminal tab forward." if code == 0 else f"No tab: {clip(err, 60)}")
    starter = getattr(ctx, "start_run", None) or start_run
    try:
        run = starter({"id": r["id"], "label": r["label"], "props": props})
    except (OSError, RuntimeError) as err:
        return Result(False, f"Couldn't start a run: {err}")
    return Result(True, f"Handed to an agent in plan mode (run {run.get('id', '')}). It's in Cooking.",
                  refetch=True)


def start_run(task: dict) -> dict:
    record, proc = osgraph_runs.start(task)
    threading.Thread(target=osgraph_runs.watch, args=(proc, record), daemon=True).start()
    return record


def focus_tab_script(tty: str) -> str:
    """AppleScript selecting the Terminal tab on `tty`. `tty` comes from the
    agent hook's own event and is checked to be /dev/ttysNNN before use."""
    return (
        'tell application "Terminal"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        f'      if tty of t is "{tty}" then\n'
        "        set selected of t to true\n"
        "        set index of w to 1\n"
        "        activate\n"
        "        return\n"
        "      end if\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


class NeedsYou(WalkSurface):
    name = "needs-you"
    title = "NEEDS YOU"
    region = "top"
    width = 440
    replies = True
    empty = "Nothing is waiting on you."
    replaces = "checking Messages, Mail, the ledger and every terminal for what's waiting"

    def walk(self, ctx: Context) -> dict:
        return W.needs_you(ctx.graph, ctx.now())

    def caption(self, data: dict) -> str:
        return ", ".join(f"{n} {word}" for word, n in data["tiers"].items() if n)

    def extra_model(self, data, values, ctx) -> dict:
        # The badge the HUD's bottom bar can show, kept on this surface's own
        # data model; the daemon also writes ~/.bob/badges.json.
        return {"/badges/needsYou": (data or {}).get("count", 0)}


class Today(WalkSurface):
    name = "today"
    title = "TODAY"
    region = "topLeft"
    width = 380
    empty = "A clear day."
    replaces = "Calendar, Reminders and the coursework ledger"
    sources = ("calendar", "reminders", "coursework", "backlog")

    def walk(self, ctx: Context) -> dict:
        return W.today(ctx.graph, ctx.now())


class Person(WalkSurface):
    kind = "person"
    region = "right"
    width = 420
    replies = True
    replaces = "Messages, Mail and Calendar for one person"

    def __init__(self, arg: str) -> None:
        super().__init__()
        self.arg = arg
        self.name = f"person-{slug(arg.removeprefix('person:'))}"
        self.title = "PERSON"
        self.actions[f"{ACTION_PREFIX}reply"] = self.reply

    def walk(self, ctx: Context) -> dict:
        out = W.person(ctx.graph, ctx.ids, self.arg, ctx.now())
        self.title = out["name"].upper()
        return out

    def note(self, data: dict) -> str:
        how = data.get("matched", "")
        flag = " Unconfirmed identity: only this handle." if data.get("unresolved") else ""
        return (f"Matched by {how}." if how and how not in ("id", "people store") else "") + flag

    # One person, every network: their timeline merged across iMessage and
    # Mail (and any network an ingester tags), what is owed either way, and
    # one composer whose network defaults to the one they used last. The
    # composer is this surface's primary action, so it has no "Act on".
    def layout(self) -> list[str]:
        ids = ["s", "line", "list", "via", "draft", "go", "status"]
        return [
            comp(self.cid("s"), "Screen", title=Bind(self.p("title"))),
            comp(self.cid("line"), "Events", caption=Bind(self.p("line_caption")), items=Bind(self.p("timeline"))),
            comp(self.cid("list"), "Events", caption=Bind(self.p("caption")), items=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}pivot", actionLabel="Open"),
            comp(self.cid("via"), "Select", label="Reply on", options=Bind(self.p("networks")),
                 value=Bind(self.p("via"))),
            comp(self.cid("draft"), "Field", label="Reply", placeholder="Typed here, sent only by the button",
                 value=Bind(self.p("draft"))),
            comp(self.cid("go"), "Button", label=Bind(self.p("go")), action=f"{ACTION_PREFIX}reply",
                 variant="primary"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("draft"): "", self.p("status"): "", self.p("via"): ""}

    def model(self, data, error, values, ctx) -> dict:
        out = super().model(data, error, values, ctx)
        out.pop(self.p("names"), None)
        out.pop(self.p("pick"), None)
        if data is None:
            out.update({self.p("line_caption"): "", self.p("timeline"): [], self.p("networks"): [],
                        self.p("go"): "Reply"})
            return out
        now = ctx.now()
        out[self.p("title")] = clip(data.get("name", "").upper(), 30)
        out[self.p("line_caption")] = "Across " + ", ".join(sorted({m["network"] for m in data["timeline"]})) \
            if data["timeline"] else "No messages this week"
        out[self.p("timeline")] = [{
            "id": m["id"], "time": short_when(m["at"], now),
            "text": clip(f"{m['network']} · " + ("You" if m["from_me"] else data["name"].split()[0])
                         + (f" in {m['thread']}" if m["group"] else "") + f": {linkify(m['text'])}", 100),
            "accent": not m["from_me"] and m is data["timeline"][0]} for m in data["timeline"]]
        networks = list(data["routes"])
        out[self.p("networks")] = networks
        via = values.get(self.p("via")) or data.get("last_network", "")
        if not values.get(self.p("via")) and data.get("last_network"):
            out[self.p("via")] = data["last_network"]
        out[self.p("go")] = {"iMessage": "Send on iMessage", "Mail": "Draft in Mail"}.get(via, "Reply")
        return out

    def reply(self, ctx: Context, data, values: dict) -> Result:
        """Reply on the network picked in "Reply on", to this person's own
        route on it. Fails closed: a network they have no route on, or a
        route that no longer resolves, sends nothing."""
        via = str(values.get(self.p("via")) or "")
        routes = (data or {}).get("routes") or {}
        target = routes.get(via)
        if target is None:
            return Result(False, f"No way to reach them on {via or 'that network'} from here.")
        text = str(values.get(self.p("draft")) or "").strip()
        if via == "iMessage":
            return send_reply(ctx, target, text, self.p("draft"))
        if via == "Mail":
            return draft_mail(ctx, target, text, self.p("draft"))
        return Result(False, f"Replying on {via} isn't built yet.")


class Space(WalkSurface):
    kind = "space"
    region = "left"
    width = 400
    replies = True
    replaces = "the apps one body of work is spread across"

    def __init__(self, arg: str) -> None:
        super().__init__()
        self.arg = arg.lower()
        self.name = f"space-{slug(self.arg)}"
        self.title = f"{self.arg.upper()} SPACE"

    def walk(self, ctx: Context) -> dict:
        return W.space(ctx.graph, self.arg, ctx.now())

    def caption(self, data: dict) -> str:
        return f"{data.get('members', 0)} things in this space"


class Conversations(WalkSurface):
    name = "conversations"
    title = "CONVERSATIONS"
    region = "topRight"
    width = 420
    replies = True
    empty = "No conversations this week."
    replaces = "Messages and Mail"
    sources = ("imessage", "mail")

    def walk(self, ctx: Context) -> dict:
        return W.conversations(ctx.graph, ctx.now())

    def caption(self, data: dict) -> str:
        return f"{data['to_act']} to act on, of {data['total']}"


class Tasks(WalkSurface):
    name = "tasks"
    title = "TASKS"
    region = "bottomRight"
    width = 420
    go_label = "Hand to an agent"
    empty = "Nothing is ready."
    replaces = "a to-do app, filled from texts, mail, the backlog and agent runs"
    sources = ("imessage", "backlog", "people", "reminders", "agents")

    def walk(self, ctx: Context) -> dict:
        runs = (getattr(ctx, "runs", None) or osgraph_runs.by_task)()
        out = W.tasks(ctx.graph, runs, ctx.now())
        lanes = out["lanes"]
        # The list is what can be acted on now; the other lanes are counts and
        # their newest rows ride along under them.
        out["rows"] = lanes["ready"][:W.MOST_ROWS]
        out["moving"] = (lanes["stuck"] + lanes["cooking"] + lanes["done"])[:4]
        return out

    def extra_ids(self) -> list[str]:
        return ["lanes", "moving"]

    def extra_layout(self) -> list[str]:
        return [
            comp(self.cid("lanes"), "Stack", direction="grid", cols=4, gap=2),
            comp(self.cid("ready"), "Metric", label="Ready", value=Bind(self.p("n_ready"))),
            comp(self.cid("cooking"), "Metric", label="Cooking", value=Bind(self.p("n_cooking"))),
            comp(self.cid("stuck"), "Metric", label="Stuck", value=Bind(self.p("n_stuck")),
                 thresholds=[{"at": 1, "tone": "bad"}]),
            comp(self.cid("done"), "Metric", label="Done", value=Bind(self.p("n_done"))),
            f"> {self.cid('lanes')} {self.cid('ready')} {self.cid('cooking')} {self.cid('stuck')} {self.cid('done')}",
            comp(self.cid("moving"), "Events", caption="Moving", items=Bind(self.p("moving"))),
        ]

    def caption(self, data: dict) -> str:
        return "Ready: from texts, mail, promises and the backlog"

    def extra_model(self, data, values, ctx) -> dict:
        counts = (data or {}).get("counts") or {"ready": 0, "cooking": 0, "stuck": 0, "done": 0}
        now = ctx.now()
        moving = [{"time": short_when(r["when"], now),
                   "text": clip(f"{(r.get('run') or {}).get('status') or r['props'].get('status', '')} · {r['label']}"
                                + (f" · {r['run']['why']}" if r.get("run", {}).get("why") else ""), 90),
                   "accent": (r.get("run") or {}).get("status") == "stuck" or r["props"].get("status") == "stuck",
                   "id": r["id"]} for r in (data or {}).get("moving", [])]
        return {self.p("n_ready"): counts.get("ready", 0), self.p("n_cooking"): counts.get("cooking", 0),
                self.p("n_stuck"): counts.get("stuck", 0), self.p("n_done"): counts.get("done", 0),
                self.p("moving"): moving}


class People(WalkSurface):
    name = "people"
    title = "PEOPLE"
    region = "left"
    width = 380
    go_label = "Open person"
    empty = "No one this week."
    replaces = "Contacts, and scrolling Messages to see who you talk to"
    sources = ("imessage", "mail")

    def walk(self, ctx: Context) -> dict:
        out = W.people(ctx.graph, ctx.ids, most=60)
        out["rows"] = [{"id": p["id"], "type": "Person", "label": p["label"], "app": "Person", "when": "",
                        "tier": W.FYI, "why": "", "chips": [], "props": p, "confidence": 0.5 if p["unresolved"] else 1.0,
                        "unresolved": p["unresolved"], "messages": p["messages"]} for p in out["rows"]]
        return out

    def extra_ids(self) -> list[str]:
        return ["q", "bars"]

    def extra_layout(self) -> list[str]:
        return [
            comp(self.cid("q"), "Field", label="Search", placeholder="A name", value=Bind(self.p("q"))),
            comp(self.cid("bars"), "Bars", caption="Messages this week, ranked by your people score",
                 rows=Bind(self.p("bars"))),
        ]

    def initial(self) -> dict:
        return {**super().initial(), self.p("q"): ""}

    def visible(self, data: dict, values: dict) -> list[dict]:
        want = str(values.get(self.p("q")) or "").strip().lower()
        rows = [r for r in data["rows"] if not want or want in r["label"].lower()]
        return rows[:W.MOST_ROWS]

    def caption(self, data: dict) -> str:
        return f"{data.get('total', 0)} people in touch this week"

    def extra_model(self, data, values, ctx) -> dict:
        rows = self.visible(data, values) if data else []
        bars = [{"label": clip(r["label"] + (" (unconfirmed)" if r["unresolved"] else ""), 28),
                 "value": max(r["messages"], 0.1), "display": f"{r['messages']} msgs"} for r in rows]
        return {self.p("bars"): bars}

    def model(self, data, error, values, ctx) -> dict:
        out = super().model(data, error, values, ctx)
        # The bars carry the list; Events would say it twice.
        out[self.p("rows")] = []
        return out
