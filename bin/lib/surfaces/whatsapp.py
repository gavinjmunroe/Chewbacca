"""whatsapp: recent WhatsApp chats, who is waiting on Caleb, and one chat's last lines.

Replaces opening WhatsApp to see who wrote and to answer one person. A thin
surface over wacli (bin/lib/ingest_whatsapp.py does the reading, always with
`--read-only`): the list is the newest chats with their last line, unread
count and whether the chat waits on him; "Open" on a row shows that chat's
last lines underneath; a 1:1 chat opened that way can be answered.

SENDING FAILS CLOSED, the same bar as the Messages Thread Go
(docs/KYBER-SURFACES.md). A send needs all of these at the press:

- the target is the JID of the chat whose Open was pressed, held by the
  provider itself. It is never a label, never a list position, never a value
  the glass can type or pick, and never defaulted, so nothing goes to whoever
  happens to be on top, and a re-sort cannot move it to another row (a label
  made unique by position did exactly that: two people-store rows both
  labelled "Alex", A opened, B got a newer message, and the send went to B)
- the text is what was typed into the Field, line breaks kept as typed,
  every other control and format character out, at most MOST_REPLY_CHARS
- wacli, asked fresh, still has that exact JID as a one-to-one chat, not
  archived
- the people store, read from disk at the press (never the copy the daemon
  loaded at its last ingest), still maps the number to the same person id it
  mapped to when Open was pressed, which Open also read from disk. A number
  with no person is the empty id, so an unsaved number stays answerable, and
  a number that gains or loses a person between Open and Send is refused
- the send goes to `--to=<exact JID>`, never a name: wacli's --to also takes
  a contact or chat name and picks among matches, which is how a reply lands
  on the wrong person
- the text rides in `--message=<text>`, one argv element with no shell, so
  a typed "--to ..." is words, and `--message-escapes` is never passed

Then the chat is read back from wacli's store, and only a message that was
not there before the send counts: matched by the id the send answered with,
or, without one, a new id carrying the same text. When the send answered
with an id, ONLY that id counts: a new message with the same words under
another id is not proof. An older "ok" from yesterday never proves today's
"ok" landed. Any send that did not answer success (the runner's 124 kill, or
wacli's own {"success":false} such as "context deadline exceeded" at exit 1)
is unknown, not failed, because the message may have gone out before the
error: it is read back the same way, and if it is not found the panel says it
may have gone and the draft is cleared so a second press cannot double it.
Only a wacli that never ran (127) is "Didn't send". Nothing a message SAYS is
ever read for an action: other people's words are stripped of control and
format characters, clipped, and only rendered.
"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import ingest_whatsapp as WA
import osgraph

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, note_for

# Miller: no more than nine rows before paging; eight leaves the composer on
# screen at the right column's height (guessed, never measured on the glass).
MOST_ROWS = 8
# Lines of the opened chat. Guessed, never measured; the person panel keeps
# five timeline lines because eight pushed its reply box off screen.
THREAD_LINES = 5
MOST_REPLY_CHARS = 2000
# Read a sent message back this many times, a second apart. Guessed, never
# measured: wacli writes its own sends to the store, but how fast is unknown
# until the account is linked.
VERIFY_TRIES = 4
# How many of his own latest lines in the chat are read before and after a
# send to tell the new message from an old one. Guessed, never measured.
READBACK_LINES = 10
# wacli's own budget for one send, kept under run_cli's 20s kill
# (surfaces/__init__.py) so wacli gives up and says so before it is killed
# mid-send: lock wait 4s, the whole command 12s, 1s for retry receipts
# instead of the default 2s. All three guessed, never measured on a linked
# account; the unknown-outcome path below covers the case where they are
# wrong.
LOCK_WAIT = "4s"
SEND_TIMEOUT = "12s"
POST_SEND_WAIT = "1s"
# run_cli's code for a command it killed at its timeout.
KILLED = 124
# run_cli's code for a binary that is not there: nothing ran, nothing went.
NOT_RUN = 127
# Who a group line is from when wacli stored no SenderJID. Never the group's
# own JID: that made the group itself a Person (verifier, 2026-10-05).
UNKNOWN_SENDER = "Unknown sender"
WINDOW_DAYS = 7


def row_id(jid: str) -> str:
    return f"wa:{jid}"


def people(ctx: Context) -> osgraph.Identities:
    """The people store read from disk now. ctx.ids is the copy the daemon
    loaded at its last ingest, minutes old, so a contact edited since then
    would still pass an identity check against it. Same path rule as
    osgraph.Identities, but from ctx.env and ctx.home so a test can point it."""
    env = ctx.env or {}
    path = env.get("PEOPLE_DB") or (
        Path(env.get("PEOPLE_DIR") or Path(ctx.home) / ".chewbacca" / "people") / "people.db")
    return osgraph.Identities(path)


class WhatsApp(Provider):
    name = "whatsapp"
    title = "WHATSAPP"
    region = "left"
    width = 400
    refresh = 15.0
    replaces = "WhatsApp"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}open": self.open, f"{ACTION_PREFIX}send": self.send}
        # The chat whose lines show underneath, by JID, and the people-store
        # person its number was when Open was pressed. Set only by open();
        # send() goes to self.opened and nowhere else.
        self.opened = ""
        self.opened_person = ""

    # ── reading ──────────────────────────────────────────────────────────

    def fetch(self, ctx: Context) -> dict:
        try:
            linked = WA.linked(ctx)
            chats = WA.chats(ctx)
            if not chats and not linked:
                raise SurfaceError(WA.NOT_LINKED)
            recent = WA.by_chat(WA.messages(ctx, after=ctx.now() - timedelta(days=WINDOW_DAYS)))
        except WA.WacliError as err:
            raise SurfaceError(str(err)) from None
        # Read fresh, so the person a row shows is the one Open and Send
        # will check against, not the ingest-time copy.
        ids = people(ctx)
        rows = []
        for chat in chats:
            jid = chat["jid"]
            dm, group = WA.is_dm(chat), chat.get("kind") == "group"
            # Archived is Caleb filing a chat away in WhatsApp (wacli says
            # archived:true, seen on the scratch store 2026-10-05); it is not
            # waiting on him and its unread count is not news.
            if not (dm or group) or chat.get("archived"):
                continue
            msgs = recent.get(jid, [])
            person = WA.person_for(ids, jid) if dm else None
            known = group or (person is not None and not person.unresolved)
            newest = msgs[0] if msgs else None
            rows.append({
                "id": row_id(jid), "jid": jid, "dm": dm, "group": group,
                "label": WA.clean(WA.chat_label(ids, chat), WA.GROUP_LABEL_MAX),
                "person": person.id if person else "",
                "last": WA.words_of(newest) if newest else "",
                "last_from_me": bool(newest and newest.get("FromMe")),
                "at": WA.when(newest.get("Timestamp")) if newest else WA.when(chat.get("last_message_ts")),
                "unread": int(chat.get("unread_count") or 0),
                "waiting": bool(msgs) and WA.waiting(msgs, chat, known),
            })
        rows.sort(key=lambda r: (not r["waiting"], -(r["at"].timestamp() if r["at"] else 0)))
        rows = rows[:MOST_ROWS]
        out = {"rows": rows, "linked": linked, "thread": [], "opened": "", "threadError": ""}
        opened = next((r for r in rows if r["jid"] == self.opened), None)
        if opened is not None:
            out["opened"] = opened["jid"]
            # Only the thread pane fails when its read does: the list above
            # it is already in hand and stays on the glass.
            try:
                lines = WA.messages(ctx, chat=opened["jid"], limit=THREAD_LINES * 2)
                out["thread"] = self.thread(ids, [m for m in lines if WA.countable(m)][:THREAD_LINES])
            except WA.WacliError as err:
                out["threadError"] = clip(str(err), 120)
        return out

    def thread(self, ids, lines: list[dict]) -> list[dict]:
        out = []
        for m in lines:
            sender = str(m.get("SenderJID") or "")
            if m.get("FromMe"):
                who = "You"
            elif sender:
                who = WA.person_for(ids, sender).label
            elif WA.DM_JID.match(str(m.get("ChatJID") or "")):
                who = WA.person_for(ids, m["ChatJID"]).label
            else:
                who = UNKNOWN_SENDER
            out.append({"id": f"wa-msg:{WA.clean(m.get('MsgID'), 64)}", "from_me": bool(m.get("FromMe")),
                        "who": WA.clean(who, 24), "text": WA.clean(WA.words_of(m), 120),
                        "at": WA.when(m.get("Timestamp"))})
        return out

    # ── drawing ──────────────────────────────────────────────────────────

    def layout(self) -> list[str]:
        ids = ["s", "list", "thread", "to", "draft", "send", "status"]
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("list"), "Events", caption=Bind(self.p("caption")), items=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}open", actionLabel="Open"),
            comp(self.cid("thread"), "Events", caption=Bind(self.p("threadCaption")), items=Bind(self.p("thread"))),
            comp(self.cid("to"), "Text", value=Bind(self.p("to"))),
            comp(self.cid("draft"), "Field", label="Message", placeholder="Typed here, sent only by Send",
                 value=Bind(self.p("draft"))),
            comp(self.cid("send"), "Button", label=Bind(self.p("go")), action=f"{ACTION_PREFIX}send",
                 variant="primary"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("draft"): "", self.p("status"): ""}

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("caption"): note_for(None, error, ""), self.p("rows"): [],
                    self.p("threadCaption"): "", self.p("thread"): [], self.p("to"): "",
                    self.p("go"): "Send"}
        now = ctx.now()
        rows = data["rows"]
        items = [{"id": r["id"], "time": ago(r["at"], now), "accent": r["waiting"],
                  "text": clip(f"{r['label']}: " + ("You: " if r["last_from_me"] else "") + (r["last"] or "no recent lines"),
                               90)}
                 for r in rows]
        opened = next((r for r in rows if r["jid"] == data.get("opened")), None)
        thread = [{"id": t["id"], "time": ago(t["at"], now), "accent": not t["from_me"],
                   "text": clip(f"{t['who']}: {t['text']}", 120)} for t in reversed(data.get("thread") or [])]
        chosen = self.chosen(data)
        linked = bool(data.get("linked"))
        if opened is None:
            thread_caption = "Open a chat to see its last lines." if rows else ""
        elif data.get("threadError"):
            thread_caption = f"{opened['label']}: couldn't read its lines. {data['threadError']}"
        else:
            thread_caption = f"{opened['label']}, last {len(thread)}"
        if chosen is None:
            to = ("Group replies aren't sent from here." if opened is not None
                  else "Open a one-to-one chat to reply to it." if rows else "")
        else:
            to = f"Reply to {chosen['label']}"
        if not linked:
            go = "Not linked, can't send"
        else:
            go = f"Send to {chosen['label']}" if chosen else "Send"
        return {
            self.p("caption"): self.caption(data, error, rows),
            self.p("rows"): items,
            self.p("threadCaption"): thread_caption,
            self.p("thread"): thread,
            self.p("to"): to,
            self.p("go"): go,
        }

    def caption(self, data: dict, error: str | None, rows: list) -> str:
        said = note_for(data, error, "", data.get("_at"))
        if said:
            return said
        parts = []
        waiting = sum(1 for r in rows if r["waiting"])
        unread = sum(r["unread"] for r in rows)
        if not rows:
            parts.append("No WhatsApp chats in the store yet.")
        if waiting:
            parts.append(f"{waiting} waiting on you")
        if unread:
            parts.append(f"{unread} unread")
        if not data.get("linked"):
            parts.append("Not linked: these are the stored chats, and nothing can be sent")
        return " · ".join(parts) or "Nobody's waiting on you here."

    def chosen(self, data) -> dict | None:
        """The 1:1 row whose Open was pressed, found by its JID, or None.
        Never a default, never a label, never a value from the glass."""
        if not self.opened:
            return None
        matches = [r for r in (data or {}).get("rows") or [] if r["dm"] and r["jid"] == self.opened]
        return matches[0] if len(matches) == 1 else None

    # ── actions ──────────────────────────────────────────────────────────

    def open(self, ctx: Context, data, values: dict) -> Result:
        """A row's Open: show that chat's last lines, and make a 1:1 chat the
        one Send goes to, by its JID."""
        node = str(values.get("row") or "")
        r = next((x for x in (data or {}).get("rows") or [] if x["id"] == node), None)
        if r is None:
            return Result(False, "That chat isn't on the list any more.")
        person = ""
        if r["dm"]:
            # The person this number is right now, from disk. If the list
            # was drawn against an older store, it named someone else.
            person = WA.person_for(people(ctx), r["jid"]).id
            if person != r["person"]:
                self.opened, self.opened_person = "", ""
                return Result(False, "That number's contact changed since the list was drawn. "
                                     "Open it again once the list refreshes.", refetch=True)
        self.opened = r["jid"]
        self.opened_person = person
        line = f"Opened {r['label']}." if r["dm"] else f"Opened {r['label']}. Group replies aren't sent from here."
        return Result(True, line, refetch=True)

    def send(self, ctx: Context, data, values: dict) -> Result:
        r = self.chosen(data)
        if r is None:
            return Result(False, "Open the chat to reply to first. Nothing was sent.")
        text = WA.clean_typed(values.get(self.p("draft")))
        if not text:
            return Result(False, "Type the message first.")
        if len(text) > MOST_REPLY_CHARS:
            return Result(False, f"That's over {MOST_REPLY_CHARS} characters. Nothing was sent.")
        jid = r["jid"]
        # Everything below is read fresh: the list on the glass may be a
        # minute old, and the chat or the contact may have changed under it.
        before: set = set()
        try:
            if not WA.linked(ctx):
                return Result(False, WA.NOT_LINKED)
            fresh = next((c for c in WA.chats(ctx) if c["jid"] == jid), None)
            if fresh is not None and WA.is_dm(fresh) and not fresh.get("archived"):
                # What is already there, so the read-back can only count a
                # message this press made.
                before = {m.get("MsgID") for m in WA.messages(ctx, chat=jid, limit=READBACK_LINES, from_me=True)}
        except WA.WacliError as err:
            return Result(False, f"{err}. Nothing was sent.")
        if fresh is None:
            return Result(False, "That chat isn't in WhatsApp any more. Nothing was sent.")
        if not WA.is_dm(fresh):
            return Result(False, "That isn't a one-to-one chat. Nothing was sent.")
        if fresh.get("archived"):
            return Result(False, "That chat is archived in WhatsApp. Nothing was sent.")
        person = WA.person_for(people(ctx), jid).id
        if person != self.opened_person or person != r["person"]:
            return Result(False, "That number isn't the same contact any more. Nothing was sent.")
        code, out, err = ctx.run([WA.wacli_bin(ctx.env), "--json", f"--lock-wait={LOCK_WAIT}",
                                  f"--timeout={SEND_TIMEOUT}", "send", "text", f"--to={jid}",
                                  f"--message={text}", "--no-preview", f"--post-send-wait={POST_SEND_WAIT}"])
        draft = {self.p("draft"): ""}
        sent_id, failure = "", ""
        try:
            sent_id = WA.sent_id(WA.envelope(code, out, err, "WhatsApp send"))
        except WA.WacliError as error:
            if code == NOT_RUN:
                return Result(False, f"Didn't send: {clip(str(error), 90)}")
            # Anything else that isn't success is unknown: wacli's own
            # deadline answers {"success":false,"error":"context deadline
            # exceeded"} at exit 1, after the message may already be out.
            failure = str(error)
        if self.landed(ctx, jid, text, sent_id, before):
            return Result(True, f"Sent to {r['label']}. It's in the chat.", updates=draft, refetch=True)
        if failure:
            # The draft is cleared so a second press can't send it twice.
            said = ("WhatsApp took too long to answer" if code == KILLED
                    else f"WhatsApp answered with an error ({clip(failure, 70)})")
            return Result(False, f"{said}, so it may have gone to {r['label']}. "
                                 "Check the chat before sending it again.", updates=draft, refetch=True)
        return Result(False, f"Sent to {r['label']}, but it isn't in the chat yet. Check WhatsApp.",
                      updates=draft, refetch=True)

    def landed(self, ctx: Context, jid: str, text: str, sent_id: str, before: set) -> bool:
        """Is the message this press sent in the store now? Only a message
        that was not there before the send counts. With an id from the send,
        that id has to be there and nothing else counts, not even a new
        message with the same words; without one, a new id with the same text."""
        want = " ".join(text.split())
        for attempt in range(VERIFY_TRIES):
            if attempt:
                ctx.sleep(1.0)
            try:
                mine = WA.messages(ctx, chat=jid, limit=READBACK_LINES, from_me=True)
            except WA.WacliError:
                mine = []
            for m in mine:
                if not m.get("FromMe") or m.get("MsgID") in before:
                    continue
                if sent_id:
                    if m.get("MsgID") == sent_id:
                        return True
                elif " ".join(str(m.get("Text") or "").split()) == want:
                    return True
        return False
