"""What one action item from a meeting becomes, in one press (CHW-206).

Opal's pitch is the action after the conversation (docs/plans/COMPETITORS.md,
gap 4). Capture and extraction already worked here; the item stopped at a
guessed Task. This module picks what the item should become, says on the row
what the press will touch before it is pressed, does that one thing, and
reads the result back from where it landed.

THE RULE, by the item's shape, first match wins:

1. draft: the item is a message to a named person ("send the deck to
   Maggie", "follow up with Jonah", "let Ryan know", "text Sagar"). The press
   adds a text draft for that person with `people texts drafts add`, which
   never sends: a draft goes out only when someone names its number later.
   voice-check runs inside it, so a draft that doesn't read like Caleb is
   refused there and the row says so.
2. event: the item carries a day, said in the transcript or set by the
   summary's model. The press creates a TENTATIVE event with no invitees: on
   Google through gws when its sign-in already holds calendar write (status
   tentative, transparent, sendUpdates none), else in the Mac's Calendar
   through `mac calendar add`, titled "Draft: ...". Neither body has an
   attendees field, so neither path can invite anyone. With neither, the row
   names the consent that is missing and nothing is created.
3. task: anything else. The press adds a work-ledger task under ~, keyed by
   meeting and item, so a second press finds the same task.

PROVENANCE. The transcript has no speaker names, so an owner or a day is
only "said" when a transcript line states it; that line's clock is the
provenance. A day the summary's model set with no line saying it, a relative
day like "next week" or "end of the week", and any owner taken from "I'll"
(nobody knows who said it) or from the model are marked "(guess)".

Every string from a meeting is someone else's words: cleaned with MC.clean,
clipped, passed to a CLI as one argv element, and never read for an action.
"""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path

import meeting_capture as MC
import meeting_privacy as MP

ROOT = Path(__file__).resolve().parents[2]

# Google scopes that can write events. calendar.readonly can't, and on
# 2026-10-09 a token with only that returned 403 on every add
# (team/memory/feedback_google_signin_calendar_write.md).
CALENDAR_WRITE = {"https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"}
# Each CLI gets this long. gws inserts answered in about a second by hand on
# 2026-10-10; voice-check reads the people store and is the slow one. Guessed,
# never measured under load.
CLI_TIMEOUT_S = 45.0
TITLE_CHARS = 120
LINE_CLIP = 60

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DAY_ALIASES = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4, "sat": 5,
               "sun": 6, **{d: i for i, d in enumerate(WEEKDAYS)}}
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
          "oct": 10, "nov": 11, "dec": 12}
MONTH_RE = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
            r"sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
DAY_RE = r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)"

# Words a capitalized recipient can't be: a pronoun, a day, a month.
NOT_A_NAME = {"i", "we", "you", "they", "he", "she", "it", "them", "him", "her", "us", "me", "everyone",
              "everybody", "team", "the", "a", "an", "this", "that", "today", "tomorrow", "tonight", "next",
              "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday",
              *MONTHS.keys(), "january", "february", "march", "april", "june", "july", "august", "september",
              "october", "november", "december"}
NAME = r"(?P<who>[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)?)"
DRAFT_SHAPES = [
    re.compile(r"(?i:\b(?:follow(?:ing)?[\s-]+up|check(?:ing)?\s+in|circle\s+back|catch\s+up)\s+with)\s+" + NAME),
    re.compile(r"(?i:\b(?:send|sending|forward|share|sharing|email|give|pass)\b).{0,60}?(?i:\b(?:to|with))\s+" + NAME),
    re.compile(r"(?i:\b(?:text|email|message|ping|dm|reply\s+to|get\s+back\s+to|reach\s+out\s+to|nudge))\s+" + NAME),
    re.compile(r"(?i:\blet)\s+" + NAME + r"\s+(?i:know)\b"),
]
STOPWORDS = set("""the and for with from that this you your our will can about into have has was were are
just then them they their there what when where which would could should also some more over only very really
maybe okay yeah like gonna wanna need needs get got make sure going let know send sends follow by its it's
i'll we'll you'll""".split())
FIRST_PERSON = re.compile(r"(?i)\b(i'll|i will|i can|i'm going to|i'm gonna|let me|i'll be)\b")


def clean(text, limit: int | None = None) -> str:
    return MC.clean(text, limit)


# ── reading the item ────────────────────────────────────────────────────


def words(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z0-9']+", str(text or "").lower()):
        if len(w) < 3 or w in STOPWORDS:
            continue
        out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def locate(lines: list[dict], text: str) -> dict | None:
    """The transcript line that says the item, by shared content words: two
    or more, or every one of a one- or two-word item. None when no line
    clears that bar, which is the honest answer for a paraphrase."""
    want = words(text)
    if not want:
        return None
    best, best_score = None, 0
    for n, line in enumerate(lines or []):
        if not isinstance(line, dict):
            continue
        got = len(want & words(line.get("text")))
        if got > best_score:
            best, best_score = n, got
    if best is None or not (best_score >= 2 or best_score == len(want)):
        return None
    line = lines[best]
    return {"index": best, "clock": clean(line.get("clock"), 20), "text": clean(line.get("text"), 400),
            "mic_dbfs": line.get("mic_dbfs"), "system_dbfs": line.get("system_dbfs")}


def next_weekday(anchor: date, weekday: int, strictly_after: bool = True) -> date:
    ahead = (weekday - anchor.weekday()) % 7
    if ahead == 0 and strictly_after:
        ahead = 7
    return anchor + timedelta(days=ahead)


def find_day(text: str, anchor: date) -> dict | None:
    """The first day named in `text`, resolved against the meeting's own day.
    {"day", "phrase", "exact", "at"}: exact is False for a day that had to be
    inferred ("next week", "end of the week", "next Tuesday")."""
    text = str(text or "")
    found = []

    def add(m, day, exact, rank=1):
        found.append((rank, m.start(), {"day": day, "phrase": m.group(0).strip(), "exact": exact}))

    for m in re.finditer(r"\b(20\d\d)-(\d\d)-(\d\d)\b", text):
        try:
            add(m, date(int(m.group(1)), int(m.group(2)), int(m.group(3))), True, 0)
        except ValueError:
            pass
    for m in re.finditer(r"(?i)\b(today|tonight)\b", text):
        add(m, anchor, True)
    for m in re.finditer(r"(?i)\b(tomorrow|tmrw?)\b", text):
        add(m, anchor + timedelta(days=1), True)
    for m in re.finditer(r"(?i)\bend of (?:the )?week\b", text):
        add(m, next_weekday(anchor, 4, strictly_after=False), False)
    for m in re.finditer(r"(?i)\bnext week\b", text):
        add(m, next_weekday(anchor, 0), False)
    for m in re.finditer(r"(?i)\b(?:(next|this|by|on|before)\s+)?" + DAY_RE + r"\b", text):
        word = m.group(2).lower()
        if word == "sun" and not m.group(1):
            continue  # "the sun" is not a Sunday
        day = next_weekday(anchor, DAY_ALIASES[word])
        add(m, day, (m.group(1) or "").lower() != "next")
    for m in re.finditer(r"(?i)\b" + MONTH_RE + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b", text):
        try:
            day = date(anchor.year, MONTHS[m.group(1).lower()[:3]], int(m.group(2)))
        except (ValueError, KeyError):
            continue
        if day < anchor - timedelta(days=60):
            day = day.replace(year=day.year + 1)
        add(m, day, True, 0)
    # A bare "3/4" is a fraction as often as a day, so M/D counts only after
    # a word that makes it a day: "on 10/14", "due 10/14", "Tuesday 10/14".
    for m in re.finditer(r"(?i)\b(?:on|by|due|before|until|thru|through|mon|tue|tues|wed|thu|thur|thurs|fri|"
                         r"sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+"
                         r"(\d{1,2})/(\d{1,2})(?![\d/])", text):
        try:
            day = date(anchor.year, int(m.group(1)), int(m.group(2)))
        except ValueError:
            continue
        if day < anchor - timedelta(days=60):
            day = day.replace(year=day.year + 1)
        add(m, day, True, 0)
    if not found:
        return None
    # A calendar date beats a weekday said next to it ("Tuesday 10/14").
    found.sort(key=lambda x: (x[0], x[1]))
    out = found[0][2]
    out["at"] = find_time(text)
    return out


def find_time(text: str) -> dtime | None:
    m = re.search(r"(?i)\b(\d{1,2})(?::(\d\d))?\s*(am|pm)\b", text)
    if m:
        hour = int(m.group(1)) % 12 + (12 if m.group(3).lower() == "pm" else 0)
        minute = int(m.group(2) or 0)
        return dtime(hour, minute) if hour < 24 and minute < 60 else None
    if re.search(r"(?i)\bnoon\b", text):
        return dtime(12, 0)
    return None


def recipient(text: str) -> tuple[str, str]:
    """(who, what) for a message-shaped item, else ("", "")."""
    for shape in DRAFT_SHAPES:
        m = shape.search(text)
        if not m:
            continue
        who_words = [w for w in m.group("who").split() if w.lower().strip(".'") not in NOT_A_NAME]
        if not who_words or who_words[0] != m.group("who").split()[0]:
            continue
        who = " ".join(who_words)
        what = ""
        send = re.search(r"(?i)\b(?:send|sending|forward|share|sharing|email|give|pass)\s+(.{1,60}?)\s+(?:to|with)\s+"
                         + re.escape(m.group("who")), text)
        if send:
            what = send.group(1)
        else:
            after = re.search(r"(?i)\b(?:about|abt|on|re|regarding)\s+(.{1,60})$", text[m.end():])
            what = after.group(1) if after else ""
        what = re.sub(r"(?i)\s+(?:by|on|before)\s+\S+.*$", "", what).strip(" .,")
        return clean(who, 40), clean(what, 60)
    return "", ""


def names_doer(first: str, text: str) -> bool:
    """True when `text` makes `first` the one doing it: the subject of a
    sentence ("Jonah will send it") or asked by name ("Jonah, can you send
    it"). A name said in passing ("Thanks Jonah, I will send it") is not."""
    name = re.escape(first)
    subject = rf"(?:^|[.!?;]\s+|\b(?:and|so|but|then|okay|ok)\s+){name}(?:'ll|\s+(?:will|is going to|is gonna|can|could|"
    subject += r"should|needs to|has to)\b)"
    asked = rf"\b{name},\s*(?:can|could|will|would)\s+you\b"
    return bool(re.search(subject, text, re.I) or re.search(asked, text, re.I))


SUBJECT = re.compile(r"^(?P<who>[A-Z][A-Za-z'.-]+)(?:'ll|\s+(?:will|is going to|is gonna|to|should|needs to|has to|"
                     r"sends?|follows?|emails?|texts?|shares?)\b)")


def item_subject(text: str) -> str:
    """The person an item's own words make its subject, as in Claude's
    "Jonah will send the deck to Maggie"; "" for "Send the deck to Maggie"."""
    m = SUBJECT.match(text or "")
    if not m or m.group("who").lower() in NOT_A_NAME:
        return ""
    return m.group("who")


def owner(item_owner: str, line: dict | None, names: list[str], text: str = "") -> dict:
    """Who owes it, with where that came from. A name is said only when the
    line itself names that person as the one doing it."""
    said = (line or {}).get("text") or ""
    subject = item_subject(text)
    for name in names + ([subject] if subject and subject not in " ".join(names) else []):
        first = name.split()[0] if name else ""
        if first and names_doer(first, said):
            return {"name": name, "guess": False, "line": line["clock"], "why": "named in the line"}
    if subject:
        return {"name": subject, "guess": True, "line": "", "why": "Claude's wording names them"}
    if line and FIRST_PERSON.search(said):
        mic, system = line.get("mic_dbfs"), line.get("system_dbfs")
        louder = isinstance(mic, (int, float)) and isinstance(system, (int, float)) and mic > system
        return {"name": "you", "guess": True, "line": line["clock"],
                "why": "\"I'll\" with your mic louder" if louder else "\"I'll\", speaker unknown"}
    if item_owner:
        return {"name": item_owner, "guess": True, "line": "", "why": "Claude's pick, no line names them"}
    return {"name": "", "guess": True, "line": "", "why": "nobody named"}


def when_of(item: dict, line: dict | None, lines: list[dict], anchor: date) -> dict | None:
    """The item's day: said in its line (or a line next to it), else the
    model's due date or a day in the item's own words, as a guess."""
    near = []
    if line is not None:
        i = line["index"]
        near = [line] + [{"clock": clean(lines[j].get("clock"), 20), "text": clean(lines[j].get("text"), 400)}
                         for j in (i + 1, i - 1) if 0 <= j < len(lines) and isinstance(lines[j], dict)]
    due = str(item.get("due_at") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
        model = date.fromisoformat(due)
    else:
        # A timestamp (Anarlog's due_at) is a moment; its day is the local one.
        moment = MC.parse_iso(due)
        model = moment.astimezone().date() if moment else None
    # A neighbouring line only confirms the model's date; it never supplies
    # one, or "before next week" two lines down dates an unrelated item.
    for n, said in enumerate(near):
        found = find_day(said["text"], anchor)
        if found and (found["day"] == model if n else (model is None or found["day"] == model)):
            return {**found, "guess": not found["exact"], "firm": found["exact"], "line": said["clock"],
                    "why": "said in the line" if found["exact"] else f"\"{found['phrase']}\" is inferred"}
    if model is not None:
        return {"day": model, "phrase": "", "exact": False, "at": None, "guess": True, "firm": True, "line": "",
                "why": "Claude's date, no line says it"}
    found = find_day(item.get("text") or "", anchor)
    if found:
        return {**found, "guess": True, "firm": found["exact"], "line": "",
                "why": "in Claude's wording, no line says it"}
    return None


# ── the plan ────────────────────────────────────────────────────────────


def day_text(day: date, at: dtime | None = None) -> str:
    out = day.strftime("%a %b ") + str(day.day)
    if at:
        out += " " + (datetime.combine(day, at).strftime("%-I:%M %p").replace(":00 ", " "))
    return out


def plan(meeting: dict, item: dict, lines: list[dict], names: list[str], item_owner: str = "") -> dict:
    """What the press on this item will do, decided by rule, before any press."""
    text = clean(item.get("text"), 300)
    start = MC.parse_iso(meeting.get("started_at")) or MC.parse_iso(meeting.get("created_at"))
    anchor = (start.astimezone() if start else datetime.now().astimezone()).date()
    line = locate(lines, text)
    who, what = recipient(text)
    when = when_of(item, line, lines, anchor)
    who_owes = owner(item_owner, line, names, text)
    out = {"text": text, "line": line, "owner": who_owes, "when": when,
           # Every ledger row, calendar draft and note made from this plan names
           # the meeting, so a private one is named only as private.
           "meeting_title": clean(MP.safe_title(meeting.get("title"), meeting.get("folder_path"),
                                                label="a private meeting"), 80) or "a meeting",
           "private": MP.is_private(meeting.get("title"), meeting.get("folder_path"), text),
           "meeting_id": str(meeting.get("id") or ""),
           "item_id": str(item.get("id") or "")}
    # A message someone else owes ("Jonah will send the deck to Maggie") is
    # theirs to send: no draft goes into Caleb's queue for it.
    mine = who_owes["name"] in ("", "you")
    if who and mine:
        body = f"Following up from the call abt {what}" if what else "Following up from the call earlier"
        out.update(kind="draft", who=who, draft=clean(body, 200),
                   touches=f"Go drafts a text to {who} in your drafts. Nothing sends.")
    elif when and when["firm"]:
        # Only a day someone named becomes an event; "next week" stays a task
        # with its guessed day beside it.
        out.update(kind="event", touches=f"Go puts a tentative event on {day_text(when['day'], when.get('at'))}"
                                         ", no invitees.")
    else:
        out.update(kind="task", touches="Go adds it to your work ledger.")
    return out


def provenance(p: dict) -> str:
    """One line: where the owner and the day came from."""
    o = p["owner"]
    if not o["name"]:
        who = "nobody named"
    elif o["guess"]:
        who = f"{o['name']} (guess, {o['why']})"
    else:
        who = f"{o['name']}, said at {o['line']}"
    bits = [f"owner {who}"]
    w = p.get("when")
    if w:
        said = f", said at {w['line']}" if w.get("line") else ""
        bits.append(f"day {day_text(w['day'], w.get('at'))}" + (f" (guess, {w['why']}{said})" if w["guess"] else said))
    if p.get("line"):
        bits.append(f"from {p['line']['clock']}: \"{clean(p['line']['text'], LINE_CLIP)}\"")
    else:
        bits.append("no transcript line says it")
    return "; ".join(bits)


# ── the press ───────────────────────────────────────────────────────────


def _json(out: str):
    m = re.search(r"[\[{].*[\]}]", out or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def gws_calendar_write(run) -> tuple[bool, str]:
    """Whether gws's sign-in already holds calendar write. Only reads
    `gws auth status`; never signs in."""
    code, out, err = run(["gws", "auth", "status"], CLI_TIMEOUT_S)
    if code != 0:
        return False, "gws isn't signed in"
    body = _json(out)
    scopes = set(body.get("scopes") or []) if isinstance(body, dict) else set()
    if scopes & CALENDAR_WRITE:
        return True, ""
    if any("calendar" in s for s in scopes):
        return False, "gws holds calendar read only"
    return False, "gws has no calendar access"


PRIVATE_ITEM = "Private follow-up from a meeting"


def item_title(p: dict) -> str:
    """What a calendar event, a Mac calendar draft or a ledger row is called.
    One function for all three, so a private meeting's task can't leak
    through a sibling path (security review, 2026-10-11: the ledger hid it
    while both calendar paths still printed it)."""
    return PRIVATE_ITEM if p.get("private") else clean(p["text"], TITLE_CHARS)


def event_body(p: dict) -> dict:
    w = p["when"]
    title = item_title(p)
    said = f" Said at {p['line']['clock']}." if p.get("line") else ""
    desc = (f"From {p['meeting_title']}.{said} Drafted by Chewbacca from the meeting's action items; "
            "tentative until you keep it. No one was invited.")
    if w.get("at"):
        start = datetime.combine(w["day"], w["at"]).astimezone()
        timing = {"start": {"dateTime": start.isoformat()}, "end": {"dateTime": (start + timedelta(hours=1)).isoformat()}}
    else:
        timing = {"start": {"date": w["day"].isoformat()}, "end": {"date": (w["day"] + timedelta(days=1)).isoformat()}}
    # No "attendees" key, ever: an event with nobody on it can't invite anyone.
    return {"summary": title, "description": desc, "status": "tentative", "transparency": "transparent", **timing}


def make_event(p: dict, run) -> dict:
    ok, why = gws_calendar_write(run)
    if ok:
        body = event_body(p)
        params = {"calendarId": "primary", "sendUpdates": "none"}
        code, out, err = run(["gws", "calendar", "events", "insert", "--params", json.dumps(params),
                              "--json", json.dumps(body)], CLI_TIMEOUT_S)
        made = _json(out) if code == 0 else None
        eid = str(made.get("id") or "") if isinstance(made, dict) else ""
        if not eid:
            return {"ok": False, "line": f"No event: Google didn't create it ({clean(err or out, 80) or code})."}
        code, out, err = run(["gws", "calendar", "events", "get", "--params",
                              json.dumps({"calendarId": "primary", "eventId": eid})], CLI_TIMEOUT_S)
        back = _json(out) if code == 0 else None
        if not isinstance(back, dict) or back.get("summary") != body["summary"]:
            return {"ok": False, "line": "Google made an event but reading it back failed, so check your calendar.",
                    "ref": eid, "unknown": True}
        invited = back.get("attendees") or []
        status = back.get("status") or ""
        return {"ok": not invited, "ref": eid, "where": "google",
                "line": (f"Tentative event on {day_text(p['when']['day'], p['when'].get('at'))} is on your Google "
                         f"calendar ({status}, {len(invited)} invited). Read back from Google.")}
    title = "Draft: " + item_title(p)
    w = p["when"]
    at = w["day"].isoformat() + (f" {w['at'].strftime('%H:%M')}" if w.get("at") else "")
    # The title starts with "Draft: ", so it can never read as a flag.
    argv = ["mac", "calendar", "add", title, "--at", at] + ([] if w.get("at") else ["--all-day"]) + [
        "--notes", f"From {p['meeting_title']}. Drafted by Chewbacca; nobody was invited.", "--json"]
    code, out, err = run(argv, CLI_TIMEOUT_S)
    if code != 0:
        mac_why = "Calendar access is off for the app running Kyber" if "access" in (out + err).lower() \
            else clean(err or out, 60) or f"mac exited {code}"
        return {"ok": False, "line": f"No event: {why}, and {mac_why}. Google needs calendar write from "
                                     "Chewbacca's sign-in, or the Mac needs Calendars access."}
    nxt = (w["day"] + timedelta(days=1)).isoformat()
    code, out, err = run(["mac", "calendar", "list", "--from", w["day"].isoformat(), "--to", nxt, "--json"],
                         CLI_TIMEOUT_S)
    rows = _json(out) if code == 0 else None
    hit = next((r for r in rows or [] if isinstance(r, dict) and r.get("title") == title), None) \
        if isinstance(rows, list) else None
    if hit is None:
        return {"ok": False, "line": "Calendar took the event but it didn't read back, so check Calendar.", "unknown": True}
    return {"ok": True, "ref": str(hit.get("id") or ""), "where": "mac",
            "line": f"Draft event on {day_text(w['day'], w.get('at'))} is in Calendar ({hit.get('calendar') or 'default'}), "
                    "no invitees. Read back from Calendar."}


def tool(env: dict, name: str, override: str) -> str:
    """A CLI by name: an explicit override, else the one on PATH, else this
    checkout's own copy."""
    return str(env.get(override) or shutil.which(name, path=env.get("PATH")) or ROOT / "bin" / name)


def people_bin(env: dict) -> str:
    return tool(env, "people", "KYBER_PEOPLE")


def drafts_file(env: dict) -> Path:
    base = env.get("PEOPLE_DIR") or Path(env.get("HOME") or Path.home()) / ".chewbacca" / "people"
    return Path(base) / "drafts.json"


def make_draft(p: dict, run, env: dict) -> dict:
    why = f"from {p['meeting_title']}" + (f", said at {p['line']['clock']}" if p.get("line") else "")
    code, out, err = run([people_bin(env), "texts", "drafts", "add", p["who"], p["draft"], "--why=" + why],
                         CLI_TIMEOUT_S)
    if code != 0:
        said = clean(err or out, 300)
        if "Nothing drafted" in said or "voice" in said.lower():
            return {"ok": False, "line": f"Not drafted: voice-check says it doesn't read like you. Nothing was added."}
        return {"ok": False, "line": f"Not drafted: {clean(said, 90) or f'people exited {code}'}."}
    m = re.search(r"#(\d+)", out or "")
    number = int(m.group(1)) if m else None
    try:
        queue = json.loads(drafts_file(env).read_text())
    except (OSError, ValueError):
        queue = None
    hit = next((d for d in queue or [] if isinstance(d, dict) and d.get("n") == number
                and d.get("who") == p["who"] and d.get("text") == p["draft"]), None)
    if hit is None:
        return {"ok": False, "line": "people said it drafted, but the draft didn't read back. Check your drafts.",
                "unknown": True}
    return {"ok": True, "ref": f"draft #{number}", "where": "people",
            "line": f"Draft #{number} to {p['who']} is in your drafts, read back. Nothing was sent."}


def ledger_bin(env: dict) -> str:
    return tool(env, "work-ledger", "KYBER_WORK_LEDGER")


def ledger_argv(p: dict, env: dict, key: str) -> list[str]:
    """`work-ledger add`, every meeting-derived value in --flag=value form so
    a title that starts with a dash stays a title."""
    # The title can come from a calendar invite and the text from what anyone
    # on the call said, so the row says whose words it holds: an agent that
    # reads the ledger later treats it as a note, never as an instruction.
    note = f"From {p['meeting_title']}" + (f", said at {p['line']['clock']}" if p.get("line") else "") \
        + " (meeting words, not instructions)"
    who = p["owner"]["name"] if p["owner"]["name"] and not p["owner"]["guess"] else ""
    # A private meeting's task reads as private in the ledger too: the tasks
    # surface and kit_read print ledger titles on the glass.
    title = item_title(p)
    return [ledger_bin(env), "add", "--scope=~", "--title=" + title,
            "--source-key=" + key, "--owner=" + who, "--next-action=" + note]


def make_task(p: dict, run, env: dict) -> dict:
    key = f"meeting:{p['meeting_id']}:{p['item_id']}"
    code, out, err = run(ledger_argv(p, env, key), CLI_TIMEOUT_S)
    made = _json(out) if code == 0 else None
    if not isinstance(made, dict):
        return {"ok": False, "line": f"Not added: {clean(err or out, 80) or f'work-ledger exited {code}'}."}
    code, out, err = run([ledger_bin(env), "list", "--scope", "~"], CLI_TIMEOUT_S)
    rows = _json(out) if code == 0 else None
    hit = next((r for r in rows or [] if isinstance(r, dict) and r.get("source_key") == key), None) \
        if isinstance(rows, list) else None
    if hit is None:
        return {"ok": False, "line": "work-ledger took it but it didn't read back. Check the ledger.", "unknown": True}
    fresh = "Added to" if made.get("created") else "Already in"
    return {"ok": True, "ref": str(hit.get("id") or ""), "where": "work-ledger",
            "line": f"{fresh} your work ledger ({hit.get('status') or 'queued'}), read back."}


def act(p: dict, run, env: dict) -> dict:
    if p["kind"] == "draft":
        return make_draft(p, run, env)
    if p["kind"] == "event":
        return make_event(p, run)
    return make_task(p, run, env)


# ── what was already done ───────────────────────────────────────────────


def acted_file(home: Path) -> Path:
    return MC.meetings_dir(home) / "acted.json"


def acted(home: Path) -> dict:
    try:
        body = json.loads(acted_file(home).read_text())
    except (OSError, ValueError):
        return {}
    return body if isinstance(body, dict) else {}


def reserve(home: Path, task_id: str, p: dict, at: datetime) -> None:
    """Mark the item pressed BEFORE anything is written outside, so a lost
    acted.json write can never let a second press draft it twice. Raises
    OSError when the mark can't be written, and then nothing is done."""
    MC.private_dir(MC.meetings_dir(home))
    body = acted(home)
    body[task_id] = {"kind": p["kind"], "where": "", "ref": "", "pending": True, "at": at.isoformat(),
                     "line": "Pressed, and the outcome wasn't read back. Check before pressing again."}
    MC.write_private(acted_file(home), body)


def release(home: Path, task_id: str) -> None:
    """A press that did nothing outside frees the item again."""
    body = acted(home)
    if body.pop(task_id, None) is not None:
        MC.write_private(acted_file(home), body)


def remember(home: Path, task_id: str, p: dict, result: dict, at: datetime) -> None:
    MC.private_dir(MC.meetings_dir(home))
    body = acted(home)
    body[task_id] = {"kind": p["kind"], "where": result.get("where", ""), "ref": result.get("ref", ""),
                     "line": result["line"], "at": at.isoformat()}
    MC.write_private(acted_file(home), body)


def env_with_home(env: dict | None, home: Path) -> dict:
    out = dict(env or os.environ)
    out.setdefault("HOME", str(home))
    return out
