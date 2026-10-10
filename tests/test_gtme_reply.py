"""gtme-reply: every case from the upstream TypeScript tests, plus the pure
fit-review and auto-send pieces those tests never covered.

tests/fixtures/gtme-reply/reply_intent_cases.json is the 27 real investor
replies from reply-intent.test.ts, copied verbatim and stored ASCII-escaped.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin" / "gtme-reply"
SPEC = importlib.util.spec_from_file_location("gtme_reply", ROOT / "tools" / "gtme_reply.py")
reply = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reply)
CASES = json.loads((ROOT / "tests" / "fixtures" / "gtme-reply" / "reply_intent_cases.json")
                   .read_text(encoding="utf-8"))

EM = "—"
EN = "–"
APPLE_MAIL_REPLY = (
    '<html class="apple-mail-supports-explicit-dark-mode"><head><meta http-equiv="content-type" '
    'content="text/html; charset=utf-8"></head><body dir="auto">Sure Sagar happy to help give me a call '
    "(949) 795-0416 anytime this afternoon after 3pm<div><br><div><div dir=\"ltr\"><div><span "
    'style="background-color: rgba(255, 255, 255, 0);">Josh Bois</span></div><div><span '
    'style="background-color: rgba(255, 255, 255, 0);">CEO Global Capital Network - &ldquo;Connecting '
    "investors to entrepreneurs &amp;amp; deal flow&rdquo;</span></div><div><span>Founder 2030 Ventures, "
    'Inc. - &amp;nbsp;"Accelerating Ideas With Capital, Leadership, and Marketing"<br><br><a '
    'href="http://www.linkedin.com/in/joshbois" target="_blank">www.linkedin.com/in/joshbois</a><br>'
    "(800) 8-EMP-415 | Toll Free<br><br>GLOBAL CAPITAL NETWORK, 2030 VENTURES, INC (2030) "
    "Confidentiality&amp;nbsp;<br>Notice:&amp;nbsp; The information contained in this electronic e-mail "
    "and any accompanying attachment(s) is intended only for the use of the intended recipient and may be "
    'confidential.</span></div></div><div dir="ltr"><br><blockquote type="cite">On Sep 2, 2026, at 2:23 PM, '
    "Sagar Tiwari &lt;sagar@bluemodernadvisory.com&gt; wrote:<br><br>Josh, quick one about the $12M in "
    "pipeline your Voice AI lab is running.</blockquote></div></div></div></body></html>")


def run_bin(*args, stdin=""):
    return subprocess.run([sys.executable, str(BIN), *args], input=stdin,
                          capture_output=True, text=True)


class ReplyIntentRealReplies(unittest.TestCase):
    def test_every_real_reply_gets_the_move_jonah_named(self):
        for case in CASES["zeutara"] + CASES["qube"]:
            with self.subTest(case["from"]):
                intent = reply.reply_intent(case["body"], lead_email=case["from"],
                                            company_name="Qube Finance")
                self.assertEqual(intent["kind"], case["kind"])
                if case["step"]:
                    self.assertIn(case["step"], intent["nextStep"])

    def test_referral_goes_to_every_colleague_not_the_replier(self):
        jlund = next(c for c in CASES["zeutara"] if c["from"] == "jlund@uventurefund.com")
        step = reply.reply_intent(jlund["body"], lead_email=jlund["from"])["nextStep"]
        for email in ("chance.murray@", "carl.adams@", "charlotte.magee@", "jose.moreno@"):
            self.assertIn(email, step)
        self.assertNotIn("jlund@", step)

    def test_our_own_quoted_email_does_not_decide(self):
        body = ("Thanks, not a fit for us.\n\nOn Tue, Oct 6, 2026 at 9:00 AM Jonah Graham "
                "<jonahg@zeutaramedia.info> wrote:\n> Happy to send the deck and set up a call.")
        self.assertEqual(reply.reply_intent(body)["kind"], "pass")

    def test_fast_and_short_on_a_hostile_reply(self):
        many = " ".join(f"p{i}@fund.com" for i in range(40))
        start = time.monotonic()
        intent = reply.reply_intent(f"Please reach out to them: {many} {'a.' * 50_000}")
        self.assertLess(time.monotonic() - start, 0.2)
        self.assertLess(len(intent["nextStep"]), 300)

    def test_nothing_matching_falls_through_to_a_read(self):
        self.assertEqual(reply.reply_intent("Cool.")["kind"], "unclear")

    def test_auto_handled_kinds(self):
        self.assertEqual(reply.AUTO_HANDLED,
                         {"pass", "later", "new_address", "referral", "unsubscribe", "ignore"})


class CleanReplyText(unittest.TestCase):
    def test_apple_mail_html_reduces_to_what_they_typed(self):
        out = reply.clean_reply_text(APPLE_MAIL_REPLY)
        self.assertIn("Sure Sagar happy to help give me a call", out)
        self.assertIn("anytime this afternoon after 3pm", out)
        self.assertNotRegex(out, "[<>]")
        for debris in ("apple-mail", "&nbsp", "&amp", "rgba("):
            self.assertNotIn(debris, out)

    def test_drops_the_quoted_thread(self):
        out = reply.clean_reply_text(APPLE_MAIL_REPLY)
        for quoted in ("On Sep 2, 2026", "wrote:", "$12M in pipeline"):
            self.assertNotIn(quoted, out)

    def test_drops_confidentiality_boilerplate(self):
        out = reply.clean_reply_text(APPLE_MAIL_REPLY)
        self.assertNotIn("Confidentiality", out)
        self.assertNotIn("intended recipient", out)

    def test_plain_text_passes_through(self):
        plain = "Thanks for the note. Not a fit right now, but check back in Q1."
        self.assertEqual(reply.clean_reply_text(plain), plain)

    def test_cuts_plain_text_quoted_thread(self):
        out = reply.clean_reply_text("Sounds good, call me Tuesday.\n\nOn Sep 1, 2026, at 9:00 AM, "
                                     "Sagar Tiwari <sagar@x.com> wrote:\n> our original pitch")
        self.assertEqual(out, "Sounds good, call me Tuesday.")

    def test_outlook_original_message_header(self):
        out = reply.clean_reply_text("Interested.\n\n-----Original Message-----\nFrom: Sagar\nSent: Monday")
        self.assertEqual(out, "Interested.")

    def test_keeps_paragraphs_collapses_rubble(self):
        self.assertEqual(reply.clean_reply_text(
            "<div>One</div><div><br></div><div><br></div><div>Two</div>"), "One\n\nTwo")

    def test_empty_input(self):
        for empty in ("", None):
            self.assertEqual(reply.clean_reply_text(empty), "")


class StripEmDashes(unittest.TestCase):
    def test_punctuating_dash_becomes_comma(self):
        self.assertEqual(reply.strip_em_dashes(f"I'll give you a ring after 3pm {EM} does 3:30 work?"),
                         "I'll give you a ring after 3pm, does 3:30 work?")

    def test_joining_dash_becomes_hyphen(self):
        self.assertEqual(reply.strip_em_dashes(f"3{EN}4 weeks"), "3-4 weeks")

    def test_ordinary_hyphens_untouched(self):
        text = "A follow-up call on Tuesday, then we re-assess."
        self.assertEqual(reply.strip_em_dashes(text), text)

    def test_no_doubled_commas(self):
        self.assertEqual(reply.strip_em_dashes(f"Sure, {EM} happy to help"), "Sure, happy to help")


class FitReviewPieces(unittest.TestCase):
    def test_signature_and_bracket_echoes_cut(self):
        jeremy = next(c for c in CASES["zeutara"] if c["from"] == "jeremy@infinityvc.capital")
        self.assertEqual(reply.readable_reply(jeremy["body"]),
                         "Hello Jonah. Is it possible to share the pitch deck before I commit to "
                         "taking a call with the Founder? Thanks.")
        jack = next(c for c in CASES["zeutara"] if c["from"] == "jack@afore.vc")
        out = reply.readable_reply(jack["body"])
        self.assertIn("nathan yu (nathan@afore.vc) is the best person to reach", out)
        self.assertNotIn("[", out)

    def test_one_line_reply_survives_and_clips(self):
        self.assertEqual(reply.readable_reply("Thanks, no."), "Thanks, no.")
        self.assertEqual(reply.readable_reply("word " * 100, 20), "word word word word…")

    def test_split_campaign(self):
        self.assertEqual(reply.split_campaign("Zeutara | Ivy | Pre-seed investors | Midweek founder story",
                                              "zeutara"),
                         {"company": "Ivy", "detail": "Pre-seed investors · Midweek founder story"})
        self.assertEqual(reply.split_campaign("Fall | list", "Zeutara"),
                         {"company": None, "detail": "Fall · list"})


class AutoSend(unittest.TestCase):
    BASE = {"sentiment": "interested", "confidence": 0.95, "threshold": 0.9,
            "draft": "Great, does Tuesday or Wednesday afternoon work for a quick call?",
            "reply": "Interested, happy to chat.", "lead_id": 1, "campaign_id": 2}

    def verdict(self, **change):
        return reply.auto_sendable(dict(self.BASE, **change))

    def test_basic_interest_goes(self):
        self.assertEqual(self.verdict(), {"ok": True, "reasons": [], "intent": "interested"})

    def test_every_gate_refuses(self):
        refusals = {
            "threshold": None, "sentiment": "not_interested", "confidence": 0.5,
            "draft": "Attached is the deck.", "lead_id": None, "campaign_id": "",
            "reply": "Please fill out our intake form.",
        }
        for key, value in refusals.items():
            with self.subTest(key):
                self.assertFalse(self.verdict(**{key: value})["ok"])
        for draft in ("Call me at 310-555-0123 tomorrow", "See https://x.co", "We raised $2M",
                      "Hi [Name], TBD", "x" * 901, ""):
            with self.subTest(draft[:20]):
                self.assertFalse(self.verdict(draft=draft)["ok"])

    def test_boolean_confidence_is_not_a_number(self):
        self.assertFalse(self.verdict(confidence=True, threshold=0.5)["ok"])

    def test_payload_pattern(self):
        for text in ("www.site.com", "a@b.co", "+1 (555) 123 4567", "€5", "40%", "3.5 million"):
            with self.subTest(text):
                self.assertTrue(reply.CARRIES_PAYLOAD.search(text))
        self.assertFalse(reply.CARRIES_PAYLOAD.search("Does Tuesday at 3 work?"))


class JavaScriptSemantics(unittest.TestCase):
    def test_lengths_count_utf16_units(self):
        # 3000 emoji are 6000 JS units, so the cap keeps them all and nothing after.
        text = "\U0001f600" * 3000 + " please unsubscribe"
        self.assertEqual(reply.reply_intent(text)["kind"], "unclear")

    def test_ascii_word_boundary_and_folding(self):
        self.assertTrue(reply.DECK.search("cafédeck"))
        self.assertFalse(reply.PASS.search("ſo not for uſ"))
        self.assertTrue(reply.OUT_OF_OFFICE.search("WIEDER IM BÜRO"))

    def test_entity_beyond_unicode_raises_like_from_code_point(self):
        with self.assertRaises(ValueError):
            reply.clean_reply_text("&#x110000;")


class Cli(unittest.TestCase):
    def test_intent(self):
        out = run_bin("intent", "--company", "Ivy", stdin="Can you send the deck?")
        self.assertEqual(out.returncode, 0, out.stderr)
        result = json.loads(out.stdout)
        self.assertEqual(result["kind"], "deck")
        self.assertIn("Ivy deck", result["nextStep"])
        self.assertFalse(result["autoHandled"])

    def test_clean(self):
        out = run_bin("clean", "--strip-dashes", stdin=f"<p>Sure {EM} call me</p><blockquote>old</blockquote>")
        self.assertEqual(json.loads(out.stdout), {"text": "Sure, call me", "readable": "Sure, call me"})

    def test_autosend(self):
        out = run_bin("autosend", stdin=json.dumps(AutoSend.BASE))
        self.assertTrue(json.loads(out.stdout)["ok"])
        bad = run_bin("autosend", stdin="[]")
        self.assertEqual(bad.returncode, 2)

    def test_help(self):
        for sub in ("intent", "clean", "autosend", "campaign"):
            self.assertEqual(run_bin(sub, "--help").returncode, 0)


if __name__ == "__main__":
    unittest.main()
