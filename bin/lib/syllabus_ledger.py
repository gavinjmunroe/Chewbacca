"""Read a syllabus into ledger fields, every value carrying the page it came from.

After `chewbacca usc lockin` the seeded course files had no class times,
office hours, attendance budget or grading: `coursework check` listed 13 gaps
for 4 courses on the 2026-10-13 USC week walk, and every answer sat in a
syllabus lockin had just pulled. This module reads those pages and drafts the
four answers a student asks about most ("when is class", "when are office
hours", "can I skip Wednesday", "where's my grade").

Rules it keeps:

- A value is only written with the file and page it was read from. A value it
  can't find stays empty and is named as a gap; it never guesses.
- It fills empty fields only. A field someone already wrote is never touched.
  When the syllabus disagrees with it, that is reported as a conflict.
- A course's AI policy is never read, stored or reported. Any sentence that
  names AI is dropped before extraction, so it can't ride along inside an
  attendance or late-work quote.

`pages` everywhere is [(label, text)] as bin/chewbacca-usc's file_pages returns.
"""
import re

DAYS = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}
# Longest spellings first so "Thursday" never matches as "Thu" + "rsday".
DAY_WORD = (r"(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?"
            r"|mon\.?|tues?\.?|weds?\.?|thur?s?\.?|fri\.?|sat\.?|sun\.?)")
# "MW", "TTh", "TR", "MWF": the compact registrar forms.
DAY_CODE = r"\b(?:M|T|W|Th|R|F)(?:M|T|W|Th|R|F){1,3}\b"
TIME = r"\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?"
DASH = r"\s*(?:-|–|—|to|until)\s*"
ROOM = re.compile(r"\b([A-Z]{2,4})\s?(\d{2,4}[A-Z]?(?:-\d{2,4})?)\b")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.edu\b", re.I)
NUMBER_WORDS = {"no": 0, "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
# Building codes that read like rooms but aren't one on a syllabus page.
NOT_ROOM = {"GE", "FA", "SP", "SU", "PM", "AM", "PT", "ID", "NO", "PDF", "USC", "ZOOM", "CSCI", "WRIT",
            "BISC", "MATH", "ACAD", "MPGU", "PSYC", "ECON", "PHYS", "CHEM", "ITP", "DSCI", "HIST", "PAGE"}

AI_WORDS = re.compile(r"\b(?:A\.?I\.?|artificial intelligence|generative|chat\s?gpt|gpt|llms?|claude|copilot|gemini)\b", re.I)


def drop_ai(text):
    """Every sentence that names AI, removed, line breaks kept. The policy is
    the student's business; this tool doesn't read it (CLAUDE.md, Caleb
    2026-10-11)."""
    parts = re.split(r"((?<=[.!?])[ \t]+|\n)", text)
    return "".join(p for p in parts if not AI_WORDS.search(p))


def lines_of(pages):
    """[(label, line)] for every non-empty line, AI sentences removed, and
    the side-by-side duplicate a two-column PDF layout prints ("GFS 210 GFS 210")
    folded to one copy."""
    out = []
    for label, text in pages:
        for line in text.splitlines():
            line = " ".join(line.split())
            half = len(line) // 2
            if len(line) > 6 and line[:half].strip() == line[half:].strip():
                line = line[:half].strip()
            if line and not AI_WORDS.search(line):
                out.append((label, line))
    return out


def day_list(text):
    found = []
    for w in re.findall(DAY_WORD, text, re.I):
        key = w.lower().rstrip(".s")[:3]
        key = {"tue": "tue", "thu": "thu", "wed": "wed"}.get(key, key)
        d = DAYS.get(key)
        if d and d not in found:
            found.append(d)
    if not found:
        for code in re.findall(DAY_CODE, text):
            for tok in re.findall(r"Th|M|T|W|R|F", code):
                d = {"M": "Mon", "T": "Tue", "W": "Wed", "Th": "Thu", "R": "Thu", "F": "Fri"}[tok]
                if d not in found:
                    found.append(d)
    order = list(DAYS.values())
    return sorted(found, key=order.index)


def clock(t, pm_hint=None):
    """'2:00 p.m.' -> '14:00'. A bare '2:00' borrows am/pm from the end time,
    the way '2:00-3:20 pm' is written."""
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*([ap])?", t.strip().lower().replace(".", ""))
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3) or pm_hint
    if h > 23 or mi > 59:
        return None
    if ap == "p" and h < 12:
        h += 12
    if ap == "a" and h == 12:
        h = 0
    return f"{h:02d}:{mi:02d}"


def time_range(text):
    m = re.search(rf"({TIME}){DASH}({TIME}|noon)", text, re.I)
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    if b.lower() == "noon":
        b = "12:00 pm"
    end_ap = re.search(r"([ap])\.?\s?m", b, re.I)
    start_ap = re.search(r"([ap])\.?\s?m", a, re.I)
    if not end_ap and not start_ap:
        return None  # "1-2" is a page range or a score, not a class time
    end = clock(b, None)
    hint = end_ap.group(1).lower() if end_ap else None
    start = clock(a, None if start_ap else hint)
    if not start or not end:
        return None
    # "11:00-12:15 pm": the start borrowed "p" and became 23:00. Morning it is.
    if start > end and not start_ap:
        start = clock(a, "a")
    # "10:00-11:50pm" for a 10am lab: a typo'd end makes a 13-hour class.
    sh, eh = int(start[:2]), int(end[:2])
    if eh - sh >= 6 and eh >= 12 and not start_ap:
        end = f"{eh - 12:02d}:{end[3:]}"
    if start >= end:
        return None
    return start, end


def find_room(text):
    for m in ROOM.finditer(text):
        if m.group(1) not in NOT_ROOM:
            return f"{m.group(1)} {m.group(2)}"
    return None


def meetings(lines):
    """Class meetings: days, start, end and room, each from one line or a
    labeled block. Lab sections the student may not be in are listed as
    options in the source note, never as meetings."""
    found = []
    for i, (label, line) in enumerate(lines):
        if re.search(r"office hours?|hours of service|due|deadline|exam|final|email|e-mail", line, re.I):
            continue
        days = day_list(line)
        times = time_range(line)
        if not days or not times:
            continue
        # A section number at the front means a list of lab or discussion
        # sections to choose from: the student is in one of them, not all.
        if re.match(r"^\s*\d{5}[A-Z]?\b", line):
            continue
        room = find_room(re.sub(rf"{TIME}{DASH}({TIME}|noon)", " ", line, flags=re.I))
        if not room:
            for _, near in lines[i + 1:i + 3] + lines[max(0, i - 2):i]:
                near_clean = re.sub(r"\b\d{5}[A-Z]?\b", " ", near)
                if re.search(r"room|location|in person|where|hall|building", near, re.I) or ROOM.fullmatch(near.strip()):
                    room = find_room(near_clean)
                    if room:
                        break
        meet = {"days": days, "start": times[0], "end": times[1], "room": room or "",
                "source": label}
        if not any(m["days"] == days and m["start"] == times[0] for m in found):
            found.append(meet)
        if len(found) >= 3:
            break
    # The course header names the class meetings. A day and a time on a later
    # page is the schedule ("Fri 11-2 showcase") or office hours, and on the
    # real WRIT 150 and ACAD 324 syllabi every one of those was noise.
    if found:
        found = [m for m in found if m["source"] == found[0]["source"]]
    if not found:
        found = block_meeting(lines)
    return found


def block_meeting(lines):
    """Some syllabi set days and time on separate lines ("MON. & WED." in one
    column, "2:00-3:20 P.M." two lines down). Join a days-only line with the
    nearest time-only line on the same page."""
    for i, (label, line) in enumerate(lines):
        if re.search(r"office|hours|due|exam", line, re.I):
            continue
        days = day_list(line)
        if not days or len(line) > 60:
            continue
        for _, near in lines[i + 1:i + 4]:
            t = time_range(near)
            if t and not re.search(r"office|hours", near, re.I):
                room = None
                for _, r in lines[i:i + 6]:
                    if not re.search(r"office|jef|hours", r, re.I) or ROOM.fullmatch(r.strip()):
                        room = find_room(r) or room
                        if room:
                            break
                return [{"days": days, "start": t[0], "end": t[1], "room": room or "", "source": label}]
    return []


def office_hours(lines):
    """The 'Office hours' value that says when, with its page. 'TBD' and an
    empty blank to fill in are not answers. A value naming a day or a time
    beats one that only gives a Zoom link, which WRIT 150's syllabus lists
    first ("office hours Zoom: ...") above the actual Wednesday hours."""
    found = []
    for i, (label, line) in enumerate(lines):
        m = re.search(r"office hours?\s*[:\-]?\s*(.*)", line, re.I)
        if not m:
            continue
        value = m.group(1).strip(" :")
        if not value or re.fullmatch(r"[_\s]*|tbd|tba|n/?a|office hours", value, re.I):
            # Labeled block: the value sits on the next lines, sometimes with
            # another column's heading in between.
            near = [l for lab, l in lines[i + 1:i + 6] if lab == label
                    and not re.search(r"assigned texts|course ?book|readings|office hours", l, re.I)]
            value = ""
            for n in range(1, len(near) + 1):
                joined = " ".join(near[:n])
                if day_list(joined) and time_range(joined):
                    value = joined
                    break
            if not value:
                continue
        if re.fullmatch(r"(?i)tbd|tba", value) or value.startswith("_"):
            continue
        found.append({"value": value[:160], "source": label})
    when = [f for f in found if day_list(f["value"]) or time_range(f["value"])]
    return (when or found or [None])[0]


def office(lines):
    for label, line in lines:
        m = re.match(r"(?i)\s*office(?: location)?\s*:\s*(.+)", line)
        if m and not re.match(r"(?i)hours", m.group(1)):
            room = find_room(m.group(1))
            if room:
                return {"value": room, "source": label}
    return None


def instructor_email(lines):
    """The instructor's address: the first .edu on a line labeled for the
    instructor or contact, skipping IT help desks."""
    for i, (label, line) in enumerate(lines):
        if re.search(r"help|it services|d2l\.com|accessibility|osas|counsel", line, re.I):
            continue
        m = EMAIL.search(line)
        if m:
            near = " ".join(l for _, l in lines[max(0, i - 4):i + 1])
            if re.search(r"instructor|professor|contact|email|e-mail|dr\.|lecturer", near, re.I):
                return {"value": m.group(0).lower(), "source": label}
    return None


def absences_allowed(lines):
    """How many absences cost nothing, read only from a sentence that says
    it outright: 'two absences ... no explanation', 'allowed 2 absences',
    'more than three absences will lower'."""
    text_lines = [(l, t) for l, t in lines]
    for idx, (label, line) in enumerate(text_lines):
        window = " ".join(t for _, t in text_lines[idx:idx + 3])
        n = r"(\d|no|zero|one|two|three|four|five|six)"
        pats = [
            rf"(?i)\ballowed\s+{n}\s+(?:\w+\s+)?absences?",
            rf"(?i)\b{n}\s+(?:\w+\s+)?absences?\b[^.]{{0,80}}\b(?:no explanation|without penalty|free|excused|allowed|permitted|no questions)",
            rf"(?i)\bmore than\s+{n}\s+(?:\w+\s+)?absences?",
            rf"(?i)\bafter\s+(?:the\s+)?{n}(?:st|nd|rd|th)?\s+(?:\w+\s+)?absences?",
        ]
        for p in pats:
            m = re.search(p, window)
            if m:
                word = m.group(1).lower()
                count = int(word) if word.isdigit() else NUMBER_WORDS[word]
                return {"value": count, "quote": clip(window, m), "source": label}
    # A contract-grading table (WRIT 150): an ABSENCES column header, then the
    # top row "B or above | 2 or fewer". The "or fewer" count is the budget.
    for idx, (label, line) in enumerate(text_lines):
        if not re.search(r"\bABSENCES\b", line):
            continue
        for _, row in text_lines[idx + 1:idx + 5]:
            m = re.search(r"(?i)\b(\d|no|zero|one|two|three|four|five)\s+or\s+fewer\b", row)
            if m:
                word = m.group(1).lower()
                count = int(word) if word.isdigit() else NUMBER_WORDS[word]
                return {"value": count, "quote": f"{line} / {row}"[:200], "source": label}
    return None


def no_attendance_grade(lines):
    for label, line in lines:
        if re.search(r"(?i)attendance (?:is|will) not (?:be )?(?:graded|taken|counted|part of)", line):
            return {"value": True, "quote": line[:200], "source": label}
    return None


def clip(text, m, pad=90):
    """The sentence around a match, from its start, so a quote never opens
    mid-word ("ach student will be allowed")."""
    a = max(text.rfind(". ", 0, m.start()) + 2, 0)
    end = text.find(". ", m.end())
    end = len(text) if end < 0 else end + 1
    return text[a:min(end, m.end() + pad)].strip()


def grading(lines):
    """The grading breakdown as [{name, weight|points, source}], read from the
    rows under a 'Grading' heading. A table whose rows don't add up to 100%
    (or to its own stated total) is returned with total so the caller can
    say so rather than store a breakdown that's off."""
    start = None
    for i, (label, line) in enumerate(lines):
        if re.search(r"(?i)^\s*(?:grading|grade|evaluation|assessment)s?(?: breakdown| distribution| components|\s*$| and)", line) \
                or re.search(r"(?i)grading breakdown|grade breakdown|course grade will be based", line):
            start = i
            break
    if start is None:
        return None
    rows, label0 = [], lines[start][0]
    for label, line in lines[start + 1:start + 30]:
        if re.search(r"(?i)^\s*(?:total|grading scale|grade scale|letter grade|course final grades)", line):
            break
        if re.match(r"(?i)^\s*(?:a|a-|b\+?|b-|c\+?)\s*[:(]?\s*\d{2}", line):
            break  # the letter scale started
        m = re.match(r"^\s*([A-Za-z][A-Za-z &/,'():\-]{2,70}?)\s*[:\-–]?\s+"
                     r"(?:(\d{1,4})\s*(?:pts|points)?(?:\s+|$))?"
                     r"(?:(~)\s*(\d{1,3})\s*%?|(\d{1,3}(?:\.\d+)?)\s*%)?\s*$", line)
        if not m or not (m.group(2) or m.group(4) or m.group(5)):
            continue
        name = m.group(1).strip(" :-")
        if re.search(r"(?i)^(assignment|component|category|item)s?(?: points)?(?: % of grade)?$|^% of grade$", name):
            continue
        row = {"name": name.title() if name.isupper() else name, "source": label}
        if m.group(5):
            row["weight"] = float(m.group(5)) if "." in m.group(5) else int(m.group(5))
        elif m.group(4):
            row["approx"] = int(m.group(4))
        if m.group(2):
            row["points"] = int(m.group(2))
        rows.append(row)
    if len(rows) < 2:
        return None
    # "~24" columns (BISC 101) are the points rounded to a percent: the
    # points are the breakdown, the rounding is never stored as a weight.
    for r in rows:
        r.pop("approx", None)
    weights = [r["weight"] for r in rows if "weight" in r]
    total = sum(weights) if len(weights) == len(rows) else None
    # ACAD 324's table has a points column that adds to its stated 1000 and a
    # percent column that adds to 105. When the percents are off and every row
    # has points, the points are the breakdown and the percents aren't kept.
    if total is not None and abs(total - 100) > 1 and all("points" in r for r in rows):
        for r in rows:
            r.pop("weight", None)
        return {"rows": rows, "weight_total": None, "source": label0,
                "note": f"the percent column adds to {total}, so the points are used"}
    return {"rows": rows, "weight_total": total, "source": label0}


def grading_contract(lines):
    """A labor-based grading contract (WRIT 150) has no weights to fill;
    the model itself is the answer to "where's my grade"."""
    for label, line in lines:
        if re.search(r"(?i)labor-based|grading contract|contract grading", line):
            return {"value": "contract", "quote": line[:200], "source": label}
    return None


def read_syllabus(pages, name=""):
    """Everything this module can draft from one syllabus, as
    {field: value-with-source}. Missing keys are fields it couldn't find.
    `name` (the file) prefixes every source, so "page 5" says which file."""
    prefix = f"{name}, " if name else ""
    lines = lines_of([(prefix + label, drop_ai(text)) for label, text in pages])
    out = {}
    m = meetings(lines)
    if m:
        out["meets"] = m
    for key, fn in (("office_hours", office_hours), ("office", office), ("email", instructor_email),
                    ("absences_allowed", absences_allowed), ("attendance_ungraded", no_attendance_grade),
                    ("grading", grading), ("grading_contract", grading_contract)):
        v = fn(lines)
        if v:
            out[key] = v
    return out


# ── the ledger side ──────────────────────────────────────────────────────────
# Course files are hand-edited YAML and the Mac's python3 has no YAML library,
# so this edits text, narrowly: it appends a top-level key that is absent and
# replaces only the literal empty forms lockin itself writes (`grading: []`,
# `allowed: null` under absences). Anything else is someone's writing and stays.

def q(s):
    return '"' + re.sub(r'["\\\n\r]+', " ", str(s)).strip() + '"'


def top_keys(text):
    return set(re.findall(r"^([A-Za-z_]+):", text, re.M))


def block(text, key):
    """The text of a top-level key's block, header line included, or ''."""
    m = re.search(rf"^{key}:.*?(?=^[A-Za-z_]+:|\Z)", text, re.M | re.S)
    return m.group(0) if m else ""


def is_empty_block(text, key):
    b = block(text, key)
    if not b:
        return True
    body = re.sub(r"#.*", "", b.split(":", 1)[1]).strip()
    return body in ("", "[]", "{}", "null", "~")


def fill(text, found, file_label, today):
    """(new_text, written, conflicts, gaps). `found` is read_syllabus (or
    merge) output, every source already naming its file and page;
    file_label names the files read, for the stamp line."""
    written, conflicts, gaps = [], [], []
    add = []

    meets = found.get("meets")
    if meets:
        if is_empty_block(text, "meets"):
            rows = []
            for m in meets:
                rows.append(f"  - {{ days: [{', '.join(m['days'])}], start: {q(m['start'])}, end: {q(m['end'])}, "
                            f"room: {q(m['room'])}, source: {q(m['source'])} }}")
            text = replace_or_add(text, "meets", "meets:\n" + "\n".join(rows) + "\n", add)
            written.append("meets")
        else:
            have = block(text, "meets")
            for m in meets:
                if m["start"] not in have:
                    conflicts.append(f"meets: syllabus says {'/'.join(m['days'])} {m['start']}-{m['end']} "
                                     f"({m['source']}), the ledger has something else")
    else:
        gaps.append("meets")

    oh, off, email = found.get("office_hours"), found.get("office"), found.get("email")
    inst = block(text, "instructor")
    # `instructor: "Name, email"` is someone's sentence: read it, never edit it.
    is_map = not inst or re.match(r"^instructor:\s*(?:#.*)?$", inst.splitlines()[0])
    want = []
    for key, v in (("email", email), ("office", off), ("office_hours", oh)):
        if not v:
            continue
        if not re.search(rf"^\s+{key}:", inst, re.M) and not (not is_map and key == "email" and v["value"] in inst):
            if is_map:
                want.append(f"  {key}: {q(v['value'])}\n  {key}_source: {q(v['source'])}\n")
                written.append(f"instructor.{key}")
        elif key == "office_hours" and norm_text(v["value"])[:12] not in norm_text(inst):
            conflicts.append(f"office hours: syllabus says {v['value']!r} ({v['source']}), the ledger has something else")
    if want and inst:
        text = text.replace(inst, inst.rstrip("\n") + "\n" + "".join(want) + "\n", 1)
    elif want:
        add.append("instructor:\n" + "".join(want))
    if not oh:
        gaps.append("office hours")

    ab = found.get("absences_allowed")
    ung = found.get("attendance_ungraded")
    absences = block(text, "absences")
    if ab:
        line = f"  allowed: {ab['value']}\n  allowed_source: {q(ab['source'] + ': ' + ab['quote'][:160])}\n"
        if not absences:
            add.append("absences:\n" + line + "  used: 0\n")
            written.append("absences.allowed")
        elif re.search(r"^\s+allowed:\s*(?:null|~)?\s*(?:#.*)?$", absences, re.M) and "ungraded: true" not in absences:
            text = text.replace(absences, re.sub(r"^\s+allowed:\s*(?:null|~)?\s*(?:#.*)?\n", line, absences, count=1, flags=re.M), 1)
            written.append("absences.allowed")
        else:
            have = re.search(r"^\s+allowed:\s*(\d+)", absences, re.M)
            if have and int(have.group(1)) != ab["value"]:
                conflicts.append(f"absences: syllabus says {ab['value']} free ({ab['source']}), "
                                 f"the ledger says {have.group(1)}")
    elif ung and not absences:
        add.append(f"absences:\n  ungraded: true\n  allowed: null\n  used: 0\n"
                   f"  source: {q(ung['source'] + ': ' + ung['quote'][:160])}\n")
        written.append("absences.ungraded")
    else:
        gaps.append("attendance budget")

    g = found.get("grading")
    if g:
        total = g["weight_total"]
        if total is not None and abs(total - 100) > 1:
            gaps.append(f"grading (the syllabus table adds to {total}%, not 100, so it wasn't written)")
        elif is_empty_block(text, "grading"):
            rows = []
            for r in g["rows"]:
                parts = [f"name: {q(r['name'])}"]
                if "weight" in r:
                    parts.append(f"weight: {r['weight']}")
                if "points" in r:
                    parts.append(f"points: {r['points']}")
                parts.append(f"source: {q(r['source'])}")
                rows.append("  - { " + ", ".join(parts) + " }")
            text = replace_or_add(text, "grading", "grading:\n" + "\n".join(rows) + "\n", add)
            if "grading_model" not in top_keys(text) and not any(a.startswith("grading_model") for a in add):
                add.append("grading_model: weighted\n")
            written.append("grading")
        else:
            have = block(text, "grading")
            n_have = len(re.findall(r"^\s*-\s", have, re.M))
            if n_have and n_have != len(g["rows"]):
                conflicts.append(f"grading: syllabus lists {len(g['rows'])} parts ({g['source']}), "
                                 f"the ledger has {n_have}")
    elif found.get("grading_contract") and is_empty_block(text, "grading") and "grading_model" not in top_keys(text):
        gc = found["grading_contract"]
        add.append(f"grading_model: contract\ngrading_model_source: {q(gc['source'] + ': ' + gc['quote'][:160])}\n")
        written.append("grading_model contract")
    elif not re.search(r"^grading_model:\s*contract", text, re.M):
        gaps.append("grading")

    if add:
        stamp = f"\n# Read from {file_label} by `chewbacca usc lockin` on {today}. Each value names its page.\n"
        text = text.rstrip("\n") + "\n" + stamp + "".join(add)
    return text, written, conflicts, gaps


def replace_or_add(text, key, new_block, add):
    b = block(text, key)
    if b:
        return text.replace(b, new_block + ("\n" if b.endswith("\n\n") else ""), 1)
    add.append(new_block)
    return text


def norm_text(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def merge(found_list):
    """One course can have two syllabi (lecture and lab, or a syllabus and an
    addendum). The first file with a field wins, and lab-named files sort
    last, so the lab manager's address never becomes the instructor's."""
    out = {}
    for found in found_list:
        for k, v in found.items():
            out.setdefault(k, v)
    return out


def syllabus_order(path):
    name = path.name.lower()
    return (bool(re.search(r"\blab\b|addendum", name)), name)
