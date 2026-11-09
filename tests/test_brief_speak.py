#!/usr/bin/env python3
"""The spoken brief: off by default, silent when the room is busy, never says a
private line. No sound comes out of this: every run uses a fake speak command,
and fake `say` and `afplay` first on PATH trip the suite if anything reaches them.
The one real `say` run renders to a file. Run: python3 tests/test_brief_speak.py"""
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mac" / "lib"))
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import brief_speak as bs  # noqa: E402
import surface_lint  # noqa: E402

TOOL = ROOT / "mac" / "lib" / "brief_speak.py"
CHEWIE = ROOT / "mac" / "bin" / "chewie"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def script(path, body):
    path.write_text("#!/bin/sh\n" + body + "\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


TMP = Path(tempfile.mkdtemp(prefix="brief-speak-"))
TRAP = TMP / "trap"
TRAP.mkdir()
REAL_SOUND = TMP / "REAL-SOUND"
for name in ("say", "afplay"):
    script(TRAP / name, f'echo "$0 $*" >> "{REAL_SOUND}"')
HEARD = TMP / "heard"
FAKE = script(TMP / "fake-speak", f'printf "%s\\n" "$1" >> "{HEARD}"')
SLOW = script(TMP / "slow-speak", f'printf "%s\\n" "$1" >> "{HEARD}"\nexec sleep 30')
GLASS = TMP / "glass"
SOCK = Path(tempfile.mkdtemp(prefix="bs-", dir="/tmp")) / "h.sock"  # sockets cap their path near 100 chars
PROBE = TMP / "probe.json"
CLEAR = {"dnd": False, "focus": "", "mic": False, "audio": False, "idle_s": 1}


def room(**over):
    PROBE.write_text(json.dumps({**CLEAR, **over}))


def home():
    h = Path(tempfile.mkdtemp(dir=TMP))
    return h


def env_for(h, speak=FAKE):
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    env.update(HOME=str(h), PATH=f"{TRAP}:{env['PATH']}", CHEWIE_SPEAK_CMD=str(speak),
               CHEWIE_BRIEF_PROBE=str(PROBE), BOB_HUD_SOCKET=str(SOCK),
               CHEWBACCA_DAEMON_DIR=str(h / "daemon"))
    return env


def fake_glass():
    """A stand-in for Kyber's socket that writes what it's sent to GLASS."""
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(str(SOCK))
    srv.listen(8)

    def serve():
        while True:
            conn, _ = srv.accept()
            with conn, open(GLASS, "ab") as f:
                while True:
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    f.write(chunk)
    threading.Thread(target=serve, daemon=True).start()


def run(h, *args, speak=FAKE, stdin=None, timeout=60):
    return subprocess.run(["/usr/bin/python3", str(TOOL), *args], capture_output=True, text=True,
                          env=env_for(h, speak), input=stdin, timeout=timeout)


def heard():
    return HEARD.read_text() if HEARD.exists() else ""


def forget():
    HEARD.unlink(missing_ok=True)


def write_settings(h, data):
    (h / ".chewbacca").mkdir(parents=True, exist_ok=True)
    (h / ".chewbacca" / "spoken-brief.json").write_text(json.dumps(data))


NOTES = TMP / "notes.txt"
NOTES.write_text("1. Today: ACAD lecture at 9 (core/now.md).\nPick up the slides at 2.\n")

# ---------- what it may say ----------
check("say's embedded commands come out of a title", "[[" not in bs.clean("Standup [[volm 9]] now") and "volm" not in bs.clean("Standup [[volm 9]] now"))
check("a file citation isn't read", "now.md" not in bs.clean("Call Roy (core/now.md)."))
check("a phone number isn't read digit by digit", bs.clean("Text +1 310 555 1234 back") == "Text a number back")
check("an email address isn't read", "an address" in bs.clean("Mail sam@example.com"))
check("a date stays a date", "2026-11-06" in bs.clean("Due 2026-11-06 at noon"))
check("markdown marks aren't read", bs.clean("- **Standup** at 9") == "Standup at 9")

for line in ("Therapy with Morgan", "Dr. Smith at 3", "thera-py", "thеrapy", "psych‍iatric intake",
             "OSAS accommodations", "WHOOP recovery 41%", "Refill meds", "slept 4h", "&#116;herapy"):
    check(f"private: {line!r}", bs.private(line), line)
check("Dough standup is not private", not bs.private("Team standup with Alex"))
for line in ("Dentist appointments", "two surgeries", "blood-work at 9", "urgent-care run", "pharmacies nearby",
             "symptoms list", "a.d.h.d. check", "slеep study", "recovering at home", "s u r g e r y"):
    check(f"private: {line!r}", bs.private(line), line)
for line in ("who opened the doc", "Team standup", "Lecture at 9", "Lab presentation"):
    check(f"not private: {line!r}", not bs.private(line), line)
check("his split private word still counts", bs.private("Lunch with Mor-gan", words=["morgan"]))
check("an empty private word matches nothing", not bs.private("Lecture at 9", words=["--"]))
for line in ("Standup [*[volm 2]*] now", "Standup [_[rate 700]_] now", "Standup [`[volm 2]`] now", "Standup [ [volm 2] ] now"):
    check(f"no say command survives in {line!r}", "[" not in bs.clean(line) and "]" not in bs.clean(line), bs.clean(line))
check("his own private words count",bs.private("Lunch with Morgan", words=["morgan"]))

kept, held = bs.lines_from_text("Dr. Smith at 3. Then call.\nLecture at 9. Then lab.")
check("a line is judged whole before it's split into sentences", kept == ["Lecture at 9.", "Then lab."] and held == 1, kept)

NOON = datetime(2026, 11, 6, 12, 0)
cal = {"available": True, "items": [
    {"summary": "Morning run", "start": "2026-11-06 08:00:00", "end": "2026-11-06 09:00:00", "all_day": False},
    {"summary": "Weekly therapy", "start": "2026-11-06 15:00:00", "end": "2026-11-06 16:00:00", "all_day": False},
    {"summary": "ACAD 185", "start": "2026-11-06 14:15:00", "end": "2026-11-06 15:00:00", "all_day": False},
    {"summary": "Team offsite", "start": "2026-11-06 00:00:00", "end": "2026-11-06 23:59:00", "all_day": True},
]}
threads = [{"with": "Alex", "last": "the plan is on, see u at 4"},
           {"with": "Jordan", "last": "my therapist said to ask"},
           {"with": "+13105551234", "last": "hey is this caleb"}]
lines, held = bs.lines_from_data(cal, threads, NOON)
said = " ".join(lines)
check("what's over isn't read", "Morning run" not in said)
check("a private title never reaches the speaker", "therapy" not in said.lower())
check("a message body never reaches the speaker", "the plan is on" not in said and "hey is this" not in said)
check("a body that reads private hides who sent it too", "Jordan" not in said)
check("a phone number thread is a number", "a number." in said and "310" not in said)
check("times are said as a clock", "2:15 PM, ACAD 185." in said)
check("a hidden item is counted out loud without saying what", "1 calendar item stays off the speaker." in said)
check("the held count covers both", held == 2, held)
only = {"available": True, "items": [cal["items"][1]]}
lines, _ = bs.lines_from_data(only, [], NOON)
check("a day of only private items never claims the calendar is empty", "Nothing left" not in " ".join(lines))
lines, _ = bs.lines_from_data({"available": True, "items": []}, [], NOON)
check("an empty day says so", lines == ["Nothing left on the calendar today."], lines)
lines, _ = bs.lines_from_data({"available": False}, [], NOON)
check("an unreadable calendar says so, never that it's empty", lines == ["I couldn't read your calendar."], lines)

# ---------- the calendar it reads ----------
import brief  # noqa: E402
import sqlite3  # noqa: E402

fix = TMP / "Calendar.sqlitedb"
db = sqlite3.connect(fix)
db.executescript("""
create table CalendarItem (summary text, start_date real, end_date real, all_day integer);
create table OccurrenceCache (day real, event_id integer, occurrence_date real, occurrence_start_date real, occurrence_end_date real);
""")
APPLE = 978307200
midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
at = lambda hour: midnight.timestamp() + hour * 3600 - APPLE
year_ago = at(10) - 365 * 86400
db.execute("insert into CalendarItem values ('Weekly lecture', ?, ?, 0)", (year_ago, year_ago + 3600))
db.execute("insert into OccurrenceCache values (?, 1, ?, ?, null)", (at(0), at(10), at(10)))
db.execute("insert into CalendarItem values ('Old one off', ?, ?, 0)", (year_ago, year_ago + 3600))
db.execute("insert into OccurrenceCache values (?, 2, ?, ?, ?)", (at(0) - 86400 * 3, year_ago, year_ago, year_ago + 3600))
db.commit()
db.close()
real_db, brief.CAL_DB = brief.CAL_DB, str(fix)
items = brief.calendar_today()["items"]
brief.CAL_DB = real_db
check("a repeating event shows up on the days it repeats", [e["summary"] for e in items] == ["Weekly lecture"], items)
check("at today's time, not the day it was first made", items and items[0]["start"].startswith(midnight.strftime("%Y-%m-%d") + " 10:00"), items)
check("and ends today, so it isn't dropped as already over", items and items[0]["end"].startswith(midnight.strftime("%Y-%m-%d") + " 11:00"), items)

# ---------- the 60 second cut ----------
long_lines = [f"Item number {i} on the list for today." for i in range(80)]
said, rest = bs.fit(long_lines)
check("a long brief is cut to the budget", sum(bs.cost(x) for x in said) <= bs.BUDGET, said)
check("digits count double", bs.cost("2:30 PM lunch") == 4)
check("the speech says where the rest went", said[-1] == bs.CLOSER)
check("nothing is lost and order holds", said[:-1] + rest == long_lines)
short = ["One line.", "Two lines."]
check("a short brief isn't touched", bs.fit(short) == (short, []))
said, rest = bs.fit(["12:30 " * 300])
check("one enormous line of digits is still cut", sum(bs.cost(x) for x in said) <= bs.BUDGET and rest and len(rest[0].split()) > 100, said)

# ---------- reading Focus ----------
def dnd(assertions=(), triggers=()):
    d = Path(tempfile.mkdtemp(dir=TMP))
    (d / "Assertions.json").write_text(json.dumps({"data": [{"storeAssertionRecords": list(assertions)}]}))
    (d / "ModeConfigurations.json").write_text(json.dumps({"data": [{"modeConfigurations": {
        "com.apple.donotdisturb.mode.default": {"mode": {"name": "Do Not Disturb"}, "triggers": {"triggers": list(triggers)}},
        "com.apple.focus.work": {"mode": {"name": "Work"}, "triggers": {"triggers": []}}}}]}))
    return d


def sched(sh, sm, eh, em, on=2):
    return {"class": "DNDModeConfigurationScheduleTrigger", "enabledSetting": on, "timePeriodStartTimeHour": sh,
            "timePeriodStartTimeMinute": sm, "timePeriodEndTimeHour": eh, "timePeriodEndTimeMinute": em}


check("no Focus reads off", bs.focus_state(dnd(), NOON) == (False, ""))
check("a manual Focus reads on, by name", bs.focus_state(dnd([{"assertionDetails": {
    "assertionDetailsModeIdentifier": "com.apple.focus.work"}}]), NOON) == (True, "Work"))
check("inside a schedule reads on", bs.focus_state(dnd(triggers=[sched(9, 0, 17, 0)]), NOON)[0] is True)
check("outside a schedule reads off", bs.focus_state(dnd(triggers=[sched(13, 0, 17, 0)]), NOON)[0] is False)
check("an overnight schedule holds past midnight", bs.focus_state(
    dnd(triggers=[sched(22, 0, 8, 0)]), datetime(2026, 11, 6, 7, 0))[0] is True)
check("an overnight schedule ends in the morning", bs.focus_state(
    dnd(triggers=[sched(22, 0, 8, 0)]), datetime(2026, 11, 6, 9, 0))[0] is False)
check("a schedule that's switched off doesn't count", bs.focus_state(dnd(triggers=[sched(0, 0, 23, 59, on=0)]), NOON)[0] is False)
check("a missing folder is unknown, never off", bs.focus_state(TMP / "nope", NOON)[0] is None)
bad = dnd()
(bad / "Assertions.json").write_text("{}")
check("a file of the wrong shape is unknown", bs.focus_state(bad, NOON)[0] is None)
odd = dnd(triggers=[{"class": "DNDModeConfigurationScheduleTrigger", "enabledSetting": 2}])
check("a schedule with missing fields is unknown", bs.focus_state(odd, NOON)[0] is None)

check("Siri's listener isn't a call", not bs.holds_the_mic("/System/Library/PrivateFrameworks/CoreSpeech.framework/corespeechd"))
check("Zoom is", bs.holds_the_mic("/Applications/zoom.us.app/Contents/MacOS/zoom.us"))
check("FaceTime's daemon is", bs.holds_the_mic("/usr/libexec/avconferenced"))
check("a process that can't be named is", bs.holds_the_mic(""))
check("the room is free", bs.blocked_by(CLEAR) == "")
for key, val, word in (("dnd", True, "Do Not Disturb"), ("mic", True, "mic"), ("audio", True, "playing"),
                       ("dnd", None, "couldn't"), ("mic", None, "couldn't"), ("audio", None, "couldn't")):
    check(f"{key}={val} keeps it quiet", word in bs.blocked_by({**CLEAR, key: val}), bs.blocked_by({**CLEAR, key: val}))
check("a probe with nothing in it keeps it quiet", bs.blocked_by({}) != "")
check("its own voice doesn't stop it", bs.blocked_by({**CLEAR, "audio": True}, speaking=True) == "")
check("a call starting mid sentence does", bs.blocked_by({**CLEAR, "mic": True}, speaking=True) != "")

# ---------- --speak end to end ----------
h = home()
room()
r = run(h, "--speak", "--from", str(NOTES))
check("--speak reads with the room free", "ACAD lecture at 9." in heard() and r.returncode == 0, r.stdout + r.stderr)
check("the citation stayed out of the speech", "now.md" not in heard())
for key, val in (("dnd", True), ("mic", True), ("audio", True), ("dnd", None), ("mic", None), ("audio", None)):
    forget()
    room(**{key: val})
    r = run(h, "--speak", "--from", str(NOTES))
    check(f"--speak stays silent with {key}={val}", heard() == "" and "silent" in r.stdout, r.stdout)
forget()
room(dnd=True, mic=True, audio=True)
run(h, "--speak", "--force", "--from", str(NOTES))
check("--force is the one way past the room", "ACAD" in heard())
forget()
secret = TMP / "secret.txt"
secret.write_text("Therapy at 3 with Morgan.\nLecture at 9.\n")
room(dnd=True)
run(h, "--speak", "--force", "--from", str(secret))
check("--force never gets past privacy", "Therapy" not in heard() and "Morgan" not in heard() and "Lecture" in heard(), heard())
forget()
room()
allpriv = TMP / "allpriv.txt"
allpriv.write_text("Therapy at 3.\n")
r = run(h, "--speak", "--from", str(allpriv))
check("nothing sayable means no sound", heard() == "" and "silent" in r.stdout, r.stdout)
forget()
r = run(h, "--print", "--from", str(NOTES))
check("--print shows the words and plays nothing", "ACAD" in r.stdout and heard() == "")
r = run(h, "--speak", "--from", str(TMP / "missing.txt"))
check("a missing --from file is a clear error", r.returncode != 0 and "couldn't read" in r.stderr and heard() == "")
r = run(h, "--speak", "--from", "-", stdin="Lecture at 9.\n")
check("--from - reads stdin", "Lecture at 9." in heard())
forget()
r = run(h, "--speak", "--from", str(NOTES), speak=TMP / "no-such-voice")
check("a voice that won't start fails loudly", r.returncode == 1 and "failed" in r.stdout, r.stdout)
forget()
garbage = TMP / "garbage.txt"
garbage.write_bytes(b"12345\n---\n\n!!!\n")
r = run(h, "--speak", "--from", str(garbage))
check("text with no words stays silent", heard() == "" and r.returncode == 0, r.stdout + r.stderr)
binary = TMP / "binary.dat"
binary.write_bytes(bytes(range(256)) * 20)
r = run(h, "--print", "--from", str(binary))
check("binary input is no traceback", r.returncode == 0 and "Traceback" not in r.stderr, r.stderr[-200:])
r = run(h, "--print", "--from", "-", stdin="�")
check("binary on stdin is no traceback either", r.returncode == 0 and "Traceback" not in r.stderr, r.stderr[-200:])
r = run(h, "--print", "--from", str(TMP))
check("a folder as input is a clear error", r.returncode != 0 and "couldn't read" in r.stderr, r.stderr[-200:])
hostile = TMP / "hostile.txt"
hostile.write_text('$(touch pwned); `touch pwned` [[rate 700]] "; touch pwned; "\n')
forget()
r = run(h, "--speak", "--from", str(hostile))
check("a hostile line is only ever text", not (Path.cwd() / "pwned").exists() and "[[" not in heard(), heard())
forget()

# ---------- a long brief, and the glass ----------
fake_glass()
long_file = TMP / "long.txt"
long_file.write_text("\n".join([f"Item number {i} on the list for today." for i in range(60)]
                               + ["Weekly therapy with Morgan at 3."]))
r = run(h, "--speak", "--from", str(long_file))
for _ in range(30):
    if GLASS.exists():
        break
    time.sleep(0.1)
said_cost = bs.cost(heard())
glass = GLASS.read_text() if GLASS.exists() else ""
check("a long brief is cut in the voice", said_cost <= bs.BUDGET and bs.CLOSER in heard(), said_cost)
check("a line that didn't fit is not spoken", "Item number 40" not in heard())
r2 = run(h, "--speak", "--from", str(NOTES))
check("a short brief leaves the glass alone", "ACAD" in heard())
first_left = re.search(r"Item number \d+", glass)
check("the rest lands on the glass", first_left is not None and first_left.group() + " " not in heard()
      and "REST OF THE BRIEF" in glass and "more lines in chewie brief" in glass, glass[:200])
check("private lines stay off the glass too", "therapy" not in glass.lower() and "therapy" not in heard().lower())
check("the glass panel isn't a wall of text", surface_lint.lint(glass.splitlines()) == [], surface_lint.lint(glass.splitlines()))
check("the stdout counts what was held", "1 private" in r.stdout, r.stdout[-200:])
forget()

# ---------- stopping it ----------
room()
proc = subprocess.Popen(["/usr/bin/python3", str(TOOL), "--speak", "--from", str(NOTES)], env=env_for(h, SLOW),
                        stdout=subprocess.PIPE, text=True)
for _ in range(50):
    if heard():
        break
    time.sleep(0.1)
room(mic=True)
try:
    out = proc.communicate(timeout=15)[0]
except subprocess.TimeoutExpired:
    proc.kill()
    out = "timed out"
check("a call starting mid sentence stops the speech", "stopped" in out and "mic" in out, out)
forget()
room()
proc = subprocess.Popen(["/usr/bin/python3", str(TOOL), "--speak", "--from", str(NOTES)], env=env_for(h, SLOW),
                        stdout=subprocess.PIPE, text=True)
for _ in range(50):
    if heard():
        break
    time.sleep(0.1)
second = run(h, "--speak", "--from", str(NOTES))
check("two at once never overlap", "already being read" in second.stdout, second.stdout)
r = run(h, "--hush")
try:
    out = proc.communicate(timeout=15)[0]
except subprocess.TimeoutExpired:
    proc.kill()
    out = "timed out"
check("--hush stops it", "hushed" in r.stdout and "hushed" in out, r.stdout + out)
forget()
r = run(home(), "--hush")
check("--hush with nothing playing is calm", r.returncode == 0 and "quiet" in r.stdout, r.stdout)

# ---------- the morning run ----------
now = datetime.now()
in_band = (now.hour == 23 and now.minute >= 50) or (now.hour == 0 and now.minute < 10)
h = home()
room()
r = run(h, "--speak-tick")
check("with no settings the morning run is off", heard() == "" and "off" in r.stdout, r.stdout)
r = run(h, "--speak-auto", "status")
check("status reads off out of the box", "off" in r.stdout, r.stdout)
check("nothing is scheduled out of the box", not (h / "daemon" / "services" / "spoken-brief.json").exists())
write_settings(h, {"enabled": "yes", "at": "00:00"})
run(h, "--speak-tick")
check("only a real true turns it on", heard() == "")
(h / ".chewbacca" / "spoken-brief.json").write_text("{broken")
run(h, "--speak-tick")
check("a broken settings file is off", heard() == "")

if not in_band:
    past = (now - timedelta(minutes=1)).strftime("%H:%M")
    soon = (now + timedelta(minutes=2)).strftime("%H:%M")
    write_settings(h, {"enabled": True, "at": soon})
    r = run(h, "--speak-tick")
    check("before its time, nothing", heard() == "" and "waiting" in r.stdout, r.stdout)
    write_settings(h, {"enabled": True, "at": past})
    for key, val in (("dnd", True), ("mic", True), ("audio", True), ("dnd", None), ("idle_s", None), ("idle_s", 9999)):
        room(**{key: val})
        r = run(h, "--speak-tick")
        check(f"the morning run waits with {key}={val}", heard() == "" and "waiting" in r.stdout, r.stdout)
    room()
    r = run(h, "--speak-tick")
    # HOME is empty here, so the brief is "I couldn't read your calendar."
    check("once the room frees up it speaks", "calendar" in heard(), r.stdout + r.stderr)
    count = heard().count("brief")
    r = run(h, "--speak-tick")
    check("and only once a day", heard().count("brief") == count and "done" in r.stdout, r.stdout)
    forget()

    h2 = home()
    write_settings(h2, {"enabled": True, "at": past})
    (h2 / ".chewbacca" / "spoken-brief-state.json").write_text(json.dumps(
        {"date": now.strftime("%Y-%m-%d"), "outcome": "speaking"}))
    run(h2, "--speak-tick")
    check("a crash mid sentence isn't read again", heard() == "")
    h3 = home()
    write_settings(h3, {"enabled": True, "at": past})
    run(h3, "--hush")
    run(h3, "--speak-tick")
    check("--hush holds for the rest of today", heard() == "")
    if now.hour >= 4:
        h4 = home()
        write_settings(h4, {"enabled": True, "at": (now - timedelta(hours=4)).strftime("%H:%M")})
        r = run(h4, "--speak-tick")
        check("a 2pm good morning never happens", heard() == "" and "missed" in r.stdout, r.stdout)
else:
    print("skip the time of day checks within ten minutes of midnight")

# ---------- turning it on and off ----------
h = home()
r = run(h, "--speak-auto", "on", "--at", "25:99")
check("a bad time is refused and stays off", r.returncode != 0 and not (h / ".chewbacca" / "spoken-brief.json").exists(), r.stdout + r.stderr)
write_settings(h, {"enabled": False, "private_words": ["morgan"]})
r = run(h, "--speak-auto", "on", "--at", "08:15")
service = h / "daemon" / "services" / "spoken-brief.json"
check("on schedules one service", r.returncode == 0 and service.exists(), r.stdout + r.stderr)
saved = json.loads((h / ".chewbacca" / "spoken-brief.json").read_text())
check("on saves the time and keeps his private words", saved.get("enabled") is True and saved.get("at") == "08:15" and saved.get("private_words") == ["morgan"], saved)
argv = json.loads(service.read_text()).get("argv", []) if service.exists() else []
check("the service runs the tick", argv[-1:] == ["--speak-tick"] and "brief_speak.py" in " ".join(argv), argv)
r = run(h, "--speak-auto", "off")
check("off removes the service", not service.exists() and json.loads((h / ".chewbacca" / "spoken-brief.json").read_text())["enabled"] is False)
env = env_for(h)
env["PATH"] = f"{TRAP}:/usr/bin:/bin"  # no node, so the daemon can't register
h5 = home()
env.update(HOME=str(h5), CHEWBACCA_DAEMON_DIR=str(h5 / "daemon"))
r = subprocess.run(["/usr/bin/python3", str(TOOL), "--speak-auto", "on"], capture_output=True, text=True, env=env)
check("if it can't be scheduled it says so and stays off", r.returncode != 0 and "stays off" in r.stderr
      and not (h5 / ".chewbacca" / "spoken-brief.json").exists(), r.stdout + r.stderr)

# ---------- the commands people type ----------
h = home()
room()
forget()
env = env_for(h)
r = subprocess.run([str(CHEWIE), "brief", "--speak", "--from", str(NOTES)], capture_output=True, text=True, env=env)
check("chewie brief --speak reads", "ACAD" in heard(), r.stdout + r.stderr)
forget()
r = subprocess.run([str(CHEWIE), "--dry-run", "brief", "--speak", "--force", "--from", str(NOTES)], capture_output=True, text=True, env=env)
check("chewie --dry-run shows the words and can't speak", "ACAD" in r.stdout and heard() == "", r.stdout + r.stderr)
r = subprocess.run([str(CHEWIE), "--dry-run", "brief", "--speak-auto", "on"], capture_output=True, text=True, env=env)
check("chewie --dry-run can't turn it on", "dry-run" in r.stdout and not (h / ".chewbacca" / "spoken-brief.json").exists(), r.stdout)
r = subprocess.run([str(CHEWIE), "--json", "brief", "--print", "--from", str(NOTES)], capture_output=True, text=True, env=env)
check("--json still parses", json.loads(r.stdout).get("outcome", "").startswith("printed"), r.stdout)
r = subprocess.run([str(CHEWIE), "--dry-run", "brief"], capture_output=True, text=True, env=env)
check("plain chewie brief is unchanged", "brief.py" in r.stdout, r.stdout)
r = subprocess.run([str(ROOT / "bin" / "chewbacca"), "brief", "--print", "--from", str(NOTES)], capture_output=True, text=True, env=env)
check("chewbacca brief is the same command", "ACAD" in r.stdout and r.returncode == 0, r.stdout + r.stderr)
r = subprocess.run([str(ROOT / "bin" / "chewbacca"), "--help"], capture_output=True, text=True, env=env)
check("chewbacca --help lists it", re.search(r"\bbrief\b", r.stdout) is not None)

# ---------- one real render, to a file, no speakers ----------
SAY = "/usr/bin/say"
if shutil.which(SAY) and shutil.which("/usr/bin/afinfo"):
    def length(text):
        out = TMP / "render.aiff"
        out.unlink(missing_ok=True)
        subprocess.run([SAY, "-o", str(out), text], check=True, timeout=120)
        m = re.search(r"estimated duration: ([\d.]+)", subprocess.run(
            ["/usr/bin/afinfo", str(out)], capture_output=True, text=True).stdout)
        return float(m.group(1))

    # Real lines, so the times and names the budget was measured on are in it.
    lines = [f"{h_}:30 PM, ACAD {100 + i} lecture with the design team." for i, h_ in enumerate(range(1, 13))] * 6
    said, rest = bs.fit(["Here's your brief."] + lines)
    cut = " ".join(said)
    seconds = length(cut)
    full = length(" ".join(lines[:60]))
    print(f"     real say render: count {bs.cost(cut)}, {seconds:.1f} s, {bs.cost(cut) / seconds:.2f} count/s; uncut 60 lines {full:.1f} s")
    check("the cut brief renders under 60 s", seconds <= 60, seconds)
    check("and still uses most of them", seconds >= 35, seconds)
    check("the uncut one would have run far over", full > 120, full)
    check("audio length tracks the count the cut uses", 2.3 <= bs.cost(cut) / seconds <= 3.3, seconds)

check("nothing in this suite reached a real speaker", not REAL_SOUND.exists(), REAL_SOUND.read_text() if REAL_SOUND.exists() else "")
shutil.rmtree(TMP, ignore_errors=True)


def test_nothing_failed():
    """For a pytest run, which imports this file and then needs a test to call."""
    assert failed == 0


if __name__ == "__main__":
    sys.exit(1 if failed else 0)
