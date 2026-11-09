#!/usr/bin/env python3
"""dash-notes: find a note by title, show its dash lines, add one dash line
only where nothing in the note can be lost, read it back, and make a note.

A fake Notes in memory answers the three JXA scripts and `mac notes add`.
Nothing here reads or writes the real Notes.
"""
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.dont_write_bytecode = True

import notes_surface as ns  # noqa: E402
import surfaces  # noqa: E402
from surfaces import Context  # noqa: E402

loader = SourceFileLoader("kyber_surfaces", str(ROOT / "bin" / "kyber-surfaces"))
ks = module_from_spec(spec_from_loader("kyber_surfaces", loader))
loader.exec_module(ks)

NOW = datetime(2026, 10, 9, 18, 0, tzinfo=timezone.utc).astimezone()
PREFIX = "x-coredata://99A0CE53-74E5-4BBE-8115-036F57066462/ICNote/p"
MS = 1_791_000_000_000
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def dash(*items):
    return '<ul class="Apple-dash-list">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def world():
    return {
        f"{PREFIX}1": {"title": "Groceries", "folder": "Notes", "html": "<div><h1>Groceries</h1></div>" + dash("eggs", "milk"),
                       "attachments": 0},
        f"{PREFIX}2": {"title": "Brain rot", "folder": "Amber",
                       "html": "<div><b>10/7/26</b></div>" + dash("bit one") + '<div><img src="data:image/png;base64,AAAA"></div>',
                       "attachments": 0},
        f"{PREFIX}3": {"title": "Trip photos", "folder": "Travel", "html": "<div><h1>Trip photos</h1></div>" + dash("view"),
                       "attachments": 1},
        f"{PREFIX}4": {"title": "Groceries old", "folder": "Notes", "html": "<div>Groceries old</div>", "attachments": 0},
        f"{PREFIX}5": {"title": "Checklist", "folder": "Notes", "html": "<div>Checklist</div><ul><li>x</li></ul>",
                       "attachments": 0},
        f"{PREFIX}6": {"title": "Deleted thing", "folder": "Recently Deleted", "html": "<div>x</div>", "attachments": 0},
    }


class FakeNotes:
    def __init__(self, items=None):
        self.items = items or world()
        for i, item in enumerate(self.items.values()):
            item.setdefault("modified", MS - i * 60_000)
        self.calls = []
        self.mode = "ok"
        self.quit_once = False

    def plain(self, item):
        return "\n".join(ns.BULLET.sub("", line) for line in ns.html_lines(item["html"]))

    def __call__(self, argv, timeout=None):
        argv = [str(a) for a in argv]
        self.calls.append(argv)
        if argv[:3] == ["osascript", "-l", "JavaScript"]:
            if self.quit_once:
                self.quit_once = False
                return 1, "", "execution error: Error: Application isn't running. (-600)"
            script, args = argv[4], argv[5:]
            if script == ns.FIND:
                q, lim = args[0].casefold(), int(args[1])
                rows = sorted(((k, v) for k, v in self.items.items() if q in v["title"].casefold()
                               and v["folder"] != "Recently Deleted"), key=lambda kv: -kv[1]["modified"])
                return 0, json.dumps([{"id": k, "title": v["title"], "folder": v["folder"],
                                       "modified": v["modified"]} for k, v in rows[:lim]]), ""
            if script == ns.READ:
                item = self.items.get(args[0])
                if item is None:
                    return 1, "", "execution error: Error: Can't get object. (-1728)"
                return 0, json.dumps({"id": args[0], "title": item["title"], "folder": item["folder"],
                                      "modified": item["modified"], "attachments": item["attachments"],
                                      "size": len(item["html"]), "html": item["html"], "plain": self.plain(item)}), ""
            if script == ns.APPEND:
                item = self.items[args[0]]
                if self.mode == "drift":
                    return 0, json.dumps({"refused": "the note changed since it was checked"}), ""
                if str(item["modified"]) != args[2] or str(len(item["html"])) != args[3]:
                    return 0, json.dumps({"refused": "the note changed since it was checked"}), ""
                if self.mode == "noop":
                    return 0, json.dumps({"ok": True}), ""
                item["html"] += args[1]
                if self.mode == "image-after":
                    item["html"] += '<img src="data:x">'
                item["modified"] += 1000
                return 0, json.dumps({"ok": True}), ""
            return 127, "", "script not faked"
        if argv[:3] == ["mac", "notes", "add"]:
            title = argv[argv.index("--") + 1]
            new_id = f"{PREFIX}{100 + len(self.items)}"
            self.items[new_id] = {"title": title, "folder": "Notes", "html": f"<div><b>{title}</b></div><div><br></div>",
                                  "attachments": 0, "modified": MS + 5000}
            return 0, json.dumps({"id": new_id}), ""
        return 127, "", f"{argv[0]} is not faked"

    def writes(self):
        return [c for c in self.calls if c[:3] == ["osascript", "-l", "JavaScript"] and c[4] == ns.APPEND]


def ctx_for(fake):
    return Context(run=fake, now=lambda: NOW, home=Path(tempfile.mkdtemp()), sleep=lambda s: None, env={})


# ── parse ────────────────────────────────────────────────────────────────

CASES = [
    ("add milk to my groceries note", ("append", "groceries", "milk")),
    ("Kyber, add call Sam back to the Amber todo note.", ("append", "Amber todo", "call Sam back")),
    ("put eggs in my Groceries note", ("append", "Groceries", "eggs")),
    ("new note Trip ideas", ("create", "Trip ideas", "")),
    ("make a new note called Chewbacca test (delete me)", ("create", "Chewbacca test (delete me)", "")),
    ("open my brain rot note", ("open", "brain rot", "")),
    ("search my notes for recipes", ("open", "recipes", "")),
    ("close the note", ("close", "", "")),
    ("close notes", ("close", "", "")),
    ("show my notes", None),
    ("open my latest note", None),
    ("add milk to my groceries note and then text Sam", None),
    ("add milk", None),
    ("what's in my groceries note", None),
]
for said, want in CASES:
    got = ns.parse(said)
    check(f"parse {said!r}", (got and (got.verb, got.title, got.line)) == want, got)

# ── lines on the glass ───────────────────────────────────────────────────

lines = ns.html_lines('<div><b>10/7/26</b></div>' + '<ul class="Apple-dash-list"><li>bit<ul class="Apple-dash-list">'
                      '<li>Mechanism: x &ampy</li></ul></li></ul><div><br></div><ol><li>one</li></ol>')
check("dash items show as '- x', a nested Mechanism line indented, Notes' bare &amp unescaped",
      lines == ["10/7/26", "- bit", "  - Mechanism: x &y", "1. one"], lines)
check("a dash item is HTML escaped, so typed markup is text",
      ns.dash_fragment('<img src=x> & "q"') == '<ul class="Apple-dash-list"><li>&lt;img src=x&gt; &amp; &quot;q&quot;</li></ul>')

# ── the write script itself ──────────────────────────────────────────────

check("the write re-checks attachments, modified time, body length and media in the same AppleEvent",
      all(s in ns.APPEND for s in ("attachments.length>0", "modificationDate().getTime()", "b.length", "img|object|table")))
check("the write only concatenates (body = body + argv), nothing typed is spliced into the script",
      "n.body=b+argv[1]" in ns.APPEND and "edit" not in ns.APPEND and "delete" not in ns.APPEND)

# ── appending ────────────────────────────────────────────────────────────

fake = FakeNotes()
ctx = ctx_for(fake)
done = ns.append_line(ctx, f"{PREFIX}1", "bread")
check("a dash-list note takes a dash line and reads back its last line", done.ok and done.last == "bread", done)
check("the line landed as a dash item", fake.items[f"{PREFIX}1"]["html"].endswith(dash("bread")))
check("one write for one press", len(fake.writes()) == 1, len(fake.writes()))

for nid, why in ((f"{PREFIX}2", "an image"), (f"{PREFIX}3", "an attachment"), (f"{PREFIX}5", "checklist")):
    before = dict(fake.items[nid])
    writes = len(fake.writes())
    done = ns.append_line(ctx, nid, "new bit")
    check(f"images untouched: a note with {why} is refused and never written",
          not done.ok and why in done.line and len(fake.writes()) == writes and fake.items[nid] == before, done.line)

done = ns.append_line(ctx, f"{PREFIX}1", "bread")
check("the same last line twice is refused", not done.ok and "already ends" in done.line, done.line)
check("an empty line is refused before Notes is asked", not ns.append_line(ctx, f"{PREFIX}1", "  \x07 ").ok)
check("a bad id is refused before Notes is asked", not ns.append_line(ctx, "x-coredata://nope; delete", "a").ok)

fake.mode = "drift"
done = ns.append_line(ctx, f"{PREFIX}1", "cheese")
check("a note edited between the check and the write is left alone", not done.ok and "changed" in done.line, done.line)
fake.mode = "noop"
done = ns.append_line(ctx, f"{PREFIX}1", "cheese")
check("a write that didn't land says so with the real last line", not done.ok and "bread" in done.line, done.line)
fake.mode = "image-after"
done = ns.append_line(ctx, f"{PREFIX}1", "cheese")
check("media found on read-back is reported, never called clean", not done.ok and "image" in done.line, done.line)
fake.mode = "ok"

fake = FakeNotes()
fake.quit_once = True
done = ns.append_line(ctx_for(fake), f"{PREFIX}1", "bread")
check("Notes quitting itself (-600) is retried once", done.ok, done.line)

# ── finding and making ───────────────────────────────────────────────────

fake = FakeNotes()
ctx = ctx_for(fake)
note, matches = ns.resolve(ctx, "groceries")
check("an exact title wins over a longer one", note and note["id"] == f"{PREFIX}1" and len(matches) == 2, note)
note, matches = ns.resolve(ctx, "Grocer")
check("two partial matches are a question, not a guess", note is None and len(matches) == 2, note)
check("Recently Deleted never matches", ns.find_notes(ctx, "Deleted") == [])

opened = []
out = ns.perform(ns.Command("append", "Grocer", "x"), ctx=ctx, opener=lambda k, p: opened.append(p) or True)
check("an ambiguous append writes nothing and opens the search", not out.ok and not fake.writes()
      and opened and f"/{ns.KIND}/want" not in opened[-1], out.line)
out = ns.perform(ns.Command("append", "groceries", "bread"), ctx=ctx, opener=lambda k, p: opened.append(p) or True)
check("a voice append reads the last line back", out.ok and out.line.endswith("bread"), out.line)
out = ns.perform(ns.Command("append", "Nope", "x"), ctx=ctx, opener=lambda k, p: True)
check("no such note: nothing added", not out.ok and "Nothing was added" in out.line, out.line)
out = ns.perform(ns.Command("create", "Groceries"), ctx=ctx, opener=lambda k, p: True)
check("a new note with an existing title is not made twice", not out.ok and "already" in out.line, out.line)
count = len(fake.items)
out = ns.perform(ns.Command("create", "Trip ideas"), ctx=ctx, opener=lambda k, p: opened.append(p) or True)
check("new note makes one note and opens it", out.ok and len(fake.items) == count + 1
      and opened[-1] == {f"/{ns.KIND}/q": "Trip ideas", f"/{ns.KIND}/want": "Trip ideas"}, out.line)

# ── the surface, through the real daemon ─────────────────────────────────


class FakeHud:
    def __init__(self):
        self.lines = []

    def send(self, lines):
        self.lines.extend(lines)
        return True


check("dash-notes is a registered kind", "dash-notes" in surfaces.KINDS
      and isinstance(surfaces.make("dash-notes"), ns.DashNotes))
fake = FakeNotes()
ctx = ctx_for(fake)
tmp = Path(tempfile.mkdtemp())
hud = FakeHud()
d = ks.Daemon(hud, ctx=ctx, state_path=tmp / "state.json", activity_path=tmp / "activity.jsonl",
              badges_path=tmp / "badges.json", spaces={}, clock=lambda: 0.0, spawn=lambda fn: fn(),
              ingest=lambda c: {})
d.open_surface("dash-notes", preset={"/dash-notes/q": "Groceries", "/dash-notes/want": "Groceries"})
live = d.open["dash-notes"]
p = live.provider
model = p.model(live.data, live.error, live.values, ctx)
check("a voice preset searches and opens the exact note", model["/dash-notes/head"] == "Groceries"
      and [r["text"] for r in model["/dash-notes/body"]] == ["Groceries", "- eggs", "- milk"], model.get("/dash-notes/body"))
check("the search rows are the titles that match", [r["title"] for r in model["/dash-notes/rows"]]
      == ["Groceries", "Groceries old"], model["/dash-notes/rows"])
check("append is the one primary button", sum('variant="primary"' in line for line in p.layout()) == 1
      and any("notes-append" in line and "primary" in line for line in p.layout()))
d.on_value("/dash-notes/draft", "bread")
d.on_action(f"{ks.ACTION_PREFIX}append", "dash-notes-append")
status = live.values.get("/dash-notes/status") or ""
check("a press adds the line and the status reads the last line back", "ends: bread" in json.dumps(
    [line for line in hud.lines if "/dash-notes/status" in line][-1:]), hud.lines[-3:])
check("the draft clears after a clean append", live.values.get("/dash-notes/draft") == "")
d.on_action(f"{ks.ACTION_PREFIX}open", "dash-notes-table", {"row": f"{PREFIX}2"})
check("a row from another search is refused", p._note["id"] == f"{PREFIX}1")
d.on_value("/dash-notes/q", "brain")
d.on_action(f"{ks.ACTION_PREFIX}find", "dash-notes-find")
check("Find searches the typed title", [r["title"] for r in live.data["rows"]] == ["Brain rot"], live.data["rows"])
d.on_action(f"{ks.ACTION_PREFIX}open", "dash-notes-table", {"row": f"{PREFIX}2"})
check("a row press opens that note", p._note and p._note["id"] == f"{PREFIX}2")
model = p.model(live.data, live.error, live.values, ctx)
check("a note with an image says it's read only here", "read only here: it has an image" in model["/dash-notes/meta"],
      model["/dash-notes/meta"])
writes = len(fake.writes())
d.on_value("/dash-notes/draft", "new bit")
d.on_action(f"{ks.ACTION_PREFIX}append", "dash-notes-append")
check("pressing append on it writes nothing", len(fake.writes()) == writes)
d.on_action(f"{ks.ACTION_PREFIX}open", "dash-notes-table", {"row": f"{PREFIX}999"})
check("a row not in the list is refused", p._note["id"] == f"{PREFIX}2")
d.handle_line("x")
check("dismissing the glass closes the surface", "dash-notes" not in d.open)

print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
