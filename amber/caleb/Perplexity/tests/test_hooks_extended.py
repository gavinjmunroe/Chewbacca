"""Tests for hooks_extended.py."""

import tempfile
import unittest
from pathlib import Path

from perplexity_code.hooks import Hooks
from perplexity_code.hooks_extended import (
    register_extended_hooks,
    CommandTimer,
    POST_EDIT,
    POST_COMMAND,
    SESSION_END,
    QUALITY_GATE,
)


class CommandTimerTests(unittest.TestCase):
    def test_timer_records_duration(self):
        import time
        timer = CommandTimer()
        timer.__enter__()
        time.sleep(0.01)
        timer.__exit__(None, None, None)
        self.assertGreater(timer.duration, 0)

    def test_timer_as_context_manager(self):
        with CommandTimer() as t:
            pass
        self.assertGreaterEqual(t.duration, 0)


class RegisterHooksTests(unittest.TestCase):
    def test_registers_all_extended_hooks(self):
        hooks = Hooks()
        register_extended_hooks(hooks)
        self.assertGreater(len(hooks.handlers_for(POST_EDIT)), 0)
        self.assertGreater(len(hooks.handlers_for(POST_COMMAND)), 0)
        self.assertGreater(len(hooks.handlers_for(SESSION_END)), 0)
        self.assertGreater(len(hooks.handlers_for(QUALITY_GATE)), 0)


class SessionSummaryHookTests(unittest.TestCase):
    def test_session_summary_runs_without_error(self):
        """Session summary hook should not crash even with empty data."""
        hooks = Hooks()
        register_extended_hooks(hooks)
        # Trigger with no data, should not crash
        hooks.trigger(SESSION_END, tasks=[], recent_files=[])
        # Trigger with data
        hooks.trigger(SESSION_END, tasks=[{"status": "completed"}], recent_files=["a.py"])


class QualityGateHookTests(unittest.TestCase):
    def test_quality_gate_runs_in_temp_dir(self):
        """Quality gate should handle a directory with no Node.js project."""
        import os
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                hooks = Hooks()
                register_extended_hooks(hooks)
                hooks.trigger(QUALITY_GATE, project_root=Path(tmp))
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
