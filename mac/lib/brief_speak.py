#!/usr/bin/env python3
"""Read the morning brief out loud, without ever talking by surprise.

    chewie brief --speak [--force] [--from FILE|-]   read it now
    chewie brief --print [--from FILE|-]             show what would be said, no sound
    chewie brief --speak-auto on [--at HH:MM]        read it each morning (off until this runs)
    chewie brief --speak-auto off|status
    chewie brief --hush                              stop it mid sentence, and for today

This Mac can sit in a shared dorm room, so sound is the exception here. Nothing plays unless a
person asked for it, Do Not Disturb or any other Focus is off, nothing holds the
mic, nothing is already playing, and, on the morning run, someone touched the
Mac in the last few minutes. A check that can't be read counts as a no. A call
or a Focus that starts mid sentence stops the speech.

What gets said comes from the same places as `chewie brief`, read by a different
rule: calendar titles and the names of who's waiting on a reply. Message bodies,
WHOOP numbers and anything meeting_privacy or the words below call private never
reach the speaker or the glass. Mail isn't read at all, since touching it opens
Mail.app. The 07:30 morning-brief job's prose isn't spoken on its own either: it
is free text from private notes. Pipe it through --from to hear it, and it goes
through the same line by line filter.

--force skips the room checks for one spoken request. Privacy and the 60 second
cut still apply, and the morning run never forces.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import textwrap
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
# Fails loudly on purpose. No privacy check means no speech.
sys.path.insert(0, str(ROOT / "bin" / "lib"))
from meeting_privacy import CONFUSABLES, _letters, decode, is_private  # noqa: E402

# Length is counted with a token holding a digit as two, because "2:30" takes
# longer to say than "lunch". Measured 2026-11-06 on a 148 count brief: Kokoro, the
# default voice, 62.0 s (2.39 a second), `say` 51.7 s (2.86). A calendar-heavy one,
# 154 count, `say` 56.1 s (2.74). Plain word counts swung between 2.25 and 2.67 on
# the same voice, which is why this isn't one. The slower voice sets the budget:
# 60 s at 2.39 is 143, and `say` lands around 50 s.
BUDGET = 143
CLOSER = "The rest is on the glass."

# Words meeting_privacy doesn't carry, because a meeting title rarely says them
# and a spoken line about someone's body shouldn't reach a roommate. A list, so
# it misses things; `private_words` in the settings file adds his own.
HEALTH = re.compile(
    r"\b(meds?|whoop\w*|hrv|recover\w*|sleep\w*|slept|appts?|sick\w*|stds?|stis?)\b", re.I)
# Searched with every non-letter removed, the way meeting_privacy's STEMS are, so
# "appointments", "surgeries" and "blood-work" are caught. Long enough not to form
# by accident across a word gap, which is why "whoop" stays above: "who opened".
HEALTH_STEMS = ("appointment", "pharmac", "refill", "surger", "urgentcare", "bloodwork", "bloodtest",
                "labresult", "biops", "symptom", "insomni", "anxiet", "depress", "adhd", "autis", "bipolar",
                "adderall", "vyvanse", "lexapro", "zoloft", "prozac")

# Texts hold a person's number or address when Contacts has no name for them.
PHONE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# `say` obeys [[volm 2]], [[rate 500]] and friends found in its text, and a
# calendar title is written by whoever sent the invite.
SAY_COMMAND = re.compile(r"\[\[.*?\]\]|\[\[|\]\]", re.S)
# The morning-brief job cites files in parentheses, as its prompt tells it to.
FILE_CITE = re.compile(r"\((?:[\w./ -]+\.(?:md|txt|json|ya?ml)(?:[,; ]+)?)+\)")
URL = re.compile(r"https?://\S+|www\.\S+")

# How long the morning run keeps trying after its time. Past this the Mac was
# asleep or he never sat down, and a 2pm "here's your morning" is the surprise
# this exists to prevent. Guessed, never measured.
WINDOW_S = 3 * 3600
# "Someone is here" for the morning run. A closed lid with Power Nap or an empty
# room reads longer than this. Guessed, never measured.
PRESENT_IDLE_S = 300
# Longest a spoken run may take: 60 s of speech, plus Kokoro's cold start, which
# took about 50 s of the 111 s wall clock measured at load 93 on 2026-11-06.
SPEECH_TIMEOUT_S = 180
POLL_S = 1.0
# Siri's listener opens the input as soon as anything plays. On 2026-11-06 a silent
# afplay put corespeechd on the mic within 2 s and it let go when afplay stopped,
# so without this the brief hears its own voice as a call and stops itself.
SYSTEM_LISTENERS = {"corespeechd"}

KOKORO = Path.home() / ".cache" / "huggingface" / "hub" / "models--mlx-community--Kokoro-82M-bf16"
AUDIO_LIB = "/System/Library/Frameworks/CoreAudio.framework/CoreAudio"
SERVICE = "spoken-brief"


def state_dir() -> Path:
    return Path.home() / ".chewbacca"


def settings_path() -> Path:
    return state_dir() / "spoken-brief.json"


def _write_private(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def load_settings() -> dict:
    """Off unless the file plainly says on. A broken file is off."""
    try:
        data = json.loads(settings_path().read_text())
    except (OSError, ValueError):
        return {"enabled": False, "at": "07:30", "private_words": []}
    if not isinstance(data, dict):
        return {"enabled": False, "at": "07:30", "private_words": []}
    at = data.get("at")
    words = data.get("private_words")
    return {
        "enabled": data.get("enabled") is True,
        "at": at if isinstance(at, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", at) else "07:30",
        "private_words": [w for w in words if isinstance(w, str) and w.strip()] if isinstance(words, list) else [],
        "speak_cmd": data.get("speak_cmd") if isinstance(data.get("speak_cmd"), str) else "",
    }


def clean(text) -> str:
    """One line as it should sound. Nothing here decides what's private."""
    out = decode(text)
    out = SAY_COMMAND.sub(" ", out)
    out = FILE_CITE.sub(" ", out)
    out = URL.sub("a link", out)
    # Ten digits, so 2026-11-06 stays a date and only a real phone number goes.
    out = PHONE.sub(lambda m: "a number" if sum(c.isdigit() for c in m.group()) >= 10 else m.group(), out)
    out = EMAIL.sub("an address", out)
    out = re.sub(r"^\s*(?:[-*+>#]+|\d+[.)])\s+", "", out)
    out = re.sub(r"[*_`#|]", "", out)
    # Last, and every bracket: `[*[volm 2]*]` only becomes a say command once the
    # stars above are gone, so a check before this step can't see it.
    out = re.sub(r"[\[\]]", " ", out)
    out = re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"\s+", " ", out)).strip()
    return out if re.search(r"[^\W\d_]", out) else ""


def private(*texts, words=()) -> bool:
    if is_private(*texts):
        return True
    for t in texts:
        folded = decode(t).translate(CONFUSABLES).casefold()
        letters = _letters(folded)
        if HEALTH.search(folded) or any(s in letters for s in HEALTH_STEMS):
            return True
        if any(_letters(w.casefold()) and _letters(w.casefold()) in letters for w in words):
            return True
    return False


def lines_from_text(text: str, words=()):
    """(what may be said, lines held back) from free text, one sentence per item.

    The whole line is judged before it's split: split first and "Dr. Smith at 3"
    becomes "Dr." and "Smith at 3", and neither half reads as private.
    """
    kept, held = [], 0
    for line in str(text or "").splitlines():
        if not line.strip():
            continue
        if private(line, clean(line), words=words):
            held += 1
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", line):
            said = clean(sentence)
            if said:
                kept.append(said)
    return kept, held


def _clock(stamp: str) -> str:
    try:
        t = datetime.strptime(stamp[:16], "%Y-%m-%d %H:%M")
    except ValueError:
        return ""
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}".replace(":00 ", " ")


def lines_from_data(calendar: dict, threads, now: datetime, words=()):
    """Spoken lines from the same data `chewie brief` reads, plus a held count.

    A held item still counts, out loud, without saying what it is: "nothing on
    the calendar" over a hidden 3pm would send him past his own appointment.
    """
    lines, held = [], 0
    if not calendar.get("available"):
        lines.append("I couldn't read your calendar.")
    else:
        stamp = now.strftime("%Y-%m-%d %H:%M:%S")
        said, hidden = [], 0
        for e in calendar.get("items", []):
            if not e.get("all_day") and str(e.get("end", "")) and str(e.get("end")) < stamp:
                continue
            title = clean(e.get("summary"))
            if private(e.get("summary"), title, words=words) or not title:
                hidden += 1
                continue
            when = "All day" if e.get("all_day") else _clock(str(e.get("start", "")))
            said.append(f"{when}, {title}." if when else f"{title}.")
        held += hidden
        if not said and not hidden:
            lines.append("Nothing left on the calendar today.")
        lines.extend(said)
        if hidden:
            lines.append(f"{hidden} calendar {'item stays' if hidden == 1 else 'items stay'} off the speaker.")
    names, hidden = [], 0
    for t in threads or []:
        who = clean(t.get("with"))
        if not who or private(t.get("with"), t.get("last"), words=words):
            hidden += 1
        else:
            names.append(who)
    held += hidden
    if names:
        lines.append(f"{len(names)} {'text is' if len(names) == 1 else 'texts are'} waiting on you.")
        lines.extend(who if who[-1] in ".!?" else f"{who}." for who in names)
    if hidden:
        lines.append(f"{hidden} more {'thread stays' if hidden == 1 else 'threads stay'} off the speaker.")
    return lines, held


def cost(text: str) -> int:
    return sum(2 if any(c.isdigit() for c in tok) else 1 for tok in text.split())


def fit(lines, budget=BUDGET):
    """(said, rest). Cuts between lines, in order, so nothing is read out of turn."""
    if sum(cost(x) for x in lines) <= budget:
        return list(lines), []
    room = budget - cost(CLOSER)
    said, used = [], 0
    for i, line in enumerate(lines):
        n = cost(line)
        if used + n > room:
            if said:
                return said + [CLOSER], list(lines[i:])
            # One enormous line with no sentence to cut at. Half the room in
            # tokens always fits, digits or not.
            words = line.split()
            keep = room // 2
            return [" ".join(words[:keep]), CLOSER], [" ".join(words[keep:])] + list(lines[i + 1:])
        said.append(line)
        used += n
    return said + [CLOSER], []


def gather(settings: dict, source=None):
    words = settings.get("private_words", [])
    if source is not None:
        return lines_from_text(source, words)
    from brief import calendar_today  # not at the top: tests of the rest need no chat.db
    from texts import read as read_texts
    threads = {}
    try:
        for m in read_texts(days=1, unanswered=True, direct=True):
            if not m["from_me"] and m["text"] != "[attachment]":
                threads[m["with"]] = m
    except (Exception, SystemExit):  # an unreadable chat.db is a shorter brief, not a crash
        threads = {}
    rows = [{"with": k, "last": v["text"]} for k, v in threads.items()]
    return lines_from_data(calendar_today(), rows, datetime.now(), words)


def focus_state(folder: Path, now: datetime):
    """(on, name). on is None when it can't be told. Any Focus counts, because
    each is someone saying don't interrupt, and a wrong yes here is silence."""
    try:
        asserts = json.loads((folder / "Assertions.json").read_text())["data"][0]
        modes = json.loads((folder / "ModeConfigurations.json").read_text())["data"][0]["modeConfigurations"]
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return None, ""
    try:
        for rec in asserts.get("storeAssertionRecords") or []:
            mode = rec.get("assertionDetails", {}).get("assertionDetailsModeIdentifier", "")
            return True, modes.get(mode, {}).get("mode", {}).get("name") or "Focus"
        minute = now.hour * 60 + now.minute
        for cfg in modes.values():
            for t in cfg.get("triggers", {}).get("triggers", []):
                # A schedule is enabledSetting 2 with no assertion written. The
                # weekday mask's bit order isn't documented, so a schedule counts
                # every day: the wrong direction is only silence.
                if t.get("class") != "DNDModeConfigurationScheduleTrigger" or t.get("enabledSetting") != 2:
                    continue
                start = t["timePeriodStartTimeHour"] * 60 + t["timePeriodStartTimeMinute"]
                end = t["timePeriodEndTimeHour"] * 60 + t["timePeriodEndTimeMinute"]
                inside = start <= minute < end if start <= end else (minute >= start or minute < end)
                if inside:
                    return True, cfg.get("mode", {}).get("name") or "Focus"
    except (AttributeError, KeyError, TypeError):
        return None, ""
    return False, ""


def audio_state():
    """(mic in use, sound playing), each None when CoreAudio won't say.

    Per process first (macOS 14.4+), because a Zoom on a USB mic isn't on the
    default input. The default devices are checked too, for an older Mac. Neither
    needs a mic permission. On 2026-11-06 both read false with hud-listen running,
    so Kyber sitting idle doesn't hold either one open. The process list wins when
    it can be read, since it knows about every device and who is who.
    """
    import ctypes
    import struct
    try:
        lib = ctypes.CDLL(AUDIO_LIB)
    except OSError:
        return None, None

    class Addr(ctypes.Structure):
        _fields_ = [("sel", ctypes.c_uint32), ("scope", ctypes.c_uint32), ("elem", ctypes.c_uint32)]

    def code(s):
        return struct.unpack(">I", s.encode())[0]

    def u32(obj, sel):
        addr, size, val = Addr(code(sel), code("glob"), 0), ctypes.c_uint32(4), ctypes.c_uint32(0)
        st = lib.AudioObjectGetPropertyData(obj, ctypes.byref(addr), 0, None, ctypes.byref(size), ctypes.byref(val))
        return val.value if st == 0 else None

    system = 1
    mic = sound = None
    for sel, which in (("dIn ", "mic"), ("dOut", "sound")):
        dev = u32(system, sel)
        running = u32(dev, "gone") if dev else None
        if running is not None:
            if which == "mic":
                mic = bool(running)
            else:
                sound = bool(running)
    addr, size = Addr(code("prs#"), code("glob"), 0), ctypes.c_uint32(0)
    if lib.AudioObjectGetPropertyDataSize(system, ctypes.byref(addr), 0, None, ctypes.byref(size)) == 0 and size.value:
        objs = (ctypes.c_uint32 * (size.value // 4))()
        if lib.AudioObjectGetPropertyData(system, ctypes.byref(addr), 0, None, ctypes.byref(size), objs) == 0:
            mic = sound = False
            for obj in objs:
                sound = sound or u32(obj, "piro") == 1
                if u32(obj, "piri") == 1 and not mic:
                    mic = holds_the_mic(_command(u32(obj, "ppid")))
    return mic, sound


def holds_the_mic(command: str) -> bool:
    """Whether a process on the input is someone using the mic. Unknown counts."""
    return Path(command).name not in SYSTEM_LISTENERS


def _command(pid) -> str:
    try:
        return subprocess.run(["ps", "-o", "comm=", "-p", str(pid)], capture_output=True, text=True,
                              timeout=2).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def idle_seconds():
    try:
        out = subprocess.run(["ioreg", "-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r'"HIDIdleTime" = (\d+)', out)
    return int(m.group(1)) / 1e9 if m else None


def probe() -> dict:
    """{dnd, focus, mic, audio, idle_s}. CHEWIE_BRIEF_PROBE names a JSON file to
    read instead, reread on every poll so a test can start a "call" mid sentence."""
    fake = os.environ.get("CHEWIE_BRIEF_PROBE")
    if fake:
        try:
            data = json.loads(Path(fake).read_text())
        except (OSError, ValueError):
            data = {}
        return {k: data.get(k) for k in ("dnd", "focus", "mic", "audio", "idle_s")}
    on, name = focus_state(Path(os.environ.get("CHEWIE_DND_DIR") or Path.home() / "Library/DoNotDisturb/DB"),
                           datetime.now())
    mic, audio = audio_state()
    return {"dnd": on, "focus": name, "mic": mic, "audio": audio, "idle_s": idle_seconds()}


def blocked_by(state: dict, speaking: bool = False) -> str:
    """Why to stay quiet, or "". While speaking, sound isn't checked: it's us."""
    if state.get("dnd") is not False:
        if state.get("dnd") is None:
            return "couldn't read Do Not Disturb"
        return f"{state.get('focus') or 'Do Not Disturb'} is on"
    if state.get("mic") is not False:
        return "couldn't read the mic" if state.get("mic") is None else "something is using the mic"
    if not speaking and state.get("audio") is not False:
        return "couldn't read audio output" if state.get("audio") is None else "audio is already playing"
    return ""


def speak_command(text: str, settings: dict):
    custom = os.environ.get("CHEWIE_SPEAK_CMD") or settings.get("speak_cmd")
    if custom:
        return shlex.split(custom) + [text]
    voice = ROOT / "bin" / "hud-speak"
    # Only with the model already here: a first run downloads it, and a voice
    # that starts minutes late is a surprise of its own.
    if voice.exists() and shutil.which("uv", path=_path()) and KOKORO.exists():
        return [str(voice), f"--say={text}"]
    return ["say", text]


def _path() -> str:
    home = str(Path.home())
    return os.pathsep.join([os.environ.get("PATH", ""), f"{home}/.local/bin", "/opt/homebrew/bin", "/usr/bin"])


class Hushed(Exception):
    pass


def _hush(_sig, _frame):
    raise Hushed()


def play(text: str, settings: dict, watch: bool):
    """(outcome, reason). outcome is spoke, stopped, hushed or failed."""
    env = dict(os.environ, PATH=_path())
    outcome, reason, proc = "spoke", "", None
    deadline = time.monotonic() + SPEECH_TIMEOUT_S
    signal.signal(signal.SIGTERM, _hush)
    try:
        try:
            proc = subprocess.Popen(speak_command(text, settings), start_new_session=True, env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, ValueError) as e:
            return "failed", f"couldn't start the voice: {e}"
        while True:
            try:
                rc = proc.wait(timeout=POLL_S)
                if rc != 0:
                    outcome, reason = "failed", f"the voice exited {rc}"
                return outcome, reason
            except subprocess.TimeoutExpired:
                pass
            if time.monotonic() > deadline:
                outcome, reason = "failed", f"still talking after {SPEECH_TIMEOUT_S} s"
                break
            why = blocked_by(probe(), speaking=True) if watch else ""
            if why:
                outcome, reason = "stopped", why
                break
    except Hushed:
        outcome, reason = "hushed", "asked to stop"
    if proc is not None:
        _stop(proc)
    return outcome, reason


def _stop(proc) -> None:
    for sig, wait in ((signal.SIGTERM, 2), (signal.SIGKILL, 2)):
        try:
            os.killpg(proc.pid, sig)
        except OSError:
            return
        try:
            proc.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def to_glass(rest) -> bool:
    """What didn't fit, on the glass. Short rows, per bin/lib/surface_lint.py."""
    rows = []
    for line in rest:
        rows.extend(textwrap.wrap(line, 66) or [])
    # surface_lint allows 7 text rows in a run, and the "more" row is one of them.
    extra = max(0, len(rows) - 6)
    rows = rows[:6]
    if extra:
        rows.append(f"And {extra} more lines in chewie brief")
    ops = ["@ brief-rest at=topRight w=380", 'c s Screen title="REST OF THE BRIEF"', "r s"]
    ids = []
    for i, row in enumerate(rows):
        ids.append(f"t{i}")
        ops.append(f"c t{i} Text value={json.dumps(row, ensure_ascii=False)}")
    ops.append("> s " + " ".join(ids))
    try:
        r = subprocess.run([str(ROOT / "bin" / "hud"), "draw"], input="\n".join(ops) + "\n", text=True,
                           capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0


def record(**fields) -> None:
    _write_private(state_dir() / "spoken-brief-state.json", dict(fields, at=datetime.now().isoformat(timespec="minutes")))


def read_record() -> dict:
    try:
        data = json.loads((state_dir() / "spoken-brief-state.json").read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def take_lock():
    state_dir().mkdir(parents=True, exist_ok=True)
    fd = os.open(state_dir() / "spoken-brief.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    os.ftruncate(fd, 0)
    os.write(fd, str(os.getpid()).encode())
    return fd


def run_speak(settings, source, force, morning=False) -> dict:
    lines, held = gather(settings, source)
    if not lines:
        return {"outcome": "silent", "reason": "nothing that can be said out loud", "held": held}
    said, rest = fit(["Here's your brief."] + lines)
    text = " ".join(said)
    result = {"said": text, "rest": rest, "held": held, "seconds": round(cost(text) * 60 / BUDGET)}
    fd = take_lock()
    if fd is None:
        return dict(result, outcome="silent", reason="the brief is already being read")
    if morning:
        # Before the first word: a crash mid sentence must not read it again.
        record(date=datetime.now().strftime("%Y-%m-%d"), outcome="speaking", held=held)
    if rest and not to_glass(rest):
        result["glass"] = False
    outcome, reason = play(text, settings, watch=not force)
    os.close(fd)
    return dict(result, outcome=outcome, reason=reason)


def cmd_tick() -> dict:
    """The morning run the daemon calls. Off, too early, too late, already done,
    nobody here, room busy: each one exits without a sound."""
    settings = load_settings()
    if not settings["enabled"]:
        return {"outcome": "off"}
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    last = read_record()
    if last.get("date") == today and last.get("done"):
        return {"outcome": "done", "reason": "already handled today"}
    if last.get("date") == today and last.get("outcome") == "speaking":
        return {"outcome": "done", "reason": "started once today"}
    hour, minute = (int(x) for x in settings["at"].split(":"))
    start = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now < start:
        return {"outcome": "waiting", "reason": f"not {settings['at']} yet"}
    if now > start + timedelta(seconds=WINDOW_S):
        record(date=today, done=True, outcome="missed", reason="the morning passed without a free moment")
        return {"outcome": "missed"}
    state = probe()
    idle = state.get("idle_s")
    why = "couldn't tell if anyone is at the Mac" if idle is None else (
        "nobody is at the Mac" if idle > PRESENT_IDLE_S else blocked_by(state))
    if why:
        record(date=today, outcome="waiting", reason=why)
        return {"outcome": "waiting", "reason": why}
    out = run_speak(settings, None, force=False, morning=True)
    record(date=today, done=True, outcome=out["outcome"], reason=out.get("reason", ""), held=out.get("held", 0))
    return {k: v for k, v in out.items() if k in ("outcome", "reason", "held", "seconds")}


def daemon(*args) -> subprocess.CompletedProcess:
    return subprocess.run([str(ROOT / "bin" / "chewbacca-daemon"), *args], capture_output=True, text=True, timeout=30)


def tick_path() -> str:
    """The kit's stable copy, never a checkout (team memory: feedback_services_run_from_the_kit)."""
    kit = Path.home() / ".chewbacca" / "kit" / "current" / "mac" / "lib" / "brief_speak.py"
    return str(kit if kit.exists() else Path(__file__).resolve())


def cmd_auto(mode: str, at) -> dict:
    current = load_settings()
    if mode == "status":
        return {"enabled": current["enabled"], "at": current["at"], "last": read_record()}
    if at and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", at):
        raise SystemExit("--at needs HH:MM, like 07:30")
    # Keep what's in the file (private_words, speak_cmd), and only touch these two.
    try:
        data = json.loads(settings_path().read_text())
        data = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        data = {}
    data.update(enabled=mode == "on", at=at or current["at"])
    if mode == "on":
        r = daemon("register", SERVICE, "--every", "300", "--nice", "10", "--",
                   "/usr/bin/python3", tick_path(), "--speak-tick")
        if r.returncode != 0:
            raise SystemExit(f"couldn't schedule it, so it stays off: {(r.stderr or r.stdout).strip()}")
        _write_private(settings_path(), data)
    else:
        # The file first: the tick reads it, so even a registration that lingers can't talk.
        _write_private(settings_path(), data)
        daemon("unregister", SERVICE)
    return {"enabled": data["enabled"], "at": data["at"]}


def cmd_hush() -> dict:
    """Stops whoever holds the lock, and today's morning run with it. Holding the
    lock proves the pid is really ours, so a recycled pid is never signalled."""
    today = datetime.now().strftime("%Y-%m-%d")
    fd = take_lock()
    if fd is not None:
        os.close(fd)
        record(date=today, done=True, outcome="hushed", reason="asked to stop")
        return {"outcome": "quiet", "reason": "nothing was being read"}
    try:
        pid = int((state_dir() / "spoken-brief.lock").read_text().strip())
        os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError) as e:
        return {"outcome": "failed", "reason": str(e)}
    return {"outcome": "hushed"}


def report(out: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return
    if "enabled" in out:
        print(f"spoken brief: {'on' if out['enabled'] else 'off'}, at {out['at']}")
        last = out.get("last") or {}
        if last:
            print(f"last run: {last.get('at', '?')} {last.get('outcome', '?')} {last.get('reason', '')}".rstrip())
        return
    if out.get("said"):
        print(out["said"])
    for line in out.get("rest") or []:
        print(f"  not spoken: {line}")
    if out.get("glass") is False:
        print("  the glass isn't up, so the rest is only here")
    if out.get("held"):
        print(f"  {out['held']} private, not spoken and not on the glass (chewie brief has them)")
    print(f"{out.get('outcome', '?')}{': ' + out['reason'] if out.get('reason') else ''}")


def main() -> int:
    ap = argparse.ArgumentParser(prog="chewie brief", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    what = ap.add_mutually_exclusive_group(required=True)
    what.add_argument("--speak", action="store_true")
    what.add_argument("--print", action="store_true", dest="show")
    what.add_argument("--speak-auto", choices=["on", "off", "status"])
    what.add_argument("--speak-tick", action="store_true")
    what.add_argument("--hush", action="store_true")
    ap.add_argument("--force", action="store_true", help="skip the room checks for this one request")
    ap.add_argument("--from", dest="source", help="read this file, or - for stdin, in place of today's data")
    ap.add_argument("--at", help="HH:MM for --speak-auto on")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.speak_tick:
        report(cmd_tick(), a.json)
        return 0
    if a.speak_auto:
        report(cmd_auto(a.speak_auto, a.at), a.json)
        return 0
    if a.hush:
        out = cmd_hush()
        report(out, a.json)
        return 0 if out["outcome"] != "failed" else 1

    settings = load_settings()
    source = None
    if a.source:
        try:
            source = (sys.stdin.buffer.read() if a.source == "-" else Path(a.source).read_bytes())[:200_000].decode("utf-8", "replace")
        except OSError as e:
            raise SystemExit(f"couldn't read {a.source}: {e}")
    if a.show:
        lines, held = gather(settings, source)
        said, rest = fit(["Here's your brief."] + lines) if lines else ([], [])
        report({"said": " ".join(said), "rest": rest, "held": held, "outcome": "printed, no sound"}, a.json)
        return 0
    if not a.force:
        why = blocked_by(probe())
        if why:
            report({"outcome": "silent", "reason": why}, a.json)
            return 0
    out = run_speak(settings, source, a.force)
    report(out, a.json)
    return 1 if out.get("outcome") == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
