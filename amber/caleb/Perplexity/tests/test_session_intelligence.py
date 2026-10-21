import unittest

from perplexity_code.session_intelligence import TaskTracker, smart_suggestions


class TaskTrackerTests(unittest.TestCase):
    def test_start_and_complete_task(self):
        tracker = TaskTracker()
        tid = tracker.start_task("Build user dashboard")
        self.assertEqual(tid, 0)
        self.assertEqual(tracker.tasks[0]["status"], "in_progress")

        tracker.complete_task(tid)
        self.assertEqual(tracker.tasks[0]["status"], "completed")
        self.assertEqual(tracker.tasks[0]["outcome"], "success")

    def test_fail_task(self):
        tracker = TaskTracker()
        tid = tracker.start_task("Deploy to prod")
        tracker.fail_task(tid, "tsc errors")
        self.assertEqual(tracker.tasks[0]["status"], "failed")
        self.assertIn("tsc errors", tracker.tasks[0]["outcome"])

    def test_record_tool_use(self):
        tracker = TaskTracker()
        tid = tracker.start_task("Read files")
        tracker.record_tool_use(tid, "read_file", "src/app.ts")
        tracker.record_tool_use(tid, "read_file", "src/utils.ts")
        self.assertEqual(len(tracker.tasks[0]["files_touched"]), 2)
        self.assertEqual(len(tracker.tasks[0]["tools_used"]), 2)

    def test_summary(self):
        tracker = TaskTracker()
        tid = tracker.start_task("Build something")
        tracker.complete_task(tid)
        summary = tracker.get_summary()
        self.assertIn("[done]", summary)
        self.assertIn("Build something", summary)

    def test_serialization(self):
        tracker = TaskTracker()
        tracker.start_task("Task A")
        tracker.start_task("Task B")
        data = tracker.to_dict()
        restored = TaskTracker.from_dict(data)
        self.assertEqual(len(restored.tasks), 2)


class SmartSuggestionsTests(unittest.TestCase):
    def test_suggests_incomplete_tasks(self):
        session = {
            "tasks": [
                {"description": "Build auth", "status": "in_progress", "files_touched": []},
            ]
        }
        suggestions = smart_suggestions(session)
        self.assertTrue(any("Resume" in s for s in suggestions))

    def test_suggests_retry_for_failed(self):
        session = {
            "tasks": [
                {"description": "Deploy", "status": "failed", "files_touched": []},
            ]
        }
        suggestions = smart_suggestions(session)
        self.assertTrue(any("Retry" in s for s in suggestions))


if __name__ == "__main__":
    unittest.main()
