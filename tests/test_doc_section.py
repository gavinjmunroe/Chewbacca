"""chewbacca google section: the batch it builds leaves every heading outside
the section alone, even with nested bullets.

Incident: 2026-10-28, an ad hoc write of the OPTRA call prep with three nested
bullets shifted the later bullet runs by three, and the "6. Close" heading and
the Firebox H1 after it became bullets in a Doc Gavin was reading live.

The Docs API isn't called. A small model of a Doc applies the requests in
order, the way Google does: insertText and deleteContentRange move text,
createParagraphBullets bullets every paragraph its range touches and deletes
the leading tabs it reads as nesting.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin", "lib"))
import doc_section  # noqa: E402


class FakeDoc:
    def __init__(self, paras):
        # paras: [(text, style)]; index 1 is the first character, like Docs.
        self.paras = [{"text": t, "style": s, "bullet": False} for t, s in paras]

    def spans(self):
        pos, out = 1, []
        for p in self.paras:
            end = pos + len(p["text"]) + 1
            out.append((pos, end))
            pos = end
        return out

    def blocks(self):
        return [{"index": i, "start": a, "end": b, "text": p["text"], "style": p["style"], "plain": True}
                for i, (p, (a, b)) in enumerate(zip(self.paras, self.spans()))]

    def flat(self):
        return "".join(p["text"] + "\n" for p in self.paras)

    def rebuild(self, text, styles):
        lines = text.split("\n")[:-1]
        self.paras = [{"text": t, "style": s, "bullet": b} for t, (s, b) in zip(lines, styles)]

    def apply(self, req):
        (kind, body), = req.items()
        if kind == "deleteContentRange":
            a, b = body["range"]["startIndex"], body["range"]["endIndex"]
            text = self.flat()
            styles, cut, pos = [], [], 1
            for p in self.paras:
                end = pos + len(p["text"]) + 1
                if not (a <= pos and end <= b):
                    styles.append((p["style"], p["bullet"]))
                pos = end
            self.rebuild(text[:a - 1] + text[b - 1:], styles)
        elif kind == "insertText":
            at = body["location"]["index"]
            text = self.flat()
            new = text[:at - 1] + body["text"] + text[at - 1:]
            # Each inserted paragraph takes the style of the paragraph it was
            # typed into.
            host = next(i for i, (a, b) in enumerate(self.spans()) if a <= at < b)
            styles = [(p["style"], p["bullet"]) for p in self.paras]
            styles[host:host] = [styles[host]] * body["text"].count("\n")
            self.rebuild(new, styles)
        elif kind in ("updateParagraphStyle", "deleteParagraphBullets", "createParagraphBullets"):
            a, b = body["range"]["startIndex"], body["range"]["endIndex"]
            for p, (s, e) in list(zip(self.paras, self.spans())):
                if s < b and e > a:
                    if kind == "updateParagraphStyle":
                        p["style"] = body["paragraphStyle"]["namedStyleType"]
                    elif kind == "deleteParagraphBullets":
                        p["bullet"] = False
                    else:
                        p["bullet"] = True
                        p["text"] = p["text"].lstrip("\t")


BEFORE = [
    ("Junto", "HEADING_1"), ("old junto line", "NORMAL_TEXT"),
    ("OPTRA Labs: Friday", "HEADING_1"), ("old optra line", "NORMAL_TEXT"), ("old step", "HEADING_3"),
    ("Firebox: 4:30", "HEADING_1"), ("Who: Noah", "NORMAL_TEXT"), ("1. Open (Gavin)", "HEADING_3"),
]

MD = """**Who:** Justin
### 4. Show the site (Caleb)
- Three things on his site:
  - One: blank without JavaScript
  - Two: counters
  - Three: country picker
### 5. Show the list (Caleb)
- 338 people
- 258 emails
### 6. Close (Gavin)
- The test
- Gavin sends a recap
"""


class SectionTest(unittest.TestCase):
    def run_section(self):
        doc = FakeDoc(BEFORE)
        start, end = doc_section.find_section(doc.blocks(), "OPTRA Labs:")
        for req in doc_section.requests(start, end, doc_section.parse(MD)):
            doc.apply(req)
        return doc

    def test_headings_outside_the_section_survive(self):
        doc = self.run_section()
        got = {p["text"]: (p["style"], p["bullet"]) for p in doc.paras}
        self.assertEqual(got["Firebox: 4:30"], ("HEADING_1", False))
        self.assertEqual(got["1. Open (Gavin)"], ("HEADING_3", False))
        self.assertEqual(got["Junto"], ("HEADING_1", False))
        self.assertEqual(got["old junto line"], ("NORMAL_TEXT", False))

    def test_new_section_has_its_own_shape(self):
        doc = self.run_section()
        got = {p["text"]: (p["style"], p["bullet"]) for p in doc.paras}
        self.assertEqual(got["6. Close (Gavin)"], ("HEADING_3", False))
        self.assertEqual(got["5. Show the list (Caleb)"], ("HEADING_3", False))
        self.assertEqual(got["Two: counters"], ("NORMAL_TEXT", True))
        self.assertEqual(got["Gavin sends a recap"], ("NORMAL_TEXT", True))
        self.assertEqual(got["Who: Justin"], ("NORMAL_TEXT", False))
        self.assertNotIn("old optra line", got)
        self.assertNotIn("old step", got)

    def test_bullets_go_last_to_first(self):
        reqs = doc_section.requests(10, 20, doc_section.parse(MD))
        starts = [r["createParagraphBullets"]["range"]["startIndex"] for r in reqs if "createParagraphBullets" in r]
        self.assertEqual(starts, sorted(starts, reverse=True))
        self.assertEqual(len(starts), 3)

    def test_bold_lands_on_the_label(self):
        paras = doc_section.parse("**Who:** Justin\n  - **Two:** counters")
        self.assertEqual(paras[0]["text"], "Who: Justin")
        self.assertEqual(paras[0]["bold"], [(0, 4)])
        self.assertEqual((paras[1]["kind"], paras[1]["level"], paras[1]["text"]), ("b", 1, "Two: counters"))

    def test_ambiguous_heading_is_refused(self):
        blocks = FakeDoc([("Close", "HEADING_3"), ("x", "NORMAL_TEXT"), ("Close", "HEADING_3")]).blocks()
        with self.assertRaises(ValueError):
            doc_section.find_section(blocks, "Close")


if __name__ == "__main__":
    unittest.main()
