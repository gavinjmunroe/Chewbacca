#!/usr/bin/env python3
"""config/send-policy.cedar answers "could this send right now", and the sinks
ask it.

- The policy parses and validates against its schema, and every forbid names
  an id and a reason.
- Quiet hours: the policy agrees with people send's own quietFor at every half
  hour of a week, Sagar's real rule included.
- Cold email: the cap ramp agrees with gtme_solo's RAMP and DAILY_CAP for 40
  days, and weekends, suppressions and repeats are refused.
- Clay: each gate in bin/chewbacca-clay's write path has its rule.
- send_approval.take() asks the policy first: with CHEWBACCA_NO_SEND set a
  minted token is refused and stays unspent. Before 2026-10-12 take() handed
  the press back and left NO_SEND to each sink.
- No binary means "unavailable" and take() runs as before; a broken policy
  or a fact of the wrong type is a no.

Builds the binary with cargo when CHEWBACCA_SENDPOLICY doesn't name one, and
skips (exit 0, says so) only when cargo is missing or can't fetch the pinned
crates; a compile error fails. Nothing here sends: no sink is called.
"""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / "crates/sendpolicy"
sys.path.insert(0, str(ROOT / "tools"))


def build():
    named = os.environ.get("CHEWBACCA_SENDPOLICY")
    if named and os.path.isfile(named):
        return named
    if not shutil.which("cargo"):
        return None
    target = Path(tempfile.gettempdir()) / "chewbacca-sendpolicy-test-target"
    env = dict(os.environ, CARGO_TARGET_DIR=str(target))
    base = ["cargo", "build", "--quiet", "--release", "--locked", "--manifest-path", str(CRATE / "Cargo.toml")]
    r = subprocess.run(base + ["--offline"], env=env, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        r = subprocess.run(base, env=env, capture_output=True, text=True, timeout=900)
    if r.returncode != 0 and any(w in r.stderr for w in ("failed to download", "Could not resolve", "network",
                                                          "failed to get")):
        return None
    if r.returncode != 0:
        raise SystemExit("chewbacca-sendpolicy did not build:\n" + r.stderr[-2000:])
    return str(target / "release/chewbacca-sendpolicy")


BIN = build()
if BIN is None:
    print("SKIP test_send_policy: no cargo, or its crates could not be fetched; every sink keeps its inline checks")
    raise SystemExit(0)
os.environ["CHEWBACCA_SENDPOLICY"] = BIN
os.environ.pop("CHEWBACCA_NO_SEND", None)

import send_approval as sa  # noqa: E402
import send_policy as sp  # noqa: E402

UTC = datetime.timezone.utc
SAGAR = [{"name": "Sagar Tiwari", "tz": "America/Los_Angeles", "after": "23:00",
          "after_by_day": {"Fri": "19:00", "Sat": "19:00"}, "source": "test"}]


def ids(answer):
    return sorted(r["id"] for r in answer.get("rules") or [])


class Policy(unittest.TestCase):
    def test_validates(self):
        r = subprocess.run([BIN, "--policy", str(sp.POLICY), "--schema", str(sp.SCHEMA), "--validate"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertGreaterEqual(json.loads(r.stdout)["policies"], 15)

    def test_every_forbid_is_named(self):
        rules = sp.rules()
        self.assertGreaterEqual(len(rules), 14)
        for r in rules:
            self.assertTrue(r["id"] and r["reason"], r)
        self.assertEqual(len({r["id"] for r in rules}), len(rules))

    def test_misspelled_field_is_a_no(self):
        bad = sp.ask_raw("text", {"channel": "imessage", "no_send": "nope"})
        self.assertEqual(bad["decision"], "deny")
        self.assertTrue(bad["errors"])

    def test_broken_policy_is_a_no(self):
        tmp = Path(tempfile.mkdtemp()) / "p.cedar"
        tmp.write_text(sp.POLICY.read_text().replace("context.no_send", "context.no_sned", 1))
        with mock.patch.object(sp, "POLICY", tmp):
            got = sp.ask_raw("text", {"channel": "imessage", "no_send": False})
        self.assertEqual(got["decision"], "deny")
        self.assertIn("schema", " ".join(got["errors"]))

    def test_no_binary_is_unavailable(self):
        with mock.patch.dict(os.environ, {"CHEWBACCA_SENDPOLICY": "/nonexistent/chewbacca-sendpolicy"}):
            self.assertEqual(sp.ask_raw("text", {"channel": "x", "no_send": True})["decision"], "unavailable")


class Text(unittest.TestCase):
    def ask(self, **facts):
        return sp.ask("text", dict({"channel": "imessage"}, **facts), env={})

    def test_no_send(self):
        self.assertEqual(ids(sp.ask("text", {"channel": "slack"}, env={"CHEWBACCA_NO_SEND": "1"})), ["no-send"])
        self.assertEqual(self.ask()["decision"], "allow")

    def test_quiet_matches_people_send(self):
        """Every half hour of a week, the policy and quietFor agree, on
        Sagar's rule and on the odd shapes a review found (a null day falls
        back to `after`, a non-object after_by_day is ignored, DST ends)."""
        odd = [
            [{"name": "Sagar Tiwari", "tz": "America/Los_Angeles", "after": "23:00", "after_by_day": {"Fri": None}}],
            [{"name": "Sagar Tiwari", "tz": "America/Los_Angeles", "after": "22:00", "after_by_day": ["Fri"]}],
            [{"name": "Sagar Tiwari", "tz": "Europe/London", "until": "09:30", "after_by_day": {"Sun": "20:00"}}],
        ]
        for rules, start in [(SAGAR, datetime.datetime(2026, 10, 5, tzinfo=UTC))] + \
                [(r, datetime.datetime(2026, 10, 27, tzinfo=UTC)) for r in odd]:
            with self.subTest(rules=rules):
                self.parity(rules, start)

    def parity(self, rules, start):
        times = [start + datetime.timedelta(minutes=30 * i) for i in range(7 * 48)]
        SAGAR = rules  # noqa: N806
        js = subprocess.run(
            ["node", "-e", """
              const { quietFor } = require(process.argv[1]);
              const rules = JSON.parse(process.argv[2]);
              const out = JSON.parse(process.argv[3]).map((t) => (quietFor("sagar tiwari", new Date(t), rules) ? 1 : 0));
              console.log(JSON.stringify(out));""",
             str(ROOT / "bin/lib/people/quiet-hours.js"), json.dumps(SAGAR), json.dumps([t.isoformat() for t in times])],
            capture_output=True, text=True, check=True)
        want = json.loads(js.stdout)
        with mock.patch.object(sp, "quiet_rules", lambda: SAGAR):
            got = [1 if "quiet-hours" in ids(self.ask(name="Sagar Tiwari", direct=True, at=t.isoformat())) else 0
                   for t in times]
        self.assertEqual(sum(want), sum(got))
        self.assertEqual(want, got)
        self.assertGreater(sum(got), 0)

    def test_z_suffix_on_39(self):
        with mock.patch.object(sp, "quiet_rules", lambda: SAGAR):
            self.assertIn("quiet-hours", ids(self.ask(name="Sagar Tiwari", direct=True, at="2026-10-07T06:30:00Z")))

    def test_quiet_spots(self):
        """The same seven instants tests/people_send.sh checks: -QQ-Q-Q."""
        spots = ["2026-10-07T05:30:00+00:00", "2026-10-07T06:30:00+00:00", "2026-10-07T13:00:00+00:00",
                 "2026-10-07T16:00:00+00:00", "2026-10-10T03:48:00+00:00", "2026-10-10T01:00:00+00:00",
                 "2026-10-11T08:00:00+00:00"]
        with mock.patch.object(sp, "quiet_rules", lambda: SAGAR):
            got = "".join("Q" if ids(self.ask(name="Sagar Tiwari", direct=True, at=t)) else "-" for t in spots)
            late = "2026-10-07T06:30:00+00:00"
            self.assertEqual(self.ask(name="Sagar Tiwari", direct=True, at=late, after_hours=True)["decision"], "allow")
            self.assertEqual(self.ask(name="Sagar Tiwari", direct=False, at=late)["decision"], "allow")
            self.assertEqual(self.ask(name="Someone Else", direct=True, at=late)["decision"], "allow")
        self.assertEqual(got, "-QQ-Q-Q")

    def test_unowned_and_unverified(self):
        self.assertEqual(ids(self.ask(address_owned=False)), ["unowned-address"])
        self.assertEqual(self.ask(address_owned=False, to_confirmed=True)["decision"], "allow")
        self.assertEqual(self.ask(address_owned=True)["decision"], "allow")
        self.assertEqual(ids(self.ask(unverified_sender=True)), ["unverified-sender"])


class Cold(unittest.TestCase):
    def ask(self, **ctx):
        base = {"no_send": False, "dry_run": False, "utc_weekday": 1, "weekend_ok": False, "sent_today": 0,
                "suppressed": False, "already_sent": False}
        base.update(ctx)
        return sp.ask_raw("cold_email", base)

    def test_ramp_matches_gtme(self):
        import gtme_solo as g
        for days in [None] + list(range(0, 40)):
            cap = g.RAMP[0][1] if days is None else next((n for limit, n in g.RAMP if days < limit), g.DAILY_CAP)
            for sent in (cap - 1, cap, cap + 1):
                ctx = {"sent_today": sent}
                if days is not None:
                    ctx["days_since_first"] = days
                self.assertEqual("cold-daily-cap" in ids(self.ask(**ctx)), sent >= cap, (days, sent, cap))

    def test_rest(self):
        self.assertEqual(ids(self.ask(utc_weekday=5)), ["cold-weekend"])
        self.assertEqual(self.ask(utc_weekday=6, weekend_ok=True)["decision"], "allow")
        self.assertEqual(ids(self.ask(suppressed=True)), ["cold-suppressed"])
        self.assertEqual(ids(self.ask(already_sent=True)), ["cold-already-sent"])
        self.assertEqual(ids(self.ask(no_send=True)), ["no-send-cold"])
        self.assertEqual(self.ask(no_send=True, dry_run=True)["decision"], "allow")


class Clay(unittest.TestCase):
    def ask(self, op, **f):
        return sp.ask("clay_write", dict({"op": op}, **f), env={})

    def test_gates(self):
        ok = {"allow_writes": True, "person_ok": True}
        self.assertEqual(ids(self.ask("campaign-create", person_ok=True)), ["clay-allow-writes"])
        self.assertEqual(ids(self.ask("campaign-create", allow_writes=True)), ["clay-person-ok"])
        self.assertEqual(self.ask("campaign-create", **ok)["decision"], "allow")
        # A reply needs no person, only a finished body.
        self.assertEqual(ids(self.ask("reply", allow_writes=True)), ["clay-reply-finished"])
        self.assertEqual(self.ask("reply", allow_writes=True, reply_finished=True)["decision"], "allow")
        self.assertEqual(ids(self.ask("campaign-update", **ok, campaign_status="active")), ["clay-draft-only"])
        self.assertEqual(self.ask("campaign-update", **ok, campaign_status="draft")["decision"], "allow")
        self.assertEqual(ids(self.ask("campaign-status", start=True, **ok, campaign_status="draft")), ["clay-graded"])
        self.assertEqual(ids(self.ask("campaign-status", start=True, **ok, campaign_status="paused", grade_pass=True)),
                         ["clay-draft-only"])
        self.assertEqual(self.ask("campaign-status", start=True, **ok, campaign_status="draft",
                                  grade_pass=True)["decision"], "allow")
        self.assertEqual(ids(self.ask("add-leads", **ok)), ["clay-graded"])
        self.assertEqual(ids(sp.ask("clay_write", dict({"op": "reply", "reply_finished": True, "allow_writes": True}),
                                    env={"CHEWBACCA_NO_SEND": "1"})), ["no-send"])


class Take(unittest.TestCase):
    """take() asks the policy before it spends a press."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"CHEWBACCA_SEND_APPROVALS": os.path.join(self.tmp, "a"),
                                                "CHEWBACCA_SEND_CODE_SHOW": "off"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def press_mode(self):
        # The press is opt-in since e2632c20; these two tests are about tokens.
        os.makedirs(os.path.join(self.tmp, "a"), exist_ok=True)
        Path(self.tmp, "a", "mode").write_text("press\n")

    def test_no_send_refuses_a_minted_token_and_keeps_it(self):
        self.press_mode()
        sa.mint("imessage", "+15550100", "hi", "kit_confirm")
        with self.assertRaises(sa.NoApproval) as e:
            sa.take("imessage", "+15550100", "hi", env={"CHEWBACCA_NO_SEND": "1"}, chain=None)
        self.assertIn("no-send", str(e.exception))
        self.assertEqual(len(sa.status()["tokens"]), 1)
        self.assertEqual(sa.take("imessage", "+15550100", "hi", env={}, chain=None), "kit_confirm")

    def test_unloadable_policy_never_stops_a_send(self):
        # Agents send by default (Caleb, 2026-10-12 9:54am): a policy module
        # that won't import is no answer, logged, and take() goes on.
        with mock.patch.dict(sys.modules, {"send_policy": None}):
            self.assertEqual(sa.take("imessage", "+15550100", "hi", env={}, chain=None), "agent")
        self.assertIn("policy-error", Path(self.tmp, "a", "log.jsonl").read_text())

    def test_a_broken_reader_never_stops_a_send_but_a_named_rule_does(self):
        broken = Path(self.tmp, "broken")
        broken.write_text("#!/bin/sh\ncat >/dev/null\nexit 101\n")
        broken.chmod(0o755)
        with mock.patch.dict(os.environ, {"CHEWBACCA_SENDPOLICY": str(broken)}):
            self.assertEqual(sa.take("imessage", "+15550100", "hi", env={}, chain=None), "agent")
            self.assertFalse(sp.refuses(sp.ask("text", {"channel": "imessage"})))
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+15550100", "hi", env={"CHEWBACCA_NO_SEND": "1"}, chain=None)

    def test_no_binary_takes_as_before(self):
        self.press_mode()
        sa.mint("imessage", "+15550100", "hi", "kit_confirm")
        with mock.patch.dict(os.environ, {"CHEWBACCA_SENDPOLICY": "/nonexistent/chewbacca-sendpolicy"}):
            self.assertEqual(sa.take("imessage", "+15550100", "hi", env={"CHEWBACCA_NO_SEND": "1"}, chain=None),
                             "kit_confirm")


class Could(unittest.TestCase):
    """`chewbacca send-policy could` is the one question, from a shell."""

    def run_could(self, *args, env=None):
        e = dict(os.environ, CHEWBACCA_SENDPOLICY=BIN)
        e.pop("CHEWBACCA_NO_SEND", None)
        e.update(env or {})
        return subprocess.run([sys.executable, str(ROOT / "tools/send_policy.py"), "could", *args],
                              capture_output=True, text=True, env=e)

    def test_quiet_from_the_people_store(self):
        people = tempfile.mkdtemp()
        Path(people, "quiet-hours.json").write_text(json.dumps(SAGAR))
        r = self.run_could("text", "--channel", "imessage", "--name", "sagar tiwari",
                           "--at", "2026-10-07T06:30:00+00:00", env={"PEOPLE_DIR": people})
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("quiet-hours", r.stdout)
        r = self.run_could("text", "--channel", "imessage", "--name", "sagar tiwari",
                           "--at", "2026-10-07T16:00:00+00:00", env={"PEOPLE_DIR": people})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("yes", r.stdout)

    def test_no_send_and_clay(self):
        r = self.run_could("text", "--channel", "slack", env={"CHEWBACCA_NO_SEND": "1"})
        self.assertEqual(r.returncode, 3)
        self.assertIn("no-send", r.stdout)
        r = self.run_could("clay", "--op", "reply", "--allow-writes", "--json")
        self.assertEqual(json.loads(r.stdout)["rules"][0]["id"], "clay-reply-finished")

    def test_unavailable_says_so(self):
        r = self.run_could("text", "--channel", "slack", env={"CHEWBACCA_SENDPOLICY": "/nonexistent/x"})
        self.assertEqual(r.returncode, 4)
        self.assertIn("can't say", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
