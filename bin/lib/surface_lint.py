"""Refuse a wall of text on the glass.

Caleb, 2026-10-10, three times in one night: "this is just a fat wall of text",
"how is anyone supposed to be able to comprehend this 1 dimensional ah ui/ux",
and on the meetings panel "Absolutely atrocious ui ux its just a wall of text
bro, fix chewb so we NEVER make a wall of text ever again". Each time the
panel had passed its tests: they checked the ops were valid, not that a person
could read them at a glance. This reads the same Kyber Lines the display gets
and measures what a person would see on the first draw.

    lint(lines) -> list of findings, empty when it reads at a glance

Text inside a component the person opens on purpose (a File, a Diff, a
Transcript, a Terminal, a Web pane) is not counted: reading it is the job. A
folded body is the right home for long text, never the first view.
"""
from __future__ import annotations

import json
import re

# One line of a 380 to 440 point panel at the HUD's body size holds about 60
# to 70 characters; two lines is the most a row should take. Measured on the
# 2026-10-10 screenshots: the meetings rows Caleb called atrocious ran 150 to
# 190 characters each.
ROW_CHARS = 120
# Everything readable on the first draw, outside opened-on-purpose components.
# The agents tiles he accepted as a step up carried about 420; the meetings
# panel he called atrocious carried about 1,400. With the fixtures, the two
# densest panels he has not flagged measure needs-you 981 and conversations
# 919, so the limit sits above them and below the meetings panel. Tighten it
# as those two get leaner (ledger: surface-lint-tighten).
SURFACE_CHARS = 1000
# Text rows in a row before something that is not text (a number, a tile, a
# chip, a ring, an avatar, a button) breaks them up. Miller's seven.
TEXT_RUN = 7
# Components whose text the person opened to read.
OPENED = {"File", "Diff", "Transcript", "Terminal", "Web", "Code"}
# Text bound to a Select's options: in its menu, not on the first view.
MENU = "Select menu"
# Components that are not prose and break a run of text.
VISUAL = {"Metric", "Tiles", "Chips", "Ring", "Avatar", "Sparkline", "Bars", "Segmented", "Button",
          "Mark", "Image", "Web", "Table"}
# The plumbing that leaked onto the meetings panel: provenance, raw clock
# times to the second, word ranges and model attributions belong behind a tap.
PLUMBING = [
    (re.compile(r"\(guess,"), "a provenance note in the row"),
    (re.compile(r"Claude's (?:pick|date|guess)"), "model attribution in the row"),
    (re.compile(r"\b\d{1,2}:\d{2}:\d{2}\s?(?:AM|PM)\b"), "a clock time to the second"),
    (re.compile(r"\bwords \d+-\d+\b"), "a word range"),
    (re.compile(r"\b[0-9a-f]{12,}\b"), "a raw id"),
]
COMPONENT = re.compile(r"^c (\S+) (\S+)(.*)$")
DATA = re.compile(r"^d (\S+) (.*)$")
TEXT_PROPS = re.compile(r'\b(?:value|title|caption|message|label|text|placeholder)=("(?:[^"\\]|\\.)*")')
TEXT_KEYS = ("text", "title", "time", "caption", "message", "summary", "subtitle", "detail", "label", "value")


def _strings(value) -> list[str]:
    """Every readable string a data value would put on the glass."""
    if isinstance(value, str):
        return [value]
    out: list[str] = []
    if isinstance(value, dict):
        for key in TEXT_KEYS:
            if isinstance(value.get(key), str):
                out.append(value[key])
    elif isinstance(value, list):
        for item in value:
            out.extend(_strings(item))
    return out


def lint(lines: list[str]) -> list[str]:
    types: dict[str, str] = {}
    bound: dict[str, str] = {}  # data pointer -> component type that reads it
    texts: list[tuple[str, str]] = []  # (component type, text)
    order: list[str] = []
    for line in lines:
        m = COMPONENT.match(line)
        if m:
            cid, ctype, rest = m.groups()
            types[cid] = ctype
            # An Events with an action and no caption is a row of buttons
            # (the agent card's Allow once, Send, Stop, Fork), drawn as a
            # press like a Button, so it breaks a run of prose as one does.
            if ctype == "Events" and "action=" in rest and re.search(r'\bcaption=""', rest):
                order.append("Button")
            else:
                order.append(ctype)
            for prop, ptr in re.findall(r"\b(\w+)=@(\S+)", rest):
                # A Select's options sit in its menu until it is opened; only
                # its chosen value is on the glass. Counted as drawn, the
                # tasks panel's "Act on" options were a third of its total
                # on 2026-10-11 though none of them was visible.
                bound[ptr] = MENU if (ctype, prop) == ("Select", "options") else ctype
            for raw in TEXT_PROPS.findall(rest):
                try:
                    texts.append((ctype, json.loads(raw)))
                except ValueError:
                    continue
            continue
        m = DATA.match(line)
        if m:
            ptr, raw = m.groups()
            try:
                value = json.loads(raw)
            except ValueError:
                continue
            ctype = bound.get(ptr, "")
            for text in _strings(value):
                texts.append((ctype, text))
    findings: list[str] = []
    shown = [(t, s) for t, s in texts if t not in OPENED and t != MENU and s.strip()]
    total = sum(len(s) for _, s in shown)
    if total > SURFACE_CHARS:
        findings.append(f"{total} characters on the first view (limit {SURFACE_CHARS}); fold the rest behind a tap")
    for ctype, s in shown:
        if len(s) > ROW_CHARS:
            findings.append(f"a {ctype or 'text'} row of {len(s)} characters (limit {ROW_CHARS}): {s[:60]}...")
        for pattern, what in PLUMBING:
            if pattern.search(s):
                findings.append(f"{what} on the glass: {s[:60]}")
                break
    run = longest = 0
    for ctype in order:
        if ctype in VISUAL:
            run = 0
        elif ctype not in ("Screen", "Stack"):
            run += 1
            longest = max(longest, run)
    if longest > TEXT_RUN:
        findings.append(f"{longest} text components in a row with nothing visual between (limit {TEXT_RUN})")
    return findings
