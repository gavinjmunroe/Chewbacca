#!/usr/bin/env bash
# chewbacca-mcp writes: every reversible write's undo really puts it back, and
# nothing outward goes anywhere without kit_confirm on a live draft, carrying
# the send code that only the person's own screen shows.
#
# Caleb, 2026-10-11 2:46am: "Never read only, find a way to write too". The
# safety that makes that OK is the undo and the two-step send, so those are
# what this checks, against the real work ledger and people store in a temp
# home, and fakes for Notes, Reminders and Calendar (the `mac` CLI and
# osascript) so no test ever touches the person's own apps.
#
# Every send check runs under CHEWBACCA_NO_SEND=1. On 2026-10-08 a test send
# whose refusal had not applied reached a client.
set -uo pipefail
ROOT="${1:?repo root}"
export CHEWBACCA_NO_SEND=1

python3 - "$ROOT" <<'PY'
import atexit, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, textwrap, time

ROOT = sys.argv[1]
T = tempfile.mkdtemp(prefix="mcp-writes-")
atexit.register(shutil.rmtree, T, True)
FAKE = os.path.join(T, "fakebin")      # on PATH: mac, osascript
FB = os.path.join(T, "kitbin")         # CHEWBACCA_MCP_BIN
for d in (FAKE, FB, os.path.join(T, "home"), os.path.join(T, "files"), os.path.join(T, "outside")):
    os.makedirs(d)

def put(path, body, mode=0o755):
    with open(path, "w") as f:
        f.write(textwrap.dedent(body).lstrip())
    os.chmod(path, mode)

# ── fakes ──────────────────────────────────────────────────────────────────────
STATE = os.path.join(T, "apps.json")
json.dump({"notes": {}, "reminders": {}, "events": {}, "n": 0, "attachments": {}}, open(STATE, "w"))

put(os.path.join(FAKE, "mac"), f"""
    #!/usr/bin/env python3
    import json, sys
    S = {STATE!r}
    s = json.load(open(S))
    a = sys.argv[1:]
    app, verb, rest = a[0], a[1], [x for x in a[2:] if x != "--json"]
    def opt(name):
        return rest[rest.index(name) + 1] if name in rest else None
    def save():
        json.dump(s, open(S, "w"))
    def new(prefix):
        s["n"] += 1
        return f"{{prefix}}-{{s['n']}}"
    def out(x):
        print(json.dumps(x)); save(); sys.exit(0)
    def fail(msg):
        print(json.dumps({{"error": msg}})); sys.exit(1)
    if app == "notes":
        if verb == "add":
            i = new("note"); s["notes"][i] = {{"id": i, "title": rest[0], "folder": opt("--folder") or "Notes",
                "body": f"<div>{{rest[0]}}</div><div>{{opt('--body') or ''}}</div>"}}; out(s["notes"][i])
        n = s["notes"].get(rest[0]) or fail("no note")
        if verb == "read": out(n)
        if verb == "append": n["body"] += f"<div>{{rest[1]}}</div>"; out(n)
        if verb == "edit":
            if opt("--body") is not None: n["body"] = f"<div>{{opt('--title') or n['title']}}</div><div>{{opt('--body')}}</div>"
            if opt("--title"): n["title"] = opt("--title")
            out(n)
        if verb == "delete": n["folder"] = "Recently Deleted"; out({{"deleted": n["id"]}})
    if app == "reminders":
        if verb == "add":
            i = new("rem"); s["reminders"][i] = {{"id": i, "title": rest[0], "due": opt("--due"), "isCompleted": False}}; out(s["reminders"][i])
        r = s["reminders"].get(rest[0]) or fail("no reminder")
        if verb == "complete": r["isCompleted"] = True; out(r)
        if verb == "delete": del s["reminders"][rest[0]]; out({{"deleted": rest[0]}})
    if app == "calendar":
        if verb == "add":
            i = new("ev"); s["events"][i] = {{"id": i, "title": rest[0], "start": opt("--at"), "end": "later",
                "calendar": opt("--calendar") or "Home", "notes": opt("--notes")}}; out(s["events"][i])
        if verb == "delete": s["events"].pop(rest[0], None) or fail("no event"); out({{"deleted": rest[0]}})
    fail("fake mac does not know " + " ".join(a[:2]))
""")

put(os.path.join(FAKE, "osascript"), f"""
    #!/usr/bin/env python3
    import json, sys
    S = {STATE!r}
    s = json.load(open(S))
    a = sys.argv[1:]
    script = " ".join(a[i + 1] for i, x in enumerate(a) if x == "-e")
    argv = a[max(i for i, x in enumerate(a) if x == "-e") + 2:]
    # Like the real Reminders: AppleScript only knows the prefixed id.
    if "reminder id" in script:
        if not argv[0].startswith("x-apple-reminder://"): sys.exit(1)
        argv[0] = argv[0][len("x-apple-reminder://"):]
    if "count of attachments" in script:
        print(s["attachments"].get(argv[0], 0)); sys.exit(0)
    if "set body of note" in script:
        s["notes"][argv[0]]["body"] = argv[1]
    elif "set completed of reminder" in script:
        s["reminders"][argv[0]]["isCompleted"] = script.rstrip().endswith("to true end run")
    elif "completed of reminder" in script:
        r = s["reminders"].get(argv[0])
        if r is None: sys.exit(1)
        print("true" if r["isCompleted"] else "false"); sys.exit(0)
    else:
        sys.exit(2)
    json.dump(s, open(S, "w"))
""")

# The kit's bin, with the two outward tools wrapped so every call is logged.
for name in ("work-ledger", "mac-db", "lib"):
    os.symlink(os.path.join(ROOT, "bin", name), os.path.join(FB, name))
CALLS = os.path.join(T, "calls.log")
put(os.path.join(FB, "people"), f"""
    #!/usr/bin/env bash
    printf 'people %s\\n' "$*" >> {CALLS!r}
    # A thread no saved card owns, as `people send --dry-run` prints one.
    if [ "$2" = "Unsaved Person" ] && [ "${{@: -1}}" = "--dry-run" ]; then
      printf '  would send to Unsaved Person via whatsapp, 15550001111@s.whatsapp.net, not a saved contact\\n  %s\\n  to send: add --to 15550001111@s.whatsapp.net\\n' "$3"
      exit 0
    fi
    exec {os.path.join(ROOT, "bin", "people")!r} "$@"
""")
REQ = os.path.join(T, "gtm-request.json")
json.dump({"method": "POST", "path": "/v3/tables/t_1/records", "body": {"records": [{"f_1": "x"}]}}, open(REQ, "w"))
# The GTM front door is faked whole: no test reaches the real one, signed in or not.
put(os.path.join(FB, "chewbacca-clay"), f"""
    #!/usr/bin/env python3
    import json, sys
    open({CALLS!r}, "a").write("gtm " + " ".join(sys.argv[1:]) + "\\n")
    if "--dry-run" in sys.argv:
        print(json.dumps({{"ok": True, "dry_run": True, "sent": False, "kind": "write", "gate": "write:table-data",
                           "surface": "api-anything", "request": json.load(open({REQ!r}))}}))
    else:
        print(json.dumps({{"ok": False, "class": "refused", "reason": "fake front door never sends"}}))
        sys.exit(3)
""")

env = dict(os.environ,
           PATH=FAKE + os.pathsep + os.environ["PATH"],
           HOME=os.path.join(T, "home"),
           CHEWBACCA_HOME=os.path.join(T, "chewbacca"),
           PEOPLE_DIR=os.path.join(T, "people"),
           PEOPLE_JEV="off",
           CHEWBACCA_MCP_BIN=FB,
           CHEWBACCA_MCP_STATE=os.path.join(T, "state"),
           CHEWBACCA_MCP_FILE_ROOTS=os.path.join(T, "files"),
           CHEWBACCA_MCP_APPROVAL_OUT=os.path.join(T, "screen-code"),
           CHEWBACCA_NO_SEND="1")
SCREEN = env["CHEWBACCA_MCP_APPROVAL_OUT"]
def screen_code():
    """What the person reads off their screen; the agent's channel never carries it."""
    return open(SCREEN).read().strip()
assert env["CHEWBACCA_NO_SEND"] == "1"

def sh(*argv):
    return subprocess.run(argv, env=env, capture_output=True, text=True, timeout=60)

class Server:
    def __init__(self, extra=None):
        self.p = subprocess.Popen([os.path.join(ROOT, "bin", "chewbacca-mcp")], env=dict(env, **(extra or {})),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.n = 0
        self.rpc("initialize", {"clientInfo": {"name": "writes-test", "version": "1"}})
    def rpc(self, method, params=None):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}}) + "\n")
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())
    def call(self, tool, **args):
        r = self.rpc("tools/call", {"name": tool, "arguments": args})
        return r["result"]["content"][0]["text"]
    def write(self, wid, **params):
        return self.call("kit_write", id=wid, params=params, asked_by="the writes test")
    def close(self):
        self.p.stdin.close(); self.p.wait(timeout=10)

failures = []
def check(ok, what):
    if not ok:
        failures.append(what)

def undo_id(text):
    m = re.search(r"Undo id: (u_[A-Za-z0-9_-]{16})", text)
    assert m, f"no undo id in: {text}"
    return m.group(1)

def apps():
    return json.load(open(STATE))

def setapps(s):
    json.dump(s, open(STATE, "w"))

s = Server()

# 1. The tools are listed, and the send is marked as reaching the world.
tools = {t["name"]: t for t in s.rpc("tools/list")["result"]["tools"]}
for name in ("kit_write", "kit_confirm", "kit_undo"):
    check(name in tools, f"{name} is not listed")
check(tools["kit_confirm"]["annotations"].get("openWorldHint") is True, "kit_confirm is not marked open-world")
check(tools["kit_read"]["annotations"].get("readOnlyHint") is True, "kit_read is not marked read-only")

# 2. Every registry entry has code, and every entry's kind is one of the two.
reg = json.load(open(os.path.join(ROOT, "config", "data", "mcp-writes.json")))["writes"]
code = open(os.path.join(ROOT, "bin", "lib", "mcp-writes.js")).read()
for e in reg:
    check(e["kind"] in ("reversible", "outward"), f"{e['id']} has kind {e['kind']}")
    check(re.search(r'"%s": ' % re.escape(e["id"]), code) is not None, f"{e['id']} has no code in mcp-writes.js")
check(len({e["id"] for e in reg}) == len(reg), "a write id repeats")
check({e["id"] for e in reg if e["kind"] == "outward"} >= {"text.send", "gtm.clay_write"}, "a send is not marked outward")

# 3. ledger.add, then undo removes the row.
def ledger():
    out = sh(os.path.join(ROOT, "bin", "work-ledger"), "list", "--all", "--scope", env["HOME"]).stdout
    return {t["id"]: t for t in json.loads(out or "[]")}
t = s.write("ledger.add", title="Email Jonah the deck", next_action="attach v3")
u = undo_id(t)
added = [x for x in ledger().values() if x["title"] == "Email Jonah the deck"]
check(len(added) == 1 and added[0]["next_action"] == "attach v3", f"ledger.add did not land: {t}")
check("Undone" in s.call("kit_undo", undo_id=u), "ledger.add undo failed")
check(not [x for x in ledger().values() if x["title"] == "Email Jonah the deck"], "ledger.add undo left the task")
check("Already undone" in s.call("kit_undo", undo_id=u), "an undo ran twice")

# 4. ledger.update, then undo puts every field back, updated_at included.
made = json.loads(sh(os.path.join(ROOT, "bin", "work-ledger"), "add", "--scope", env["HOME"], "--title", "Ship writes",
                     "--source-key", "t1", "--next-action", "write tests").stdout)["task"]
u = undo_id(s.write("ledger.update", task_id=made["id"], status="active", next_action="land it"))
check(ledger()[made["id"]]["next_action"] == "land it", "ledger.update did not land")
check("Undone" in s.call("kit_undo", undo_id=u), "ledger.update undo failed")
back = ledger()[made["id"]]
check((back["status"], back["next_action"], back["updated_at"]) == ("queued", "write tests", made["updated_at"]),
      f"ledger.update undo did not restore: {back}")

# 5. An undo refuses when someone else changed the task since, and keeps their change.
u = undo_id(s.write("ledger.update", task_id=made["id"], next_action="mine"))
sh(os.path.join(ROOT, "bin", "work-ledger"), "update", "--scope", env["HOME"], "--id", made["id"], "--next-action", "another tab")
check("Not undone" in s.call("kit_undo", undo_id=u), "undo clobbered a later change")
check(ledger()[made["id"]]["next_action"] == "another tab", "the other tab's change was lost")

# 6. notes.add, undo moves it to Recently Deleted.
t = s.write("notes.add", title="Groceries", body="eggs")
nid = re.search(r"\((note-\d+)\)", t).group(1)
check(apps()["notes"][nid]["folder"] == "Notes", f"notes.add did not land: {t}")
s.call("kit_undo", undo_id=undo_id(t))
check(apps()["notes"][nid]["folder"] == "Recently Deleted", "notes.add undo did not delete")

# 7. notes.append and notes.edit, undo restores the exact HTML.
t = s.write("notes.add", title="Plan", body="step one")
nid = re.search(r"\((note-\d+)\)", t).group(1)
before = apps()["notes"][nid]["body"]
u = undo_id(s.write("notes.append", note_id=nid, text="step two"))
check(apps()["notes"][nid]["body"] != before, "notes.append did not land")
s.call("kit_undo", undo_id=u)
check(apps()["notes"][nid]["body"] == before, "notes.append undo did not restore the body")
u = undo_id(s.write("notes.edit", note_id=nid, body="rewritten"))
s.call("kit_undo", undo_id=u)
check(apps()["notes"][nid]["body"] == before, "notes.edit undo did not restore the body")
# Someone typed in the note after the write: the undo leaves their words alone.
u = undo_id(s.write("notes.append", note_id=nid, text="agent line"))
st = apps(); st["notes"][nid]["body"] += "<div>typed by hand</div>"; setapps(st)
check("Not undone" in s.call("kit_undo", undo_id=u), "a note undo ran over a later edit")
check("typed by hand" in apps()["notes"][nid]["body"], "a later edit to the note was lost")
st = apps(); st["notes"][nid]["body"] = before; setapps(st)
# A note with attachments is not rewritten by an undo, which could drop them.
st = apps(); st["attachments"][nid] = 2; setapps(st)
u = undo_id(s.write("notes.append", note_id=nid, text="three"))
after = apps()["notes"][nid]["body"]
check("attachments" in s.call("kit_undo", undo_id=u), "an undo rewrote a note with attachments")
check(apps()["notes"][nid]["body"] == after, "the refused undo still changed the note")

# 8. Reminders: add, complete, and an already-done reminder has nothing to undo.
t = s.write("reminders.add", title="Call Mom", due="tomorrow 9am")
rid = re.search(r"\((rem-\d+)\)", t).group(1)
s.call("kit_undo", undo_id=undo_id(t))
check(rid not in apps()["reminders"], "reminders.add undo did not delete")
t = s.write("reminders.add", title="Gym")
rid = re.search(r"\((rem-\d+)\)", t).group(1)
u = undo_id(s.write("reminders.complete", reminder_id=rid))
check(apps()["reminders"][rid]["isCompleted"] is True, "reminders.complete did not land")
s.call("kit_undo", undo_id=u)
check(apps()["reminders"][rid]["isCompleted"] is False, "reminders.complete undo did not untick")
s.write("reminders.complete", reminder_id=rid)
check("Undo id" not in s.write("reminders.complete", reminder_id=rid), "an already-done reminder got an undo")

# 9. A calendar hold is titled as one, and undo deletes it.
t = s.write("calendar.hold", title="Deep work", at="tomorrow 2pm", duration="2h")
eid = re.search(r"\((ev-\d+)\)", t).group(1)
check(apps()["events"][eid]["title"] == "Hold: Deep work", "the hold is not titled as one")
s.call("kit_undo", undo_id=undo_id(t))
check(eid not in apps()["events"], "calendar.hold undo did not delete")

# 10. people.note, undo forgets exactly that observation.
sh(os.path.join(ROOT, "bin", "people"), "add", "Test Person", "--phone", "+15555550123")
db = os.path.join(env["PEOPLE_DIR"], "people.db")
live = lambda: sqlite3.connect(db).execute("select count(*) from observations where body = ? and deleted_at is null", ("got promoted",)).fetchone()[0]
u = undo_id(s.write("people.note", name="Test Person", text="got promoted"))
check(live() == 1, "people.note did not land")
s.call("kit_undo", undo_id=u)
check(live() == 0, "people.note undo did not forget it")

# 11. Files: create, replace, edit, each undone byte for byte, and the refusals.
F = os.path.join(T, "files", "plan.md")
u = undo_id(s.write("file.write", path=F, content="v1\n"))
s.call("kit_undo", undo_id=u)
check(not os.path.exists(F), "file.write undo left a file it created")
open(F, "w").write("original\nline two\n")
u = undo_id(s.write("file.write", path=F, content="replaced\n"))
s.call("kit_undo", undo_id=u)
check(open(F).read() == "original\nline two\n", "file.write undo did not restore")
u = undo_id(s.write("file.edit", path=F, old="line two", new="line 2"))
check(open(F).read() == "original\nline 2\n", "file.edit did not land")
s.call("kit_undo", undo_id=u)
check(open(F).read() == "original\nline two\n", "file.edit undo did not restore")
os.makedirs(os.path.join(T, "files", ".git"))
os.symlink(os.path.join(T, "outside"), os.path.join(T, "files", "out"))
exe = os.path.join(T, "files", "run.sh"); open(exe, "w").write("echo hi\n"); os.chmod(exe, 0o755)
for bad in (os.path.join(T, "outside", "x.md"), os.path.join(T, "files", ".git", "hooks"),
            os.path.join(T, "files", "out", "x.md"), exe, "relative.md"):
    r = s.write("file.write", path=bad, content="pwned\n")
    check("failed" in r and "Undo id" not in r, f"file.write was not refused for {bad}: {r}")
check(not os.listdir(os.path.join(T, "outside")), "a refused write still landed outside the roots")
check(open(exe).read() == "echo hi\n", "an executable was overwritten")

# 12. A value shaped like a flag never reaches a CLI.
check("can't start with a dash" in s.write("reminders.add", title="--list=Work"), "a flag-shaped value got through")

# 13. A send without kit_confirm sends nothing; only dry runs ever reached people.
open(CALLS, "w").close()
t = s.write("text.send", to="Test Person", text="running 10 late", via="imessage")
draft = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", t)
check(draft is not None and "would send to" in t and "Nothing has been sent" in t, f"text.send did not draft: {t}")
calls = open(CALLS).read().splitlines()
check(calls and all(c.startswith("people send") and c.endswith("--dry-run") for c in calls), f"a send ran without a confirm: {calls}")

# 14. Wrong, malformed and reused ids are refused; the right one sends nothing under NO_SEND.
check("Refused" in s.call("kit_confirm", draft_id="d_AAAAAAAAAAAAAAAA", asked_by="test"), "a wrong draft id was not refused")
check("Refused" in s.call("kit_confirm", draft_id="../../etc/passwd", asked_by="test"), "a malformed id was not refused")
check(re.fullmatch(r"\d{6}", screen_code()) and screen_code() not in t, "the send code is missing, or it is in the agent's reply")
check("isn't the send code" in s.call("kit_confirm", draft_id=draft.group(1), asked_by="test"),
      "a confirm with no send code was not refused: an agent could send by itself")
check("nothing was sent" in s.call("kit_confirm", draft_id=draft.group(1), approval_code=screen_code(), asked_by="test"), "a confirm under CHEWBACCA_NO_SEND said it sent")
check("already confirmed" in s.call("kit_confirm", draft_id=draft.group(1), approval_code=screen_code(), asked_by="test"), "a draft confirmed twice")

# 14b. Guessing is not a press: three wrong codes burn the draft, and the
#      right code after that sends nothing.
g = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", s.write("text.send", to="Test Person", text="guess", via="imessage")).group(1)
real = screen_code()
wrong = "000000" if real != "000000" else "111111"
for _ in range(2):
    check("isn't the send code" in s.call("kit_confirm", draft_id=g, approval_code=wrong, asked_by="test"), "a wrong code was not refused")
check("three times" in s.call("kit_confirm", draft_id=g, approval_code=wrong, asked_by="test"), "a third wrong code did not burn the draft")
check("no draft with that id" in s.call("kit_confirm", draft_id=g, approval_code=real, asked_by="test"), "a burned draft still sent")
calls = open(CALLS).read().splitlines()
check(all(c.endswith("--dry-run") for c in calls), f"a confirm under CHEWBACCA_NO_SEND reached the sender: {calls}")

# 15. The GTM write drafts the exact request; a changed request is refused.
t = s.write("gtm.clay_write", op="add-rows", args={"ws": "1", "table": "t_1", "records": '[{"f_1":"x"}]'})
draft = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", t)
check(draft is not None and "/v3/tables/t_1/records" in t, f"the GTM write did not draft: {t}")
json.dump({"method": "POST", "path": "/v3/tables/t_OTHER/records", "body": {}}, open(REQ, "w"))
check("changed since the draft" in s.call("kit_confirm", draft_id=draft.group(1), approval_code=screen_code(), asked_by="test"), "a changed request was confirmed")
check("must be one of" in s.write("gtm.clay_write", op="rm-rf", args={}), "an unknown GTM op was drafted")
check(not [c for c in open(CALLS).read().splitlines() if c.startswith("gtm") and "--dry-run" not in c],
      "a GTM write ran without --dry-run")

# 16. A draft from an earlier server never sends, and an expired one is refused.
old = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", s.write("text.send", to="Test Person", text="hi", via="imessage")).group(1)
s.close()
s2 = Server()
check("no draft with that id" in s2.call("kit_confirm", draft_id=old, asked_by="test"), "a draft survived a restart")
s2.close()
s3 = Server({"CHEWBACCA_MCP_DRAFT_TTL_MS": "1"})
d = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", s3.write("text.send", to="Test Person", text="hi", via="imessage")).group(1)
time.sleep(0.05)  # a 1ms TTL compared by Date.now() can tie without it
check("expired" in s3.call("kit_confirm", draft_id=d, asked_by="test"), "an expired draft was not refused")
s3.close()

# 17. An address no saved card owns is never filled in for the sender: the
#     confirm has to repeat it, the way `people send` makes a person type it.
s4 = Server()
t = s4.write("text.send", to="Unsaved Person", text="hey", via="whatsapp")
d = re.search(r"DRAFT (d_[A-Za-z0-9_-]{16})", t).group(1)
check("not a saved contact" in t and "to_address" in t, f"an unsaved address was not flagged: {t}")
check("needs to_address" in s4.call("kit_confirm", draft_id=d, approval_code=screen_code(), asked_by="test"), "an unsaved address confirmed without to_address")
check("needs to_address" in s4.call("kit_confirm", draft_id=d, approval_code=screen_code(), to_address="15559999999@s.whatsapp.net", asked_by="test"),
      "a different to_address was accepted")
check("nothing was sent" in s4.call("kit_confirm", draft_id=d, approval_code=screen_code(), to_address="15550001111@s.whatsapp.net", asked_by="test"),
      "the matching to_address was not accepted")
s4.close()
check(all(c.endswith("--dry-run") for c in open(CALLS).read().splitlines() if c.startswith("people send")),
      "an unsaved-address confirm reached the sender")

# 18. Caleb's handwritten notes stay his in any spelling APFS accepts.
os.makedirs(os.path.join(T, "files", "04 Notes"))
for spelled in ("04 Notes", "04 notes", "04 NOTES"):
    s5 = Server()
    out = s5.write("file.write", path=os.path.join(T, "files", spelled, "idea.md"), content="x\n")
    s5.close()
    check("written by hand" in out, f"a write into {spelled} was not refused: {out}")
check(not os.listdir(os.path.join(T, "files", "04 Notes")), "a file landed in 04 Notes")

# 19. Over HTTP a write needs the owner-only token; a read does not.
import socket, urllib.request
sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
srv = subprocess.Popen([os.path.join(ROOT, "bin", "chewbacca-mcp"), "--http", str(port)], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def post(body, token=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["result"]["content"][0]["text"]
for _ in range(50):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1); break
    except Exception:
        time.sleep(0.1)
call = lambda: {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "kit_write", "arguments": {"id": "ledger.add", "params": {"title": "over http"}, "asked_by": "test"}}}
tokfile = os.path.join(env["CHEWBACCA_MCP_STATE"], "http-token")
try:
    check("bearer token" in post(call()), "an HTTP write ran without the token")
    check("bearer token" in post(call(), "0" * 64), "an HTTP write ran with a wrong token")
    check(not [x for x in ledger().values() if x["title"] == "over http"], "a refused HTTP write still landed")
    check(oct(os.stat(tokfile).st_mode & 0o777) == "0o600", "the HTTP token is readable by others")
    check("Undo id" in post(call(), open(tokfile).read().strip()), "an HTTP write with the token was refused")
finally:
    srv.terminate(); srv.wait(timeout=10)

# 20. Every write is logged with who asked and which client.
log = [json.loads(l) for l in open(os.path.join(env["CHEWBACCA_MCP_STATE"], "log.jsonl"))]
writes = [l for l in log if l["op"] == "write" and l["transport"] == "stdio"]
check(writes and all(l["asked_by"] == "the writes test" and l["client"] == "writes-test 1" for l in writes),
      "a write was logged without who asked")
check([l for l in log if l["op"] == "write" and l["transport"] == "http" and l["asked_by"] == "test"],
      "the HTTP write was not logged as one")
check(any(l["op"] == "confirm-no-send" for l in log) and any(l["op"] == "confirm-refused" for l in log),
      "confirms are not logged")
check(oct(os.stat(os.path.join(env["CHEWBACCA_MCP_STATE"], "log.jsonl")).st_mode & 0o777) == "0o600", "the log is readable by others")

if failures:
    sys.exit("mcp writes:\n  " + "\n  ".join(failures))
print(f"mcp writes: {len(reg)} writes, every undo restored, no send without a confirm")
PY
