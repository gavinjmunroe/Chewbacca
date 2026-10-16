"""gtme next-move: moves come from the failure evidence, boundaries drop what may
never run, Jev ranks what's left, and every attempt lands in the lesson ledger.

Jev is stubbed here so the suite is hermetic. The live-Jev replay numbers are
measured with `chewbacca gtme next-move replay tests/fixtures/next_move/replays`.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gtme_lessons  # noqa: E402
import next_move as N  # noqa: E402

FIX = ROOT / "tests" / "fixtures" / "next_move"
REPLAYS = FIX / "replays"
SITE = json.loads((FIX / "barebells_home_excerpt.json").read_text())


def case(name):
    return json.loads((REPLAYS / f"{name}.json").read_text())


def flat_jev(p=0.5):
    """A Jev stand-in with no opinion: every move gets the same probability."""
    def evaluate(req):
        return {"answers": {q: {"type": "noul", "noul": p} for q in req["questions"]}}
    return evaluate


def picky_jev(likes, high=0.9, low=0.3):
    """A Jev stand-in that likes moves whose action text holds any of `likes`."""
    def evaluate(req):
        return {"answers": {q: {"type": "noul", "noul": high if any(w in spec["instructions"] for w in likes) else low}
                            for q, spec in req["questions"].items()}}
    return evaluate


class Generate(unittest.TestCase):
    def test_parent_comes_from_the_brands_own_footer(self):
        b = case("sabo-barebells-empty-search")["blocker"]
        b["evidence"].update(SITE)
        orgs = N.related_orgs(b, N.load_data())
        self.assertIn("vitaminwell.com", orgs)
        self.assertIn("part of Vitamin Well Group", orgs["vitaminwell.com"]["why"])
        self.assertEqual(orgs["vitaminwell.com"]["trust"], "owned_and_linked")
        self.assertNotIn("barebells.de", orgs, "the brand's own country sites aren't another company")
        self.assertNotIn("wikipedia.org", orgs, "a platform link says nothing about ownership")

    def test_no_evidence_no_parent(self):
        b = case("sabo-barebells-empty-search")["blocker"]
        kinds = {c["kind"] for c in N.generate(b, N.load_data())}
        self.assertNotIn("org_hop", kinds, "without the site read there is nothing to hop to")
        self.assertIn("read_source", kinds)

    def test_no_lookup_table(self):
        src = (ROOT / "tools" / "next_move.py").read_text()
        self.assertNotIn("parents.json", src.replace("parents.json, filled", ""))
        self.assertNotIn("vitaminwell", src.lower())

    def test_owner_phrase_and_email_domains(self):
        b = {"step": "people_search", "account": {"brand": "Nocco", "domain": "nocco.com"},
             "evidence": {"site_text": "NOCCO is a brand of Vitamin Well AB.",
                          "people": [{"name": "A", "email": "a@other.co.uk"}]}}
        orgs = N.related_orgs(b, N.load_data())
        self.assertIn("vitaminwell.com", orgs, "a name with no link is guessed and says so")
        self.assertIn("guessed", orgs["vitaminwell.com"]["why"])
        self.assertEqual(orgs["vitaminwell.com"]["trust"], "owned_guessed")
        self.assertEqual(orgs["other.co.uk"]["trust"], "email_domain")

    def test_tried_moves_are_not_proposed_again(self):
        b = case("sabo-celsius-no-email")["blocker"]
        b["tried"] = ["next_person:Ava Paszkiewicz"]
        sigs = {c["signature"] for c in N.generate(b, N.load_data())}
        self.assertNotIn("next_person:Ava Paszkiewicz", sigs)
        self.assertNotIn("next_person:Brenna Tanner", sigs, "people already tried are skipped")


class Barebells(unittest.TestCase):
    def test_loop_finds_the_parent_with_no_table(self):
        """parents.json gone: the loop reads the site, derives the parent and searches it."""
        b = case("sabo-barebells-empty-search")["blocker"]
        searched = []

        def read(move, blocker):
            return {"cleared": False, "credits": 0.0, "evidence": SITE if move["target"] == "site_read" else {}}

        def search(move, blocker):
            searched.append(move["target"])
            return {"cleared": move["target"] == "vitaminwell.com", "credits": 0.5}

        with tempfile.TemporaryDirectory() as d:
            res = N.run(b, {"read_source": read, "org_hop": search}, evaluate=picky_jev(["vitaminwell"]),
                        max_steps=5, ledger=d)
        self.assertTrue(res["cleared"], res)
        self.assertEqual(res["trace"][0]["move"], "read_source:site_read", "the free read goes first")
        self.assertEqual(searched[-1], "vitaminwell.com")
        self.assertNotIn("barebells.com", searched)

    def test_flat_jev_still_reaches_the_parent(self):
        """With Jev giving no signal, cost order alone still gets there: the parent was generated."""
        b = case("sabo-barebells-empty-search")["blocker"]
        res = N.run(b, N.AllMoves(N.world_executor(case("sabo-barebells-empty-search")["world"], N.load_data())),
                    evaluate=flat_jev(), max_steps=8, learn=False)
        self.assertIn("org_hop:vitaminwell.com", [t["move"] for t in res["trace"]])


class Boundaries(unittest.TestCase):
    def blocker(self, **over):
        b = case("zeutara-launch-postal-address")["blocker"]
        b.update(over)
        return b

    def test_launch_is_never_executed_even_when_jev_loves_it(self):
        ran = []
        b = self.blocker()
        executors = {"launch": lambda m, _: ran.append(m) or {"cleared": True},
                     "fix_copy": lambda m, _: {"cleared": False}}
        res = N.run(b, executors, evaluate=flat_jev(0.99), max_steps=6, learn=False,
                    run_classes=N.EXECUTABLE | {"launch"})
        self.assertEqual(ran, [], "a launch without gtme ready never reaches its executor")
        dropped = {c["signature"]: c["broke"] for c in N.plan(b, evaluate=flat_jev(0.99))["dropped"]}
        self.assertEqual(dropped["launch:without-address"][0]["rule"], "no-send-without-ready")
        self.assertEqual(dropped["fix_copy:virtual-mailbox"][0]["rule"], "no-purchase")
        self.assertFalse(res["cleared"])

    def test_a_pick_fn_cannot_route_around_a_boundary(self):
        ran = []
        b = self.blocker()
        launch = next(e for e in b["extra"] if e["kind"] == "launch")

        def sneaky(plan, runnable):
            return dict(launch, id="x", signature="launch:without-address")

        with self.assertRaises(PermissionError):
            N.run(b, {"launch": lambda m, _: ran.append(m)}, evaluate=flat_jev(), pick_fn=sneaky, learn=False)
        self.assertEqual(ran, [])

    def test_receipt_lifts_the_send_rule_but_not_the_others(self):
        b = self.blocker(receipts={"gtme_ready": True})
        dropped = {c["signature"] for c in N.plan(b, evaluate=flat_jev())["dropped"]}
        self.assertNotIn("launch:without-address", dropped)
        self.assertIn("fix_copy:virtual-mailbox", dropped)

    def test_client_ruling_drops_the_postal_address(self):
        with tempfile.TemporaryDirectory() as d:
            rulings = {"rulings": [{"id": "no-postal-address", "rule": "send without a postal address",
                                    "who": "Ryan Korn", "date": "2026-10-14", "status": "active"}]}
            (Path(d) / "DECISIONS.json").write_text(json.dumps(rulings))
            p = N.plan(self.blocker(client_dir=d), evaluate=flat_jev())
            broke = {c["signature"]: [x["rule"] for x in c["broke"]] for c in p["dropped"]}
            self.assertIn("client:no-postal-address", broke["fix_copy:add-office-address"])
            self.assertNotIn("fix_copy:add-office-address", {c["signature"] for c in p["ranked"]})
            rulings["rulings"][0]["status"] = "retired"
            (Path(d) / "DECISIONS.json").write_text(json.dumps(rulings))
            p = N.plan(self.blocker(client_dir=d), evaluate=flat_jev())
            self.assertIn("fix_copy:add-office-address", {c["signature"] for c in p["ranked"]})

    def test_credit_allowance(self):
        b = case("sabo-barebells-empty-search")["blocker"]
        b["evidence"].update(SITE)
        b["credits_left"] = 0.3
        p = N.plan(b, evaluate=flat_jev())
        over = {c["signature"] for c in p["dropped"] if any(x["rule"] == "credit-allowance" for x in c["broke"])}
        self.assertIn("org_hop:vitaminwell.com", over)
        self.assertIn("read_source:site_read", {c["signature"] for c in p["ranked"]}, "free reads still run")

    def test_unclassified_agent_move_is_dropped(self):
        b = self.blocker(extra=[{"kind": "mystery", "action": "do something"}])
        p = N.plan(b, evaluate=flat_jev())
        self.assertEqual(p["dropped"][0]["broke"][0]["rule"], "unclassified")


class Rank(unittest.TestCase):
    def test_jev_failure_says_so_and_still_ranks(self):
        def broken(req):
            raise OSError("down")
        p = N.plan(case("sabo-celsius-no-email")["blocker"], evaluate=broken)
        self.assertTrue(p["jev"].startswith("unavailable"))
        self.assertTrue(p["ranked"])

    def test_downstream_cost_counts(self):
        """A search rerun still owes the email lookup; a next person finishes the job."""
        p = N.plan(case("sabo-celsius-no-email")["blocker"], evaluate=flat_jev(), )
        cost = {c["signature"]: c["cost"] for c in p["ranked"]}
        self.assertGreater(cost["persona_swap:"], cost["next_person:Ava Paszkiewicz"])

    def test_ask_is_the_pick_when_nothing_else_is_worth_it(self):
        b = {"client": "Acme", "goal": "g", "step": "launch_gate", "account": {"brand": "Acme", "domain": "acme.com"},
             "failure": "blocked", "evidence": {}}
        p = N.plan(b, evaluate=flat_jev(0.6))
        self.assertEqual(p["decision"], "ask")


class Learn(unittest.TestCase):
    def test_outcomes_land_in_the_ledger_and_change_the_next_ranking(self):
        with tempfile.TemporaryDirectory() as d:
            f = N.record_outcome("Acme", "persona_swap", "people_search", False, 0.5, when="2026-10-16", ledger=d)
            lesson = json.loads(Path(f).read_text())
            self.assertEqual(gtme_lessons.lesson_errors(lesson), [], "a move lesson passes the ledger's own checks")
            self.assertEqual(lesson["move_stats"], {"attempts": 1, "clears": 0, "credits": 0.5})
            N.record_outcome("Acme", "persona_swap", "people_search", False, 0.5, when="2026-10-17", ledger=d)
            lesson = json.loads(Path(f).read_text())
            self.assertEqual(lesson["move_stats"]["attempts"], 2)
            self.assertEqual(len(lesson["history"]), 1, "the old state moves to history, never erased")
            self.assertEqual(N.priors({"persona_swap"}, d), {"persona_swap": (0, 2)})
            b = case("sabo-gymshark-no-buyer")["blocker"]
            cold = {c["signature"]: c["p"] for c in N.plan(b, evaluate=flat_jev())["ranked"]}
            warm = {c["signature"]: c["p"] for c in N.plan(b, evaluate=flat_jev(), ledger=d)["ranked"]}
            self.assertLess(warm["persona_swap:"], cold["persona_swap:"], "two misses lower the next estimate")

    def test_reads_are_not_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            b = case("sabo-barebells-empty-search")["blocker"]
            N.run(b, {"read_source:site_read": lambda m, _: {"cleared": False, "evidence": SITE}},
                  evaluate=flat_jev(), max_steps=2, ledger=d)
            self.assertEqual(list(Path(d).glob("*.json")), [])


class Replay(unittest.TestCase):
    def test_every_case_replays_and_never_runs_a_dropped_move(self):
        data = N.load_data()
        for f in sorted(REPLAYS.glob("*.json")):
            c = json.loads(f.read_text())
            r = N.replay_case(c, data, evaluate=flat_jev())
            dropped = {d["signature"] for d in N.plan(c["blocker"], data, evaluate=flat_jev())["dropped"]}
            self.assertFalse(dropped & set(r["loop"]["moves"]), f.name)
            self.assertIn("old_path", r, f.name)
            for sig, hit in c["world"].items():
                self.assertTrue(hit.get("source"), f"{f.name} {sig}: every recorded outcome cites where it came from")

    def test_cli_plan_and_replay(self):
        out = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "next_move.py"), "plan",
                              str(REPLAYS / "sabo-gymshark-no-buyer.json"), "--no-jev", "--json"],
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("persona_swap", out.stdout)
        out = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "next_move.py"), "replay", str(REPLAYS),
                              "--no-jev", "--json"], capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(len(json.loads(out.stdout)["cases"]), len(list(REPLAYS.glob("*.json"))))


if __name__ == "__main__":
    unittest.main()
