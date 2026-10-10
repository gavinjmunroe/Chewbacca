"""The tiers in front of kyber-genui's model: code, then Jev and math, then the model.

Tier 0 is code. A request that is the same as a fixed exemplar, a pinned
preset or a promoted framework (after the words that carry no meaning are
dropped) redraws that layout with fresh data.

Tier 1 asks Jev two typed questions in one call (which archetype, which data
source), fills the source's argument with code (a course code, a weekday, a
window of days), runs the queries, and then picks the components from the
shape of what came back: one value is a Metric, a bounded proportion a Ring,
two to twelve magnitudes Bars, timed items Events, multi-field rows a Table.
No generative model, no layout typed by anything that read the data: the
layout binds pointers like every other, and goes through the same validator.

Tier 2 is the model, used only when Jev is unsure, says no source fits, or the
answer is a drawing (no query returns relationships yet).

The math step sees data because it is code; the rule that matters, that no
model reads somebody else's text, still holds. It reads counts and field
shapes and never copies a value into a line.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DAY_ALIASES = {"mon": "monday", "tue": "tuesday", "tues": "tuesday", "wed": "wednesday",
               "thu": "thursday", "thur": "thursday", "thurs": "thursday", "fri": "friday",
               "sat": "saturday", "sun": "sunday", "tonight": "today"}
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fourteen": 14,
                "a": 1, "couple": 2, "few": 3}
MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"}
# Three-to-five letters then three digits is a course code ("ACAD 185"), but
# "next 100" and "over 200" have the same shape.
NOT_COURSE = {"next", "last", "past", "over", "about", "than", "with", "from", "into", "after",
              "under", "within", "top", "around", "only", "least", "most", "like", "have"}
# Words that never change which layout answers a request. Kept short: a word
# that does carry meaning, dropped here, makes two different requests equal.
STOP = {"a", "an", "the", "my", "me", "i", "im", "i'm", "is", "are", "am", "do", "does", "did",
        "on", "in", "of", "for", "to", "at", "it", "its", "it's", "this", "that", "what", "whats",
        "what's", "show", "pull", "up", "please", "yo", "rn", "right", "now", "anything", "any",
        "look", "looks", "like", "there", "have", "has", "got", "be", "so", "just", "can", "you",
        "u", "and", "or", "with", "all", "everything", "give", "tell", "about", "how", "whos", "who's"}

ROW_EVENTS_CAP = 6
TABLE_MAX_COLUMNS = 3  # a 400-point card; four columns wrapped every cell in the 10/04 bench


# Slots: the literal arguments, read by code. Exact matching stays in code.

@dataclass
class Slots:
    course: str | None = None
    course_text: str | None = None
    day: str | None = None
    day_text: str | None = None
    days: int | None = None
    days_text: str | None = None
    name: str | None = None
    name_text: str | None = None
    until: bool = False

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v not in (None, False)}


def days_until(weekday: str, today: date) -> int:
    ahead = (WEEKDAYS.index(weekday) - today.weekday()) % 7
    return ahead or 7


def extract_slots(request: str, today: date | None = None) -> Slots:
    today = today or date.today()
    text = request.lower()
    slots = Slots()
    m = re.search(r"\b([a-z]{3,5})[ -]?(\d{3}[a-z]?)\b", text)
    if m and m.group(1) not in NOT_COURSE:
        slots.course = (m.group(1) + m.group(2)).upper()
        slots.course_text = m.group(0)
    words = re.findall(r"[a-z']+", text)
    for w in words:
        word = DAY_ALIASES.get(w, w)
        if word in WEEKDAYS or word in ("today", "tomorrow"):
            slots.day, slots.day_text = word, w
            break
    m = re.search(r"\bbefore (" + "|".join(WEEKDAYS + list(DAY_ALIASES)) + r")\b", text)
    if m:
        word = DAY_ALIASES.get(m.group(1), m.group(1))
        if word in WEEKDAYS:
            slots.days, slots.days_text, slots.until = days_until(word, today), m.group(0), True
            slots.day = slots.day_text = None
    number = r"(\d{1,3}|" + "|".join(NUMBER_WORDS) + ")"
    if slots.days is None:
        m = re.search(r"\b(?:next |coming |past )?" + number + r" (day|days|week|weeks)\b", text)
        if m:
            n = int(m.group(1)) if m.group(1).isdigit() else NUMBER_WORDS[m.group(1)]
            slots.days = n * (7 if m.group(2).startswith("week") else 1)
            slots.days_text = m.group(0)
        elif re.search(r"\b(this|the) month\b|\bmonth\b", text):
            nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
            slots.days, slots.days_text = max(1, (nxt - today).days - 1), "this month"
        elif re.search(r"\bnext week\b", text):
            slots.days, slots.days_text = 14, "next week"
        elif re.search(r"\bweek\b", text):
            slots.days, slots.days_text = 7, "this week"
        elif re.search(r"\bfortnight\b", text):
            slots.days, slots.days_text = 14, "fortnight"
    # A capitalised word that is not a weekday, a month or the course code is
    # the best a rule can do for a client or campaign name. The first word is
    # capitalised in every sentence, so it counts only when it is not an
    # ordinary English word and no later word is capitalised: "Zeutara reply
    # rate" named no client and the pill asked "Which campaign?" (labelled
    # 30, #10, 2026-10-10).
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9.'-]*", request)
    later = any(t[:1].isupper() and t.split("'")[0].lower() not in ("i", "hud", "chewbacca")
                for t in tokens[1:])
    for i, tok in enumerate(tokens):
        base = tok.split("'")[0]
        if not base[:1].isupper() or base.isupper() and len(base) <= 4:
            continue
        if i == 0 and (later or common_word(base)):
            continue
        low = base.lower()
        if low in WEEKDAYS or low in MONTHS or low in ("i", "hud", "chewbacca") or \
                (slots.course and slots.course.startswith(low.upper())):
            continue
        slots.name, slots.name_text = base, tok
        break
    return slots


DICTIONARY = Path("/usr/share/dict/words")
_dictionary: list[str] | None = None


def common_word(word: str) -> bool:
    """An ordinary lowercase English word, or a form of one ("Meetings", "Showing").

    /usr/share/dict/words lists proper nouns capitalised and has no plurals or
    -ing forms, so the stems are tried too. Read only when a first word needs
    judging: the file takes 16 ms to load (2026-10-10), a set of it 230 ms.
    Without the file every first word counts as common, the rule before this.
    """
    global _dictionary
    low = word.lower().strip("'.")
    if not low.isalpha():
        return False
    if low in STOP or low in WEEKDAYS or low in MONTHS or low in NUMBER_WORDS:
        return True
    if _dictionary is None:
        try:
            _dictionary = DICTIONARY.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            _dictionary = []
    if not _dictionary:
        return True
    forms = {low}
    for suffix, back in (("s", ""), ("es", ""), ("ies", "y"), ("ing", ""), ("ing", "e"), ("ed", ""),
                         ("ed", "e")):
        if low.endswith(suffix) and len(low) - len(suffix) > 1:
            forms.add(low[: -len(suffix)] + back)
    return any(f in _dictionary for f in forms)


# Tier 0: near-exact match against layouts that already exist.

def content_words(request: str, slots: Slots | None = None) -> frozenset[str]:
    text = request.lower()
    if slots:
        for key in ("course", "day", "days", "name"):
            span = getattr(slots, f"{key}_text")
            if span:
                text = text.replace(span.lower(), f" <{key}> ")
    words = re.findall(r"<[a-z]+>|[a-z0-9']+", text)
    return frozenset(w for w in words if w not in STOP)


# Jaccard on content words. 0.75 lets one extra filler through on a
# four-word request and nothing on a one- or two-word one; set on the
# exemplars and the frozen 20 only.
NEAR_EXACT = 0.75


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


@dataclass
class Entry:
    """A layout Tier 0 can redraw: an exemplar, a preset, or a promoted framework."""
    name: str
    kind: str
    triggers: list[str]
    lines: list[str]
    requires: list[str] = field(default_factory=list)

    def fill(self, slots: Slots) -> list[str] | None:
        values = {"course": slots.course, "day": slots.day, "days": slots.days, "name": slots.name}
        out = []
        for line in self.lines:
            for key in self.requires:
                if values.get(key) in (None, ""):
                    return None
                line = line.replace("{" + key + "}", str(values[key]))
            out.append(line)
        return out


def tier0(request: str, entries: list[Entry]) -> tuple[Entry, list[str], float] | None:
    slots = extract_slots(request)
    best: tuple[Entry, list[str], float] | None = None
    for entry in entries:
        for trig in entry.triggers:
            have = content_words(request, slots if entry.requires else None)
            score = similarity(have, content_words(trig))
            if score < NEAR_EXACT or (best and score <= best[2]):
                continue
            lines = entry.fill(slots)
            if lines is not None:
                best = (entry, lines, score)
    return best


def _stems(words: frozenset[str]) -> set[str]:
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words}


def guess_source(request: str, frameworks: dict) -> str | None:
    """The source whose description shares the most words with the request, or None on a tie.

    Only a head start: its query runs while Jev decides, and its answer is
    used only if Jev picks the same source. Jev's choice is the decision.
    """
    have = _stems(content_words(request))
    scored = sorted(((len(have & _stems(content_words(spec["jev"]))), name)
                     for name, spec in frameworks["sources"].items() if name != "none"), reverse=True)
    if not scored or scored[0][0] == 0 or (len(scored) > 1 and scored[1][0] == scored[0][0]):
        return None
    return scored[0][1]


# Tier 1: Jev picks the archetype and the source.

@dataclass
class Choice:
    archetype: str
    archetype_p: float
    source: str
    source_p: float
    ms: float


def jev_questions(frameworks: dict) -> dict:
    return {
        "archetype": {
            "type": "choice",
            "instructions": ("A person spoke this request to a heads-up display that answers with a small "
                             "panel. What shape of answer does the request want?"),
            "criteria": {k: v["jev"] for k, v in frameworks["archetypes"].items()},
        },
        "source": {
            "type": "choice",
            "instructions": ("Which one data source holds the answer to this request? Pick none if the "
                             "request is about something these sources do not hold."),
            "criteria": {k: v["jev"] for k, v in frameworks["sources"].items()},
        },
    }


def classify(request: str, frameworks: dict, ask: Callable[..., dict | None]) -> Choice | None:
    """One Jev call, two independent questions about the same request. None means no judgment."""
    import time
    started = time.monotonic()
    result = ask(request, jev_questions(frameworks))
    ms = round((time.monotonic() - started) * 1000, 1)
    answers = (result or {}).get("answers") if isinstance(result, dict) and "answers" in result else result
    if not isinstance(answers, dict):
        return None
    picked = []
    for key in ("archetype", "source"):
        answer = answers.get(key)
        probs = answer.get("probabilities") if isinstance(answer, dict) else None
        if not isinstance(probs, dict) or not probs:
            return None
        choice = max(probs, key=lambda k: probs[k])
        valid = frameworks["archetypes" if key == "archetype" else "sources"]
        if choice not in valid:
            return None
        picked.append((choice, float(probs[choice])))
    return Choice(picked[0][0], picked[0][1], picked[1][0], picked[1][1], ms)


@dataclass
class Plan:
    archetype: str
    source: str
    key: str
    companions: list[str]
    window: str
    why: str = ""


def plan(choice: Choice, slots: Slots, frameworks: dict, queries: dict) -> tuple[Plan | None, str]:
    """Turn Jev's two choices and the code-read slots into query keys, or say why not."""
    th = frameworks["thresholds"]
    if choice.source == "none":
        return None, f"Jev: no source fits ({choice.source_p:.2f})"
    if choice.source_p < th["source"]:
        return None, f"Jev unsure of the source: {choice.source} at {choice.source_p:.2f}"
    if choice.archetype == "connections":
        return None, "the answer is a drawing, and no query returns relationships"
    source = choice.source
    # Code overrides on literal facts Jev was not asked: a named course or a
    # single day narrows the query to the one that can hold just that.
    if slots.course and source in ("due", "overdue", "course"):
        source = "course"
    if source == "course" and not slots.course:
        source = "due"
    if slots.day and not slots.until and source in ("week", "calendar"):
        source = "day"
    if source == "day" and not slots.day and slots.days and slots.days > 1:
        source = "week"
    if source not in queries or source not in frameworks["sources"]:
        return None, f"no query named {source}"
    spec = frameworks["sources"][source]
    arg, window = None, ""
    kind = spec.get("arg", "")
    if kind == "days":
        days = slots.days
        if days is None and slots.day in ("today", "tomorrow"):
            days = 1
        elif days is None and slots.day in WEEKDAYS:
            days = days_until(slots.day, date.today())
        days = min(days or spec["default"], spec.get("max", 120))
        arg, window = str(days), f"{days} days"
    elif kind == "day":
        arg = slots.day or spec["default"]
        window = arg
    elif kind in ("course", "course?"):
        if slots.course:
            arg, window = slots.course, slots.course
        elif kind == "course":
            return None, "a course query with no course named"
    elif kind == "name":
        if not slots.name:
            return None, f"{source} needs a name and the request has none"
        arg, window = re.sub(r"[^A-Za-z0-9._-]", "", slots.name)[:40], slots.name
    if not queries[source].arg.get("kind"):
        # A provider registered the query without an argument (unreplied did
        # on 2026-10-05), so the window the framework expected does not apply.
        arg, window = None, ""
    key = f"{source}:{arg}" if arg else source
    bad = queries[source].check_arg(arg)
    if bad:
        return None, bad
    companions = []
    if choice.archetype in ("timeline", "plan", "act") or choice.archetype == "count" and source == "due":
        companions = [c for c in spec.get("companions", []) if c in queries]
    return Plan(choice.archetype, source, key, companions, window), ""


# The math step: components from the data's shape.

def _numbers(values: list[Any]) -> list[float]:
    return [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]


def features(data: dict, fields: list[str]) -> dict:
    """What the resolved answer looks like, measured, never read aloud."""
    rows = data.get("rows") or []
    bars = data.get("bars") or []
    values = _numbers([b.get("value") for b in bars])
    series = _numbers(data.get("series") or [])
    timed = any(r.get(k) not in (None, "") for r in rows for k in ("iso", "date", "time", "waiting"))
    varying = []
    for f in fields:
        seen = [r.get(f) for r in rows if r.get(f) not in (None, "")]
        if rows and len(seen) * 2 >= len(rows) and (len(rows) == 1 or len({str(s) for s in seen}) > 1):
            varying.append(f)
    return {
        "n": data.get("count"),
        "groups": len(values),
        "spread": (max(values) / min(values)) if values and min(values) > 0 else (float("inf") if values and max(values) > 0 else 1.0),
        "distinct": len(set(values)),
        "series": len(series) >= 3 and len(set(series)) > 1,
        "ratio": isinstance(data.get("ratio"), (int, float)),
        "timed": timed,
        "varying": varying,
        "magnitudes": bool(values) and not timed,
    }


def _metric(cid: str, label: str, pointer: str, tone_bad: bool = False) -> str:
    line = f"c {cid} Metric label={json.dumps(label)} value={pointer}"
    return line + (' thresholds=[{"at":1,"tone":"bad"}]' if tone_bad else "")


def compose(p: Plan, data: dict[str, dict], frameworks: dict, queries: dict) -> tuple[list[str], dict]:
    """The layout for a plan, chosen from the measured shape of its data."""
    spec = frameworks["sources"][p.source]
    d = data[p.key]
    f = features(d, queries[p.source].fields)
    ptr = lambda view: f"@/q/{p.key}/{view}"  # noqa: E731
    title = spec.get("title", p.source.upper()).format(
        course=_spaced(p.window), day=p.window.upper(), days=p.window.split()[0] if p.window else "",
        name=p.window.upper())
    if p.source in ("due", "exams", "calendar") and p.window:
        title = f"{title} IN {p.window.upper()}"
    title = title[:32]
    lines: list[str] = [f"c s Screen title={json.dumps(title)}"]
    kids: list[str] = []
    body: list[str] = []
    metrics: list[str] = []
    label = spec.get("label", "Items")
    why = {"features": {k: (round(v, 2) if isinstance(v, float) and v != float("inf") else v)
                        for k, v in f.items() if k != "varying"}, "picked": []}

    def add(line: str, cid: str, reason: str) -> None:
        body.append(line)
        kids.append(cid)
        why["picked"].append(f"{line.split()[2]}: {reason}")

    if f["n"] is None:
        # Rule 8 in skills/kyber-surfaces: a source that failed is named, never drawn as zero.
        add(f"c st Status message={ptr('note')} level=warning", "st", "the source returned no count")
    elif f["n"] == 0:
        # An honest empty line (rule 6), and nothing else: a 0 over "Nothing
        # on Tuesday" says the same thing twice.
        add(f"c st Status message={ptr('note')} level=info", "st", "nothing came back; the note says why")
    else:
        arche = p.archetype
        caption = _caption(p, spec)
        if arche == "count" or (arche == "none" and not f["timed"]):
            if p.source == "grades" and "average" in queries[p.source].scalars:
                metrics.append(_metric("m0", "Average", ptr("average")))
            else:
                metrics.append(_metric("m0", label, ptr("count"), spec.get("tone") == "bad"))
            if f["series"]:
                add(f"c sp Sparkline label={json.dumps(caption)} points={ptr('series')}", "sp",
                    "a non-constant series of 3 or more")
            elif f["groups"] >= 2 and f["distinct"] > 1:
                add(f"c b Bars caption={json.dumps('By ' + _group_name(p))} rows={ptr('bars')}", "b",
                    f"{f['groups']} groups that differ, the longer look")
        elif arche in ("compare", "breakdown"):
            if f["ratio"]:
                add(f"c r Ring label={json.dumps(label)} value={ptr('ratio')}", "r", "a bounded proportion")
            elif f["groups"] >= 2:
                if arche == "breakdown":
                    metrics.append(_metric("m0", "Total", ptr("count")))
                add(f"c b Bars caption={json.dumps('By ' + _group_name(p))} rows={ptr('bars')}", "b",
                    f"{f['groups']} ranked magnitudes")
            elif len(f["varying"]) >= 2:
                add(_table(p, f, caption), "tb", "rows with several fields and no magnitude to rank")
            else:
                metrics.append(_metric("m0", label, ptr("count")))
        elif f["magnitudes"] and f["groups"] >= 2 and arche == "act":
            add(f"c b Bars caption={json.dumps(caption)} rows={ptr('bars')}", "b",
                "people ranked by days since, a magnitude")
        elif f["timed"]:
            if f["n"] > ROW_EVENTS_CAP or arche in ("before-after", "entity"):
                metrics.append(_metric("m0", label, ptr("count"), spec.get("tone") == "bad"))
            add(f"c ev Events caption={json.dumps(caption)} items={ptr('events')}", "ev",
                f"{f['n']} timed items, soonest first")
        elif f["groups"] >= 2 and f["magnitudes"]:
            add(f"c b Bars caption={json.dumps(caption)} rows={ptr('bars')}", "b", "ranked magnitudes")
        elif len(f["varying"]) >= 2:
            if f["n"] > 9:
                metrics.append(_metric("m0", label, ptr("count")))
            add(_table(p, f, caption), "tb", f"{len(f['varying'])} fields that vary across rows")
        else:
            add(f"c ls List items={ptr('list')}", "ls", "one field worth showing")
    for comp in p.companions:
        cd = data.get(comp) or {}
        # A companion is context, not the question: a zero or a source that
        # failed would only add a second "Nothing overdue." under the answer.
        if not cd.get("count"):
            continue
        cspec = frameworks["sources"][comp]
        metrics.append(_metric(f"m{len(metrics)}", cspec.get("label", comp), f"@/q/{comp}/count",
                               cspec.get("tone") == "bad"))
    if len(metrics) == 1:
        lines.append(f"> s {metrics[0].split()[1]} {' '.join(kids)}".rstrip())
        lines.append(metrics[0])
    elif metrics:
        lines.append(f"> s row {' '.join(kids)}".rstrip())
        lines.append("c row Stack direction=grid cols=2 gap=3")
        lines.append("> row " + " ".join(m.split()[1] for m in metrics))
        lines.extend(metrics)
    else:
        lines.append(f"> s {' '.join(kids)}")
    lines.extend(body)
    return lines, why


def _spaced(code: str) -> str:
    m = re.fullmatch(r"([A-Z]+)(\d+[A-Z]?)", code or "")
    return f"{m.group(1)} {m.group(2)}" if m else (code or "").upper()


def _group_name(p: Plan) -> str:
    return {"grades": "course", "week": "day", "reconnect": "person", "campaign": "metric"}.get(p.source, "course")


def _caption(p: Plan, spec: dict) -> str:
    # Rule 13 in skills/kyber-surfaces: a guess says it is a guess. The
    # caption names the window and source the composer understood, so a
    # misread ("10 days" for "this month") is visible on the glass.
    base = {
        "due": f"Next {p.window}, overdue first", "overdue": "Past due, still todo",
        "exams": f"Exams in the next {p.window}", "before-exam": "Next exam first, then what lands before it",
        "course": f"{_spaced(p.window)}, overdue first", "grades": "Standing by course",
        "week": f"Next {p.window}: classes, deadlines, events", "day": f"{p.window.capitalize()}: classes, deadlines, events",
        "calendar": f"Calendar, next {p.window}", "reconnect": "Days since you last talked",
        "tasks": "Open promises", "unreplied": "They wrote last", "campaign": f"{p.window} by metric",
        "needs": "Blocked first, then due soon", "person": f"{p.window}: threads, mail, what you owe",
        "conversations": "This week, act on first",
    }.get(p.source, spec.get("label", ""))
    return base[:80]


def _table(p: Plan, f: dict, caption: str) -> str:
    cols = [{"field": k, "label": k.capitalize()} for k in f["varying"][:TABLE_MAX_COLUMNS]]
    return (f"c tb Table caption={json.dumps(caption)} columns={json.dumps(cols, separators=(',', ':'))} "
            f"rows=@/q/{p.key}/rows")


# The learning loop: a kept Tier 2 layout becomes a framework candidate.

def distill(request: str, lines: list[str]) -> dict | None:
    """Abstract a kept layout's literal arguments into slots, so it answers the next request like it."""
    slots = extract_slots(request)
    values = {"course": slots.course, "day": slots.day, "days": str(slots.days) if slots.days else None,
              "name": slots.name}
    requires = []
    out = []
    for line in lines:
        def swap(m: re.Match) -> str:
            name, arg, view = m.group(1), m.group(2), m.group(3)
            for key, val in values.items():
                if val and arg.lower() == str(val).lower():
                    if key not in requires:
                        requires.append(key)
                    return f"/q/{name}:{{{key}}}/{view}"
            return m.group(0)
        out.append(re.sub(r"/q/([a-z-]+):([^/\s]+)/([a-z]+)", swap, line))
    if not out:
        return None
    trigger = request
    for key in requires:
        span = getattr(slots, f"{key}_text")
        if span:
            trigger = re.sub(re.escape(span), "{" + key + "}", trigger, flags=re.I)
    return {"request": request, "triggers": [trigger], "lines": out, "requires": requires}


def candidate_entry(name: str, data: dict) -> Entry:
    # A stored trigger keeps `{course}` where the course was; content_words
    # turns the slot span of a new request into `<course>` to match it.
    triggers = [re.sub(r"\{([a-z]+)\}", r"<\1>", t) for t in data.get("triggers", [data.get("request", "")])]
    return Entry(name, "promoted", triggers, list(data["lines"]), list(data.get("requires", [])))


def load_entries(exemplars_path: Path, presets_dir: Path, promoted_dir: Path) -> list[Entry]:
    entries = []
    for ex in json.loads(exemplars_path.read_text(encoding="utf-8"))["exemplars"]:
        entries.append(Entry(ex["name"], "exemplar", [ex["request"]], list(ex["lines"])))
    for folder, kind in ((presets_dir, "preset"), (promoted_dir, "promoted")):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if kind == "promoted":
                entries.append(candidate_entry(path.stem, data))
            elif data.get("request") and data.get("lines"):
                entries.append(Entry(path.stem, kind, [data["request"]], list(data["lines"])))
    return entries


# The relevance gate: can the bound source answer what the request is about?
#
# The validator checks shape. On 2026-10-10 the model, sent a request no query
# covers, bound one anyway: "what's the weather tomorrow" drew `day:tomorrow`,
# "what's Nvidia stock at" drew `campaign:Nvidia` (sealed set, CHW-203). Each
# panel said it had no data, about the wrong thing. Every query declares what
# it covers (config/genui/covers.json); code decides when the request's subject
# words land on that declaration, and only an undecided case asks Jev one
# typed yes/no.

@dataclass
class Verdict:
    ok: bool | None           # True answers it, False does not, None undecided
    by: str                   # "code", "jev", or "none" (nobody could decide)
    why: str
    other: str | None = None  # the query the subject belongs to instead, when code found one
    words: int = 0            # how many request words a code no rests on

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None and not (k == "words" and not v)}

    @property
    def weak(self) -> bool:
        """A code no resting on one word: `sent` made "that thing Sagar sent" another query's (#30)."""
        return self.ok is False and self.by == "code" and self.words == 1


def _norm(word: str) -> str:
    word = word.lower().replace(chr(0x2019), "'")
    if word.endswith("'s"):
        word = word[:-2]
    word = word.strip("'")
    # Regular plurals only: "deadlines" and "deadline" must meet, and cutting
    # "-es" off every word turned "grades" into "grad".
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("sses", "xes", "ches", "shes", "zes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def _filler(word: str, generic: set[str]) -> bool:
    """A word that asks rather than names: "how's", "when's", "I'd" count by their first part."""
    low = word.lower().replace(chr(0x2019), "'")
    base = low.split("'")[0]
    return low in STOP or low in generic or base in STOP or base in generic


def cover_words(spec: dict) -> set[str]:
    words: set[str] = set()
    for phrase in list(spec.get("entities", [])) + list(spec.get("measures", [])):
        words |= {_norm(w) for w in re.findall(r"[a-z']+", phrase.lower()) if w not in STOP}
    return words


def subject_words(request: str, slots: Slots, generic: set[str]) -> list[str]:
    """The request's words that name what it is about, in order: slots, filler and question words removed."""
    text = request.lower()
    for key in ("course", "day", "days", "name"):
        span = getattr(slots, f"{key}_text")
        if span:
            text = text.replace(span.lower(), " ")
    out: list[str] = []
    for w in re.findall(r"[a-z0-9']+", text):
        n = _norm(w)
        if _filler(w, generic) or n in generic or w.isdigit() or not n:
            continue
        if n not in out:
            out.append(n)
    return out


SLOT_FOR_ARG = {"course": "course", "course?": "course", "name": "name", "day": "day", "days": "days"}


def relevance(request: str, source: str, covers: dict, slots: Slots | None = None,
              arg_kind: str = "") -> Verdict:
    """Code's verdict on one source. Never asks anything; None means ask Jev."""
    slots = slots or extract_slots(request)
    generic = set(covers.get("generic", []))
    table = covers.get("queries", {})
    subject = subject_words(request, slots, generic)
    mine = cover_words(table[source]) if source in table else set()
    hits = [w for w in subject if w in mine]
    if hits:
        return Verdict(True, "code", f"{source} covers {', '.join(hits)}")
    if not subject:
        slot = SLOT_FOR_ARG.get(arg_kind)
        if slot and getattr(slots, slot, None):
            return Verdict(True, "code", f"only a {slot} was asked, and {source} takes one")
        return Verdict(None, "none", "the request names no subject")
    elsewhere = {name: [w for w in subject if w in cover_words(spec)]
                 for name, spec in table.items() if name != source}
    elsewhere = {k: v for k, v in elsewhere.items() if v}
    if elsewhere and source in table:
        best = max(elsewhere, key=lambda k: len(elsewhere[k]))
        return Verdict(False, "code", f"{', '.join(elsewhere[best])} is {best}'s, not {source}'s", other=best,
                       words=len(elsewhere[best]))
    return Verdict(None, "none", f"no query declares {', '.join(subject[:3])}")


def covered_anywhere(request: str, covers: dict, slots: Slots | None = None) -> list[str]:
    """The queries whose declaration any subject word lands on."""
    slots = slots or extract_slots(request)
    subject = set(subject_words(request, slots, set(covers.get("generic", []))))
    return [name for name, spec in covers.get("queries", {}).items() if subject & cover_words(spec)]


def jev_relevance_question(description: str, spec: dict) -> dict:
    holds = ", ".join(spec.get("entities", [])[:8])
    says = ", ".join(spec.get("measures", [])[:8])
    detail = (f" It holds {holds}" if holds else "") + (f"; it can say {says}" if says else "")
    return {"relevant": {
        "type": "choice",
        "instructions": ("A person asked a heads-up display this request. The panel would show one data "
                         f"source: {description}.{detail}. Can this source answer what the request is "
                         "asking about?"),
        "criteria": {"yes": "this source holds what the request asks about",
                     "no": "the request asks about something this source does not hold"},
    }}


def ask_relevance(request: str, source: str, description: str, covers: dict,
                  ask: Callable[..., dict | None]) -> Verdict:
    """Jev's typed yes/no for a source code could not decide. ok=None if Jev gave no answer."""
    spec = covers.get("queries", {}).get(source, {})
    try:
        result = ask(request, jev_relevance_question(description, spec))
    except Exception:  # noqa: BLE001  a gate that cannot ask lets the source through, as before it existed
        return Verdict(None, "none", "Jev could not be asked")
    answers = (result or {}).get("answers") if isinstance(result, dict) and "answers" in result else result
    answer = answers.get("relevant") if isinstance(answers, dict) else None
    probs = answer.get("probabilities") if isinstance(answer, dict) else None
    if not isinstance(probs, dict) or "yes" not in probs:
        return Verdict(None, "none", "Jev gave no answer")
    p = float(probs.get("yes", 0))
    return Verdict(p >= 0.5, "jev", f"Jev: {source} answers it at {p:.2f}")


# What the pill says when a request is a query's but lacks its argument.

def clarifying_question(verdict: Verdict | None, covers: dict) -> str | None:
    """The pill's question when the request is a query's but lacks its argument, else None.

    None means no source on this Mac holds it, and the request gets an open
    answer instead (bin/lib/glass_answer.py). A no resting on one stray word
    never asks: "pull up that thing Sagar sent" got the client-name question
    because of `sent` (labelled 30, #30).
    """
    other = verdict.other if verdict else None
    if not other or verdict is None or verdict.weak:
        return None
    return covers.get("queries", {}).get(other, {}).get("ask")
