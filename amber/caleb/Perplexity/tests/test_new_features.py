"""Tests for v0.6.0 features: parallel agents, context manager, LSP, sandbox, git-first."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from perplexity_code.parallel_agents import ParallelAgentPool, AgentTask
from perplexity_code.context_manager import (
    build_repo_map, rank_files_for_task,
    _extract_js_signatures, _extract_py_signatures,
)
from perplexity_code.lsp_integration import get_all_diagnostics, format_diagnostics
from perplexity_code.sandbox import SandboxManager, detect_image_for_project
from perplexity_code.git_first import AutoCommitManager, generate_commit_message


class TestParallelAgents(unittest.TestCase):
    def test_submit_and_status(self):
        pool = ParallelAgentPool()
        pool.submit("build auth page")
        pool.submit("write tests")
        status = pool.get_status()
        self.assertIn("2 total", status)
        self.assertIn("build auth page", status)

    def test_clear(self):
        pool = ParallelAgentPool()
        pool.submit("task 1")
        pool.clear()
        self.assertEqual(len(pool.tasks), 0)

    def test_task_to_dict(self):
        task = AgentTask(0, "test task", "/tmp")
        d = task.to_dict()
        self.assertEqual(d["id"], 0)
        self.assertEqual(d["description"], "test task")
        self.assertEqual(d["status"], "pending")


class TestContextManager(unittest.TestCase):
    def test_build_repo_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "src").mkdir()
            Path(tmp, "src", "app.ts").write_text("export function main() {}\nexport class App {}")
            Path(tmp, "package.json").write_text("{}")

            repo_map = build_repo_map(Path(tmp))
            self.assertIn("app.ts", repo_map)
            self.assertIn("fn main", repo_map)
            self.assertIn("class App", repo_map)

    def test_extract_js_signatures(self):
        code = "export function handleSubmit() {}\nexport class UserService {}\nexport const API_URL = 'x';"
        sigs = _extract_js_signatures(code)
        self.assertTrue(any("handleSubmit" in s for s in sigs))
        self.assertTrue(any("UserService" in s for s in sigs))

    def test_extract_py_signatures(self):
        code = "class MyClass:\n    pass\n\ndef my_function():\n    pass\n\nasync def async_fn():\n    pass"
        sigs = _extract_py_signatures(code)
        self.assertTrue(any("MyClass" in s for s in sigs))
        self.assertTrue(any("my_function" in s for s in sigs))

    def test_rank_files_for_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "auth.ts").write_text("export function login() {}")
            Path(tmp, "utils.ts").write_text("export function format() {}")
            Path(tmp, "database.py").write_text("def connect(): pass")

            ranked = rank_files_for_task(Path(tmp), "fix the auth login", [])
            # auth.ts should rank higher than utils.ts for an "auth login" task
            self.assertTrue(len(ranked) > 0)
            self.assertEqual(ranked[0], "auth.ts")

    def test_skips_node_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            nm = Path(tmp, "node_modules", "pkg")
            nm.mkdir(parents=True)
            (nm / "index.js").write_text("module.exports = {}")
            Path(tmp, "app.ts").write_text("1")

            repo_map = build_repo_map(Path(tmp))
            self.assertNotIn("node_modules", repo_map)


class TestLSPIntegration(unittest.TestCase):
    def test_format_no_diagnostics(self):
        result = format_diagnostics([])
        self.assertIn("clean", result.lower())

    def test_format_with_errors(self):
        diags = [
            {"location": "app.ts(5,10)", "message": "Type error", "severity": "error", "source": "tsc"},
            {"location": "app.ts(10,1)", "message": "Unused var", "severity": "warning", "source": "eslint"},
        ]
        result = format_diagnostics(diags)
        self.assertIn("1 errors", result)
        self.assertIn("1 warnings", result)
        self.assertIn("Type error", result)

    def test_get_diagnostics_empty_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            diags = get_all_diagnostics(Path(tmp))
            self.assertEqual(diags, [])


class TestSandbox(unittest.TestCase):
    def test_detect_image_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "package.json").write_text("{}")
            image = detect_image_for_project(Path(tmp))
            self.assertIn("node", image)

    def test_detect_image_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "pyproject.toml").write_text("[project]")
            image = detect_image_for_project(Path(tmp))
            self.assertIn("python", image)

    def test_detect_image_rust(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "Cargo.toml").write_text("[package]")
            image = detect_image_for_project(Path(tmp))
            self.assertIn("rust", image)

    def test_sandbox_manager_default_off(self):
        mgr = SandboxManager()
        self.assertFalse(mgr.enabled)
        self.assertIn("OFF", mgr.status())

    def test_sandbox_execute_host_mode(self):
        mgr = SandboxManager()
        result = mgr.execute("echo hello", "/tmp")
        self.assertIn("hello", result)
        self.assertIn("EXIT CODE: 0", result)


class TestGitFirst(unittest.TestCase):
    def test_generate_commit_message(self):
        msg = generate_commit_message("write_file", "src/auth.ts")
        self.assertIn("perplexity", msg)
        self.assertIn("auth.ts", msg)

    def test_generate_with_description(self):
        msg = generate_commit_message("write_patch", "app.py", "fix null check in login")
        self.assertEqual(msg, "perplexity: fix null check in login")

    def test_autocommit_manager_default_off(self):
        mgr = AutoCommitManager()
        self.assertFalse(mgr.enabled)
        self.assertIn("OFF", mgr.status())

    def test_track_files(self):
        mgr = AutoCommitManager()
        mgr.track_file("src/app.ts")
        mgr.track_file("src/utils.ts")
        mgr.track_file("src/app.ts")  # duplicate
        self.assertEqual(len(mgr.pending_files), 2)

    def test_commit_when_disabled_returns_none(self):
        mgr = AutoCommitManager()
        mgr.track_file("test.py")
        result = mgr.commit_if_enabled("write_file", "test.py")
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
