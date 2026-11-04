"""tools/gtme_reply.py, the reply classifier, is a front door: the classifier and its full
suite live in Dough (engine/tests/test_gtme_reply.py). This is its replay here, the one
docs/plans/decision-evals.json names, so the kit still proves that what it runs labels
the 27 real investor replies the way Jonah did.

Corpus: tests/fixtures/gtme-reply/reply_intent_cases.json (anonymized, kept byte for byte
with Dough's copy), with the client copy from tests/fixtures/gtme-reply/reply-copy-cases.json.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gtme_reply as reply  # noqa: E402  the front door, which loads Dough's module

FIX = ROOT / "tests" / "fixtures" / "gtme-reply"
CASES = json.loads((FIX / "reply_intent_cases.json").read_text(encoding="utf-8"))
COPY = json.loads((FIX / "reply-copy-cases.json").read_text(encoding="utf-8"))["clients"]["zeutara"]


class FrontDoorReplay(unittest.TestCase):
    def test_the_module_is_doughs(self):
        self.assertIn("engine", Path(reply.__file__).parts)

    def test_every_real_reply_gets_the_move_jonah_named(self):
        for case in CASES["zeutara"] + CASES["qube"]:
            with self.subTest(case["from"]):
                intent = reply.reply_intent(case["body"], lead_email=case["from"], company_name="Qube Finance",
                                            client=COPY)
                self.assertEqual(intent["kind"], case["kind"])
                if case["step"]:
                    self.assertIn(case["step"], intent["nextStep"])


if __name__ == "__main__":
    unittest.main()
