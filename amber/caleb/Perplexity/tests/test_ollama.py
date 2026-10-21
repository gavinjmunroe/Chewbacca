"""Tests for Ollama integration and three-tier routing."""

import unittest
from unittest.mock import patch, MagicMock

from perplexity_code.ollama import chat, is_available, list_models, chat_for_agent
from perplexity_code.router import route_task, classify_task


class MockOllamaResponse:
    def __init__(self, json_data, status_code=200):
        self._json = json_data
        self.status_code = status_code

    def json(self):
        return self._json

    def raise_for_status(self):
        pass


class OllamaChatTests(unittest.TestCase):
    @patch("perplexity_code.ollama.requests.post")
    @patch("perplexity_code.ollama._ollama_available", True)
    def test_chat_returns_correct_format(self, mock_post):
        mock_post.return_value = MockOllamaResponse({
            "message": {"content": '{"type":"answer","message":"hello"}'},
            "eval_duration": 200000000,  # 200ms in nanoseconds
            "prompt_eval_count": 50,
            "eval_count": 20,
        })
        result = chat([{"role": "user", "content": "say hi"}])
        self.assertEqual(result["content"], '{"type":"answer","message":"hello"}')
        self.assertEqual(result["cost"], 0.0)
        self.assertEqual(result["source"], "ollama")
        self.assertGreater(result["duration_ms"], 0)

    @patch("perplexity_code.ollama.requests.post")
    @patch("perplexity_code.ollama._ollama_available", True)
    def test_chat_for_agent_returns_string(self, mock_post):
        mock_post.return_value = MockOllamaResponse({
            "message": {"content": '{"type":"answer","message":"ok"}'},
            "eval_duration": 100000000,
            "prompt_eval_count": 10,
            "eval_count": 5,
        })
        result = chat_for_agent([{"role": "user", "content": "test"}])
        self.assertIsInstance(result, str)
        self.assertIn("answer", result)


class OllamaAvailabilityTests(unittest.TestCase):
    @patch("perplexity_code.ollama.requests.get")
    def test_available_when_running(self, mock_get):
        mock_get.return_value = MockOllamaResponse({"models": []})
        import perplexity_code.ollama as ollama_mod
        ollama_mod._ollama_available = None  # Reset cache
        self.assertTrue(is_available())

    @patch("perplexity_code.ollama.requests.get", side_effect=Exception("refused"))
    def test_unavailable_when_down(self, mock_get):
        import perplexity_code.ollama as ollama_mod
        ollama_mod._ollama_available = None
        self.assertFalse(is_available())


class ThreeTierRoutingTests(unittest.TestCase):
    @patch("perplexity_code.ollama.is_available", return_value=True)
    def test_quick_routes_to_ollama(self, mock_avail):
        route = route_task("rename this variable")
        self.assertEqual(route["api"], "ollama")
        self.assertTrue(route["local"])
        self.assertEqual(route["cost_tier"], "free")

    @patch("perplexity_code.ollama.is_available", return_value=True)
    def test_generation_routes_to_ollama(self, mock_avail):
        route = route_task("create a function that adds two numbers")
        self.assertEqual(route["api"], "ollama")
        self.assertTrue(route["local"])
        self.assertEqual(route["cost_tier"], "free")

    @patch("perplexity_code.ollama.is_available", return_value=True)
    def test_discovery_always_paid(self, mock_avail):
        route = route_task("find the best auth library for Next.js")
        self.assertEqual(route["api"], "sonar")
        self.assertFalse(route["local"])
        self.assertTrue(route["search_enabled"])

    @patch("perplexity_code.ollama.is_available", return_value=True)
    def test_review_always_paid(self, mock_avail):
        route = route_task("review this code for security issues")
        self.assertEqual(route["api"], "sonar")
        self.assertFalse(route["local"])

    @patch("perplexity_code.ollama.is_available", return_value=True)
    def test_architecture_always_paid(self, mock_avail):
        route = route_task("how should I structure the database schema")
        self.assertEqual(route["api"], "sonar")
        self.assertFalse(route["local"])

    @patch("perplexity_code.ollama.is_available", return_value=False)
    def test_falls_back_when_ollama_down(self, mock_avail):
        route = route_task("rename this variable")
        # Should fall back to paid Sonar
        self.assertEqual(route["api"], "sonar")
        self.assertFalse(route["local"])
        self.assertNotEqual(route["cost_tier"], "free")

    @patch("perplexity_code.ollama.is_available", return_value=False)
    def test_discovery_unaffected_by_ollama_status(self, mock_avail):
        route = route_task("search for React frameworks")
        self.assertEqual(route["api"], "sonar")
        self.assertTrue(route["search_enabled"])


if __name__ == "__main__":
    unittest.main()
