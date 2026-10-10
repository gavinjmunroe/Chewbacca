"""The Clay sync agent for Chewbacca Live: what it reads, what it pushes, and
that it keeps running when the page or Clay misbehaves. No Clay call is made:
the CLI is replaced by a fake for every test."""
import http.client
import importlib.machinery
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("live_stats_sync", str(HERE.parent / "agent" / "live-stats-sync"))
spec = importlib.util.spec_from_loader("live_stats_sync", loader)
agent = importlib.util.module_from_spec(spec)
loader.exec_module(agent)

ZEUTARA = {"clientId": "zeutara", "clayWorkspaceId": "1372623", "campaignPrefix": "Zeutara |"}
ANALYTICS = {
    "funnel": {"totalLeads": 21, "conversion": {"steps": [{"step": 1, "sentCount": 21}]}},
    "stats": {"totals": {"sent": 41, "replies": 3, "repliesExcludingOoo": 2, "bounces": 1}},
}


class FakeLive:
    def __init__(self, fail_with=None):
        self.posts = []
        self.fail_with = fail_with

    def call(self, method, path, body=None, timeout=60):
        if self.fail_with:
            raise self.fail_with
        self.posts.append((method, path, body))
        return {"rows": len((body or {}).get("rows", [])), "as_of": (body or {}).get("as_of")}


def fake_cli(workspace="1372623", campaigns=None):
    campaigns = campaigns if campaigns is not None else [
        {"id": "cam_1", "name": "Zeutara | Ivy | Pre-seed investors | Wave 2", "status": "active"},
        {"id": "cam_2", "name": "Zeutara | Qube Finance | Seed investors | Draft", "status": "draft"},
        {"id": "cam_3", "name": "PARKED, not a client (Zeutara list) | RagMetrics", "status": "active"},
    ]
    calls = []

    def cli(*args):
        calls.append(args)
        if args[0] == "whoami":
            return {"workspace": {"id": workspace}}
        if args[:2] == ("campaigns", "list"):
            return {"data": campaigns}
        if args[:2] == ("campaigns", "analytics"):
            return ANALYTICS
        raise AssertionError(f"unexpected CLI call {args}")

    cli.calls = calls
    return cli


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.real_cli = agent.cli

    def tearDown(self):
        agent.cli = self.real_cli

    def test_rows_use_totals_and_leads_only_all_time(self):
        c = {"id": "cam_1", "name": "Zeutara | Ivy | x", "status": "active"}
        self.assertEqual(agent.row(c, ANALYTICS, "all"), {
            "campaign_id": "cam_1", "campaign": "Zeutara | Ivy | x", "status": "active",
            "leads": 21, "sent": 41, "replies": 3, "human_replies": 2, "bounces": 1,
        })
        self.assertIsNone(agent.row(c, ANALYTICS, "7d")["leads"])

    def test_only_this_clients_live_campaigns_are_read(self):
        agent.cli = fake_cli()
        bodies = agent.read_client(ZEUTARA)
        self.assertEqual({b["window"] for b in bodies}, {"all", "7d"})
        for b in bodies:
            self.assertEqual([r["campaign_id"] for r in b["rows"]], ["cam_1"])
            self.assertEqual(b["workspace"], "1372623")
        reads = [c for c in agent.cli.calls if c[:2] == ("campaigns", "analytics")]
        self.assertEqual(len(reads), 2)
        self.assertTrue(any("--start-date" in c for c in reads))
        # Read only: nothing but whoami, list and analytics ever runs.
        self.assertTrue(all(c[0] == "whoami" or c[:2] in {("campaigns", "list"), ("campaigns", "analytics")} for c in agent.cli.calls))

    def test_a_different_workspace_is_reported_not_pushed(self):
        agent.cli = fake_cli(workspace="999")
        live = FakeLive()
        self.assertFalse(agent.sync(live, ZEUTARA, dry=False))
        self.assertEqual([p[1] for p in live.posts], ["/sync/fail"])
        self.assertIn("different workspace", live.posts[0][2]["message"])

    def test_a_dropped_connection_never_kills_the_agent(self):
        agent.cli = fake_cli()
        live = FakeLive(fail_with=http.client.RemoteDisconnected("Remote end closed connection"))
        self.assertFalse(agent.sync(live, ZEUTARA, dry=False))
        agent.cli = fake_cli(workspace="999")
        self.assertFalse(agent.sync(live, ZEUTARA, dry=False))

    def test_a_transient_server_error_is_retried_but_auth_is_not(self):
        import subprocess as sp
        from unittest import mock

        def proc(code, out="{}", err=""):
            return sp.CompletedProcess([], code, out, err)

        waits = []
        with mock.patch.object(agent.subprocess, "run", side_effect=[proc(1, err="server_error"), proc(0, '{"ok": 1}')]):
            self.assertEqual(self.real_cli("whoami", sleep=waits.append), {"ok": 1})
        self.assertEqual(waits, [2])
        with mock.patch.object(agent.subprocess, "run", side_effect=[proc(3, err="auth_forbidden")]) as run:
            with self.assertRaises(RuntimeError):
                self.real_cli("whoami", sleep=waits.append)
            self.assertEqual(run.call_count, 1)
        with mock.patch.object(agent.subprocess, "run", side_effect=[proc(1), proc(1), proc(1)]) as run:
            with self.assertRaises(RuntimeError):
                self.real_cli("whoami", sleep=lambda s: None)
            self.assertEqual(run.call_count, 3)

    def test_pushes_both_windows(self):
        agent.cli = fake_cli()
        live = FakeLive()
        self.assertTrue(agent.sync(live, ZEUTARA, dry=False))
        self.assertEqual([(p[1], p[2]["window"]) for p in live.posts], [("/sync/stats", "all"), ("/sync/stats", "7d")])


if __name__ == "__main__":
    unittest.main()
