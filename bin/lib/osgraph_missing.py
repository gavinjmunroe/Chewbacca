"""What am I missing: one walk that joins each commitment to what it needs and
to the commitments around it (CHW-204).

Ghost's best moment ("you have a demo on Monday, but you're still missing the
GPU") and Muse's conflict catch both need this, and no other walk does it
(docs/plans/COMPETITORS.md, gap 3). Every answer is a rule over the OS graph,
with no generative model anywhere on the path:

    blocked      an Assignment due soon whose reading or pre-lab in the same
                 course is still open; a meeting in the next three days with
                 someone whose text to you is still unanswered
    conflict     two calendar events with other people that overlap
    lapsed       your own "I'll send it tonight", past its time, with nothing
                 from you in that thread since
    late reply   a one-to-one ask from a saved contact, waiting a day or more,
                 whose newest message itself asks something
    announced    a group text names a meeting at a time, and your calendar has
                 nothing near it (always a guess)

Each finding is ONE typed edge written back to the graph under the source
"missing" (BLOCKED_BY, CONFLICTS_WITH, OVERDUE_SINCE, LAPSED_ON, ANNOUNCES in
osgraph.EDGE_TYPES), with `provenance` naming the message, event or ledger row
it stands on and a confidence. Below GUESS_BELOW the row says "(guess)"
(kyber-surfaces rule 13).

The text rules here (PROMISE, EVENT_WORD, the day and clock words) are read by
the iMessage ingester, which turns a matching message into a commitment Task or
an announcement; this file only reads the graph.

Not a finding, on purpose: an assignment the ledger still calls open past its
due date. needs-you already lists it, and on the ten dev days of the CHW-204
replay the ledger's "overdue" was wrong 6 times out of 8 labeled (in-class
work done and confirmed days later), which alone would break "wrong under 2
in 20".

What it cannot see yet: a call with no prep doc (no document source is in the
graph), travel with no ride or lodging thread (no travel source), a class
meeting against a meeting (classes are not ingested as events), and a promise
made by voice or in mail.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

import osgraph
from osgraph import ME, Edge, Graph, day_node

SOURCE = "missing"
# A row below this confidence says "(guess)"; the same line walks.py draws.
GUESS_BELOW = 0.7
MOST_ROWS = 9
PER_KIND = 3
# A one-to-one ask is late once it has waited this long. A day is the line
# Caleb's own `people texts owed` uses for "owed"; guessed, never measured
# against what he calls late.
LATE_REPLY_H = 24
# A meeting this far ahead is close enough that an unanswered ask from the
# person matters now. The same 72 hours needs-you calls "due soon".
MEETING_AHEAD_H = 72
# An assignment due this many days out pulls in its unfinished readings and
# pre-labs. Guessed, never measured.
PREREQ_AHEAD_DAYS = 3
# Two events overlapping by less than this are back to back, not double booked.
CONFLICT_MIN = 15
# A promise for "tonight" kept the next morning is kept. Guessed, never measured.
PROMISE_GRACE_H = 12
# An announcement is covered by any calendar event that day within this many
# hours of the time it names. Guessed, never measured.
ANNOUNCE_SLACK_H = 2
ANNOUNCE_AHEAD_DAYS = 7
# Readings and pre-labs are what an assignment or a lab session needs first.
PREREQ_TYPES = {"reading", "prelab", "pre-lab"}
PREREQ_NAME = re.compile(r"\bpre-?lab\b|^read\b", re.I)

KIND_ORDER = {"blocked": 1, "conflict": 2, "lapsed": 3, "late": 4, "announced": 5}
KIND_WORD = {"blocked": "not ready", "conflict": "double-booked", "lapsed": "you said you would",
             "late": "waiting on you", "announced": "not on your calendar"}

# ── the text rules the iMessage ingester applies ─────────────────────────

# What makes a message ask HIM for an answer, stricter than the ingester's
# AWAITS_REPLY_FROM rule (osgraph_ingest.ASK). On the CHW-204 dev days the
# looser rule flagged "Yeah I'm free tmrw" (its `free tmr` clause), a
# supportive paragraph with an earlier question in the burst, and "Sorry imma
# be 10 late" after a "can we do 9?" for a meetup that had already happened.
# Only second-person asks count, and only in the newest message (late_replies).
LATE_ASK = re.compile(
    r"\?|\b(can|could|would|will|do|did|are|were|have|r) (you|u)\b|\blmk\b|let me know|\b(u|you) free\b|"
    r"when (are|r|can) (you|u)|\b(call|text|email|ping) me\b|send (me|over|it)\b|need (you|u) to\b", re.I)
URL = re.compile(r"https?://\S+", re.I)
TAPBACK = re.compile(r"^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned|Reacted .{1,8} to) \u201c", re.I)


def asks(text: str) -> bool:
    """Does this one message ask the reader something? A shared link's
    "?si=..." is not a question."""
    t = URL.sub(" ", str(text or "")).strip()
    return bool(t) and not TAPBACK.match(t) and bool(LATE_ASK.search(t))


WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
SHORT_DAYS = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4, "sat": 5, "sun": 6}
DAY_WORD = (r"(tonight|tonite|tn|today|later today|tmr|tmrw|tomorrow|this (?:morning|afternoon|evening|weekend)|"
            r"eod|end of (?:the )?day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
            r"mon|tues?|wed|thur?s?|fri|sat|sun|\d{1,2}/\d{1,2})")
DAY_RE = re.compile(rf"\b{DAY_WORD}\b", re.I)
# His own words for doing a thing for someone. A verb the person can be
# waiting on, not "I'll be there" or "I'll see".
PROMISE = re.compile(
    r"\b(?:i'?ll|i will|imma|ima|i'?m gonna|i'?m going to|will)\s+(?:\w+\s+){0,2}?"
    r"(send|get|text|call|email|share|forward|finish|have|make|bring|pay|venmo|zelle|submit|write|fill|"
    r"review|read|post|drop|ship|push|book|set up|ft|facetime)\b", re.I)
# The rule sample (Sep 1 to 17, before every eval day) had journal entries and
# a pasted email match a verb and a day word; a promise is short.
PROMISE_MAX_CHARS = 160
# A resolution to himself is not a promise to the person reading it: "Moving
# forwards I'm going to make it a goal to finish most work before friday" was
# the one wrong promise row on the CHW-204 dev days.
SELF_RESOLUTION = re.compile(r"\b(goal|habit|priority|resolution)\b", re.I)
# His next message counts as following up only if it comes this long after the
# promise. The messages he fires off in the same minute are the rest of the
# same burst: on the dev days "I will text everyone individually tmr" read as
# followed up by its own next line, sent the same minute, and the real silence
# that followed (until he was asked about it five days later) never showed.
FOLLOW_UP_GAP = timedelta(hours=1)
EVENT_WORD = re.compile(
    r"\b(meeting|mtg|practice|rehearsal|service|dinner|lunch|breakfast|standup|stand-up|game|party|"
    r"bible study|study session|kickoff|interview|workshop|gathering|worship|devo|devotional|call)\b", re.I)
CLOCK = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b", re.I)
ANNOUNCE_MAX_CHARS = 200
# "Anyone down for breakfast at 8 tomorrow?" invites; it is not on anyone's
# calendar yet, so it is not something he is missing (rule sample, Sep 1).
INVITE = re.compile(r"\b(anyone|who'?s|who is|y'?all|you guys|u guys) (down|free|tryna|want|wanna|coming)\b|\?\s*$", re.I)


def day_of(word: str, at: datetime) -> date | None:
    """The calendar day a day word means, said at `at`."""
    w = word.lower().strip()
    today = at.date()
    if w in ("tonight", "tonite", "tn", "today", "later today", "eod") or w.startswith(("this morning", "this afternoon",
                                                                                        "this evening", "end of")):
        return today
    if w in ("tmr", "tmrw", "tomorrow"):
        return today + timedelta(days=1)
    if w == "this weekend":
        return today + timedelta(days=(6 - today.weekday()) % 7)
    if "/" in w:
        try:
            month, day = (int(x) for x in w.split("/"))
            found = date(today.year, month, day)
        except ValueError:
            return None
        return found if found >= today - timedelta(days=1) else None
    idx = WEEKDAYS.index(w) if w in WEEKDAYS else SHORT_DAYS.get(w)
    if idx is None:
        return None
    return today + timedelta(days=(idx - today.weekday()) % 7)


def promise_due(text: str, at: datetime) -> datetime | None:
    """When his own message says a thing will be done by, or None when it
    makes no promise with a day in it."""
    text = " ".join(str(text or "").replace("\u2019", "'").split())
    if not text or len(text) > PROMISE_MAX_CHARS:
        return None
    m = PROMISE.search(text)
    if not m or SELF_RESOLUTION.search(text):
        return None
    # The day word has to sit in the same sentence as the promise.
    sentence = re.split(r"(?<=[.!?])\s+", text[m.start():], maxsplit=1)[0]
    d = DAY_RE.search(sentence) or DAY_RE.search(text[:m.start()].split(".")[-1])
    if not d:
        return None
    day = day_of(d.group(1), at)
    if day is None:
        return None
    word = d.group(1).lower()
    hour = 12 if "morning" in word else 18 if "afternoon" in word else 23
    minute = 0 if hour != 23 else 59
    return datetime.combine(day, time(hour, minute), tzinfo=at.tzinfo)


def announced_at(text: str, at: datetime) -> datetime | None:
    """When a group text says a meeting happens, or None. Needs a meeting
    word, a day word and a clock time; an open invitation does not count."""
    text = " ".join(str(text or "").replace("\u2019", "'").split())
    if not text or len(text) > ANNOUNCE_MAX_CHARS or not EVENT_WORD.search(text) or INVITE.search(text):
        return None
    d, c = DAY_RE.search(text), CLOCK.search(text)
    if not d or not c:
        return None
    day = day_of(d.group(1), at)
    if day is None:
        return None
    hour = int(c.group(1) or c.group(4))
    minute = int(c.group(2) or c.group(5) or 0)
    half = (c.group(3) or "").lower()
    if half.startswith("p") and hour < 12:
        hour += 12
    elif not half and 1 <= hour <= 7:
        hour += 12  # "practice at 6" is the evening
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    when = datetime.combine(day, time(hour, minute), tzinfo=at.tzinfo)
    return when if when > at else None


# ── the walk ─────────────────────────────────────────────────────────────


def when_of(value) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.astimezone()


def _day(g: Graph, nid: str) -> str:
    days = [e["dst"][4:] for e in g.edges(src=nid, verb="DUE_ON")]
    return min(days) if days else ""


def _people(g: Graph, nid: str, verbs=("PARTICIPANT", "SENT_BY", "OWED_TO")) -> list[dict]:
    out = []
    for verb in verbs:
        out += [p for p in g.out(nid, verb) if p["id"] != ME]
    return out


def _attendees(g: Graph, event_id: str) -> list[tuple[dict, float]]:
    out = []
    for e in g.edges(verb="ATTENDS", dst=event_id):
        if e["src"] == ME:
            continue
        p = g.node(e["src"])
        if p:
            out.append((p, float(e.get("confidence", 1.0))))
    return out


def _waiting(g: Graph) -> dict[str, list[tuple[dict, dict]]]:
    """Person id -> [(thread or mail, its AWAITS_REPLY_FROM edge)] waiting on me."""
    out: dict[str, list] = {}
    for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME):
        node = g.node(e["src"])
        if not node or node["props"].get("group") or not newest_asks(g, node):
            continue
        for p in _people(g, node["id"], ("PARTICIPANT", "SENT_BY")):
            out.setdefault(p["id"], []).append((node, e))
    return out


class Finding:
    def __init__(self, kind: str, node: dict, verb: str, target: str, confidence: float, when: str,
                 provenance: str, why: str, act_on: dict | None = None, extra: dict | None = None):
        self.kind, self.node, self.verb, self.target = kind, node, verb, target
        self.confidence, self.when, self.provenance, self.why = confidence, when, provenance, why
        # The node the row's one action works on: the thread to answer, the
        # assignment to open. The row itself is the commitment.
        self.act_on = act_on or node
        self.extra = extra or {}

    def edge(self) -> Edge:
        return Edge(self.node["id"], self.verb, self.target,
                    props={"kind": self.kind, "provenance": self.provenance, "why": self.why, **self.extra},
                    confidence=self.confidence)


def _fmt(moment: datetime | None) -> str:
    if moment is None:
        return ""
    return moment.strftime("%a %-I:%M%p").replace(":00", "").lower().capitalize()


def _is_prereq(node: dict) -> bool:
    p = node["props"]
    return str(p.get("type") or "").lower() in PREREQ_TYPES or bool(PREREQ_NAME.search(p.get("name") or ""))


def blocked_assignments(g: Graph, now: datetime) -> list[Finding]:
    today = now.date()
    horizon = (today + timedelta(days=PREREQ_AHEAD_DAYS)).isoformat()
    items = []
    for e in g.edges(verb="OWED_BY", dst=ME):
        node = g.node(e["src"])
        if node and node["type"] == "Assignment":
            items.append((node, _day(g, node["id"])))
    out = []
    for node, day in items:
        if not day or _is_prereq(node) or node["props"].get("overdue") or not (today.isoformat() <= day <= horizon):
            continue
        course = node["props"].get("course", "")
        for pre, pday in items:
            if pre["id"] == node["id"] or not _is_prereq(pre) or pre["props"].get("course", "") != course:
                continue
            if not pday or pday > day:
                continue
            out.append(Finding("blocked", node, "BLOCKED_BY", pre["id"], 0.7, day,
                               f"coursework ledger, {course}: {pre['label']} still open",
                               f"needs {pre['props'].get('name') or pre['label']} first",
                               act_on=pre))
    return out


def blocked_meetings(g: Graph, now: datetime, waiting: dict) -> list[Finding]:
    """A meeting in the next three days with someone whose ask is unanswered.
    The person comes from the invite's attendees; failing that, from a title
    word that is exactly the first name of ONE person waiting on you, which is
    a guess and says so (never a merge: the edge is to the thread, and the
    title only chose which thread)."""
    out = []
    end = now + timedelta(hours=MEETING_AHEAD_H)
    by_first: dict[str, list[str]] = {}
    for pid in waiting:
        p = g.node(pid)
        if p and not p["unresolved"]:
            first = (p["label"].split() or [""])[0].lower()
            by_first.setdefault(first, []).append(pid)
    for event in g.nodes("Event"):
        start = when_of(event["props"].get("start"))
        if start is None or not (now <= start <= end) or event["props"].get("all_day"):
            continue
        found: list[tuple[str, float, str]] = []
        for p, conf in _attendees(g, event["id"]):
            if p["id"] in waiting:
                found.append((p["id"], conf, "on the invite"))
        if not found:
            words = set(re.findall(r"[a-z]+", event["label"].lower()))
            for first, pids in by_first.items():
                if first in words and len(pids) == 1:
                    found.append((pids[0], 0.6, "named in the title"))
        for pid, conf, how in found:
            for thread, edge in waiting.get(pid, []):
                person = g.node(pid) or {"label": "them"}
                since = when_of(edge["props"].get("since"))
                out.append(Finding(
                    "blocked", event, "BLOCKED_BY", thread["id"], round(min(conf, float(edge["confidence"])), 2),
                    event["props"].get("start", ""),
                    f"calendar {_fmt(start)}, {person['label']} {how}; their text {_fmt(since)} is unanswered",
                    f"{person['label'].split()[0]} is waiting on your reply", act_on=thread))
    return out


def conflicts(g: Graph, now: datetime) -> list[Finding]:
    """Two timed events, each with at least one other person on it, that
    overlap by CONFLICT_MIN or more. A block he put on his own calendar
    ("Lock in", "Leg day") has nobody else on it and never counts."""
    events = []
    for event in g.nodes("Event"):
        p = event["props"]
        start, end = when_of(p.get("start")), when_of(p.get("end"))
        if start is None or end is None or p.get("all_day") or end <= now:
            continue
        if int(p.get("others") or 0) < 1:
            continue
        events.append((start, end, event))
    events.sort(key=lambda x: x[0])
    out = []
    for i, (s1, e1, a) in enumerate(events):
        for s2, e2, b in events[i + 1:]:
            if s2 >= e1:
                break
            overlap = (min(e1, e2) - max(s1, s2)).total_seconds() / 60
            if overlap < CONFLICT_MIN or a["label"].lower() == b["label"].lower():
                continue
            out.append(Finding("conflict", a, "CONFLICTS_WITH", b["id"], 0.8, a["props"].get("start", ""),
                               f"calendar {_fmt(s1)} and {_fmt(s2)}, {int(overlap)} minutes overlap",
                               f"overlaps {b['label']}", extra={"other": b["label"]}))
    return out


def lapsed(g: Graph, now: datetime) -> list[Finding]:
    out = []
    for task in g.nodes("Task"):
        p = task["props"]
        if p.get("kind") != "commitment":
            continue
        due = when_of(p.get("due_at"))
        if due is None or now < due + timedelta(hours=PROMISE_GRACE_H):
            continue
        followed = when_of(p.get("followed_at"))
        if followed is not None and followed <= now:
            continue
        threads = [t for m in g.out(task["id"], "EXTRACTED_FROM") for t in g.out(m["id"], "IN_THREAD")]
        out.append(Finding("lapsed", task, "LAPSED_ON", f"day:{due.date().isoformat()}", float(task["confidence"]),
                           p.get("due_at", ""), p.get("provenance", "your text"),
                           f"you said by {_fmt(due)}; nothing from you since",
                           act_on=threads[0] if threads else task))
    return out


def newest_asks(g: Graph, node: dict) -> bool:
    """Whether the newest thing they sent since his last message asks him
    something. Mail is one message, so its subject line decides. A message
    an ingester stored without an `asks` mark is read from its label."""
    if node["type"] == "MailItem":
        return asks(node["label"])
    msgs = sorted(g.into(node["id"], "IN_THREAD"), key=lambda m: str(m["props"].get("at", "")))
    for m in reversed(msgs):
        p = m["props"]
        if p.get("from_me"):
            return False
        text = m["label"]
        if not text or text in ("Attachment", "\ufffc") or TAPBACK.match(text):
            continue
        return bool(p["asks"]) if "asks" in p else asks(text)
    return False


def late_replies(g: Graph, now: datetime) -> list[Finding]:
    out = []
    for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME):
        node = g.node(e["src"])
        if not node or node["props"].get("group"):
            continue
        since = when_of(e["props"].get("since"))
        if since is None or now - since < timedelta(hours=LATE_REPLY_H):
            continue
        if not newest_asks(g, node):
            continue
        people = _people(g, node["id"], ("PARTICIPANT", "SENT_BY"))
        # A saved contact only: an unsaved number asking "u free tmr?" is
        # usually a blast, and needs-you already lists it.
        if not people or any(p["unresolved"] for p in people):
            continue
        hours = int((now - since).total_seconds() // 3600)
        waited = f"{hours // 24}d" if hours >= 48 else f"{hours}h"
        network = node["props"].get("app") or node["props"].get("network") or "text"
        out.append(Finding("late", node, "OVERDUE_SINCE", f"day:{since.date().isoformat()}",
                           float(e["confidence"]), e["props"].get("since", ""),
                           f"{network}, {people[0]['label']}'s message {_fmt(since)}",
                           f"{people[0]['label'].split()[0]} waiting {waited}"))
    return out


def announced(g: Graph, now: datetime) -> list[Finding]:
    starts = []
    for event in g.nodes("Event"):
        s = when_of(event["props"].get("start"))
        if s is not None:
            starts.append(s)
    out = []
    end = now + timedelta(days=ANNOUNCE_AHEAD_DAYS)
    for msg in g.nodes("Message"):
        at = when_of(msg["props"].get("announces"))
        if at is None or not (now <= at <= end):
            continue
        if any(abs((s - at).total_seconds()) <= ANNOUNCE_SLACK_H * 3600 for s in starts):
            continue
        sender = next(iter(g.out(msg["id"], "SENT_BY")), None)
        thread = next(iter(g.out(msg["id"], "IN_THREAD")), None)
        where = thread["label"] if thread else "a group"
        out.append(Finding("announced", msg, "ANNOUNCES", f"day:{at.date().isoformat()}", 0.5,
                           at.isoformat(), f"{sender['label'] if sender else 'someone'}'s text in {where}",
                           f"{_fmt(at)} in {where}, not on your calendar", extra={"at": at.isoformat()}))
    return out


def findings(g: Graph, now: datetime) -> list[Finding]:
    waiting = _waiting(g)
    found = (blocked_assignments(g, now) + blocked_meetings(g, now, waiting) + conflicts(g, now)
             + lapsed(g, now) + late_replies(g, now) + announced(g, now))
    # One fact, one row: a thread that blocks a meeting is not also listed as
    # a late reply, and the same pair of events is one conflict.
    blocking = {f.target for f in found if f.kind == "blocked"}
    seen, out = set(), []
    for f in sorted(found, key=lambda f: (KIND_ORDER[f.kind], -f.confidence)):
        if f.kind == "late" and f.node["id"] in blocking:
            continue
        key = (f.kind, *sorted((f.node["id"], f.target))) if f.kind == "conflict" else (f.kind, f.node["id"], f.target)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def write(g: Graph, found: list[Finding]) -> dict:
    """Every finding as its edge, replacing the last pass's (Graph.apply)."""
    days = {f.target for f in found if f.target.startswith("day:")}
    nodes = [day_node(d[4:]) for d in days]
    edges = [f.edge() for f in found]
    for e, f in zip(edges, found):
        e.props["when"] = f.when
    return g.apply(SOURCE, nodes, edges)


def _sort_when(f: Finding) -> float:
    moment = when_of(f.when) if "T" in str(f.when) else (
        datetime.fromisoformat(f.when + "T12:00:00").astimezone() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(f.when))
        else None)
    return moment.timestamp() if moment else float("inf")


def missing(g: Graph, now: datetime, persist: bool = True) -> dict:
    """The rows for "what am I missing": worst first, at most nine, at most
    three of one kind before the others get theirs (kyber-surfaces rule 3)."""
    import osgraph_walks as W  # noqa: PLC0415  osgraph_walks imports this module lazily

    found = findings(g, now)
    if persist:
        write(g, found)
    rows = []
    for f in found:
        tier = W.BLOCKED if f.kind in ("blocked", "conflict", "lapsed") else (
            W.DUE if f.kind == "late" else W.FYI)
        r = W.row(g, f.node, tier, f.when, f.why)
        r.update({"group": f.kind, "kind": f.kind, "finding": KIND_WORD[f.kind], "verb": f.verb, "target": f.target,
                  "provenance": f.provenance, "confidence": f.confidence, "act_on": f.act_on["id"],
                  "act_type": f.act_on["type"], "act_props": f.act_on.get("props") or {},
                  "act_label": f.act_on.get("label", ""), "rank": (KIND_ORDER[f.kind], _sort_when(f))})
        if f.act_on["id"] != f.node["id"]:
            seen = {c["id"] for c in r["chips"]}
            r["chips"] = (r["chips"] + [c for c in W.chips(g, f.act_on) if c["id"] not in seen])[:4]
        rows.append(r)
    rows.sort(key=lambda r: r["rank"])
    kept, spill, per = [], [], {}
    for r in rows:
        if per.get(r["kind"], 0) < PER_KIND:
            per[r["kind"]] = per.get(r["kind"], 0) + 1
            kept.append(r)
        else:
            spill.append(r)
    kept = sorted(kept + spill[: max(0, MOST_ROWS - len(kept))], key=lambda r: r["rank"])[:MOST_ROWS]
    counts: dict[str, int] = {}
    for f in found:
        counts[f.kind] = counts.get(f.kind, 0) + 1
    return {"rows": kept, "count": len(found), "kinds": counts}
