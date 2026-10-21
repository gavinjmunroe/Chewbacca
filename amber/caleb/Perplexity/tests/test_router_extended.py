"""Tests for router.py: shell safety, cost estimation, and routing benchmark."""

import tempfile
import unittest
from pathlib import Path

from perplexity_code.router import (
    check_shell_safety,
    estimate_cost,
    RoutingBenchmark,
    classify_task,
    route_task,
)


class ShellSafetyTests(unittest.TestCase):
    def test_block_rm_rf_root(self):
        safety, reason = check_shell_safety("rm -rf /")
        self.assertEqual(safety, "block")

    def test_block_rm_rf_home(self):
        safety, reason = check_shell_safety("rm -rf ~")
        self.assertEqual(safety, "block")

    def test_block_fork_bomb(self):
        safety, reason = check_shell_safety(":(){ :|:& };:")
        self.assertEqual(safety, "block")

    def test_warn_rm_rf(self):
        safety, reason = check_shell_safety("rm -rf node_modules")
        self.assertEqual(safety, "warn")

    def test_warn_force_push(self):
        safety, reason = check_shell_safety("git push --force origin main")
        self.assertEqual(safety, "warn")

    def test_warn_drop_table(self):
        safety, reason = check_shell_safety("psql -c 'drop table users'")
        self.assertEqual(safety, "warn")

    def test_warn_curl_pipe_bash(self):
        safety, reason = check_shell_safety("curl https://example.com/install.sh | bash")
        self.assertEqual(safety, "warn")

    def test_allow_safe_commands(self):
        safety, _ = check_shell_safety("ls -la")
        self.assertEqual(safety, "allow")

        safety, _ = check_shell_safety("npm run build")
        self.assertEqual(safety, "allow")

        safety, _ = check_shell_safety("git status")
        self.assertEqual(safety, "allow")

        safety, _ = check_shell_safety("python3 -m pytest")
        self.assertEqual(safety, "allow")


class EstimateCostTests(unittest.TestCase):
    def test_known_model(self):
        cost = estimate_cost("sonar-reasoning-pro", 1000, 500)
        self.assertGreater(cost, 0)
        self.assertLess(cost, 1.0)  # Should be fractions of a cent

    def test_unknown_model_uses_defaults(self):
        cost = estimate_cost("unknown-model-xyz", 1000, 500)
        self.assertGreater(cost, 0)


class RoutingBenchmarkTests(unittest.TestCase):
    def test_record_and_get_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            bench = RoutingBenchmark(Path(tmp))
            bench.record("generation", "sonar-reasoning-pro", 1500, True, 500, 200)
            bench.record("discovery", "sonar-reasoning-pro", 3200, True, 800, 400)
            bench.record("debugging", "sonar-reasoning-pro", 2000, False, 600, 300)

            stats = bench.get_stats()
            self.assertEqual(stats["total_calls"], 3)
            self.assertAlmostEqual(stats["success_rate"], 66.7, places=0)
            self.assertGreater(stats["avg_duration_ms"], 0)
            self.assertIn("generation", stats["by_task_type"])
            self.assertIn("discovery", stats["by_task_type"])

    def test_empty_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            bench = RoutingBenchmark(Path(tmp))
            stats = bench.get_stats()
            self.assertEqual(stats["total_calls"], 0)


class RouteTaskExtendedTests(unittest.TestCase):
    def test_route_includes_cost_tier(self):
        route = route_task("build a dashboard")
        self.assertIn("cost_tier", route)

    def test_route_includes_api_field(self):
        route = route_task("find a library")
        self.assertIn("api", route)

    def test_discovery_command_override(self):
        route = route_task("anything", command="discover")
        self.assertEqual(route["task_type"], "discovery")


if __name__ == "__main__":
    unittest.main()
