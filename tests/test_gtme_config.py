"""The client entry in clients.json is the contract: `gtme config check` reads
it, workspaces resolve from the named client and never from a built-in id, and
a client with a rulings_path keeps every ruling in that one file.

Every fixture is invented: workspaces in the 9000s, .example domains, no real
client. Nothing reads the network or a real clients.json.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GTME = ROOT / "bin" / "gtme"
sys.path.insert(0, str(ROOT / "tools"))

import gtme_config as gc  # noqa: E402


def write(path: Path, doc) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1))
    return path


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.decisions = write(self.tmp / "repo" / "DECISIONS.json", {
            "client": "Northwind Test Co", "aliases": ["northwind"],
            "rulings": [{"id": "volume", "rule": "Max volume.", "who": "Morgan", "status": "active"}]})
        (self.tmp / "data").mkdir()
        self.clay = {
            "name": "Northwind Test Co", "aliases": ["Northwind"], "workspaces": ["9001"],
            "principal": "Riley Stone", "offers": [{"name": "Widgets"}],
            "campaign_name": "Northwind | {company} | {date} tier {tier}", "data_dir": str(self.tmp / "data"),
            "rulings_path": str(self.decisions), "refused_senders": ["^admin@"],
            "voice": {"first_name": "Riley", "sign_off": "Riley"},
            "channels": {"togari_client": "northwind"}, "report": {"recipient": "Morgan", "day": "Friday"},
            "client_slack": {"user": "U_T", "me": ["U_M"], "conversations": ["C_T"]}}
        self.solo = {"name": "Harbor Church Test", "sender_company": "Harbor Test",
                     "state_dir": str(self.tmp / "data")}
        self.cfg = write(self.tmp / "gtm" / "clients.json", {"clients": [self.clay, self.solo]})
        self.env = dict(os.environ, HOME=str(self.tmp), GTM_CONFIG=str(self.cfg), GTME_HOME=str(self.tmp / "gtm"))
        self.env.pop("CLAY_WORKSPACE_ID", None)
        self.env.pop("GTME_CLIENTS", None)
        self.env.pop("CHEWBACCA_GTM_CLIENTS", None)
        os.environ["GTM_CONFIG"] = str(self.cfg)

    def tearDown(self):
        os.environ.pop("GTM_CONFIG", None)
        self._tmp.cleanup()

    def gtme(self, *args, env=None):
        return subprocess.run([sys.executable, str(GTME), *args], capture_output=True, text=True,
                              env=env or self.env, timeout=60)

    # -- check

    def test_complete_clay_and_solo_entries_pass(self):
        r = self.gtme("config", "check", "--all", "--json")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out = {c["name"]: c for c in json.loads(r.stdout)["clients"]}
        self.assertEqual(out["Northwind Test Co"]["errors"], [])
        self.assertEqual(out["Northwind Test Co"]["missing"], [])
        self.assertEqual(out["Northwind Test Co"]["path"], "clay")
        self.assertEqual(out["Harbor Church Test"]["path"], "solo")
        self.assertEqual(out["Harbor Church Test"]["errors"], [])

    def test_a_client_being_set_up_lists_missing_fields_without_failing(self):
        write(self.cfg, {"clients": [{"name": "Northwind Test Co", "workspaces": ["9001"]}]})
        r = self.gtme("config", "check", "--client", "northwind test co")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("contract 2 of 12 fields", r.stdout)
        self.assertIn("missing  principal", r.stdout)

    def test_broken_fields_are_errors(self):
        bad = dict(self.clay, workspaces=["9001", "ws-two"], refused_senders=["(unclosed"],
                   rulings_path=str(self.tmp / "nope.json"), campaign_name="Northwind weekly",
                   presend={"per_firm_total": 0}, report={"day": "Someday"}, colour="blue")
        write(self.cfg, {"clients": [bad]})
        r = self.gtme("config", "check", "--client", "Northwind Test Co", "--json")
        self.assertEqual(r.returncode, 1)
        res = json.loads(r.stdout)["clients"][0]
        joined = " | ".join(res["errors"])
        for needle in ("not Clay workspace ids", "does not compile", "nope.json does not exist",
                       "needs {company}", "presend.per_firm_total", "report.day"):
            self.assertIn(needle, joined)
        self.assertIn("colour: not a contract field", " ".join(res["warnings"]))

    def test_rulings_file_for_another_client_is_an_error(self):
        write(self.decisions, {"client": "Someone Else", "rulings": []})
        r = self.gtme("config", "check", "--client", "Northwind Test Co", "--json")
        self.assertEqual(r.returncode, 1)
        self.assertIn("names client 'Someone Else'", json.loads(r.stdout)["clients"][0]["errors"][0])

    def test_two_clients_sharing_a_workspace_or_alias_is_an_error(self):
        twin = dict(self.solo, name="Twin Test", aliases=["northwind"], workspaces=["9001"])
        write(self.cfg, {"clients": [self.clay, twin]})
        r = self.gtme("config", "check", "--client", "Twin Test", "--json")
        errs = " | ".join(json.loads(r.stdout)["clients"][0]["errors"])
        self.assertIn("workspaces ['9001'] are also Northwind Test Co's", errs)
        self.assertIn("is also Northwind Test Co's", errs)

    def test_two_names_with_one_file_name_is_an_error(self):
        twin = dict(self.solo, name="northwind-test co")
        write(self.cfg, {"clients": [self.clay, twin]})
        r = self.gtme("config", "check", "--client", "northwind-test co", "--json")
        self.assertEqual(r.returncode, 1)
        self.assertIn("share the file name northwind-test-co", " ".join(json.loads(r.stdout)["clients"][0]["errors"]))

    def test_unknown_client_is_a_usage_error(self):
        self.assertEqual(self.gtme("config", "check", "--client", "Nobody").returncode, 2)

    # -- workspace resolution

    def test_workspace_comes_from_the_named_client(self):
        self.assertEqual(gc.workspace("Northwind Test Co", env={}), ("9001", ""))
        self.assertEqual(gc.workspace("northwind", env={"CLAY_WORKSPACE_ID": "9999"}), ("9001", ""))

    def test_no_client_and_no_env_refuses_with_no_built_in_id(self):
        ws, why = gc.workspace(None, env={})
        self.assertIsNone(ws)
        self.assertIn("no Clay workspace chosen", why)
        self.assertEqual(gc.workspace(None, env={"CLAY_WORKSPACE_ID": "9002"}), ("9002", ""))

    def test_a_client_with_none_or_two_workspaces_refuses(self):
        write(self.cfg, {"clients": [dict(self.clay, workspaces=["9001", "9003"]), self.solo]})
        ws, why = gc.workspace("Northwind Test Co", env={})
        self.assertIsNone(ws)
        self.assertIn("names 2 Clay workspaces", why)
        ws, why = gc.workspace("Harbor Church Test", env={})
        self.assertIsNone(ws)
        self.assertIn("names no Clay workspace", why)

    def test_client_for_workspace(self):
        self.assertEqual(gc.client_for_workspace("9001")[0]["name"], "Northwind Test Co")
        entry, why = gc.client_for_workspace("9555")
        self.assertIsNone(entry)
        self.assertIn("belongs to no client", why)

    # -- no client defaults in the engine (2026-10-13: grade, ready and
    # add-leads each fell back to one client's workspace)

    def test_grade_needing_a_workspace_refuses_without_one(self):
        env = dict(self.env, GTME_CLIENTS=str(self.cfg))
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_grade.py"), "--verify", "--campaign", "cam_t1",
                            "--action", "launch"], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 2)
        self.assertIn("no Clay workspace chosen", r.stderr)

    def test_grade_takes_the_named_clients_workspace(self):
        import argparse
        import gtme_grade
        os.environ["GTME_CLIENTS"] = str(self.cfg)
        try:
            a = argparse.Namespace(client="Northwind Test Co", ws=None)
            self.assertEqual(gtme_grade.resolve_ws(a), "")
            self.assertEqual(a.ws, "9001")
            b = argparse.Namespace(client="Harbor Church Test", ws=None)
            self.assertIn("names no Clay workspace", gtme_grade.resolve_ws(b))
            self.assertIsNone(b.ws)
        finally:
            os.environ.pop("GTME_CLIENTS", None)

    def test_ready_for_a_client_with_no_workspace_refuses(self):
        drafts = write(self.tmp / "drafts.json", [])
        inbox = write(self.tmp / "inbox.json", [])
        slack = write(self.tmp / "slack.json", {})
        (self.tmp / "fx").mkdir()
        env = dict(self.env, GTME_CLIENTS=str(self.cfg), CHEWBACCA_GTM_CLIENTS=str(self.cfg),
                   GTME_READY_CAMPAIGN_DIR=str(self.tmp / "fx"), CLAY_WORKSPACE_ID="9002",
                   GTME_GRADE_KEY_FILE=str(self.tmp / "key"))
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_ready.py"), "--client", "Harbor Church Test",
                            "--drafts", str(drafts), "--inbox", str(inbox), "--slack", str(slack)],
                           capture_output=True, text=True, env=env, timeout=120)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("names no Clay workspace", r.stderr)

    # -- one home for rulings

    def test_rule_goes_to_the_rulings_path_and_not_clients_json(self):
        r = self.gtme("rule", "--client", "Northwind Test Co", "Never email a firm twice in a week",
                      "--who", "Morgan", "--source", "call 3/19")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(str(self.decisions), r.stdout)
        dec = json.loads(self.decisions.read_text())
        self.assertEqual([x["rule"] for x in dec["rulings"]], ["Max volume.", "Never email a firm twice in a week"])
        cfg = json.loads(self.cfg.read_text())
        self.assertNotIn("rulings", next(c for c in cfg["clients"] if c["name"] == "Northwind Test Co"))
        again = self.gtme("rule", "--client", "Northwind Test Co", "never email a firm twice in a week",
                          "--who", "Morgan")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(len(json.loads(self.decisions.read_text())["rulings"]), 2)

    def test_rule_without_a_rulings_path_still_lands_in_clients_json(self):
        r = self.gtme("rule", "--client", "Harbor Church Test", "Five a day in week one", "--who", "Gavin")
        self.assertEqual(r.returncode, 0, r.stderr)
        cfg = json.loads(self.cfg.read_text())
        self.assertEqual(next(c for c in cfg["clients"] if c["name"] == "Harbor Church Test")["rulings"][0]["rule"],
                         "Five a day in week one")

    # -- carrying a client to another Mac (2026-10-13: a client operator's
    # install, rehearsed from a clean HOME, had the entry pasted by hand and its
    # ready block still named files in the sender's home)

    def test_export_writes_home_paths_as_tilde_and_import_reads_them_on_another_home(self):
        ready_dir = self.tmp / "data" / "week"
        ready_dir.mkdir()
        (ready_dir / "verdicts.csv").write_text("email,verification\n")
        clay = dict(self.clay, ready={"verification": str(ready_dir / "verdicts.csv"), "warmup_start": "2026-10-02"})
        write(self.cfg, {"clients": [clay, self.solo]})
        out = self.tmp / "northwind.client.json"
        r = self.gtme("config", "export", "--client", "Northwind", "--out", str(out))
        self.assertEqual(r.returncode, 0, r.stderr)
        sent = json.loads(out.read_text())["entry"]
        self.assertEqual(sent["data_dir"], "~/data")
        self.assertEqual(sent["ready"]["verification"], "~/data/week/verdicts.csv")
        self.assertNotIn(str(self.tmp), out.read_text())
        # The operator's Mac: another home, where `gtme setup` already named the workspace.
        other = self.tmp / "operator"
        for rel in ("data/week", "repo"):
            (other / rel).mkdir(parents=True)
        (other / "data/week/verdicts.csv").write_text("email,verification\n")
        (other / "repo/DECISIONS.json").write_text(self.decisions.read_text())
        self.assertTrue(sent["rulings_path"].startswith("~/"), sent["rulings_path"])
        theirs = write(other / ".chewbacca/gtm/clients.json",
                       {"clients": [{"name": "Northwind Test Co", "workspaces": ["9001"]}]})
        env = dict(self.env, HOME=str(other), GTM_CONFIG=str(theirs), GTME_HOME=str(other / ".chewbacca/gtm"))
        r = self.gtme("config", "import", str(out), env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("backed up", r.stdout)
        got = json.loads(theirs.read_text())["clients"]
        self.assertEqual(len(got), 1, "the stub gtme setup wrote was kept beside the import")
        self.assertEqual(got[0]["principal"], "Riley Stone")
        r = self.gtme("config", "check", "--client", "Northwind", env=env)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_import_never_overwrites_a_real_entry_without_replace(self):
        out = write(self.tmp / "in.json", {"chewbacca_client": 1, "entry": {"name": "Northwind Test Co",
                                                                            "workspaces": ["9001"]}})
        r = self.gtme("config", "import", str(out))
        self.assertEqual(r.returncode, 2)
        self.assertIn("--replace", r.stderr)
        self.assertEqual(json.loads(self.cfg.read_text())["clients"][0]["principal"], "Riley Stone")

    def test_a_path_in_another_persons_home_is_an_error(self):
        clay = dict(self.clay, ready={"suppress": "/Users/someone-else/code/data/suppress.csv"})
        write(self.cfg, {"clients": [clay, self.solo]})
        r = self.gtme("config", "check", "--client", "Northwind")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("another person's home", r.stdout)
        self.assertIn("ready.suppress", r.stdout)

    def test_a_missing_ready_file_is_an_error_and_a_relative_one_is_not(self):
        clay = dict(self.clay, ready={"senders": "~/nowhere/senders.json", "verification": "verdicts.csv"})
        write(self.cfg, {"clients": [clay, self.solo]})
        r = self.gtme("config", "check", "--client", "Northwind")
        self.assertIn("ready.senders: ~/nowhere/senders.json does not exist", r.stdout)
        self.assertNotIn("ready.verification", r.stdout)

    def test_grade_fills_left_out_inputs_from_the_clients_ready_block(self):
        import argparse
        import gtme_grade
        ver = self.tmp / "verdicts.csv"
        ver.write_text("email,verification\n")
        clay = dict(self.clay, ready={"verification": str(ver), "suppress": str(self.tmp / "missing.csv"),
                                      "warmup_start": "2026-10-02", "icp_titles": "partner,principal",
                                      "field_map": {"audf_x": "firm"}})
        write(self.cfg, {"clients": [clay, self.solo]})
        os.environ["GTME_CLIENTS"] = str(self.cfg)
        try:
            a = argparse.Namespace(client="Northwind Test Co", verify=False, verification=None, senders=None,
                                   review=None, suppress=None, warmup_start=None, icp_titles="ceo",
                                   icp_fit_column=None, offer=None, signal=None, field_map=None, leads=None)
            filled = gtme_grade.fill_from_ready(a)
        finally:
            os.environ.pop("GTME_CLIENTS", None)
        self.assertEqual(a.verification, str(ver))
        self.assertIsNone(a.suppress, "a ready file that isn't on this Mac was filled in")
        self.assertEqual(a.warmup_start, "2026-10-02")
        self.assertEqual(a.icp_titles, "ceo", "the command line lost to the ready block")
        self.assertEqual(a.field_map, ["audf_x=firm"])
        self.assertEqual(filled, ["verification", "warmup_start", "field_map"])

    # -- review of the first cut, 2026-10-13: each of these let a grade or an
    # import do something the explicit command line never would

    def _ns(self, **kw):
        import argparse
        base = dict(client="Northwind Test Co", verify=False, verification=None, senders=None, review=None,
                    suppress=None, warmup_start=None, icp_titles=None, icp_fit_column=None, offer=None,
                    signal=None, field_map=None, leads=None)
        base.update(kw)
        return argparse.Namespace(**base)

    def _fill(self, ready, ns):
        import gtme_grade
        clay = dict(self.clay, ready=ready)
        write(self.cfg, {"clients": [clay, self.solo]})
        os.environ["GTME_CLIENTS"] = str(self.cfg)
        try:
            return gtme_grade.fill_from_ready(ns)
        finally:
            os.environ.pop("GTME_CLIENTS", None)

    def test_a_relative_ready_file_is_never_read_from_the_shells_folder(self):
        here = self.tmp / "other-client"
        here.mkdir()
        (here / "suppress.csv").write_text("email\n")
        old = os.getcwd()
        os.chdir(here)
        try:
            ns = self._ns()
            self._fill({"suppress": "suppress.csv"}, ns)
        finally:
            os.chdir(old)
        self.assertIsNone(ns.suppress, "another client's suppress list in the current folder was graded")

    def test_a_client_wide_offer_never_replaces_the_campaigns_own(self):
        ns = self._ns()
        filled = self._fill({"offer": "one pitch for every offer", "signal": "one signal"}, ns)
        self.assertIsNone(ns.offer)
        self.assertIsNone(ns.signal)
        self.assertEqual(filled, [])

    def test_a_field_map_column_the_leads_file_lacks_is_left_out(self):
        leads = self.tmp / "leads.csv"
        leads.write_text("email,first_name,firm\n")
        ns = self._ns(leads=str(leads))
        self._fill({"field_map": {"audf_x": "firm", "audf_y": "fund_size"}}, ns)
        self.assertEqual(ns.field_map, ["audf_x=firm"])

    def test_grade_reads_the_same_clients_file_import_writes(self):
        import gtme_grade
        other = write(self.tmp / "elsewhere" / "clients.json",
                      {"clients": [dict(self.clay, principal="From GTM_CONFIG")]})
        os.environ["GTM_CONFIG"] = str(other)
        try:
            self.assertEqual(gtme_grade.load_client("Northwind Test Co")["principal"], "From GTM_CONFIG")
        finally:
            os.environ["GTM_CONFIG"] = str(self.cfg)

    def test_two_imports_in_one_second_keep_both_backups(self):
        a = write(self.tmp / "a.json", {"entry": {"name": "Alpha Test", "workspaces": ["9101"]}})
        b = write(self.tmp / "b.json", {"entry": {"name": "Beta Test", "workspaces": ["9102"]}})
        first = self.cfg.read_text()
        self.gtme("config", "import", str(a))
        self.gtme("config", "import", str(b))
        backups = sorted(self.cfg.parent.glob("clients.json.bak-*"))
        self.assertEqual(len(backups), 2, [p.name for p in backups])
        self.assertIn(first, [p.read_text() for p in backups], "the original file was lost")

    def test_import_by_another_clients_alias_is_refused(self):
        out = write(self.tmp / "alias.json", {"entry": {"name": "Northwind", "workspaces": ["9201"]}})
        r = self.gtme("config", "import", str(out), "--replace")
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("alias", r.stderr)
        self.assertEqual(json.loads(self.cfg.read_text())["clients"][0]["principal"], "Riley Stone")


if __name__ == "__main__":
    unittest.main()
