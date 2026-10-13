"""Everyday jobs a person texts their own Mac, answered with no model.

`text-command` hands every texted command here before it would wake a model.
Four jobs people already do every day, each a whole sentence:

  what did Mom say           her last three texts, quoted as they came in
  remind me to X tomorrow    one reminder in their own Reminders
  what's due this week       the class ledger, when they keep one
  text Mom I'm running late  a DRAFT, which goes out only when they OK it
                             on the Mac

THE PRIVACY LINE. Nothing here asks a model anything. "What did Mom say" reads
Messages and Contacts on this Mac and quotes Mom's words back to the owner's
own thread, so another person's text is shown and never obeyed: no model
reads it, so a line in it saying "send money" or "ignore your rules" has
nothing to talk to.

THE SEND LINE. No job here sends to another person. "text Mom ..." queues a
draft with Mom's exact address pinned, and the owner sends it from the Mac
(`people texts drafts send <n>`, where the number is the approval). A phone
in someone else's hand can make a draft, never a text.

`route` reads and writes only through a `Readers`, so tests hand it a fake
Messages database and a fake Contacts book. CHEWBACCA_NO_SEND=1 also stops
the two writes (a reminder, a draft), so a rehearsal touches nothing.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

# Messages counts from 2001-01-01 UTC.
APPLE_EPOCH_UNIX = 978307200
# Three texts fit a lock-screen preview and still say what the thread is
# about. Guessed, never measured.
MOST_QUOTED = 3
# One quoted text past this is cut: the whole reply has to fit text-command's
# 900 characters with three of them in it.
MOST_QUOTED_CHARS = 200
# Past five, a list read on a phone stops being read. Same bound agenda.py
# uses for the spoken calendar.
MOST_DUE = 5
# A name in "text Mom Smith I'm late" is at most this many words. Three covers
# "Mary Ann Lee"; more starts eating the message.
MOST_NAME_WORDS = 3
# The class ledger answers in under a second warm; this covers a cold start.
TOOL_TIMEOUT_S = 15
# A bare "remind me tomorrow" lands at 9am, as `mac reminders add` documents.
MORNING, AFTERNOON, EVENING, NIGHT = 9, 14, 18, 20

NO_SEND_NOTE = " (test mode: nothing was added)"
# text-command never treats a text starting with this as a command (the
# brain's own briefs use it). A reply quoting someone else starts with it, so
# their words landing back in the owner's thread stay words even if the
# reply's fingerprint is ever lost.
NOT_A_COMMAND = "Chewbacca: "


def no_send() -> bool:
    return bool(os.environ.get("CHEWBACCA_NO_SEND"))


def body_text(text: str | None, blob: bytes | None) -> str:
    """The message's words. Since iOS 16 most arrive only in attributedBody,
    an archived NSAttributedString whose string follows the NSString class
    name, a '+' and a length (one byte, or 0x81 and two little-endian bytes)."""
    if text:
        return text
    if not blob:
        return ""
    at = blob.find(b"NSString")
    if at < 0:
        return ""
    plus = blob.find(b"+", at)
    if plus < 0 or plus + 1 >= len(blob):
        return ""
    size, start = blob[plus + 1], plus + 2
    if size == 0x81:
        size, start = int.from_bytes(blob[plus + 2:plus + 4], "little"), plus + 4
    return blob[start:start + size].decode("utf-8", "ignore")


def digits_key(handle: str) -> str:
    """A phone number as its last ten digits, an email lowercased: the form
    both Contacts and Messages agree on."""
    h = handle.strip().lower()
    if "@" in h:
        return h
    d = re.sub(r"\D", "", h)
    return d[-10:] if len(d) >= 10 else d


@dataclass
class Person:
    name: str
    handles: list[str] = field(default_factory=list)


@dataclass
class Said:
    at: float  # Apple seconds since 2001
    words: str
    in_group: bool


RELATIONS = {
    "mom": "mother", "mum": "mother", "mother": "mother", "mama": "mother",
    "dad": "father", "father": "father", "papa": "father",
    "wife": "spouse", "husband": "spouse", "partner": "partner",
    "brother": "brother", "sister": "sister", "son": "son", "daughter": "daughter",
}


class Readers:
    """The Mac's own Messages and Contacts, read-only, plus the two writes.

    `home` is the folder holding Library/; tests point it at a fake one."""

    def __init__(self, home: Path | None = None, chat_db: Path | None = None):
        self.home = Path(home or Path.home())
        self.chat_db = Path(chat_db or self.home / "Library" / "Messages" / "chat.db")

    # Contacts -------------------------------------------------------------
    def _books(self) -> list[str]:
        root = self.home / "Library" / "Application Support" / "AddressBook"
        return sorted(glob.glob(str(root / "Sources" / "*" / "AddressBook-v22.abcddb"))) + \
            [p for p in [str(root / "AddressBook-v22.abcddb")] if Path(p).exists()]

    def contacts(self, name: str) -> list[Person]:
        """Everyone whose name, first name or nickname is `name`, plus the
        person the owner's own card names as that relation ("Mom" when the
        card says Mother: Jane). People sharing a number are one person."""
        want = name.strip().lower()
        found: list[Person] = []
        for book in self._books():
            try:
                db = sqlite3.connect(f"file:{book}?mode=ro", uri=True)
            except sqlite3.Error:
                continue
            try:
                found += self._book_people(db, want)
            except sqlite3.Error:
                pass
            finally:
                db.close()
        return merge_people(found)

    def _book_people(self, db, want: str) -> list[Person]:
        names = [want]
        rel = RELATIONS.get(want)
        if rel:
            # Only the owner's own card: someone else's card listing their
            # mother is not the owner's Mom.
            names += [n.lower() for (n,) in db.execute(
                """select r.ZNAME from ZABCDRELATEDNAME r
                   where r.ZOWNER in (select ZME from ZABCDRECORD where ZME is not null)
                     and lower(r.ZLABEL) like ? and r.ZNAME is not null""", (f"%{rel}%",))]
        out = []
        for pk, first, last, nick, org in db.execute(
                "select Z_PK, ZFIRSTNAME, ZLASTNAME, ZNICKNAME, ZORGANIZATION from ZABCDRECORD"):
            full = " ".join(x for x in (first, last) if x).strip()
            keys = {(x or "").strip().lower() for x in (first, nick, full, org)} - {""}
            if not keys & set(names):
                continue
            handles = [n for (n,) in db.execute(
                "select ZFULLNUMBER from ZABCDPHONENUMBER where ZOWNER = ? and ZFULLNUMBER is not null", (pk,))]
            handles += [e for (e,) in db.execute(
                "select ZADDRESS from ZABCDEMAILADDRESS where ZOWNER = ? and ZADDRESS is not null", (pk,))]
            if handles:
                out.append(Person(full or nick or org or want, handles))
        return out

    # Messages -------------------------------------------------------------
    def messages_from(self, handles: list[str], most: int = MOST_QUOTED) -> list[Said]:
        """Their newest texts to the owner, in any thread, newest first."""
        keys = {digits_key(h) for h in handles}
        db = sqlite3.connect(f"file:{self.chat_db}?mode=ro", uri=True)
        try:
            ids = [rowid for rowid, hid in db.execute("select ROWID, id from handle")
                   if digits_key(hid or "") in keys]
            if not ids:
                return []
            marks = ",".join("?" * len(ids))
            rows = db.execute(
                f"""select m.date, m.text, m.attributedBody,
                           coalesce((select c.chat_identifier from chat_message_join j
                                     join chat c on c.ROWID = j.chat_id
                                     where j.message_id = m.ROWID limit 1), '')
                    from message m where m.handle_id in ({marks}) and m.is_from_me = 0
                    order by m.date desc limit ?""", (*ids, most * 3)).fetchall()
        finally:
            db.close()
        said = []
        for date, text, blob, chat in rows:
            words = body_text(text, blob).replace("￼", "[photo]").strip()
            if words:
                said.append(Said((date or 0) / 1e9, words, chat.startswith("chat")))
            if len(said) == most:
                break
        return said

    def address_for(self, handles: list[str]) -> str:
        """The address Messages already knows them by (+13105550101, not the
        card's "(310) 555-0101"), so a draft is pinned to the thread the owner
        has actually been texting. The card's first handle when there is none."""
        keys = [digits_key(h) for h in handles]
        try:
            db = sqlite3.connect(f"file:{self.chat_db}?mode=ro", uri=True)
            try:
                known = {digits_key(hid or ""): hid for (hid,) in db.execute("select id from handle")}
            finally:
                db.close()
        except sqlite3.Error:
            known = {}
        return next((known[k] for k in keys if k in known), handles[0])

    # The class ledger -----------------------------------------------------
    def coursework_due(self, days: int) -> dict | None:
        if not shutil.which("coursework"):
            return None
        try:
            done = subprocess.run(["coursework", "due", "--days", str(days), "--json"],
                                  capture_output=True, text=True, timeout=TOOL_TIMEOUT_S)
            return json.loads(done.stdout) if done.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            return None

    # The two writes, both the owner's own words and never a send ----------
    def add_reminder(self, title: str, due: str | None) -> tuple[bool, str]:
        argv = ["mac", "reminders", "add", title, "--quiet"] + (["--due", due] if due else [])
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as err:
            return False, str(err)
        last = (done.stderr or done.stdout).strip().splitlines()
        return done.returncode == 0, last[-1] if last else ""

    def add_draft(self, name: str, handle: str, words: str) -> tuple[bool, str]:
        # --voice-ok: the owner typed these words themselves.
        argv = ["people", "texts", "drafts", "add", name, words, "--to", handle,
                "--voice-ok", "--why", "texted from your phone"]
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as err:
            return False, str(err)
        out = re.sub(r"\x1b\[[0-9;]*m", "", done.stdout + done.stderr)
        n = re.search(r"#(\d+)", out)
        return done.returncode == 0, n.group(1) if n else out.strip()[:120]


def merge_people(found: list[Person]) -> list[Person]:
    """Contacts keeps one card per account, so one person is often two cards
    with the same number. Cards sharing any handle are one person."""
    merged: list[Person] = []
    for p in found:
        keys = {digits_key(h) for h in p.handles}
        for m in merged:
            if keys & {digits_key(h) for h in m.handles}:
                m.handles += [h for h in p.handles if digits_key(h) not in {digits_key(x) for x in m.handles}]
                break
        else:
            merged.append(Person(p.name, list(p.handles)))
    return merged


# ---------------------------------------------------------------- phrasing

def _norm(asked: str) -> str:
    s = asked.strip().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^(?:(?:hey|ok|okay|so|please|pls|plz|can you|could you)[,]?\s+)+", "", s, flags=re.I)
    return s.rstrip(" ?!.")


SAID = [
    re.compile(r"^what did (?P<who>.+?) (?:say|text|send|write)(?: me| to me)?(?: today| last| lately| earlier| yesterday)?$", re.I),
    re.compile(r"^what(?:'s|s| is| was) (?P<who>.+?) (?:saying|texting)(?: me)?$", re.I),
    re.compile(r"^did (?P<who>.+?) (?:text|message|reply|write)(?: me| back)?(?: today| yet)?$", re.I),
    re.compile(r"^(?:any |last |latest |new )?(?:texts?|messages?) from (?P<who>.+)$", re.I),
    re.compile(r"^what(?:'s|s| is) the last thing (?P<who>.+?) (?:said|texted|sent)(?: me)?$", re.I),
]
DUE = re.compile(r"^(?:what(?:'s|s| is| do i have) due|anything due|what homework do i have)(?P<when> today| tomorrow| this week| next week| soon)?$", re.I)
REMIND = [
    re.compile(r"^remind me (?P<when>tomorrow(?: morning| afternoon| evening| night)?|tonight|this (?:morning|afternoon|evening)"
               r"|in \d+ (?:min(?:ute)?s?|hours?|hrs?)|on \w+day)(?: at (?P<at>[\d: ]+(?:am|pm)?))? (?:to |about |that )?(?P<what>.+)$", re.I),
    re.compile(r"^remind me (?:to |about |that )?(?P<what>.+?)(?: (?P<when>tomorrow(?: morning| afternoon| evening| night)?|tonight"
               r"|this (?:morning|afternoon|evening)|in \d+ (?:min(?:ute)?s?|hours?|hrs?)|on \w+day))?(?: at (?P<at>[\d: ]+(?:am|pm)?))?$", re.I),
]
DRAFT = re.compile(r"^(?:text|tell|message|msg|imessage) (?P<rest>.+)$", re.I)
# Words that sit where a name goes and never are one: "what did that say" asks
# about a link, "tell him" has nobody to look up.
NOT_A_NAME = {"me", "i", "myself", "us", "everyone", "everybody", "all", "you", "it", "that", "this",
              "he", "she", "they", "him", "her", "them", "it say", "the email", "the article", "the link"}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _clean_who(who: str) -> str:
    who = re.sub(r"^(?:my|the)\s+", "", who.strip(), flags=re.I)
    return who.strip(" ,:")


def when_label(apple_s: float, now: datetime) -> str:
    at = datetime.fromtimestamp(apple_s + APPLE_EPOCH_UNIX)
    clock = at.strftime("%-I:%M%p").lower()
    days = (now.date() - at.date()).days
    if days == 0:
        return clock
    if days == 1:
        return f"Yesterday {clock}"
    if days < 7:
        return f"{at.strftime('%a')} {clock}"
    return at.strftime("%b %-d")


def _hour(at: str) -> tuple[int, int] | None:
    m = re.match(r"^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$", at or "", re.I)
    if not m:
        return None
    h, mins, half = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
    if h > 23 or mins > 59:
        return None
    if half == "pm" and h < 12:
        h += 12
    if half == "am" and h == 12:
        h = 0
    return h, mins


def due_at(when: str | None, at: str | None, now: datetime) -> datetime | None:
    """The moment "tomorrow", "at 5", "in 20 minutes" or "on friday at 3"
    means, so the reminder gets an exact time and never a guess by another
    parser. None when the text named no time at all."""
    when = (when or "").strip().lower()
    clock = _hour(at) if at else None
    if at and clock is None:
        return None
    m = re.match(r"in (\d+) (min|hour|hr)", when)
    if m:
        n = int(m.group(1))
        return now + (timedelta(minutes=n) if m.group(2) == "min" else timedelta(hours=n))
    base = now.replace(second=0, microsecond=0)
    if when.startswith("tomorrow"):
        day = base + timedelta(days=1)
    elif when.startswith("on "):
        name = when[3:]
        if name not in DAYS:
            return None
        ahead = (DAYS.index(name) - base.weekday()) % 7 or 7
        day = base + timedelta(days=ahead)
    else:
        day = base
    part = {"morning": MORNING, "afternoon": AFTERNOON, "evening": EVENING, "night": NIGHT,
            "tonight": NIGHT}
    hour = next((h for k, h in part.items() if k in when), None)
    if clock:
        h, mins = clock
        if not re.search(r"am|pm", at, re.I):
            # "tomorrow at 5" is 5pm: 1 to 7 with no am or pm reads as
            # afternoon, the way people say it. 8 to 11 today is the next one
            # still ahead, so "at 9" after breakfast is 9 tonight.
            if 1 <= h <= 7:
                h += 12
            elif h < 12 and when in ("", "today") and base.replace(hour=h, minute=mins) <= now:
                h += 12
        moment = day.replace(hour=h, minute=mins)
        if when == "" and moment <= now:
            moment += timedelta(days=1)
        return moment
    if hour is not None:
        return day.replace(hour=hour, minute=0)
    if when.startswith("tomorrow") or when.startswith("on "):
        return day.replace(hour=MORNING, minute=0)
    return None


def say_moment(t: datetime, now: datetime) -> str:
    clock = t.strftime("%-I:%M%p").lower().replace(":00", "")
    days = (t.date() - now.date()).days
    if days == 0:
        return f"today at {clock}"
    if days == 1:
        return f"tomorrow at {clock}"
    if days < 7:
        return f"{t.strftime('%A')} at {clock}"
    return f"{t.strftime('%b %-d')} at {clock}"


# ---------------------------------------------------------------- the jobs

def said(who: str, readers: Readers, now: datetime) -> str:
    people = readers.contacts(who)
    if not people:
        return f"I couldn't find {who} in your Contacts."
    if len(people) > 1:
        names = ", ".join(p.name for p in people[:4])
        return f"Which {who}? {names}. Text again with the full name."
    person = people[0]
    try:
        texts = readers.messages_from(person.handles)
    except sqlite3.Error:
        return "I can't read Messages on this Mac yet. It needs Full Disk Access in System Settings."
    if not texts:
        return f"Nothing from {person.name} in your Messages."
    lines = [f"{NOT_A_COMMAND}{person.name}'s last {'text' if len(texts) == 1 else str(len(texts)) + ' texts'}:"]
    for t in texts:
        words = re.sub(r"\s+", " ", t.words)
        if len(words) > MOST_QUOTED_CHARS:
            words = words[:MOST_QUOTED_CHARS - 1].rstrip() + "…"
        lines.append(f"{when_label(t.at, now)}{' (group)' if t.in_group else ''}: {words}")
    return "\n".join(lines)


def due(when: str, readers: Readers, now: datetime) -> str | None:
    days = {"today": 0, "tomorrow": 1, "this week": 7, "next week": 14, "soon": 3}.get(when.strip().lower(), 7)
    data = readers.coursework_due(max(days, 1))
    if data is None:
        return None
    late = data.get("overdue") or []
    ahead = [x for x in data.get("upcoming") or []
             if (datetime.fromisoformat(x["date"]).date() - now.date()).days <= days]
    if not ahead and not late:
        return "Nothing due" + (" today." if days == 0 else f" in the next {days} days.")
    lines = []
    for x in ahead[:MOST_DUE]:
        d = (datetime.fromisoformat(x["date"]).date() - now.date()).days
        when_s = "today" if d == 0 else "tomorrow" if d == 1 else datetime.fromisoformat(x["date"]).strftime("%a %b %-d")
        lines.append(f"{x.get('course', '').strip()}: {x.get('name', '').strip()}, {when_s}")
    if len(ahead) > MOST_DUE:
        lines.append(f"and {len(ahead) - MOST_DUE} more")
    head = f"{len(ahead)} due" if ahead else "Nothing new due"
    if late:
        head += f", {len(late)} past due"
    return head + (":\n" + "\n".join(lines) if lines else ".")


def remind(m: re.Match, readers: Readers, now: datetime) -> str:
    what = m.group("what").strip(" ,.")
    if not what:
        return "Remind you of what? Text: remind me to call the dentist tomorrow"
    moment = due_at(m.group("when"), m.group("at"), now)
    if (m.group("when") or m.group("at")) and moment is None:
        return "I couldn't tell when. Try: remind me to call the dentist tomorrow at 3pm"
    stamp = moment.strftime("%Y-%m-%d %H:%M") if moment else None
    told = f'"{what}"' + (f", {say_moment(moment, now)}" if moment else "")
    if no_send():
        return f"Would add to Reminders: {told}{NO_SEND_NOTE}"
    ok, why = readers.add_reminder(what, stamp)
    return f"Added to Reminders: {told}" if ok else f"Couldn't add that reminder. {why}".strip()


def draft(rest: str, readers: Readers) -> str | None:
    words = rest.split()
    for n in range(min(MOST_NAME_WORDS, len(words) - 1), 0, -1):
        who = _clean_who(" ".join(words[:n]))
        if who.lower() in NOT_A_NAME:
            return None
        people = readers.contacts(who)
        if not people:
            continue
        body = re.sub(r"^(?:that|to say|saying|:|,)\s*", "", " ".join(words[n:]), flags=re.I).strip()
        if not body:
            return f"What should the text to {people[0].name} say?"
        if len(people) > 1:
            names = ", ".join(p.name for p in people[:4])
            return f"Which {who}? {names}. Text again with the full name."
        person = people[0]
        handle = readers.address_for(person.handles)
        if no_send():
            return f'Would save a draft to {person.name}: "{body}"{NO_SEND_NOTE}'
        ok, n_or_why = readers.add_draft(person.name, handle, body)
        if not ok:
            return f"Couldn't save that draft. {n_or_why}".strip()
        return (f'Draft #{n_or_why} to {person.name}: "{body}". It won\'t send until you '
                "OK it on your Mac.")
    # No name in Contacts: not a draft after all. Replayed on the voice log
    # 2026-10-13, "Text that is a poem about LeBron James..." was a request
    # for a poem, and answering "I couldn't find that in your Contacts" would
    # have eaten it.
    return None


def route(asked: str, readers: Readers | None = None, now: datetime | None = None) -> str | None:
    """The reply to a texted command, or None when it isn't one of these jobs
    and the caller should do whatever it does next (a model, for text-command)."""
    readers = readers or Readers()
    now = now or datetime.now()
    s = _norm(asked)
    if not s:
        return None
    m = DUE.match(s)
    if m:
        return due(m.group("when") or "", readers, now)
    for shape in SAID:
        m = shape.match(s)
        if m:
            who = _clean_who(m.group("who"))
            if who.lower() in NOT_A_NAME:
                return None
            return said(who, readers, now)
    if s.lower().startswith("remind me"):
        for shape in REMIND:
            m = shape.match(s)
            if m:
                return remind(m, readers, now)
    m = DRAFT.match(s)
    if m:
        return draft(m.group("rest"), readers)
    return None
