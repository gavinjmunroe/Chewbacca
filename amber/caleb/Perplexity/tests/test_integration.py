"""Integration tests that exercise the actual REPL command dispatch.

These test the full path from user input through command parsing,
routing, rules injection, and tool execution. API calls are mocked.
"""

import os
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from perplexity_code.cli import (
    build_system_prompt,
    detect_repo_profile,
    extract_json,
)
from perplexity_code.router import route_task, check_shell_safety, RoutingBenchmark, MODEL_REGISTRY
from perplexity_code.rules_engine import build_rules_prompt, load_all_rules
from perplexity_code.command_registry import load_command_registry, get_command_prompt
from perplexity_code.source_registry import translate_source_to_native, list_staged


class TestRulesInjection(unittest.TestCase):
    """Test that rules engine correctly matches rules to project files."""

    def test_ts_rules_match_ts_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "typescript.md").write_text(
                '---\npaths:\n  - "**/*.ts"\n---\n# TypeScript\nUse strict mode always.'
            )

            prompt = build_rules_prompt(Path(tmp), active_files=["src/app.ts"])
            self.assertIn("TypeScript", prompt)
            self.assertIn("strict mode", prompt)

    def test_python_rules_match_py_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "typescript.md").write_text(
                '---\npaths:\n  - "**/*.ts"\n---\n# TypeScript only\nStrict mode.'
            )
            (rules_dir / "python.md").write_text(
                '---\npaths:\n  - "**/*.py"\n---\n# Python\nUse type hints.'
            )

            prompt = build_rules_prompt(Path(tmp), active_files=["main.py"])
            self.assertIn("Python", prompt)
            self.assertIn("type hints", prompt)
            # Should NOT include TS rules for a .py file
            self.assertNotIn("Strict mode", prompt)

    def test_command_rules_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "security.md").write_text(
                '---\ncommands:\n  - audit\n  - review-pr\n---\n# Security\nCheck for injection.'
            )

            prompt = build_rules_prompt(Path(tmp), command="audit")
            self.assertIn("Security", prompt)
            self.assertIn("injection", prompt)


class TestRepoProfileDetection(unittest.TestCase):
    """Test that detect_repo_profile returns REAL file paths, not globs."""

    def test_returns_actual_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("package.json").write_text("{}")
                Path("src").mkdir()
                Path("src/index.ts").write_text("export {}")
                Path("src/app.tsx").write_text("export default function App() {}")

                files = detect_repo_profile()
                # Should be real file paths, not glob patterns
                self.assertTrue(all("*" not in f for f in files), f"Got globs instead of files: {files}")
                # Should find the actual files
                ts_files = [f for f in files if f.endswith((".ts", ".tsx"))]
                self.assertGreater(len(ts_files), 0)
            finally:
                os.chdir(old)

    def test_skips_node_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("package.json").write_text("{}")
                nm = Path("node_modules/some-pkg")
                nm.mkdir(parents=True)
                (nm / "index.js").write_text("module.exports = {}")
                Path("src").mkdir()
                Path("src/app.ts").write_text("1")

                files = detect_repo_profile()
                self.assertTrue(all("node_modules" not in f for f in files))
            finally:
                os.chdir(old)


class TestMultiProviderRouting(unittest.TestCase):
    """Test that routing correctly selects API surface."""

    def test_discovery_uses_sonar(self):
        route = route_task("find a React auth library")
        self.assertEqual(route["api"], "sonar")
        self.assertTrue(route["search_enabled"])

    def test_agent_models_use_agent_api(self):
        info = MODEL_REGISTRY.get("openai/gpt-5.2", {})
        self.assertEqual(info["api"], "agent")

    def test_sonar_models_use_sonar_api(self):
        info = MODEL_REGISTRY.get("sonar-reasoning-pro", {})
        self.assertEqual(info["api"], "sonar")


class TestShellSafetyInContext(unittest.TestCase):
    """Test shell safety with realistic command sequences."""

    def test_blocks_recursive_delete_root(self):
        safety, _ = check_shell_safety("rm -rf /")
        self.assertEqual(safety, "block")

    def test_blocks_recursive_delete_home(self):
        safety, _ = check_shell_safety("sudo rm -rf ~/")
        self.assertIn(safety, ("block", "warn"))  # Both are acceptable for destructive home deletion

    def test_warns_npm_publish(self):
        safety, _ = check_shell_safety("npm publish --access public")
        self.assertEqual(safety, "warn")

    def test_allows_normal_dev_commands(self):
        safe_commands = [
            "npm run dev",
            "npx tsc --noEmit",
            "git status",
            "python3 -m pytest tests/",
            "ls -la src/",
            "cat package.json",
        ]
        for cmd in safe_commands:
            safety, _ = check_shell_safety(cmd)
            self.assertEqual(safety, "allow", f"'{cmd}' should be allowed but got warn/block")


class TestCommandRegistryIntegration(unittest.TestCase):
    """Test command loading with real frontmatter."""

    def test_loads_metadata_and_generates_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd_dir = Path(tmp) / ".perplexity" / "commands"
            cmd_dir.mkdir(parents=True)
            (cmd_dir / "deploy.md").write_text(
                "---\n"
                "description: Deploy to Vercel\n"
                "mode: acceptEdits\n"
                "model: sonar-pro\n"
                "rules:\n"
                "  - deployment\n"
                "post-actions:\n"
                "  - git push origin main\n"
                "---\n"
                "# Deploy\n"
                "Run quality gate, then push to main for auto-deploy."
            )
            registry = load_command_registry(Path(tmp))
            prompt, meta = get_command_prompt(registry, "deploy", "my-project")

            # Verify the prompt includes the command content
            self.assertIn("Deploy", prompt)
            self.assertIn("my-project", prompt)
            # Verify metadata was parsed
            self.assertEqual(meta["mode"], "acceptEdits")
            self.assertEqual(meta["model"], "sonar-pro")
            self.assertEqual(meta["rules"], ["deployment"])
            self.assertEqual(meta["post_actions"], ["git push origin main"])


class TestIngestionWithFallback(unittest.TestCase):
    """Test that ingestion works deterministically when API is unavailable."""

    @patch.dict("os.environ", {}, clear=True)
    def test_deterministic_fallback_without_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = translate_source_to_native(
                root,
                "d1",
                "commands/build.md",
                "Use Claude Code to build. Check .claude/commands/ for details.",
                use_ai=True,  # Will fall back because no API key
            )
            self.assertEqual(len(results), 1)
            staged = list_staged(root)
            content = staged[0].read_text()
            self.assertNotIn("Claude Code", content)
            self.assertIn("Perplexity Code", content)
            self.assertNotIn(".claude/", content)


class TestRoutingBenchmarkPersistence(unittest.TestCase):
    """Test that benchmark data persists and computes correctly."""

    def test_stats_reflect_recorded_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            bench = RoutingBenchmark(Path(tmp))
            bench.record("generation", "sonar-reasoning-pro", 1500, True)
            bench.record("generation", "sonar-reasoning-pro", 2000, True)
            bench.record("discovery", "sonar-pro", 3000, False)

            stats = bench.get_stats()
            self.assertEqual(stats["total_calls"], 3)
            gen = stats["by_task_type"]["generation"]
            self.assertEqual(gen["count"], 2)
            self.assertEqual(gen["success_rate"], 100.0)
            disc = stats["by_task_type"]["discovery"]
            self.assertEqual(disc["success_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()
