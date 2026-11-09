"""Rewrite one section of a Google Doc from a small markdown subset, in one
batchUpdate.

Written 2026-10-28. An ad hoc script wrote the OPTRA call prep into the shared
"Calls 10/28" Doc with three nested bullets. createParagraphBullets deletes the
leading tabs it reads as nesting, so every index after that run moved back
three, and the next two bullet runs, computed from the same read, swallowed
the "6. Close" heading and the Firebox H1 below them. Gavin was reading that
Doc live. This module computes every index from the text it inserts and sends
the bullet runs last to first, so a tab removed in one run can't move another.

Markdown it reads, one line per paragraph:
  # / ## / ### text     a heading
  - text                a bullet; two more spaces of indent per nesting level
  anything else         a normal paragraph
  **bold** anywhere     bold, the stars removed
Blank lines are dropped.
"""
import re

HEADINGS = {1: "HEADING_1", 2: "HEADING_2", 3: "HEADING_3"}
BOLD = re.compile(r"\*\*(.+?)\*\*")


def parse(md):
    """[{kind: h|b|p, level, text, bold: [(start, end)]}], text without stars
    or tabs."""
    out = []
    for raw in md.splitlines():
        if not raw.strip():
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", raw.strip())
        b = re.match(r"^( *)[-*]\s+(.*)$", raw)
        if m:
            kind, level, body = "h", len(m.group(1)), m.group(2)
        elif b:
            kind, level, body = "b", len(b.group(1)) // 2, b.group(2)
        else:
            kind, level, body = "p", 0, raw.strip()
        spans, text, pos = [], "", 0
        for mm in BOLD.finditer(body):
            text += body[pos:mm.start()]
            spans.append((len(text), len(text) + len(mm.group(1))))
            text += mm.group(1)
            pos = mm.end()
        text += body[pos:]
        out.append({"kind": kind, "level": level, "text": text.replace("\t", " "), "bold": spans})
    return out


def heading_level(style):
    m = re.match(r"HEADING_(\d)", style or "")
    return int(m.group(1)) if m else 0


def find_section(blocks, under):
    """(start, end) of the body under the heading whose text starts with
    `under`: from the end of that heading to the start of the next heading
    of the same or a higher level, or the end of the Doc."""
    hits = [b for b in blocks if heading_level(b["style"]) and b["text"].startswith(under)]
    if len(hits) != 1:
        raise ValueError(f"{len(hits)} headings start with {under!r}; it has to be exactly one")
    head = hits[0]
    lvl = heading_level(head["style"])
    end = None
    for b in blocks:
        if b["start"] > head["start"] and 0 < heading_level(b["style"]) <= lvl:
            end = b["start"]
            break
    if end is None:
        end = blocks[-1]["end"] - 1
        # The Doc's last newline can't be deleted, so the new text goes before it.
    return head["end"], end


def requests(start, end, paras, tab_id=None):
    """The one batch: delete the old body, insert the new text, style it,
    then bullets last to first."""
    def rng(a, b):
        r = {"startIndex": a, "endIndex": b}
        if tab_id:
            r["tabId"] = tab_id
        return r

    lines = [("\t" * p["level"] if p["kind"] == "b" else "") + p["text"] for p in paras]
    text = "".join(line + "\n" for line in lines)
    reqs = []
    if end > start:
        reqs.append({"deleteContentRange": {"range": rng(start, end)}})
    loc = {"index": start}
    if tab_id:
        loc["tabId"] = tab_id
    reqs.append({"insertText": {"location": loc, "text": text}})
    stop = start + len(text)
    # The new text inherits the style of the paragraph it was typed into
    # (the next heading), so reset everything before styling.
    reqs.append({"deleteParagraphBullets": {"range": rng(start, stop)}})
    reqs.append({"updateParagraphStyle": {"range": rng(start, stop), "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"},
                                          "fields": "namedStyleType"}})
    reqs.append({"updateTextStyle": {"range": rng(start, stop), "textStyle": {}, "fields": "bold,italic"}})
    spans, pos = [], start
    for p, line in zip(paras, lines):
        a, b = pos, pos + len(line) + 1
        pad = len(line) - len(p["text"])
        spans.append((p, a, b))
        if p["kind"] == "h":
            reqs.append({"updateParagraphStyle": {"range": rng(a, b), "paragraphStyle": {
                "namedStyleType": HEADINGS.get(p["level"], "HEADING_3")}, "fields": "namedStyleType"}})
        for s, e in p["bold"]:
            reqs.append({"updateTextStyle": {"range": rng(a + pad + s, a + pad + e), "textStyle": {"bold": True},
                                             "fields": "bold"}})
        pos = b
    runs, cur = [], []
    for p, a, b in spans:
        if p["kind"] == "b":
            cur.append((a, b))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    # Last run first: removing a run's nesting tabs only moves text after it.
    for run in sorted(runs, key=lambda r: r[0][0], reverse=True):
        reqs.append({"createParagraphBullets": {"range": rng(run[0][0], run[-1][1]),
                                                "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE"}})
    return reqs
