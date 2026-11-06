"""One answer to "is this meeting private", for every path a meeting reaches.

The commit security review flagged the meetings panel's private-title filter
three times on 2026-10-11: the list checked one form of a title while other
paths (the ledger rows and calendar drafts made from action items, the alert
line, the walk text) printed another, and a split word ("thera-py",
"t.h.e.r.a.p.y") drew readable while the word list missed it. Every caller
now asks `safe_title`, which decodes once, checks that value, and returns the
text to show. Anything that can't be read for sure is private.
"""
from __future__ import annotations

import html
import re
import unicodedata

# Someone else can see the glass (kyber-surfaces rule 11). On 2026-10-11 the
# panel printed a psychiatric intake and a therapy session by name on the
# right edge of the screen. A title that names health care shows as "Private"
# and its detail stays behind a press. Words read off the titles on this Mac
# that day, plus their obvious siblings; a list, so it misses things (a
# doctor's surname alone), and it errs toward hiding.
PRIVATE = re.compile(
    r"\b(psychiatr\w*|psycholog\w*|therap\w*|counsel+ing|counsel+or|medica\w*|medicine|doctor|dr\.? [a-z]+|"
    r"clinic\w*|diagnos\w*|mental health|health ?care|hospital|prescri\w*|rehab\w*|dentist\w*|dental|"
    r"ob-?gyn|pregnan\w*|osas|accommodations?|disabilit\w*|psych|intake)\b", re.I)
PRIVATE_LABEL = "Private"

# Stems searched with every non-letter removed, so "thera-py", "t h e r a p y"
# and "psych.iatric" are caught. Longer than the word list's short forms
# ("psych", "dr") so letters-only text doesn't hide a "Dr Pepper" run.
STEMS = ("psychiatr", "psycholog", "therap", "counsel", "diagnos", "prescri", "clinic", "medicat",
         "mentalhealth", "hospital", "rehab", "pregnan", "obgyn", "disabilit")

# Letters from other scripts that draw as Latin ones, so "thеrapy" with a
# Cyrillic e is read as "therapy" by the private check. The common Cyrillic
# and Greek lookalikes only; a title that still mixes Latin with another
# script after this is treated as private (`is_private`).
CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "һ": "h", "ԁ": "d", "ӏ": "l", "ɡ": "g", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "α": "a", "ο": "o", "ρ": "p", "ι": "i", "κ": "k",
    "ν": "v", "τ": "t", "υ": "u", "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
    "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X"})


def decode(text) -> str:
    """The one form of a meeting's words that is both checked and drawn.

    Granola and Anarlog hand titles over HTML-escaped ("Sam&apos;s",
    2026-10-11), sometimes twice ("&amp;#39;"), so entities are undone until
    nothing changes (three rounds at most); then NFKC folds full-width and
    compatibility forms, and every format, control and bidi character goes,
    zero-width joiner included (ingest_meetings.clean keeps U+200D for emoji,
    and "psych\u200diatric" would have drawn as "psychiatric" while the
    private check read two words). The private check runs on this value and
    the row draws this value, so the two can never differ."""
    out = str(text or "")
    for _ in range(3):
        nxt = html.unescape(out)
        if nxt == out:
            break
        out = nxt
    out = unicodedata.normalize("NFKC", out)
    return "".join(ch for ch in out if unicodedata.category(ch) not in ("Cf", "Cc", "Cs", "Co", "Cn"))


def _scripts(text: str) -> set[str]:
    names = set()
    for ch in text:
        if ch.isalpha():
            name = unicodedata.name(ch, "")
            names.add(name.split(" ")[0] if name else "UNKNOWN")
    return names




def _letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", text)


def is_private(*texts) -> bool:  # noqa: F811  the stem check below widens the original
    for t in texts:
        text = decode(t)
        if not text:
            continue
        folded = text.translate(CONFUSABLES).casefold()
        if PRIVATE.search(folded) or any(s in _letters(folded) for s in STEMS):
            return True
        scripts = _scripts(folded)
        if "UNKNOWN" in scripts or ("LATIN" in scripts and len(scripts) > 1):
            return True
    return False


def safe_title(title, *also, label: str = PRIVATE_LABEL) -> str:
    """The title to print anywhere outside a pressed-open detail: decoded,
    or the label when it, or anything passed in `also`, reads as private."""
    full = decode(title)
    return label if is_private(full, *also) else full


def redact(text: str, label: str = PRIVATE_LABEL) -> str:
    """A whole CLI output with every private piece swapped for the label, for
    readers that print meetings in bulk (chewbacca-mcp's kit_read: a walk, a
    calendar, a ledger). JSON keeps its shape and each string goes through
    `safe_title`; anything else is checked a line at a time, and a private
    line keeps only its indent, because the time beside a title can be the
    thing that identifies it ("Tue 3pm" every week)."""
    import json
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, (dict, list)):
        def walk(v):
            if isinstance(v, str):
                return safe_title(v, label=label)
            if isinstance(v, list):
                return [walk(x) for x in v]
            if isinstance(v, dict):
                # A meeting title can be a key (rows grouped by meeting), and
                # two hidden keys must not collapse into one.
                return {(f"{label} {i + 1}" if is_private(k) else k): walk(x)
                        for i, (k, x) in enumerate(v.items())}
            return v
        return json.dumps(walk(data), indent=1, ensure_ascii=False)
    out = []
    for line in str(text or "").split("\n"):
        if is_private(line):
            out.append(line[: len(line) - len(line.lstrip())] + label)
        else:
            # The raw line, so tabs survive (decode drops every Cc character);
            # the check above already ran on its decoded form.
            out.append(line)
    return "\n".join(out)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] != ["--redact"]:
        sys.exit("usage: meeting_privacy.py --redact < text")
    sys.stdout.write(redact(sys.stdin.read()))
