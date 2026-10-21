import unittest

from perplexity_code.cost_tracker import CostTracker


class CostTrackerTests(unittest.TestCase):
    def test_record_usage(self):
        tracker = CostTracker()
        cost = tracker.record({"prompt_tokens": 100, "completion_tokens": 50}, "sonar-reasoning-pro")
        self.assertGreater(cost, 0)
        self.assertEqual(tracker.total_input_tokens, 100)
        self.assertEqual(tracker.total_output_tokens, 50)
        self.assertEqual(tracker.total_requests, 1)

    def test_multiple_records(self):
        tracker = CostTracker()
        tracker.record({"prompt_tokens": 100, "completion_tokens": 50}, "sonar")
        tracker.record({"prompt_tokens": 200, "completion_tokens": 100}, "sonar")
        self.assertEqual(tracker.total_input_tokens, 300)
        self.assertEqual(tracker.total_output_tokens, 150)
        self.assertEqual(tracker.total_tokens, 450)
        self.assertEqual(tracker.total_requests, 2)

    def test_summary(self):
        tracker = CostTracker()
        tracker.record({"prompt_tokens": 1000, "completion_tokens": 500}, "sonar-pro")
        summary = tracker.summary()
        self.assertIn("Requests: 1", summary)
        self.assertIn("1,000", summary)
        self.assertIn("$", summary)

    def test_empty_tracker(self):
        tracker = CostTracker()
        self.assertEqual(tracker.total_cost, 0)
        self.assertEqual(tracker.total_tokens, 0)

    def test_unknown_model_uses_default(self):
        tracker = CostTracker()
        cost = tracker.record({"prompt_tokens": 1000, "completion_tokens": 1000}, "unknown-model")
        self.assertGreater(cost, 0)

    def test_alternate_usage_keys(self):
        tracker = CostTracker()
        tracker.record({"input_tokens": 100, "output_tokens": 50}, "sonar")
        self.assertEqual(tracker.total_input_tokens, 100)
        self.assertEqual(tracker.total_output_tokens, 50)


if __name__ == "__main__":
    unittest.main()
