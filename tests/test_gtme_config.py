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
            "channels": {"togari_client": "northwind"}, "report": {"recipient": "Morgan", "day": "Friday"}}
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
        self.assertIn("contract 2 of 11 fields", r.stdout)
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


if __name__ == "__main__":
    unittest.main()
