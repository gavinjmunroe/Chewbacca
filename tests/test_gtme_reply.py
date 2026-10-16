"""gtme-reply: every case from the upstream TypeScript tests, plus the pure
fit-review and auto-send pieces those tests never covered.

tests/fixtures/gtme-reply/reply_intent_cases.json is the 27 investor
replies from reply-intent.test.ts, anonymized (every name, firm, address, phone
number and link invented) and stored ASCII-escaped.
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
# Shared byte for byte with togari-platform's
# src/agents/smartlead-responder/__tests__/reply-copy-cases.json; both suites pin
# this hash (feedback_ported_logic_fix_both_copies.md).
COPY_FILE = ROOT / "tests" / "fixtures" / "gtme-reply" / "reply-copy-cases.json"
COPY_SHA256 = "cf3d9f40ffb8429fe95e1439947b6698c418a7df1b1c648caa2cf246de443ac4"
COPY_CASES = json.loads(COPY_FILE.read_text(encoding="utf-8"))
ZEUTARA_COPY = COPY_CASES["clients"]["zeutara"]

EM = "—"
EN = "–"
APPLE_MAIL_REPLY = (
    '<html class="apple-mail-supports-explicit-dark-mode"><head><meta http-equiv="content-type" '
    'content="text/html; charset=utf-8"></head><body dir="auto">Sure Sagar happy to help give me a call '
    "(949) 555-0107 anytime this afternoon after 3pm<div><br><div><div dir=\"ltr\"><div><span "
    'style="background-color: rgba(255, 255, 255, 0);">Dale Kemp</span></div><div><span '
    'style="background-color: rgba(255, 255, 255, 0);">CEO Summit Capital Network - &ldquo;Connecting '
    "founders with capital &amp;amp; advice&rdquo;</span></div><div><span>Founder 4040 Ventures, "
    'Inc. - &amp;nbsp;"Growing Ideas With Capital and Counsel"<br><br><a '
    'href="http://www.linkedin.com/in/example-person-40" target="_blank">www.linkedin.com/in/example-person-40</a><br>'
    "(800) 5-CAP-010 | Toll Free<br><br>SUMMIT CAPITAL NETWORK, 4040 VENTURES, INC (4040) "
    "Confidentiality&amp;nbsp;<br>Notice:&amp;nbsp; The information contained in this electronic e-mail "
    "and any accompanying attachment(s) is intended only for the use of the intended recipient and may be "
    'confidential.</span></div></div><div dir="ltr"><br><blockquote type="cite">On Sep 2, 2026, at 2:23 PM, '
    "Sagar Tiwari &lt;sagar@bluemodernadvisory.com&gt; wrote:<br><br>Dale, quick one about the $9M in "
    "pipeline your AI lab is running.</blockquote></div></div></div></body></html>")


def run_bin(*args, stdin=""):
    return subprocess.run([sys.executable, str(BIN), *args], input=stdin,
                          capture_output=True, text=True)


class ReplyIntentRealReplies(unittest.TestCase):
    def test_every_real_reply_gets_the_move_jonah_named(self):
        for case in CASES["zeutara"] + CASES["qube"]:
            with self.subTest(case["from"]):
                intent = reply.reply_intent(case["body"], lead_email=case["from"],
                                            company_name="Qube Finance", client=ZEUTARA_COPY)
                self.assertEqual(intent["kind"], case["kind"])
                if case["step"]:
                    self.assertIn(case["step"], intent["nextStep"])

    def test_referral_goes_to_every_colleague_not_the_replier(self):
        referrer = next(c for c in CASES["zeutara"] if c["from"] == "person08@firm06.example")
        step = reply.reply_intent(referrer["body"], lead_email=referrer["from"])["nextStep"]
        for email in ("person09@", "person10@", "person11@", "person12@"):
            self.assertIn(email, step)
        self.assertNotIn("person08@", step)

    def test_our_own_quoted_email_does_not_decide(self):
        body = ("Thanks, not a fit for us.\n\nOn Tue, Oct 6, 2026 at 9:00 AM Jonah Graham "
                "<jonahg@zeutaramedia.info> wrote:\n> Happy to send the deck and set up a call.")
        self.assertEqual(reply.reply_intent(body)["kind"], "pass")

    def test_fast_and_short_on_a_hostile_reply(self):
        many = " ".join(f"p{i}@fund.example" for i in range(40))
        start = time.monotonic()
        intent = reply.reply_intent(f"Please reach out to them: {many} {'a.' * 50_000}")
        self.assertLess(time.monotonic() - start, 0.2)
        self.assertLess(len(intent["nextStep"]), 300)

    def test_misses_from_the_2026_10_11_inbox_run(self):
        # Each came out "unclear" over 87 real Zeutara replies; reworded here.
        cases = {
            "no": "pass",
            "No thanks": "pass",
            "Sorry, no interest. please take us off your distribution list!": "unsubscribe",
            "Please remove us from your list": "unsubscribe",
            "It would be a conflict of interest since we have our own fund in the space": "pass",
            "Thanks for thinking of us. I have to pass on this one.": "pass",
            "Hey! Thanks for reaching out. This is an automated message. I get a high volume of "
            "messages and may not be able to reply.": "later",
            "Jonah - I'm happy to chat once they identify a lead for the round, but until then, "
            "I have to pass.": "later",
        }
        for body, kind in cases.items():
            with self.subTest(body):
                self.assertEqual(reply.reply_intent(body)["kind"], kind)

    def test_passes_that_held_gtme_done_open_on_2026_10_16(self):
        # Read as "unclear" and listed as owed replies; reworded.
        cases = [
            "oh thanks. will need to hold off. out of thesis for us.",
            "Np interest",
            "Thank you for reaching out. While the concept is intriguing, it falls outside the "
            "sectors we are presently targeting. Unfortunately, this won't be a fit for us.",
            "Jonah, The partners here have all retired and we no longer invest. Best of luck",
        ]
        for body in cases:
            with self.subTest(body):
                self.assertEqual(reply.reply_intent(body)["kind"], "pass")

    def test_passes_that_blocked_the_2026_10_14_launch(self):
        # Five passes read "unclear" and stood as owed replies in front of a
        # 14-campaign launch; reworded, signature shapes kept.
        cases = {
            "No Pat Example 100 Main Street, Suite 1, Springfield M: (555) 010-0100": "pass",
            "No  Get Outlook for Mac  From: Jonah Graham Sent: Tuesday": "pass",
            "Sorry for the non-response. Our fund is no longer making new investments. Good luck.": "pass",
            "We do not invest in individual deals unless they are our own. Thanks": "pass",
            "We will never talk to anyone who is using a third-party to help them raise capital.": "pass",
        }
        for body, kind in cases.items():
            with self.subTest(body):
                self.assertEqual(reply.reply_intent(body)["kind"], kind)
        # A "No" the first sentence turns around stays open for a person.
        for body in ("No worries, happy to take a look at the deck",
                     "No pressure, but could you share more on the round?",
                     "No, but I'd be open to a call next week"):
            with self.subTest(body):
                self.assertNotEqual(reply.reply_intent(body)["kind"], "pass")

    def test_moved_on_wrapped_across_lines(self):
        # A Swiss mailbox notice on 2026-10-11 broke "nicht mehr aktiv" over a
        # line and came out "unclear"; reworded.
        body = "Danke für Ihre Nachricht.\nDas Postfach ist nicht\nmehr aktiv. Bei Rückfragen wenden Sie sich an Herrn Muster."
        self.assertEqual(reply.reply_intent(body)["kind"], "referral")

    def test_no_inside_a_sentence_is_not_a_pass(self):
        self.assertNotEqual(reply.reply_intent("No problem, send the deck over")["kind"], "pass")

    def test_nothing_matching_falls_through_to_a_read(self):
        self.assertEqual(reply.reply_intent("Cool.")["kind"], "unclear")

    def test_auto_handled_kinds(self):
        # Upstream's six, plus Chewbacca's "bounce" (see Bounces below).
        self.assertEqual(reply.AUTO_HANDLED,
                         {"pass", "later", "new_address", "referral", "unsubscribe", "ignore", "bounce"})


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
        for quoted in ("On Sep 2, 2026", "wrote:", "$9M in pipeline"):
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
                                     "Sagar Tiwari <sagar@bluemodernadvisory.com> wrote:\n> our original pitch")
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
        deck_ask = next(c for c in CASES["zeutara"] if c["from"] == "person13@firm08.example")
        self.assertEqual(reply.readable_reply(deck_ask["body"]),
                         "Hello Jonah. Is it possible to share the pitch deck before I commit to "
                         "taking a call with the Founder? Thanks.")
        moved_on = next(c for c in CASES["zeutara"] if c["from"] == "person02@firm02.example")
        out = reply.readable_reply(moved_on["body"])
        self.assertIn("owen park (person03@firm02.example) is the best person to reach", out)
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
        for text in ("www.site.com", "a@b.example", "+1 (555) 123 4567", "€5", "40%", "3.5 million"):
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


class Bounces(unittest.TestCase):
    # Chewbacca's addition over upstream: on 65 real replies (2026-10-10) both
    # delivery failures came out "unclear" and would have reached the client.
    def test_server_bounces_are_handled(self):
        for text in (
            "Address not found\n\nYour message wasn't delivered to person01@gmail.com because "
            "the address couldn't be found.",
            "Message blocked\n\nYour message to person02@firm01.example has been blocked.",
            "Delivery Status Notification (Failure)",
            "Undeliverable: Quick intro",
        ):
            out = reply.reply_intent(text)
            self.assertEqual(out["kind"], "bounce", text)
            self.assertIn("bounce", reply.AUTO_HANDLED)

    def test_an_opt_out_that_reads_like_a_bounce_is_blocklisted(self):
        for text in ("Remove me. My mailbox is full of these.",
                     "Unsubscribe. This was undeliverable to my team anyway."):
            self.assertEqual(reply.reply_intent(text)["kind"], "unsubscribe", text)

    def test_a_person_mentioning_delivery_is_not_a_bounce(self):
        self.assertNotEqual(reply.reply_intent("Interested, can you send the deck? Delivery timing "
                                               "matters to us.")["kind"], "bounce")


class RemovalAsks(unittest.TestCase):
    # "Remove Daniel" was a partner's whole reply (2026-10-10) and came out
    # "unclear"; the GTM tab kept it as an expected failure until this landed.
    def test_naming_someone_else_is_an_opt_out(self):
        for text in ("Remove Daniel", "Please remove", "Not a fit. Remove us.",
                     "Please remove him from your list", "Remove Dan Smith from your list please"):
            self.assertEqual(reply.reply_intent(text)["kind"], "unsubscribe", text)

    def test_remove_in_passing_is_not(self):
        self.assertEqual(reply.reply_intent("We will remove the cap next round, send the deck")["kind"], "deck")
        self.assertEqual(reply.reply_intent("Can you remove the deck password?")["kind"], "deck")

    def test_unclosed_tags_stay_linear(self):
        # "<br" with no ">" scanned to the end from every "<": 50k chars took 2.6 s.
        for text in ("<br" * 17000, "<html>" + "<style" * 10000, "<p" * 17000):
            started = time.time()
            reply.clean_reply_text(text)
            self.assertLess(time.time() - started, 1, text[:12])


class LeadNames(unittest.TestCase):
    # Synced with src/replies/lead-name.ts and card-copy.ts at 8d7ad77; all
    # 36 parity inputs matched the TypeScript on 2026-10-10.
    def test_email_proves_the_e_was_added(self):
        self.assertEqual(reply.clean_lead_name("Gary Zimmermane", "gary.zimmerman@firm.example"),
                         "Gary Zimmerman")
        self.assertEqual(reply.clean_lead_name("Eric Chine", "echin@firm.example"), "Eric Chin")

    def test_initial_with_e(self):
        self.assertEqual(reply.clean_lead_name("B. P.e"), "B. P.")

    def test_real_e_survives(self):
        self.assertEqual(reply.clean_lead_name("Grace Moore", "gmoore@firm.example"), "Grace Moore")
        self.assertEqual(reply.clean_lead_name("Philipp Rose", "philipp.rose@firm.example", True),
                         "Philipp Rose")

    def test_known_feeder_strips_without_email_evidence(self):
        # The email doesn't spell "rose", so a known feeder's "e" goes.
        self.assertEqual(reply.clean_lead_name("Joe Smithe", "joe@firm.example", True), "Joe Smith")
        # "prose" does contain "rose", so the "e" is theirs.
        self.assertEqual(reply.clean_lead_name("Philipp Rose", "prose@firm.example", True), "Philipp Rose")
        self.assertEqual(reply.clean_lead_name("Grace Mooree", "gmoore@firm.example"), "Grace Moore")

    def test_feeder_batch_needs_eight_and_ninety_percent(self):
        eight = ["A Be", "C De", "E Fe", "G He", "I Je", "K Le", "M Ne", "O Pe"]
        self.assertTrue(reply.feeder_appends_e(eight))
        self.assertFalse(reply.feeder_appends_e(eight[:7]))
        self.assertFalse(reply.feeder_appends_e(eight + ["Q R", "S T"]))

    def test_out_of_office(self):
        self.assertTrue(reply.is_auto_reply("I am currently out of the office until 10/20."))
        self.assertTrue(reply.is_auto_reply("I'm on parental leave and will reply upon my return"))
        self.assertFalse(reply.is_auto_reply("Thanks, please send the deck"))

    def test_cli(self):
        out = json.loads(run_bin("name", "Gary Zimmermane", "--email",
                                 "gary.zimmerman@firm.example").stdout)
        self.assertEqual(out, {"name": "Gary Zimmerman", "changed": True})
        out = json.loads(run_bin("names", stdin="A Be\nC De\nE Fe\nG He\nI Je\nK Le\nM Ne\nO Pe\n").stdout)
        self.assertEqual(out, {"feederAddsE": True, "count": 8})
        self.assertTrue(json.loads(run_bin("ooo", stdin="Automatic reply: back Monday").stdout)["autoReply"])


class HostileInput(unittest.TestCase):
    # Security review 2026-10-09: 200,000 spaces then "x" held readable_reply
    # for 192s, and a NaN confidence compared False against the threshold so
    # it never read as too low.
    def test_long_whitespace_run_stays_fast(self):
        text = " " * 200000 + "x"
        for fn in (reply.clean_reply_text, reply.readable_reply, reply.reply_intent):
            started = time.time()
            fn(text)
            self.assertLess(time.time() - started, 2, fn.__name__)

    def test_bracket_echo_still_dropped(self):
        self.assertEqual(reply.readable_reply("hi there [person39@firm31.example] ok"), "hi there ok")

    def test_non_finite_confidence_never_sends(self):
        base = {"threshold": 0.9, "sentiment": "interested", "draft": "Tuesday works.\n\nJonah",
                "reply": "yes, let's talk", "lead_id": 1, "campaign_id": 1}
        for bad in (float("nan"), float("inf"), "1"):
            self.assertFalse(reply.auto_sendable({**base, "confidence": bad})["ok"], bad)

    def test_threshold_must_be_a_real_bar(self):
        base = {"sentiment": "interested", "confidence": 1, "draft": "Tuesday works.\n\nJonah",
                "reply": "yes, let's talk", "lead_id": 1, "campaign_id": 1}
        for bad in (0, -1, 2, "0", float("nan")):
            self.assertFalse(reply.auto_sendable({**base, "threshold": bad})["ok"], bad)



class ReplyCopyReadsTheClient(unittest.TestCase):
    """Move 4 (2026-10-13): next steps name the client's own principal and facts."""

    def test_same_corpus_as_togari(self):
        import hashlib
        self.assertEqual(hashlib.sha256(COPY_FILE.read_bytes()).hexdigest(), COPY_SHA256)

    def test_every_client_case_matches_togari(self):
        for name, facts in COPY_CASES["clients"].items():
            for case in COPY_CASES["inputs"]:
                with self.subTest(client=name, case=case["id"]):
                    got = reply.reply_intent(case["body"], lead_email="a@fund.example",
                                             company_name=case["company"], client=facts)
                    self.assertEqual({"kind": got["kind"], "nextStep": got["nextStep"]},
                                     COPY_CASES["expected"][name][case["id"]])

    def test_copy_facts_from_a_config_entry(self):
        zeutara = {"name": "Zeutara", "voice": {"first_name": "Jonah"},
                   "offer_facts": {"raises_debt": False, "call_with": "the founder"}}
        self.assertEqual(reply.copy_facts(zeutara), ZEUTARA_COPY)
        solo = {"name": "Firm Foundation DFW", "sender_company": "Firm Foundation"}
        self.assertEqual(reply.copy_facts(solo, "Gavin Munroe"),
                         {"principal": "Gavin", "clientName": "Firm Foundation"})
        self.assertIsNone(reply.copy_facts({"name": "Nobody"}))

    def test_a_solo_client_form_reply_never_says_jonah(self):
        facts = reply.copy_facts({"name": "Firm Foundation"}, "Gavin Munroe")
        step = reply.reply_intent("Please fill out our intake form at https://church.example/form",
                                  client=facts)["nextStep"]
        self.assertIn("as Gavin", step)
        self.assertNotIn("Jonah", step)
        for case in CASES["zeutara"] + CASES["qube"]:
            self.assertNotRegex(reply.reply_intent(case["body"], lead_email=case["from"])["nextStep"],
                                "Jonah|Zeutara")

    def test_autosend_reason_names_the_clients_principal(self):
        base = {"threshold": 0.9, "sentiment": "interested", "confidence": 0.95,
                "draft": "Tuesday works.", "reply": "Can you send the deck?",
                "lead_id": 1, "campaign_id": 2}
        self.assertIn("reply reads as deck, which needs a person", reply.auto_sendable(base)["reasons"])
        pat = {**base, "client": {"principal": "Pat", "clientName": "Harborline"}}
        self.assertIn("reply reads as deck, which needs Pat", reply.auto_sendable(pat)["reasons"])


if __name__ == "__main__":
    unittest.main()
