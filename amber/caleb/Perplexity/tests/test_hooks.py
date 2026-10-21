import os
import sys
import tempfile
import unittest
from pathlib import Path

from perplexity_code.hooks import (
    Hooks,
    PRE_TOOL,
    POST_TOOL,
    ON_ERROR,
    VALID_HOOK_EVENTS,
    load_project_hook_config,
)


class HooksRegistryTests(unittest.TestCase):
    def test_on_and_trigger(self):
        hooks = Hooks()
        calls = []
        hooks.on("pre_tool", lambda **kw: calls.append(kw["hook_name"]))
        hooks.trigger("pre_tool", action_type="read_file")
        self.assertEqual(calls, ["pre_tool"])

    def test_off_removes_handler(self):
        hooks = Hooks()
        calls = []
        handler = lambda **kw: calls.append(1)
        hooks.on("pre_tool", handler)
        hooks.off("pre_tool", handler)
        hooks.trigger("pre_tool")
        self.assertEqual(calls, [])

    def test_off_nonexistent_handler(self):
        hooks = Hooks()
        hooks.off("pre_tool", lambda **kw: None)  # should not raise

    def test_trigger_unknown_event(self):
        hooks = Hooks()
        hooks.trigger("nonexistent_event")  # should not raise

    def test_handlers_for(self):
        hooks = Hooks()
        handler = lambda **kw: None
        hooks.on("post_tool", handler)
        self.assertEqual(len(hooks.handlers_for("post_tool")), 1)
        self.assertEqual(len(hooks.handlers_for("pre_tool")), 0)

    def test_clear_specific(self):
        hooks = Hooks()
        hooks.on("pre_tool", lambda **kw: None)
        hooks.on("post_tool", lambda **kw: None)
        hooks.clear("pre_tool")
        self.assertEqual(len(hooks.handlers_for("pre_tool")), 0)
        self.assertEqual(len(hooks.handlers_for("post_tool")), 1)

    def test_clear_all(self):
        hooks = Hooks()
        hooks.on("pre_tool", lambda **kw: None)
        hooks.on("post_tool", lambda **kw: None)
        hooks.clear()
        self.assertEqual(len(hooks.handlers_for("pre_tool")), 0)
        self.assertEqual(len(hooks.handlers_for("post_tool")), 0)

    def test_handler_exception_does_not_propagate(self):
        hooks = Hooks()
        hooks.on("pre_tool", lambda **kw: 1 / 0)
        hooks.trigger("pre_tool")  # should not raise

    def test_multiple_handlers_all_fire(self):
        hooks = Hooks()
        calls = []
        hooks.on("pre_tool", lambda **kw: calls.append("a"))
        hooks.on("pre_tool", lambda **kw: calls.append("b"))
        hooks.trigger("pre_tool")
        self.assertEqual(calls, ["a", "b"])


class LoadProjectHookConfigTests(unittest.TestCase):
    def test_loads_valid_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "PERPLEXITY_HOOKS.json"
            config_path.write_text(
                '{"hooks": [{"event": "pre_tool", "type": "command", "command": "echo test"}]}'
            )
            hooks = Hooks()
            loaded = load_project_hook_config(path=config_path, hooks=hooks)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(len(hooks.handlers_for("pre_tool")), 1)

    def test_skips_disabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "PERPLEXITY_HOOKS.json"
            config_path.write_text(
                '{"hooks": [{"event": "pre_tool", "type": "command", "command": "echo test", "enabled": false}]}'
            )
            hooks = Hooks()
            loaded = load_project_hook_config(path=config_path, hooks=hooks)
            self.assertEqual(len(loaded), 0)

    def test_skips_invalid_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "PERPLEXITY_HOOKS.json"
            config_path.write_text(
                '{"hooks": [{"event": "invalid_event", "type": "command", "command": "echo test"}]}'
            )
            hooks = Hooks()
            loaded = load_project_hook_config(path=config_path, hooks=hooks)
            self.assertEqual(len(loaded), 0)

    def test_missing_config_returns_empty(self):
        hooks = Hooks()
        loaded = load_project_hook_config(path=Path("/nonexistent/path.json"), hooks=hooks)
        self.assertEqual(loaded, [])

    def test_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "PERPLEXITY_HOOKS.json"
            config_path.write_text("not valid json{{{")
            hooks = Hooks()
            loaded = load_project_hook_config(path=config_path, hooks=hooks)
            self.assertEqual(loaded, [])


class ValidHookEventsTests(unittest.TestCase):
    def test_constants_match(self):
        self.assertIn(PRE_TOOL, VALID_HOOK_EVENTS)
        self.assertIn(POST_TOOL, VALID_HOOK_EVENTS)
        self.assertIn(ON_ERROR, VALID_HOOK_EVENTS)


if __name__ == "__main__":
    unittest.main()
