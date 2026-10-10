"""dash-notes: find one Apple Note by title, read its dash lines, add one.

The `notes` surface (bin/lib/surfaces/notes.py) shows the six newest notes and
appends a plain paragraph. Caleb's notes are dash lists (memory
feedback_apple_notes_dash_lists): `<ul class="Apple-dash-list">`, one `<li>`
per clause. So this surface finds any note by title, shows it as the dash lines
he wrote, and adds a line as a dash item, plus a new note by name. Voice:
"add milk to my groceries note", "new note Trip ideas", "open my brain rot
note", "close the note". NO-APPS.md section 8, team board CHW-195.

NEVER REWRITE A NOTE. Notes has no append verb: every write is `body = body &
more`, which hands the note's own HTML back to it. On 2026-10-08 a `set body`
erased a 4.6 MB screenshot from a real note, so a write here is refused unless
losing nothing is certain:

- the HTML is read fresh and every tag and attribute must be on the `notes`
  surface's allowlist (plain text formatting and the dash list; no image,
  table, attachment, link, or bare `<ul>` that may be a checklist);
- the note's attachment count must be 0, read from Notes, because Notes leaves
  some attachments out of the HTML;
- inside the one AppleEvent that writes, the script checks again that the
  modification time and body length are the ones just checked, that there are
  still no attachments, and that no media tag appeared, then concatenates. The
  text is HTML escaped and passed as an argument, never spliced into a script.

Afterward the note is read back: the earlier lines must be unchanged and the
new line must be the last one, and the HTML must still pass the allowlist.
Nothing here edits, deletes or replaces a body built from parsed text.

Titles and bodies can come from shared notes other people write. They are only
rendered, cleaned of control and format characters, never read for
instructions (.claude/rules/untrusted-content.md).
"""
from __future__ import annotations

import html as htmllib
import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field

from surfaces import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, cli_error, clip, comp, \
    note_for
from surfaces.notes import MAX_HTML, MAX_LINE, NOTE_ID, appendable, call, lines_of, plain

KIND = "dash-notes"
# A bulk title search (`whose name contains`) took 2.3 s cold and 0.9 s warm
# over 910 notes on 2026-10-09; the first call after Notes launched took 20.6 s
# with the machine at load 45. Half again over the worst seen.
FIND_TIMEOUT = 30.0
# One note read through JXA, guessed from the `notes` surface's 2.6 to 3.3 s
# per `mac notes read`, which is two AppleEvents slower than this one.
READ_TIMEOUT = 25.0
# The write is one AppleEvent; measured in the live check (see the commit).
APPEND_TIMEOUT = 25.0
# `mac notes add`, never measured before this file; the read's bound.
CREATE_TIMEOUT = 25.0
# Rows a search shows. Rule 3 of kyber-surfaces: nine at most.
MOST_ROWS = 8
# Lines of the open note on the glass. Guessed, never measured.
SHOWN_LINES = 30
LINE_WIDTH = 96
# Notes quits itself when it has no window (macOS automatic termination); an
# AppleEvent arriving while it does fails with -600. Seen twice in a row on
# 2026-10-09. One retry relaunches it.
NOT_RUNNING = "-600"

# Finds notes by title, newest first, skipping Recently Deleted (a deleted
# note still matches `whose`, and on it `container.name()` threw where
# `container().name()` worked, both seen 2026-10-09). argv: query
# (may be empty for "the newest"), limit.
FIND = r"""function run(argv){var app=Application("Notes");var q=argv[0],lim=parseInt(argv[1],10);
var set=q?app.notes.whose({name:{_contains:q}}):app.notes;var ids=set.id(),names=set.name(),mods=set.modificationDate();
var idx=[];for(var i=0;i<ids.length;i++)idx.push(i);idx.sort(function(a,b){return mods[b]-mods[a];});
var gone={};try{app.folders.whose({name:"Recently Deleted"}).notes.id().forEach(function(l){l.forEach(function(d){gone[d]=1;});});}catch(e){}
var out=[];for(var k=0;k<idx.length&&out.length<lim;k++){var i=idx[k],f="";if(gone[ids[i]])continue;
try{f=app.notes.byId(ids[i]).container().name();}catch(e){}
if(f==="Recently Deleted")continue;out.push({id:ids[i],title:names[i],folder:f,modified:mods[i].getTime()});}
return JSON.stringify(out);}"""
# One note in one AppleEvent round: argv: id, the largest body worth sending.
READ = r"""function run(argv){var n=Application("Notes").notes.byId(argv[0]);var b=n.body(),f="";
try{f=n.container().name();}catch(e){}
return JSON.stringify({id:n.id(),title:n.name(),folder:f,modified:n.modificationDate().getTime(),
attachments:n.attachments.length,size:b.length,html:b.length<=parseInt(argv[1],10)?b:"",plain:n.plaintext()});}"""
# The one write. argv: id, the escaped fragment, the modified time and body
# length the allowlist check saw. Refuses on any drift; else concatenates.
APPEND = r"""function run(argv){var n=Application("Notes").notes.byId(argv[0]);
if(n.attachments.length>0)return JSON.stringify({refused:"it has an attachment now"});
if(String(n.modificationDate().getTime())!==argv[2])return JSON.stringify({refused:"the note changed since it was checked"});
var b=n.body();if(String(b.length)!==argv[3])return JSON.stringify({refused:"the note changed since it was checked"});
if(/<\s*(img|object|table|iframe|video|audio|a)\b/i.test(b))return JSON.stringify({refused:"it has media now"});
n.body=b+argv[1];return JSON.stringify({ok:true});}"""

TAG = re.compile(r"<\s*(/?)\s*([A-Za-z][A-Za-z0-9]*)([^>]*)>")
BREAKS = {"div", "br", "h1", "h2", "h3", "p"}
BULLET = re.compile(r"^[-•◦⁃–]\s*")


# ── reading Notes ────────────────────────────────────────────────────────

def jxa(ctx: Context, script: str, args: list, timeout: float, what: str = "Notes"):
    """Run a JXA script with argv, retrying once when Notes had quit itself."""
    argv = ["osascript", "-l", "JavaScript", "-e", script, *[str(a) for a in args]]
    for attempt in (1, 2):
        code, out, err = call(ctx, argv, timeout)
        if code == 0:
            try:
                return json.loads(out or "null")
            except json.JSONDecodeError:
                raise SurfaceError(f"{what} answered with something that is not JSON") from None
        if NOT_RUNNING in (err or "") and attempt == 1:
            continue
        if code == 124:
            raise SurfaceError(f"{what} didn't answer in {timeout:.0f}s")
        raise SurfaceError(cli_error(what, err or out))
    raise SurfaceError(f"{what} isn't running")  # pragma: no cover  the loop always returns or raises


def find_notes(ctx: Context, query: str, limit: int = MOST_ROWS) -> list[dict]:
    """Notes whose title contains `query`, newest first, cleaned for the glass."""
    found = jxa(ctx, FIND, [plain(query)[:80], limit], FIND_TIMEOUT)
    if not isinstance(found, list):
        raise SurfaceError("Notes answered with something that is not a list")
    rows = []
    for item in found:
        if not isinstance(item, dict) or not NOTE_ID.fullmatch(str(item.get("id") or "")):
            continue
        rows.append({"id": item["id"], "title": plain(item.get("title")) or "Untitled",
                     "folder": plain(item.get("folder")) or "Notes", "modified": stamp(item.get("modified"))})
    return rows


def stamp(ms) -> str:
    """Notes' milliseconds as the ISO time the rest of the kit parses."""
    if not isinstance(ms, (int, float)) or isinstance(ms, bool):
        return ""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def read_note(ctx: Context, note_id: str) -> dict:
    if not NOTE_ID.fullmatch(note_id or ""):
        raise SurfaceError("that doesn't look like a Notes id")
    body = jxa(ctx, READ, [note_id, MAX_HTML], READ_TIMEOUT)
    if not isinstance(body, dict) or body.get("id") != note_id:
        raise SurfaceError("Notes answered with something that is not that note")
    return body


def html_lines(html: str) -> list[str]:
    """A note's HTML as the lines it shows: dash items as "- x", nested ones
    indented two spaces a level, paragraphs and headings as their text."""
    lines: list[str] = []
    current: list[str] = []
    prefix = ""
    lists: list[str] = []  # "dash", "ol" or "ul", innermost last

    def flush() -> None:
        nonlocal prefix
        text = plain(htmllib.unescape("".join(current)))
        if text:
            lines.append(prefix + text)
        current.clear()
        prefix = ""

    pos = 0
    for match in TAG.finditer(html or ""):
        current.append(html[pos:match.start()])
        pos = match.end()
        closing, tag, attrs = match.group(1), match.group(2).lower(), match.group(3)
        if tag in ("ul", "ol"):
            flush()
            if closing:
                if lists:
                    lists.pop()
            else:
                lists.append("dash" if "Apple-dash-list" in attrs else tag)
        elif tag == "li":
            flush()
            if not closing:
                depth = max(len(lists) - 1, 0)
                mark = "-" if not lists or lists[-1] == "dash" else ("1." if lists[-1] == "ol" else "•")
                prefix = "  " * depth + mark + " "
        elif tag in BREAKS:
            flush()
    current.append((html or "")[pos:])
    flush()
    return lines


def readback_lines(note: dict) -> list[str]:
    """The note's plaintext lines with any list mark Notes put in front taken
    off, which is what the landed check compares."""
    return [BULLET.sub("", line) for line in lines_of(note.get("plain"))]


def dash_fragment(line: str) -> str:
    """One dash item as HTML, the text escaped so it can't open a tag."""
    return f'<ul class="Apple-dash-list"><li>{htmllib.escape(line, quote=True)}</li></ul>'


def why_not(note: dict) -> str:
    """"" when a dash line can be appended without risking the note, else the
    reason in words."""
    if int(note.get("size") or 0) > MAX_HTML or (note.get("size") and not note.get("html")):
        return "it's too big to rewrite safely"
    attached = note.get("attachments")
    if not isinstance(attached, int) or isinstance(attached, bool) or attached < 0:
        return "Notes didn't say how many attachments it has"
    return appendable(str(note.get("html") or ""), attached)


@dataclass
class Appended:
    ok: bool
    line: str          # what to show or say
    last: str = ""     # the note's last line on read-back
    seconds: float = 0.0
    note: dict = field(default_factory=dict)


def append_line(ctx: Context, note_id: str, typed: str) -> Appended:
    """Add one dash line to the end of a note, only where nothing can be lost,
    and read it back."""
    started = time.monotonic()
    line = plain(typed)
    if not line:
        return Appended(False, "Say or type a line first.")
    if len(line) > MAX_LINE:
        return Appended(False, f"That's {len(line)} characters; one line here is at most {MAX_LINE}.")
    try:
        before = read_note(ctx, note_id)
    except SurfaceError as err:
        return Appended(False, f"Not added: {err}.")
    title = clip(plain(before.get("title")) or "that note", 40)
    why = why_not(before)
    if why:
        return Appended(False, f"Not added: {why}. {title} is read only from here.", note=before)
    old = readback_lines(before)
    if old and old[-1] == line:
        return Appended(False, f"Not added: {title} already ends with that line.", last=old[-1], note=before)
    try:
        wrote = jxa(ctx, APPEND, [note_id, dash_fragment(line), before.get("modified"), before.get("size")],
                    APPEND_TIMEOUT)
    except SurfaceError as err:
        wrote = {"error": str(err)}
    if isinstance(wrote, dict) and wrote.get("refused"):
        return Appended(False, f"Not added: {wrote['refused']}. Nothing changed.", note=before)
    try:
        after = read_note(ctx, note_id)
    except SurfaceError as err:
        return Appended(False, f"Sent, but reading {title} back failed ({err}). Check it before adding again.")
    new = readback_lines(after)
    seconds = time.monotonic() - started
    last = new[-1] if new else ""
    if last != line:
        failed = wrote.get("error") if isinstance(wrote, dict) else ""
        return Appended(False, f"Not added{f': {failed}' if failed else ''}. {title} still ends: {clip(last, 60)}",
                        last=last, seconds=seconds, note=after)
    if new[:-1] != old:
        return Appended(False, f"The line is in, but {title}'s earlier text changed too. Check it.",
                        last=last, seconds=seconds, note=after)
    why = why_not(after)
    if why:
        return Appended(False, f"The line is in, but {why} now. Check {title}.", last=last, seconds=seconds,
                        note=after)
    return Appended(True, f"Added to {title}. It ends: {clip(last, 60)}", last=last, seconds=seconds, note=after)


def create_note(ctx: Context, title: str) -> dict:
    """A new, empty note named `title`, through `mac notes add`. Returns the
    note as read back."""
    name = plain(title)[:120]
    if not name:
        raise SurfaceError("a new note needs a name")
    code, out, err = call(ctx, ["mac", "notes", "add", "--json", "--", name], CREATE_TIMEOUT)
    if code != 0:
        raise SurfaceError(cli_error("Notes", err or out))
    try:
        made = json.loads(out or "null")
    except json.JSONDecodeError:
        raise SurfaceError("Notes answered with something that is not JSON") from None
    note_id = str((made or {}).get("id") or "") if isinstance(made, dict) else ""
    if not NOTE_ID.fullmatch(note_id):
        raise SurfaceError("Notes made something, but didn't say which note")
    return read_note(ctx, note_id)


def resolve(ctx: Context, title: str) -> tuple[dict | None, list[dict]]:
    """The one note `title` names, and every match. An exact title (any case)
    wins; otherwise only a single match counts. Two is a question."""
    want = plain(title).casefold()
    matches = find_notes(ctx, title)
    exact = [m for m in matches if m["title"].casefold() == want]
    if len(exact) == 1:
        return exact[0], matches
    if not exact and len(matches) == 1:
        return matches[0], matches
    return None, matches


# ── the surface ──────────────────────────────────────────────────────────

class DashNotes(Provider):
    name = KIND
    title = "NOTE"
    region = "topLeft"
    width = 420
    refresh = 120.0
    replaces = "Apple Notes, one note at a time"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}find": self.find, f"{ACTION_PREFIX}open": self.open_row,
                        f"{ACTION_PREFIX}append": self.append, f"{ACTION_PREFIX}create": self.create}
        # The search box as the last model() saw it, so a fetch searches it.
        self._query = ""
        # A title to open as soon as a fetch finds exactly that note: the
        # voice's "open my X note" arrives as a preset, not a press.
        self._want = ""
        self._want_seen = ""
        # The note the person opened. A press writes only here, never to a
        # row that took its place after a refresh.
        self._note: dict | None = None
        self._lock = threading.Lock()
        self._pressing = False

    def fetch(self, ctx: Context) -> dict:
        rows = find_notes(ctx, self._query)
        want = self._want.casefold()
        if want:
            exact = [r for r in rows if r["title"].casefold() == want]
            if len(exact) == 1:
                self._note = read_note(ctx, exact[0]["id"])
            self._want = ""
        elif self._note is not None:
            try:
                self._note = read_note(ctx, self._note["id"])
            except SurfaceError:
                pass  # keep the last read; the status line says when a press fails
        return {"rows": rows}

    def layout(self) -> list[str]:
        ids = ("s", "q", "find", "note", "table", "head", "meta", "body", "draft", "append", "create", "status")
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("q"), "Field", label="Find a note", placeholder="Part of its title",
                 value=Bind(self.p("q"))),
            comp(self.cid("find"), "Button", label="Find", action=f"{ACTION_PREFIX}find"),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("table"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}open", actionLabel="Open"),
            comp(self.cid("head"), "Heading", text=Bind(self.p("head")), level=3),
            comp(self.cid("meta"), "Text", value=Bind(self.p("meta")), tone="muted"),
            comp(self.cid("body"), "List", items=Bind(self.p("body"))),
            comp(self.cid("draft"), "Field", label="Add a dash line", placeholder="Added at the end, only by the button",
                 value=Bind(self.p("draft"))),
            comp(self.cid("append"), "Button", label="Add line", action=f"{ACTION_PREFIX}append",
                 variant="primary"),
            comp(self.cid("create"), "Button", label="New note named the search", action=f"{ACTION_PREFIX}create"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            "> " + " ".join(self.cid(i) for i in ids),
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("q"): "", self.p("want"): "", self.p("draft"): "", self.p("status"): "",
                self.p("columns"): [{"field": "title", "label": "Note"}, {"field": "folder", "label": "Folder"},
                                    {"field": "age", "label": "Edited"}]}

    def model(self, data, error, values, ctx) -> dict:
        self._query = plain(values.get(self.p("q")) or "")[:80]
        want = plain(values.get(self.p("want")) or "")
        if want and want != self._want_seen:
            self._want_seen = want
            self._want = want
        note = self._note
        out = {self.p("head"): "", self.p("meta"): "", self.p("body"): []}
        if note is not None:
            why = why_not(note)
            shown = html_lines(str(note.get("html") or "")) or lines_of(note.get("plain"))
            out[self.p("head")] = clip(plain(note.get("title")) or "Untitled", 60)
            meta = f"{plain(note.get('folder')) or 'Notes'} · edited {ago(_moment(note), ctx.now())}"
            out[self.p("meta")] = meta + (f" · read only here: {why}" if why else "")
            tail = shown[-SHOWN_LINES:]
            out[self.p("body")] = [{"id": f"l{i}", "text": clip(t, LINE_WIDTH)} for i, t in enumerate(tail)] or \
                [{"id": "l0", "text": "Empty."}]
        if data is None:
            out.update({self.p("note"): note_for(None, error, ""), self.p("rows"): []})
            return out
        rows = data["rows"]
        now = ctx.now()
        empty = (f"No note title has {clip(self._query, 40)} in it." if self._query else "No notes yet.") \
            if not rows else ""
        out[self.p("note")] = note_for(data, error, empty, data.get("_at"))
        out[self.p("rows")] = [{"id": r["id"], "title": clip(r["title"], 34), "folder": clip(r["folder"], 14),
                                "age": ago(_moment(r), now)} for r in rows]
        return out

    # ── presses ──────────────────────────────────────────────────────────

    def find(self, ctx: Context, data, values: dict) -> Result:
        self._query = plain(values.get(self.p("q")) or "")[:80]
        return Result(True, f"Looking for {clip(self._query, 40)}." if self._query else "The newest notes.",
                      refetch=True)

    def open_row(self, ctx: Context, data, values: dict) -> Result:
        row_id = str(values.get("row") or "")
        rows = (data or {}).get("rows") or []
        if not any(r["id"] == row_id for r in rows):
            return Result(False, "That note isn't in the list any more. Find it again.")
        try:
            self._note = read_note(ctx, row_id)
        except SurfaceError as err:
            return Result(False, f"Couldn't open it: {err}.")
        return Result(True, f"Opened {clip(plain(self._note.get('title')), 40)}.")

    def append(self, ctx: Context, data, values: dict) -> Result:
        note = self._note
        if note is None:
            return Result(False, "Open a note first.")
        with self._lock:
            if self._pressing:
                return Result(False, "Still adding the last line. Wait for it, then check.")
            self._pressing = True
        try:
            done = append_line(ctx, note["id"], str(values.get(self.p("draft")) or ""))
        finally:
            with self._lock:
                self._pressing = False
        if done.note:
            self._note = done.note
        updates = {self.p("draft"): ""} if done.ok else {}
        return Result(done.ok, done.line, updates=updates, refetch=True)

    def create(self, ctx: Context, data, values: dict) -> Result:
        title = plain(values.get(self.p("q")) or "")
        if not title:
            return Result(False, "Type the new note's name in the search box first.")
        rows = (data or {}).get("rows") or []
        if any(r["title"].casefold() == title.casefold() for r in rows):
            return Result(False, f"There's already a note called {clip(title, 40)}. Open it from the list.")
        try:
            self._note = create_note(ctx, title)
        except SurfaceError as err:
            return Result(False, f"No note made: {err}.")
        return Result(True, f"Made {clip(title, 40)}. Add its first line below.", refetch=True)


def _moment(item: dict):
    from surfaces import parse_time  # noqa: PLC0415

    value = item.get("modified")
    return parse_time(stamp(value) if isinstance(value, (int, float)) else value)


# ── voice ────────────────────────────────────────────────────────────────

@dataclass
class Command:
    verb: str          # "append", "create", "open" or "close"
    title: str = ""
    line: str = ""


@dataclass
class Outcome:
    ok: bool
    line: str


LEAD = re.compile(r"^(?:(?:ok|okay|so|hey|um|uh|now|please|kyber|can you|could you)[,]?\s+)+", re.I)
APPEND_SAID = re.compile(r"^(?:add|put|append|jot(?: down)?|write(?: down)?)\s+(?P<line>.+?)\s+"
                         r"(?:to|in|into|on|onto)\s+(?:my|the)\s+(?P<title>.+?)\s+note$", re.I)
CREATE_SAID = re.compile(r"^(?:new note|(?:make|create|start)\s+(?:a\s+)?new note|(?:make|create|start)\s+a note)"
                         r"(?:\s+(?:called|named|titled))?\s+(?P<title>.+)$", re.I)
OPEN_SAID = re.compile(r"^(?:open|show|find|pull up|bring up)(?: me)?(?: up)?\s+(?:my|the)\s+(?P<title>.+?)\s+note$",
                       re.I)
SEARCH_SAID = re.compile(r"^(?:search|find in)\s+(?:my\s+)?notes\s+for\s+(?P<title>.+)$", re.I)
CLOSE_SAID = re.compile(r"^(?:close|hide|dismiss|take down|get rid of)\s+(?:my\s+|the\s+)?notes?"
                        r"(?:\s+(?:surface|panel))?$", re.I)
# "Open my latest note" names no title; those stay with the `notes` surface.
NOT_TITLES = {"latest", "last", "newest", "recent", "new", "a", "my", "this", "that"}
# A second request rides along ("and text Sam"); the model takes those whole.
SECOND_HALF = re.compile(r"\b(?:and then|and also|then)\b", re.I)


def parse(said: str) -> Command | None:
    """The notes command a whole sentence asks for, or None. Reads only."""
    s = LEAD.sub("", " ".join(str(said or "").replace("’", "'").split())).rstrip(".!?").strip()
    if not s or SECOND_HALF.search(s):
        return None
    if CLOSE_SAID.match(s):
        return Command("close")
    m = APPEND_SAID.match(s)
    if m and m.group("title").lower() not in NOT_TITLES:
        line = m.group("line").strip(" \"'")
        return Command("append", m.group("title").strip(" \"'"), line) if line else None
    m = CREATE_SAID.match(s)
    if m and m.group("title").strip(" \"'"):
        return Command("create", m.group("title").strip(" \"'"))
    m = OPEN_SAID.match(s) or SEARCH_SAID.match(s)
    if m and m.group("title").lower() not in NOT_TITLES:
        return Command("open", m.group("title").strip(" \"'"))
    return None


def show(title: str, want: bool = True, opener=None) -> bool:
    """Put the surface up searching `title`, opening it if it's exact."""
    if opener is None:
        import surface_intent  # noqa: PLC0415  bin/lib, only when a sentence arrives

        opener = surface_intent.open_with_preset
    preset = {f"/{KIND}/q": title}
    if want:
        preset[f"/{KIND}/want"] = title
    return bool(opener(KIND, preset))


def perform(command: Command, ctx: Context | None = None, opener=None, run=subprocess.run) -> Outcome:
    ctx = ctx or Context()
    if command.verb == "close":
        from surface_intent import KYBER_SURFACES  # noqa: PLC0415

        ok = True
        for name in (KIND, "notes"):
            try:
                run([str(KYBER_SURFACES), "close", name], capture_output=True, text=True, timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                ok = False
        return Outcome(ok, "Closed." if ok else "The surfaces didn't answer.")
    if command.verb == "open":
        if show(command.title, opener=opener):
            return Outcome(True, f"Looking for {command.title}.")
        return Outcome(False, "The note surface didn't open.")
    try:
        note, matches = resolve(ctx, command.title)
    except SurfaceError as err:
        return Outcome(False, f"Couldn't search Notes: {err}.")
    if command.verb == "create":
        if any(m["title"].casefold() == plain(command.title).casefold() for m in matches):
            show(command.title, opener=opener)
            return Outcome(False, f"There's already a note called {command.title}. It's up.")
        try:
            made = create_note(ctx, command.title)
        except SurfaceError as err:
            return Outcome(False, f"No note made: {err}.")
        show(plain(made.get("title")) or command.title, opener=opener)
        return Outcome(True, f"Made {command.title}.")
    if note is None:
        if not matches:
            return Outcome(False, f"No note called {command.title}. Nothing was added.")
        show(command.title, want=False, opener=opener)
        return Outcome(False, f"{len(matches)} notes match {command.title}. Pick one on the glass; nothing was added.")
    done = append_line(ctx, note["id"], command.line)
    show(note["title"], opener=opener)
    return Outcome(done.ok, done.line)
