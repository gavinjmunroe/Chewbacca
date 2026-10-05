"""notes: the newest Apple Notes, one previewed, and a line added to it.

Replaces opening Notes to glance at what was jotted last or to add one more
line to it. Reads and the one write all go through `mac notes`, the same CLI
the rest of the kit uses, with --json everywhere.

APPEND ONLY, AND ONLY WHERE APPENDING IS LOSSLESS. `mac notes append` is not a
true append: its AppleScript is `set body of n to (body of n) & "<div>..."`,
which rewrites the whole note from the HTML Notes hands out. That HTML carries
images as data: URIs and tables as <object><table>, and rewriting a note
through it is not known to give those back intact. So before a press appends,
the note's HTML is read fresh and every tag and attribute in it must be on an
allowlist of plain text formatting; anything else (an image, a table, an
attachment, a link, a bulleted list that might be a checklist, a tag or
attribute never seen) refuses and changes nothing. Notes leaves some
attachments out of that HTML entirely (a real note with one Media attachment
came back as only div, h1 and br on 2026-10-05), so the note's attachment count
is also read, through osascript, and anything above 0 refuses too. The id must look like a
Notes id, the line is one line with no control characters, and it goes after
`--` so a line starting with a dash is text, not a flag. Afterward the note is
read back: the old text must still lead it and the new line must end it, or
the press says so. A press while another press on the same note is still
running refuses, so two quick presses cannot both pass the duplicate check.

WHICH NOTE. A press writes to the note id pinned when the person picked it, not
to whatever row carries that label now. Two notes can share a title and folder,
and a refresh reorders the list when one is edited, so a label alone can come to
name the other note between the pick and the press. If the pinned note is gone
or its label changed, the press refuses and asks for a new pick.

WHAT IS LEFT OPEN. The allowlist check and the append are two AppleEvents, so an
image pasted into the same note in the second between them would go through the
rewrite. The check is the last read before the append, the press refuses if the
note's modified time moved between its two reads, and after the append the HTML
is read again: anything not on the allowlist there is reported, never silent.
Closing it fully needs the check inside `mac notes append` itself.

Nothing here deletes, edits or overwrites (`mac notes edit` and `delete` are
never called), and a note's text is only ever rendered. Titles, folders and
bodies can come from shared notes other people write, so control and format
characters (bidi overrides, zero-width marks) are stripped before they reach
the glass, and none of it is read for instructions.
"""
from __future__ import annotations

import inspect
import json
import re
import threading
import unicodedata

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, cli_error, clip, comp, linkify, \
    note_for, parse_time, run_cli

MOST_NOTES = 6
# A cold `mac notes list` took 16.0 s on 2026-10-05 (a warm one 8.4 s), and a
# full first fetch of seven calls took 47.4 s, so the kit's default 20 s cut a
# cold list close and could cut a slow read. Roughly three times what was seen.
LIST_TIMEOUT = 45.0
# One `mac notes read` measured 2.6 s and 3.3 s warm on 2026-10-05; the 47.4 s
# cold fetch averages 6.8 s a call. A read that runs out fails its own row only.
READ_TIMEOUT = 25.0
# The append's AppleEvent rewrites the whole note; never measured, so it gets
# the read's bound. A timeout here is read back, never assumed lost.
APPEND_TIMEOUT = 25.0
# Counting a note's attachments through JXA took 0.26 to 0.90 s on 2026-10-05.
ATTACH_TIMEOUT = 15.0
REFRESH_S = 90.0
# Lines of the picked note shown on the glass. Guessed, never measured.
PREVIEW_LINES = 12
PREVIEW_WIDTH = 96
# One appended line. Guessed, never measured: long enough for a thought,
# short enough that a paste of a whole document is refused, not appended.
MAX_LINE = 500
# A note whose HTML is bigger than this is not rewritten from the glass. The
# largest of 15 recent notes on 2026-10-05 was 6.2 MB of HTML (one inline
# image); every text-only one was under 16 KB. The bound is guessed.
MAX_HTML = 300_000

# Every id `mac notes list` printed on 2026-10-05 had this shape.
NOTE_ID = re.compile(r"x-coredata://[0-9A-Fa-f-]{36}/ICNote/p\d{1,12}")

# Tags seen in 15 recent notes on 2026-10-05, minus the ones that carry
# something other than text (img, object, table and its parts), plus the
# plain formatting Notes' own toolbar makes. An allowlist, never a denylist.
SAFE_TAGS = {"div", "br", "b", "i", "u", "strike", "s", "tt", "h1", "h2", "h3", "span", "font", "ul", "ol", "li"}
# A checklist and a bulleted list both come out of Notes' AppleScript as a bare
# <ul>; 135 bare <ul>/<ol> in 40 recent notes on 2026-10-05, and nothing in the
# HTML says which one is a checklist. A rewrite through that HTML could drop
# the check marks, so a bare <ul> refuses. Only the dash list (it carries its
# own class, 97 seen) and a numbered <ol> pass.
NEEDS_CLASS = {"ul"}
SAFE_ATTRS = {"style", "class", "face", "color", "size", "dir"}
# The one class seen: Notes' dash list.
SAFE_CLASSES = {"Apple-dash-list"}
TAG = re.compile(r"<\s*(/?)\s*([A-Za-z][A-Za-z0-9]*)([^>]*)>")
# Every attribute, with or without a value: `<div hidden>` names one too.
ATTR = re.compile(r"""([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?""")
# Reads Notes and nothing else: the count of the note's attachments, by id.
COUNT_ATTACHMENTS = ('function run(argv){var n=Application("Notes").notes.byId(argv[0]);'
                     'return JSON.stringify({attachments:n.attachments.length})}')
WHAT = {"img": "an image", "object": "a table or attachment", "table": "a table", "a": "a link",
        "iframe": "an embed", "video": "a video", "audio": "audio"}


def plain(text) -> str:
    """Untrusted text made safe to draw: control and format characters gone
    (newlines become spaces, bidi overrides and zero-width marks vanish)."""
    out = []
    for ch in str(text or ""):
        cat = unicodedata.category(ch)
        if ch in "\n\r\t":
            out.append(" ")
        elif cat not in ("Cc", "Cf", "Cs", "Co"):
            out.append(ch)
    return " ".join("".join(out).split())


def preview(body: str) -> list[str]:
    """The first lines of a note's plaintext, each one clause on one line."""
    lines = []
    for raw in str(body or "").splitlines():
        line = plain(raw)
        if line:
            lines.append(clip(linkify(line), PREVIEW_WIDTH))
        if len(lines) >= PREVIEW_LINES:
            break
    return lines


def appendable(html: str, attached: int = 0) -> str:
    """"" when every tag and attribute in the note is plain text formatting
    and it has no attachments, else the reason, in words, that appending to it
    is refused. `attached` comes from Notes, not the HTML, because Notes leaves
    some attachments out of the HTML."""
    if attached > 0:
        return "it has an attachment" if attached == 1 else f"it has {attached} attachments"
    if not html or not html.strip():
        return "it came back empty (locked, or unreadable)"
    if len(html) > MAX_HTML:
        return "it's too big to rewrite safely"
    for closing, name, attrs in TAG.findall(html):
        tag = name.lower()
        if tag not in SAFE_TAGS:
            return f"it has {WHAT.get(tag, f'a <{tag}> block')}"
        found = {}
        for match in ATTR.finditer(attrs):
            key, raw = match.group(1).lower(), match.group(2)
            if key not in SAFE_ATTRS:
                return f"it has a {key}= the glass doesn't rewrite"
            if raw is None:
                return f"it has a bare {key} the glass doesn't rewrite"
            found[key] = raw.strip("\"'")
        # Whatever the attribute reader skipped, a stray quote or `=`, refuses;
        # only a self-closing slash is left over in HTML Notes writes.
        if ATTR.sub("", attrs).replace("/", "").strip():
            return "it has markup the glass doesn't read"
        classes = set(found.get("class", "").split())
        if classes - SAFE_CLASSES:
            return "it has formatting the glass doesn't rewrite"
        if tag in NEEDS_CLASS and not closing and not classes:
            return "it has a bulleted list, which may be a checklist"
    return ""


def lines_of(text: str) -> list[str]:
    """A note's plaintext as whole, cleaned, non-empty lines. The duplicate and
    landed checks compare these, never string suffixes: "milk" is not the last
    line of a note that ends "buy milk"."""
    return [line for line in (plain(raw) for raw in str(text or "").splitlines()) if line]


def call(ctx: Context, argv: list, timeout: float) -> tuple[int, str, str]:
    """ctx.run with a timeout, for a runner that takes one."""
    runner = ctx.run
    if runner is run_cli:
        return run_cli(argv, timeout=timeout)
    try:
        takes = "timeout" in inspect.signature(runner).parameters
    except (TypeError, ValueError):
        takes = False
    return runner(argv, timeout=timeout) if takes else runner(argv)


def call_json(ctx: Context, argv: list, timeout: float):
    code, out, err = call(ctx, argv, timeout)
    if code != 0:
        raise SurfaceError(cli_error("Notes", err or out))
    try:
        return json.loads(out or "null")
    except json.JSONDecodeError:
        raise SurfaceError("Notes answered with something that is not JSON") from None


class Notes(Provider):
    name = "notes"
    title = "NOTES"
    region = "topLeft"
    width = 400
    refresh = REFRESH_S
    replaces = "Apple Notes"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}append": self.append}
        # id -> (modified, preview lines). Only ever touched by fetch, which
        # the daemon runs one at a time per surface.
        self._bodies: dict[str, tuple[str, list[str]]] = {}
        # (label, id) of the note the person picked, fixed when the pick
        # arrives against the rows they were looking at. A press writes only
        # here, so a refresh that hands the label to another note cannot move
        # the write. model() runs under the daemon's lock; append reads it once.
        self._pin: tuple[str, str] = ("", "")
        # Note ids with a press running. Each press runs on its own worker
        # thread, so without this two quick presses both read the note before
        # either appends, both pass the duplicate check, and the line lands twice.
        self._pressing: set[str] = set()
        self._pressing_lock = threading.Lock()

    # ── reading ──────────────────────────────────────────────────────────

    def read(self, ctx: Context, note_id: str, html: bool = False) -> dict:
        argv = ["mac", "notes", "read", "--json"] + (["--html"] if html else []) + ["--", note_id]
        body = call_json(ctx, argv, READ_TIMEOUT)
        if not isinstance(body, dict):
            raise SurfaceError("Notes answered with something that is not a note")
        return body

    def attachments(self, ctx: Context, note_id: str) -> int:
        """How many attachments Notes says the note has. Raises when it can't
        say, so an unknown count refuses rather than passing as 0."""
        body = call_json(ctx, ["osascript", "-l", "JavaScript", "-e", COUNT_ATTACHMENTS, note_id], ATTACH_TIMEOUT)
        count = body.get("attachments") if isinstance(body, dict) else None
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise SurfaceError("Notes didn't say how many attachments the note has")
        return count

    def fetch(self, ctx: Context) -> dict:
        listed = call_json(ctx, ["mac", "notes", "list", "--limit", str(MOST_NOTES), "--json"], LIST_TIMEOUT)
        if not isinstance(listed, list):
            raise SurfaceError("Notes answered with something that is not a list")
        rows = []
        for item in listed[:MOST_NOTES]:
            if not isinstance(item, dict):
                continue
            note_id = str(item.get("id") or "")
            if not NOTE_ID.fullmatch(note_id):
                continue
            modified = str(item.get("modified") or "")
            cached = self._bodies.get(note_id)
            if cached and cached[0] == modified:
                lines = cached[1]
            else:
                try:
                    lines = preview(self.read(ctx, note_id).get("body"))
                except SurfaceError as err:
                    lines = [f"Couldn't read this note: {err}"]
                    modified = ""  # try again next fetch
                self._bodies[note_id] = (modified, lines)
            rows.append({"id": note_id, "title": plain(item.get("title")) or "Untitled",
                         "folder": plain(item.get("folder")) or "Notes", "modified": str(item.get("modified") or ""),
                         "lines": lines})
        keep = {r["id"] for r in rows}
        self._bodies = {k: v for k, v in self._bodies.items() if k in keep}
        for r in rows:
            r["label"] = f"{clip(r['title'], 40)} · {clip(r['folder'], 16)}"
        # Two notes with the same title and folder both get their Notes number,
        # which belongs to the note and not to its place in the list, so the
        # label stays the same note's however the list reorders.
        for r in rows:
            if sum(x["label"] == r["label"] for x in rows) > 1:
                r["dup"] = True
        for r in rows:
            if r.pop("dup", False):
                r["label"] += f" #{r['id'].rsplit('/p', 1)[-1]}"
        return {"rows": rows}

    # ── drawing ──────────────────────────────────────────────────────────

    def layout(self) -> list[str]:
        ids = ["s", "note", "table", "pick", "head", "meta", "body", "draft", "append", "status"]
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("table"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("rows"))),
            comp(self.cid("pick"), "Select", label="Note", options=Bind(self.p("names")), value=Bind(self.p("pick"))),
            comp(self.cid("head"), "Heading", text=Bind(self.p("head")), level=3),
            comp(self.cid("meta"), "Text", value=Bind(self.p("meta")), tone="muted"),
            comp(self.cid("body"), "List", items=Bind(self.p("body"))),
            comp(self.cid("draft"), "Field", label="Add a line", placeholder="Appended only by the button",
                 value=Bind(self.p("draft"))),
            comp(self.cid("append"), "Button", label="Append to this note", action=f"{ACTION_PREFIX}append",
                 variant="primary"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("pick"): "", self.p("draft"): "", self.p("status"): "",
                self.p("columns"): [{"field": "title", "label": "Note"}, {"field": "folder", "label": "Folder"},
                                    {"field": "age", "label": "Edited"}]}

    @staticmethod
    def by_label(data, label) -> dict | None:
        rows = (data or {}).get("rows") or []
        matches = [r for r in rows if r["label"] == label]
        return matches[0] if len(matches) == 1 else None

    def chosen(self, data, values: dict, pin: tuple[str, str] | None = None) -> dict | None:
        """For a press: exactly the note pinned at the pick, never a default,
        and only while it is still listed under the label that was picked."""
        label, note_id = pin or self._pin
        if not label or values.get(self.p("pick")) != label:
            return None
        rows = (data or {}).get("rows") or []
        matches = [r for r in rows if r["id"] == note_id]
        if len(matches) != 1 or matches[0]["label"] != label:
            return None
        return matches[0]

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("rows"): [], self.p("names"): [],
                    self.p("head"): "", self.p("meta"): "", self.p("body"): []}
        now = ctx.now()
        rows = data["rows"]
        label = values.get(self.p("pick")) or ""
        if label and label != self._pin[0]:
            # A new pick: resolve it against the rows on the glass right now,
            # which are the rows the person picked from.
            row = self.by_label(data, label)
            self._pin = (label, row["id"]) if row else (label, "")
        shown = self.chosen(data, values)
        # Only an empty pick defaults to the newest. A default that later
        # leaves the list is not swapped for the new newest behind the
        # person's back, since a press racing that swap would land elsewhere.
        if shown is None and not label and rows:
            shown = rows[0]
            self._pin = (shown["label"], shown["id"])
        out = {
            self.p("note"): note_for(data, error, "" if rows else "No notes yet.", data.get("_at")),
            self.p("rows"): [{"id": r["id"], "title": clip(r["title"], 30), "folder": clip(r["folder"], 14),
                              "age": ago(parse_time(r["modified"]), now)} for r in rows],
            self.p("names"): [r["label"] for r in rows],
            self.p("head"): shown["title"] if shown else "",
            self.p("meta"): f"{shown['folder']} · edited {ago(parse_time(shown['modified']), now)}" if shown else "",
            self.p("body"): [{"id": f"l{i}", "text": t} for i, t in enumerate(shown["lines"])] if shown else [],
        }
        if shown is None and rows:
            out[self.p("body")] = [{"id": "l0", "text": "That note left the list. Pick another."}]
        if shown and not shown["lines"]:
            out[self.p("body")] = [{"id": "l0", "text": "Empty, or locked."}]
        if not label and shown:
            out[self.p("pick")] = shown["label"]
        return out

    # ── the one write ────────────────────────────────────────────────────

    def append(self, ctx: Context, data, values: dict) -> Result:
        row = self.chosen(data, values, self._pin)
        if row is None:
            return Result(False, "That note isn't on the list any more, or the list changed. Pick it again.")
        note_id = row["id"]
        if not NOTE_ID.fullmatch(note_id):
            return Result(False, "That doesn't look like a Notes id, so nothing was added.")
        with self._pressing_lock:
            if note_id in self._pressing:
                return Result(False, "Still adding the last line to this note. Wait for it, then check.")
            self._pressing.add(note_id)
        try:
            return self._append(ctx, row, values)
        finally:
            with self._pressing_lock:
                self._pressing.discard(note_id)

    def _append(self, ctx: Context, row: dict, values: dict) -> Result:
        note_id = row["id"]
        typed = str(values.get(self.p("draft")) or "")
        line = plain(typed)
        if not line:
            return Result(False, "Type a line first.")
        if len(line) > MAX_LINE:
            return Result(False, f"That's {len(line)} characters; one line here is at most {MAX_LINE}.")
        try:
            attached = self.attachments(ctx, note_id)
            plain_read = self.read(ctx, note_id)
            # The allowlist check is the last read before the append, so the
            # gap an edit in Notes could slip into is one AppleEvent wide.
            html_read = self.read(ctx, note_id, html=True)
        except SurfaceError as err:
            return Result(False, f"Not added: {err}")
        before = lines_of(plain_read.get("body"))
        if str(plain_read.get("modified") or "") != str(html_read.get("modified") or ""):
            return Result(False, "Not added: the note changed while it was being checked. Press again.")
        why = appendable(str(html_read.get("body") or ""), attached)
        if why:
            return Result(False, f"Not added: {why}. That note is read-only from here.")
        if before and before[-1] == line:
            # Also what stops a second press from doubling a line whose first
            # press timed out but landed anyway.
            return Result(False, "Not added: the note already ends with that line.")
        code, out, err = call(ctx, ["mac", "notes", "append", "--json", "--", note_id, line], APPEND_TIMEOUT)
        cleared = {self.p("draft"): ""}
        try:
            after = lines_of(self.read(ctx, note_id).get("body"))
        except SurfaceError as read_err:
            if code != 0:
                return Result(False, f"{cli_error('Notes', err or out)}, and reading the note back failed too "
                                     f"({read_err}). Check the note before pressing again.", refetch=True)
            return Result(False, f"Appended, but reading it back failed ({read_err}). Check the note.",
                          updates=cleared, refetch=True)
        landed = bool(after) and after[-1] == line
        if code != 0 and not landed:
            if code == 124:
                return Result(False, "Notes didn't answer in time and the line isn't there yet. It may still "
                                     "land, so check the note before pressing again.", refetch=True)
            return Result(False, cli_error("Not added. Notes", err or out), refetch=after != before)
        if not landed:
            return Result(False, "Appended, but the line isn't at the end on read-back. Check the note.",
                          updates=cleared, refetch=True)
        # From here the line is in the note, whether `mac` exited 0 or was
        # killed at its timeout while Notes finished the AppleEvent. Both get
        # the same checks; a late landing is never called clean unchecked.
        if after[:-1] != before:
            return Result(False, "Appended, but the note's earlier text changed too. Check the note.",
                          updates=cleared, refetch=True)
        try:
            why = appendable(str(self.read(ctx, note_id, html=True).get("body") or ""),
                             self.attachments(ctx, note_id))
        except SurfaceError as read_err:
            why = f"its formatting couldn't be read back ({read_err})"
        if why:
            # Something not on the allowlist appeared during the press: it was
            # added in Notes between the check and the append, and went through
            # the rewrite. Say so; never call that a clean append.
            return Result(False, f"Appended, but {why} now, added while this ran. Check the note.",
                          updates=cleared, refetch=True)
        if code != 0:
            # A timeout kills `mac`, not the AppleEvent it sent, so Notes can
            # still finish the append. Never say "not added" without looking.
            return Result(True, f"Notes reported an error, but the line is in {clip(row['title'], 40)} "
                                "on read-back.", updates=cleared, refetch=True)
        return Result(True, f"Added to {clip(row['title'], 40)}, read back.", updates=cleared, refetch=True)
