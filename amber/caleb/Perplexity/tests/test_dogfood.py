"""Dogfood test suite: simulates real-world usage scenarios.

These tests verify the full pipeline works for realistic tasks
without hitting the API (mocked). Each test represents a dogfood
project scenario from the master doc Week 3 plan.

10 scenarios covering the range of real usage.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from perplexity_code.cli import (
    build_system_prompt,
    extract_json,
    detect_hallucination_in_answer,
    apply_patch_edit,
    tool_read_file,
    tool_list_dir,
    tool_write_file,
    generate_diff,
)
from perplexity_code.router import classify_task, route_task, check_shell_safety
from perplexity_code.rules_engine import build_rules_prompt, load_all_rules, match_rules_for_context
from perplexity_code.command_registry import load_command_registry, get_command_prompt
from perplexity_code.session_intelligence import TaskTracker, smart_suggestions
from perplexity_code.source_registry import add_source, list_sources, stage_update, apply_staged


class Scenario01_NextJsProjectSetup(unittest.TestCase):
    """Scenario: User asks to scaffold a Next.js project."""

    def test_routes_to_generation(self):
        route = route_task("create a new Next.js app with Tailwind and shadcn")
        self.assertEqual(route["task_type"], "generation")
        self.assertFalse(route["search_enabled"])

    def test_extract_write_file_action(self):
        raw = '{"type":"write_file","path":"app/page.tsx","content":"export default function Home() { return <div>Hello</div> }"}'
        action = extract_json(raw)
        self.assertEqual(action["type"], "write_file")
        self.assertIn("page.tsx", action["path"])


class Scenario02_DebugNullCrash(unittest.TestCase):
    """Scenario: User reports a null reference crash."""

    def test_routes_to_debugging(self):
        route = route_task("fix the null error in the auth middleware")
        self.assertEqual(route["task_type"], "debugging")

    def test_read_before_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "auth.ts").write_text("const user = null;\nuser.name;")
            old_cwd = os.getcwd()
            os.chdir(tmp)
            try:
                result = tool_read_file("auth.ts")
                self.assertIn("user = null", result)
            finally:
                os.chdir(old_cwd)


class Scenario03_FindBestAuthLibrary(unittest.TestCase):
    """Scenario: User wants to find the best auth solution."""

    def test_routes_to_discovery(self):
        route = route_task("find the best authentication library for Next.js")
        self.assertEqual(route["task_type"], "discovery")
        self.assertTrue(route["search_enabled"])


class Scenario04_ReviewPRSecurity(unittest.TestCase):
    """Scenario: User wants a security review of a PR."""

    def test_routes_to_review(self):
        route = route_task("review this PR for security vulnerabilities", command="review-pr")
        self.assertEqual(route["task_type"], "review")

    def test_rules_load_for_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "security.md").write_text('---\ncommands:\n  - review-pr\n  - audit\n---\n# Security rules\nCheck for SQL injection.')
            rules = load_all_rules(Path(tmp))
            matched = match_rules_for_context(rules, command="review-pr")
            self.assertEqual(len(matched), 1)
            self.assertIn("SQL injection", matched[0]["body"])


class Scenario05_PatchExistingFile(unittest.TestCase):
    """Scenario: Agent patches an existing TypeScript file."""

    def test_patch_edit_works(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = os.getcwd()
            os.chdir(tmp)
            try:
                Path("utils.ts").write_text("export function getCwd() { return process.cwd(); }")
                new, diff, err = apply_patch_edit("utils.ts", "getCwd", "getCurrentWorkingDirectory")
                self.assertIsNone(err)
                self.assertIn("getCurrentWorkingDirectory", new)
                self.assertIn("getCwd", diff)
            finally:
                os.chdir(old_cwd)


class Scenario06_ShellSafetyBlocking(unittest.TestCase):
    """Scenario: Agent tries to run a dangerous command."""

    def test_blocks_destructive_rm(self):
        safety, reason = check_shell_safety("rm -rf /")
        self.assertEqual(safety, "block")

    def test_warns_on_force_push(self):
        safety, reason = check_shell_safety("git push --force origin main")
        self.assertEqual(safety, "warn")

    def test_allows_safe_npm(self):
        safety, _ = check_shell_safety("npm run build")
        self.assertEqual(safety, "allow")


class Scenario07_TaskTracking(unittest.TestCase):
    """Scenario: Track multiple tasks across a session."""

    def test_full_task_lifecycle(self):
        tracker = TaskTracker()
        t1 = tracker.start_task("Build dashboard")
        tracker.record_tool_use(t1, "read_file", "app/page.tsx")
        tracker.record_tool_use(t1, "write_file", "app/dashboard/page.tsx")
        tracker.complete_task(t1)

        t2 = tracker.start_task("Fix linting errors")
        tracker.fail_task(t2, "eslint not installed")

        summary = tracker.get_summary()
        self.assertIn("[done]", summary)
        self.assertIn("[FAIL]", summary)
        self.assertIn("Build dashboard", summary)

    def test_suggestions_for_incomplete(self):
        suggestions = smart_suggestions({
            "tasks": [
                {"description": "Deploy to prod", "status": "in_progress", "files_touched": []},
                {"description": "Fix auth", "status": "failed", "files_touched": ["auth.ts"]},
            ]
        })
        self.assertTrue(any("Resume" in s for s in suggestions))
        self.assertTrue(any("Retry" in s for s in suggestions))


class Scenario08_DynamicCommandsWithMetadata(unittest.TestCase):
    """Scenario: User runs a dynamic command with metadata."""

    def test_command_metadata_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd_dir = Path(tmp) / ".perplexity" / "commands"
            cmd_dir.mkdir(parents=True)
            (cmd_dir / "deploy.md").write_text(
                '---\ndescription: Deploy to Vercel\nmode: acceptEdits\nmodel: sonar-pro\nrules:\n  - deployment\n---\n# Deploy\nRun quality gate then deploy.'
            )
            registry = load_command_registry(Path(tmp))
            self.assertIn("deploy", registry)
            self.assertEqual(registry["deploy"]["mode"], "acceptEdits")
            self.assertEqual(registry["deploy"]["model"], "sonar-pro")
            self.assertEqual(registry["deploy"]["rules"], ["deployment"])

            prompt, meta = get_command_prompt(registry, "deploy", "my-app")
            self.assertIn("Deploy", prompt)
            self.assertIn("my-app", prompt)


class Scenario09_SourceIngestion(unittest.TestCase):
    """Scenario: Ingest and apply a command from a tracked source."""

    def test_full_ingestion_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".perplexity" / "commands").mkdir(parents=True)

            # Add source
            add_source(root, "test-repo", "https://github.com/test/repo.git", "commands")
            self.assertEqual(len(list_sources(root)), 1)

            # Stage a translated command
            stage_update(root, "test-repo", "command", "new-workflow",
                         "# New Workflow\nDo something useful with Perplexity Code.",
                         description="Translated from test-repo")

            # Apply it
            from perplexity_code.source_registry import list_staged
            staged = list_staged(root)
            self.assertEqual(len(staged), 1)

            result = apply_staged(root, staged[0])
            self.assertIn("Applied", result)
            self.assertTrue((root / ".perplexity" / "commands" / "new-workflow.md").exists())


class Scenario10_HallucinationDetection(unittest.TestCase):
    """Scenario: Agent tries to cite external docs it hasn't read."""

    def test_catches_citation_brackets(self):
        bad, reason = detect_hallucination_in_answer("According to the docs [1], you should use React 19.")
        self.assertTrue(bad)

    def test_catches_doc_claims(self):
        bad, reason = detect_hallucination_in_answer("According to the documentation, this API returns JSON.")
        self.assertTrue(bad)

    def test_catches_claude_references(self):
        bad, reason = detect_hallucination_in_answer("You can configure this in ~/.claude/settings.json")
        self.assertTrue(bad)

    def test_allows_clean_answers(self):
        bad, reason = detect_hallucination_in_answer("The function returns a Promise that resolves to a User object.")
        self.assertFalse(bad)


if __name__ == "__main__":
    unittest.main()
