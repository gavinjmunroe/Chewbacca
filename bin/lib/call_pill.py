"""The call pill (CHW-190, docs/plans/NO-APPS.md "3. Call pill").

FaceTime was 5.04 h in front over 14 days, about 7 minutes in the window per
audio call, and the jobs in it are four presses: place, take, mute, end. This
module does those four from the glass and never shows FaceTime's window:

    "call Mark"  ->  the people store  ->  one handle  ->  facetime-audio://
    a call live  ->  FaceTime's accessibility tree  ->  a pill: who, timer, Mute, End
    a call rings ->  the same tree (or Notification Center's banner)  ->  Accept, Decline

The hard lines, each from a rule this kit already had:

- **A name is never an identity.** "Call Mark" resolves through the people
  store: an exact full name or nickname, else the people whose name starts
  with exactly those words. Two matches is a question on the glass, never a
  pick (skills/kyber-surfaces "Never merge on a name"; Tyler Law and Tyler
  Larsen are two people).
- **Never fake state.** Mute shows what FaceTime's own control says, read
  back after the press; nothing toggles a local flag. A control the tree does
  not show is not drawn, so a pill never offers a button that presses nothing.
- **Escape hides, it never hangs up.** Escape and the X take the pill down
  and remember that; only the End button, or "hang up", presses End.
- **Read only until a press.** Reading the tree changes nothing; the four
  presses are the person's own, on the glass or by voice.

The accessibility layer is `chewie app` (mac/appctl), which presses by
AXPress without moving the mouse or raising a window. Tests put a fake
`chewie`, `open`, `pgrep` and `lsappinfo` on PATH; nothing here dials in a
test, and `--dry-run` prints the URL that would open.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sqlite3
import subprocess
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

from osgraph import email_key, phone_key

SURFACE = "call-pill"
ASK_SURFACE = "call-ask"
FACETIME = "FaceTime"
FACETIME_BUNDLE = "com.apple.FaceTime"
NOTIFICATIONS = "Notification Center"
# Every press the pill sends starts with this. hud-listen already ignores any
# `call-` action (call-watch's offer owns `call-start`), so a press never
# also becomes a model turn about pressing it.
ACTION_PREFIX = "call-pill-"

# Four rows is as many as a glance can compare; past that the person says
# the full name instead. Guessed, never measured.
MOST_OPTIONS = 4
# A dial counts as the call it started if the call shows up within this long.
# FaceTime took 1 to 3 s to show a call in the one demo recorded for the plan
# (docs/plans/NO-APPS.md); 90 covers a slow confirm press. Guessed.
DIAL_MATCH_S = 90.0
# An unanswered "call who?" card leaves on its own. Same as call-watch's offer.
ASK_LIFE_S = 45.0
# How long `call` waits for FaceTime to come forward before putting the
# previous app back in front. Guessed, never measured against a slow launch.
FRONT_WAIT_S = 4.0


def bob_dir() -> Path:
    return Path(os.environ.get("BOB_DIR") or Path.home() / ".bob")


def calls_dir() -> Path:
    path = bob_dir() / "calls"
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------- the words

LEAD = r"^(?:(?:ok|okay|so|hey|kyber|please|can you|could you|would you)[ ,]+)*"
DIAL = re.compile(
    LEAD + r"(?:call|ring|facetime|face time)\s+(?P<who>.+?)"
    r"(?P<via>\s+on\s+(?:my\s+)?(?:phone|cell|iphone|facetime|face time))?"
    r"(?:\s+(?:now|please|for me))?[.!?]*$",
    re.I,
)
# A word after "call" that is not somebody: "call it a day", "call me back",
# "call history". The sentence goes to the model instead.
NOT_A_NAME = frozenset(
    """me him her them it that this back us you someone somebody anyone everyone history log logs
    list recording recordings transcript coach later off out up a an the again home there here
    my your his their our 911 emergency""".split()
)
NAME_WORD = re.compile(r"^[A-Za-z][A-Za-z.'-]*$")

CONTROLS = {
    "end": r"(?:hang up(?: the call)?|end (?:the |this |my )?call)",
    "mute": r"(?:mute (?:the |this |my )?call|mute me)",
    "unmute": r"(?:unmute (?:the |this |my )?call|unmute me)",
    "accept": r"(?:(?:answer|accept|pick up) (?:the |this )?call|answer it|pick up)",
    "decline": r"(?:(?:decline|reject|ignore) (?:the |this )?call)",
    "show": r"(?:show (?:me )?(?:the |my )?call)",
    "hide": r"(?:hide (?:the |my )?call)",
}
CONTROL_RES = {name: re.compile(LEAD + body + r"[.!?]*$", re.I) for name, body in CONTROLS.items()}


@dataclass(frozen=True)
class Ask:
    verb: str          # "dial", or a control: end mute unmute accept decline show hide
    who: str = ""
    via: str = "facetime"   # "facetime" (facetime-audio://) or "phone" (tel:)


def parse(said: str) -> Ask | None:
    """Which call request a whole sentence is, or None. Parse only."""
    words = " ".join((said or "").split())
    if not words:
        return None
    for verb, pattern in CONTROL_RES.items():
        if pattern.match(words):
            return Ask(verb)
    m = DIAL.match(words)
    if not m:
        return None
    tokens = m.group("who").split()
    if tokens and tokens[0].lower() == "my":
        tokens = tokens[1:]
    if not tokens or len(tokens) > 4:
        return None
    if any(not NAME_WORD.match(t) or t.lower() in NOT_A_NAME for t in tokens):
        return None
    via = m.group("via") or ""
    phone = bool(re.search(r"phone|cell", via, re.I))
    return Ask("dial", " ".join(tokens), "phone" if phone else "facetime")


# ---------------------------------------------------------------- who

@dataclass(frozen=True)
class Callee:
    person_id: str
    name: str
    handle: str        # E.164 phone or an email address
    kind: str          # "phone" or "email"
    company: str = ""

    def label(self) -> str:
        """For the glass: the name, a company if there is one, and only the
        last four digits of a number, since someone else can see the glass
        (skills/kyber-surfaces rule 11)."""
        parts = [self.name]
        if self.company:
            parts.append(self.company)
        if self.kind == "phone":
            parts.append("ending " + self.handle[-4:])
        else:
            parts.append(self.handle.split("@", 1)[-1])
        return " · ".join(parts)


@dataclass
class Resolution:
    callee: Callee | None = None
    options: list[Callee] = field(default_factory=list)
    line: str = ""


def people_db() -> Path:
    return Path(os.environ.get("PEOPLE_DB")
                or Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db")


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9\s'.-]", " ", (text or "").lower()).split())


def _rows(db_path: Path) -> tuple[list[dict], dict[str, list[tuple[str, str]]]]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
    try:
        try:
            people = con.execute(
                "SELECT id, name, phone, email, company, nickname FROM people WHERE deleted_at IS NULL").fetchall()
        except sqlite3.OperationalError:
            # An older store has no nickname column.
            people = [r + ("",) for r in con.execute(
                "SELECT id, name, phone, email, company FROM people WHERE deleted_at IS NULL").fetchall()]
        ids: dict[str, list[tuple[str, str]]] = {}
        try:
            for pid, kind, value in con.execute("SELECT person_id, kind, value FROM identities"):
                ids.setdefault(pid, []).append((kind, value))
        except sqlite3.OperationalError:
            pass
    finally:
        con.close()
    keys = ("id", "name", "phone", "email", "company", "nickname")
    return [dict(zip(keys, r)) for r in people], ids


def handles_of(person: dict, identities: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Every dialable handle the store holds for one person, phones first:
    the card's own phone, then the resolved phones, then emails. Deduplicated
    in E.164, so "(626) 555-0103" and "+16265550103" are one number."""
    phones: list[str] = []
    emails: list[str] = []
    for raw in [person.get("phone") or ""] + [v for k, v in identities if k == "phone"]:
        key = phone_key(raw)
        if key and re.fullmatch(r"\+?\d{7,15}", key) and key not in phones:
            phones.append(key)
    for raw in [person.get("email") or ""] + [v for k, v in identities if k == "email"]:
        key = email_key(raw)
        if key and re.fullmatch(r"[^\s/?#@]+@[^\s/?#@]+\.[^\s/?#@]+", key) and key not in emails:
            emails.append(key)
    return [(h, "phone") for h in phones] + [(h, "email") for h in emails]


def resolve(name: str, db_path: Path | None = None) -> Resolution:
    """One callee for a spoken name, or the options to ask between.

    Exact full name or nickname first; else the people whose name starts with
    exactly those words ("Mark" is "Mark Lin", never "Marky" or "Lamark").
    Two people is a question. One person with two numbers and no number on the
    card is a question too: picking one would be guessing which phone is his."""
    path = db_path or people_db()
    if not path.exists():
        return Resolution(line="The people store isn't there, so I can't tell who that is.")
    try:
        people, identities = _rows(path)
    except sqlite3.Error as err:
        return Resolution(line=f"Couldn't read the people store ({err.__class__.__name__}).")
    want = _norm(name)
    if not want:
        return Resolution(line="Who should I call?")
    exact = [p for p in people if _norm(p["name"]) == want or (p["nickname"] and _norm(p["nickname"]) == want)]
    words = want.split()
    found = exact or [p for p in people if _norm(p["name"]).split()[: len(words)] == words]
    if not found:
        return Resolution(line=f"No one called {name} in your people.")
    if len(found) > MOST_OPTIONS:
        return Resolution(line=f"{len(found)} people match {name}. Say the full name.")
    options: list[Callee] = []
    silent: list[str] = []
    for p in sorted(found, key=lambda p: p["name"].lower()):
        hs = handles_of(p, identities.get(p["id"], []))
        if not hs:
            silent.append(p["name"])
            continue
        card_phone = phone_key(p.get("phone") or "")
        phones = [h for h in hs if h[1] == "phone"]
        if card_phone and any(h == card_phone for h, _ in phones):
            picks = [(card_phone, "phone")]
        elif phones:
            picks = phones
        else:
            picks = hs[:1] if len({h for h, _ in hs}) == 1 else hs
        for handle, kind in picks:
            options.append(Callee(p["id"], p["name"], handle, kind, p.get("company") or ""))
    if len(found) == 1 and len(options) == 1:
        return Resolution(callee=options[0])
    if not options:
        who = found[0]["name"] if len(found) == 1 else name
        return Resolution(line=f"{who} has no number or email on file.")
    options = options[:MOST_OPTIONS]
    if len(found) == 1:
        line = f"{found[0]['name']} has {len(options)} numbers. Pick one on the glass."
    else:
        line = f"{len(found)} people match {name}. Pick one on the glass."
    if silent:
        line += " " + ", ".join(silent) + " has no number on file."
    return Resolution(options=options, line=line)


def name_for_handle(text: str, db_path: Path | None = None) -> str | None:
    """A caller's number as shown by FaceTime, put to a name only when exactly
    one person in the store owns that whole number."""
    key = phone_key(text) if re.fullmatch(r"[\d\s()+.-]{7,}", text or "") else email_key(text or "")
    if not key:
        return None
    path = db_path or people_db()
    if not path.exists():
        return None
    try:
        people, identities = _rows(path)
    except sqlite3.Error:
        return None
    owners = {p["name"] for p in people if any(h == key for h, _ in handles_of(p, identities.get(p["id"], [])))}
    return next(iter(owners)) if len(owners) == 1 else None


# ---------------------------------------------------------------- dialing

def dial_url(callee: Callee, via: str = "facetime") -> str:
    """facetime-audio://<handle>, or tel:<number> to place it as a phone call
    through the iPhone. The handle was validated in `handles_of`, and the URL
    goes to `open` as one argv entry, never through a shell."""
    if via == "phone":
        if callee.kind != "phone":
            raise ValueError(f"{callee.name} has no phone number to call as a phone call")
        return "tel:" + callee.handle
    return "facetime-audio://" + urllib.parse.quote(callee.handle, safe="+@.")


def open_cmd() -> list[str]:
    return shlex.split(os.environ.get("CALL_PILL_OPEN", "open"))


def run(argv: list[str], timeout: float = 8.0) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def front_bundle() -> str:
    """The bundle id of the frontmost app, from `lsappinfo`, which needs no
    permission. Empty when it can't be read."""
    asn = run(["lsappinfo", "front"], timeout=3)
    if asn is None or asn.returncode != 0 or not asn.stdout.strip():
        return ""
    info = run(["lsappinfo", "info", "-only", "bundleid", asn.stdout.strip()], timeout=3)
    if info is None:
        return ""
    m = re.search(r'"CFBundleIdentifier"="([^"]+)"', info.stdout)
    return m.group(1) if m else ""


def keep_behind(previous: str, wait: float = FRONT_WAIT_S, sleep=time.sleep, clock=time.monotonic) -> str:
    """Once FaceTime comes forward for the dial, put the app the person was
    in back in front, so FaceTime's window sits behind their work and the
    pill on the glass is where the call is run. Returns what happened."""
    if not previous or previous == FACETIME_BUNDLE:
        return "left as is"
    deadline = clock() + wait
    while clock() < deadline:
        if front_bundle() == FACETIME_BUNDLE:
            done = run(open_cmd() + ["-b", previous], timeout=5)
            return f"put {previous} back in front" if done and done.returncode == 0 else "couldn't put it back"
        sleep(0.2)
    return "FaceTime never came forward"


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def dialed_path() -> Path:
    return calls_dir() / "dialed.json"


def ask_path() -> Path:
    return calls_dir() / "ask.json"


def show_flag() -> Path:
    return calls_dir() / "show"


def dial(callee: Callee, via: str = "facetime", dry_run: bool = False) -> dict:
    """Open the URL (or, dry, only say which), remember who was dialed so the
    pill can name the call, and keep FaceTime behind the glass."""
    url = dial_url(callee, via)
    out = {"url": url, "name": callee.name, "opened": False, "dry_run": dry_run}
    if dry_run:
        return out
    previous = front_bundle()
    done = run(open_cmd() + [url], timeout=10)
    out["opened"] = bool(done and done.returncode == 0)
    if out["opened"]:
        write_json(dialed_path(), {"name": callee.name, "person_id": callee.person_id,
                                   "kind": callee.kind, "via": via, "at": time.time()})
        out["front"] = keep_behind(previous)
    return out


# ---------------------------------------------------------------- reading FaceTime

def _label(text: str | None) -> str:
    return " ".join((text or "").replace("…", "").replace("...", "").lower().split())


END = {"end", "end call", "hang up", "leave", "leave call"}
MUTE = {"mute", "mute microphone", "mute audio"}
UNMUTE = {"unmute", "unmute microphone", "unmute audio"}
ACCEPT = {"accept", "answer"}
DECLINE = {"decline"}
CONFIRM = {"call"}
CANCEL = {"cancel"}
LABELS = {"end": END, "mute": MUTE | UNMUTE, "accept": ACCEPT, "decline": DECLINE,
          "call": CONFIRM, "cancel": CANCEL}
BUTTON_ROLES = {"AXButton", "AXCheckBox", "AXToggle", "AXRadioButton"}
TIMER = re.compile(r"^\d{1,2}:\d{2}(?::\d{2})?$")
CALLING = re.compile(r"^(calling|ringing|connecting|dialing)\b", re.I)
# Text on a call window that is chrome, not the caller.
NOT_WHO = re.compile(r"^(facetime( audio| video)?|audio|video|notification center|incoming call|"
                     r"(facetime )?audio call|mute|unmute|end|accept|decline|call|cancel|details|"
                     r"camera|microphone|speaker|now)$", re.I)


@dataclass
class Control:
    name: str            # end mute accept decline call cancel
    app: str
    window: int | None   # None: a menu item
    label: str           # the control's own label, as FaceTime shows it
    menu: tuple[str, ...] = ()


@dataclass
class CallState:
    kind: str = "none"   # none incoming confirm calling live
    who: str = ""
    timer: str = ""
    status: str = ""     # "Calling", "Ringing", from FaceTime's own text
    muted: bool | None = None
    controls: dict[str, Control] = field(default_factory=dict)
    readable: bool = True
    evidence: list[str] = field(default_factory=list)


class Ax:
    """`chewie app` (mac/appctl), the accessibility layer, as JSON calls.
    Nothing here moves the mouse or raises a window; `press` and `menu_press`
    are the only calls that act, and only the pill's buttons reach them."""

    def __init__(self, cmd: list[str] | None = None):
        self.cmd = cmd or shlex.split(os.environ.get("CALL_PILL_AX", "chewie app"))
        self.errors: list[str] = []

    def _json(self, *args: str, timeout: float = 8.0):
        done = run(self.cmd + list(args), timeout=timeout)
        if done is None:
            self.errors.append(f"{args[0]}: did not run")
            return None
        if done.returncode != 0:
            msg = (done.stderr or done.stdout).strip().splitlines()
            self.errors.append(f"{args[0]}: {msg[-1][:160] if msg else done.returncode}")
            return None
        try:
            return json.loads(done.stdout or "null")
        except ValueError:
            self.errors.append(f"{args[0]}: not JSON")
            return None

    @staticmethod
    def running(app: str = FACETIME) -> bool:
        done = run(["pgrep", "-x", app], timeout=3)
        return bool(done and done.returncode == 0 and done.stdout.strip())

    def windows(self, app: str) -> list[dict]:
        got = self._json("windows", app)
        return got if isinstance(got, list) else []

    def see(self, app: str, window: int) -> list[dict]:
        got = self._json("see", app, "--window", str(window), "--limit", "300")
        return got.get("elements", []) if isinstance(got, dict) else []

    def menu(self, app: str, *path: str) -> list[dict]:
        got = self._json("menu", app, *path)
        return got if isinstance(got, list) else []

    def press(self, app: str, window: int, index: int) -> bool:
        # --yes: the person pressed End (or Accept) on the glass, which is the
        # confirmation appctl's irreversible gate asks for.
        return self._json("press", app, str(index), "--window", str(window), "--yes") is not None

    def menu_press(self, app: str, *path: str) -> bool:
        return self._json("menu", app, *path, "--yes") is not None


def _window_controls(app: str, window: int, elements: list[dict]) -> tuple[dict[str, Control], list[str], bool | None]:
    controls: dict[str, Control] = {}
    texts: list[str] = []
    muted: bool | None = None
    for e in elements:
        role = e.get("role", "")
        if role.startswith("AXMenu"):
            continue
        label = e.get("label") or ""
        norm = _label(label)
        if role in BUTTON_ROLES or "AXPress" in (e.get("actions") or []):
            for name, names in LABELS.items():
                if norm in names and name not in controls:
                    controls[name] = Control(name, app, window, label)
                    if name == "mute":
                        if norm in UNMUTE:
                            muted = True
                        elif role in ("AXCheckBox", "AXToggle") and str(e.get("value")) in ("0", "1"):
                            muted = str(e.get("value")) == "1"
                        else:
                            muted = False
        if role == "AXStaticText":
            for t in (e.get("value"), label):
                if t and t.strip() and t.strip() not in texts:
                    texts.append(t.strip())
    return controls, texts, muted


def _who_from(texts: list[str], skip: set[str]) -> str:
    for t in texts:
        if TIMER.match(t) or CALLING.match(t) or NOT_WHO.match(t) or _label(t) in skip or len(t) > 60:
            continue
        return t
    return ""


def read_state(ax: Ax, dialed_name: str = "", dialing: bool = False, db_path: Path | None = None) -> CallState:
    """What FaceTime shows right now, read through its accessibility tree.

    Windows first: a window with Accept and Decline is a call ringing in (on
    Notification Center only when the banner says FaceTime), a window with End
    is a call placed or live, and Call with Cancel right after a dial is
    FaceTime asking to place it. Then the Video menu: its Mute item is
    disabled with no call (observed 2026-10-10, FaceTime 15.6.1 idle) and is
    the fallback for mute when the window shows none."""
    state = CallState()
    ax.errors = []
    windows: list[tuple[str, int, list[dict]]] = []
    ft_running = ax.running(FACETIME)
    apps = ([FACETIME] if ft_running else []) + [NOTIFICATIONS]
    for app in apps:
        for w in ax.windows(app):
            wid = int(w.get("window") or 0)
            if not wid or w.get("minimized"):
                continue
            windows.append((app, wid, ax.see(app, wid)))
    menu_mute: dict | None = None
    if ft_running:
        for item in ax.menu(FACETIME, "Video"):
            if _label(item.get("title")) in MUTE | UNMUTE:
                menu_mute = item
                break
    skip = set().union(*LABELS.values())
    for app, wid, elements in windows:
        controls, texts, muted = _window_controls(app, wid, elements)
        if app == NOTIFICATIONS and not any("facetime" in t.lower() for t in texts + [c.label for c in controls.values()]):
            continue
        if "accept" in controls and "decline" in controls:
            state.kind = "incoming"
            state.controls = {k: controls[k] for k in ("accept", "decline")}
            who = _who_from(texts, skip)
            state.who = name_for_handle(who, db_path) or who
            state.evidence.append(f"{app} window {wid}: Accept and Decline")
            return state
        if "end" in controls and state.kind != "live":
            state.kind = "live"
            state.controls = {k: v for k, v in controls.items() if k in ("end", "mute")}
            state.muted = muted
            state.timer = next((t for t in texts if TIMER.match(t)), "")
            status = next((t for t in texts if CALLING.match(t)), "")
            if status and not state.timer:
                state.kind, state.status = "calling", status
            who = _who_from(texts, skip)
            state.who = dialed_name or name_for_handle(who, db_path) or who
            state.evidence.append(f"{app} window {wid}: End" + (", Mute" if "mute" in controls else ""))
        elif dialing and app == FACETIME and "call" in controls and "cancel" in controls and state.kind == "none":
            state.kind = "confirm"
            state.controls = {k: controls[k] for k in ("call", "cancel")}
            state.who = dialed_name
            state.evidence.append(f"FaceTime window {wid}: Call and Cancel after a dial")
    if menu_mute is not None:
        enabled = bool(menu_mute.get("enabled"))
        title = menu_mute.get("title") or ""
        state.evidence.append(f"Video menu: {title} {'enabled' if enabled else 'disabled'}")
        if enabled:
            if state.kind == "none":
                state.kind = "live"
                state.who = dialed_name or "FaceTime call"
            if state.kind in ("live", "calling") and "mute" not in state.controls:
                state.controls["mute"] = Control("mute", FACETIME, None, title, ("Video", title))
                state.muted = _label(title) in UNMUTE
    state.readable = not ax.errors or bool(windows) or menu_mute is not None
    return state


def press(ax: Ax, state: CallState, name: str) -> tuple[bool, str]:
    """Press the real control `name` for this state, found again by its label
    in a fresh read of its window, so a press never lands on a stale index."""
    ctl = state.controls.get(name)
    if ctl is None:
        return False, f"FaceTime isn't showing {name.capitalize()} right now."
    if ctl.window is None:
        ok = ax.menu_press(ctl.app, *ctl.menu)
        return ok, "" if ok else f"{ctl.label} didn't press ({'; '.join(ax.errors) or 'no reply'})."
    names = LABELS[name]
    for e in ax.see(ctl.app, ctl.window):
        if e.get("role", "").startswith("AXMenu"):
            continue
        if _label(e.get("label")) in names:
            ok = ax.press(ctl.app, ctl.window, int(e["i"]))
            return ok, "" if ok else f"{ctl.label} didn't press ({'; '.join(ax.errors) or 'no reply'})."
    return False, f"{ctl.label} is gone from FaceTime."


# ---------------------------------------------------------------- CallHistory

def ended_in_history(since: float) -> bool | None:
    """Whether CallHistory has a call that started at or after `since` (epoch
    seconds), which it writes when the call is over. None when the store can't
    be read (it needs Full Disk Access for whoever runs this)."""
    db = Path(os.path.expanduser(os.environ.get(
        "CHEWBACCA_CALLS_DB", "~/Library/Application Support/CallHistoryDB/CallHistory.storedata")))
    if not db.exists():
        return None
    apple = since - 978307200  # seconds from 1970 to 2001-01-01
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            # ZDATE is when the call began, and the watcher sees a call up to
            # one poll late (a ring longer still), so the window opens a
            # minute early. Guessed, never measured against a real record.
            row = con.execute("SELECT COUNT(*) FROM ZCALLRECORD WHERE ZDATE >= ?", (apple - 60,)).fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return bool(row and row[0])


# ---------------------------------------------------------------- the glass

def text(value: str) -> str:
    """A string value for a Kyber line: JSON, with UTF-8 left as is."""
    return json.dumps(value, ensure_ascii=False)


TITLES = {"incoming": "INCOMING CALL", "confirm": "PLACE THIS CALL?", "calling": "CALLING", "live": "ON A CALL"}


def buttons(state: CallState) -> list[tuple[str, str, bool]]:
    """(control, label, primary) for the controls the tree actually showed."""
    out: list[tuple[str, str, bool]] = []
    c = state.controls
    if state.kind == "incoming":
        out = [("accept", "Accept", True), ("decline", "Decline", False)]
    elif state.kind == "confirm":
        out = [("call", "Call", True), ("cancel", "Cancel", False)]
    elif state.kind in ("calling", "live"):
        if "mute" in c:
            out.append(("mute", "Unmute" if state.muted else "Mute", False))
        if "end" in c:
            out.append(("end", "End", True))
    return [b for b in out if b[0] in c]


def clock(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def status_line(state: CallState, live_for: float | None, note: str = "") -> str:
    if note:
        return note
    if state.kind == "incoming":
        return "FaceTime"
    if state.kind == "confirm":
        return "FaceTime is asking before it dials"
    if state.kind == "calling":
        return state.status or "Calling"
    if state.kind == "live":
        timer = state.timer or (clock(live_for) if live_for is not None else "")
        bits = (["Muted"] if state.muted else []) + ([timer] if timer else [])
        if "end" not in state.controls:
            bits.append("End it in FaceTime")
        return " · ".join(bits) or "Live"
    return ""


def pill_lines(state: CallState, who: str, status: str) -> list[str]:
    """The whole pill. Who and status are bound to data, so a tick of the
    timer is one `d` line (skills/kyber-surfaces rule 9)."""
    bs = buttons(state)
    lines = [
        f"@ {SURFACE} at=top w=340",
        f"c s Screen title={text(TITLES.get(state.kind, 'CALL'))}",
        "c who Text value=@/call/who",
        "c st Text value=@/call/status tone=muted",
    ]
    kids = ["who", "st"]
    if bs:
        lines.append(f"c row Stack direction=grid cols={len(bs)} gap=2")
        for name, label, primary in bs:
            lines.append(f"c b-{name} Button label={text(label)} action={ACTION_PREFIX}{name}"
                         + (" variant=primary" if primary else ""))
        kids.append("row")
        lines.append("> row " + " ".join(f"b-{n}" for n, _, _ in bs))
    lines.append("> s " + " ".join(kids))
    lines += data_lines(who, status)
    lines.append("r s")
    return lines


def data_lines(who: str, status: str) -> list[str]:
    return [f"d /call/who {text(who or 'FaceTime call')}", f"d /call/status {text(status)}"]


def ask_lines(options: list[Callee], line: str) -> list[str]:
    lines = [
        f"@ {ASK_SURFACE} at=top w=360",
        f"glance {ASK_SURFACE}",
        'c s Screen title="CALL WHO?"',
        f"c t Text value={text(line)}",
        "c row Stack gap=2",
    ]
    for i, o in enumerate(options):
        lines.append(f"c p{i} Button label={text(o.label())} action={ACTION_PREFIX}pick")
    lines.append("> row " + " ".join(f"p{i}" for i in range(len(options))))
    lines += ["> s t row", "r s"]
    return lines
