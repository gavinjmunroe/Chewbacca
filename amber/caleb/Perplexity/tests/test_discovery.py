"""Tests for discovery.py using mocked API responses matching REAL Perplexity format.

Real Sonar response format (verified against live API):
{
    "choices": [{"message": {"content": "..."}}],
    "citations": ["https://..."],
    "search_results": [{"title": "...", "url": "...", "snippet": "...", "source": "web"}],
    "usage": {"prompt_tokens": N, "completion_tokens": N, "cost": {"total_cost": 0.005}}
}
"""

import json
import unittest
from unittest.mock import MagicMock, patch

from perplexity_code.discovery import sonar_search, discover_repos, fetch_url_content, agent_query


class MockResponse:
    def __init__(self, json_data, status_code=200):
        self._json = json_data
        self.status_code = status_code

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")


def make_real_sonar_response(answer, citations=None, cost=0.005):
    """Matches the actual Perplexity API response structure."""
    return MockResponse({
        "id": "test-id",
        "model": "sonar",
        "created": 1775696461,
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 50,
            "total_tokens": 62,
            "search_context_size": "low",
            "cost": {
                "input_tokens_cost": 0.00001,
                "output_tokens_cost": 0.00005,
                "request_cost": 0.005,
                "total_cost": cost,
            },
        },
        "citations": citations or [],
        "search_results": [
            {"title": "Test Result", "url": "https://example.com", "snippet": "test", "source": "web"},
        ],
        "choices": [{"message": {"role": "assistant", "content": answer}}],
    })


def make_real_agent_response(text, model="openai/gpt-5.2"):
    """Matches the actual Agent API response structure."""
    return MockResponse({
        "id": "resp_test",
        "model": model,
        "object": "response",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {"type": "output_text", "text": text, "annotations": []}
                ],
            }
        ],
        "usage": {"cost": {"total_cost": 0.001}},
    })


class SonarSearchTests(unittest.TestCase):
    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_parses_real_response_format(self, mock_post):
        mock_post.return_value = make_real_sonar_response(
            "Next.js is a React framework.",
            citations=["https://nextjs.org"],
            cost=0.0051,
        )
        result = sonar_search("what is next.js")
        self.assertEqual(result["answer"], "Next.js is a React framework.")
        self.assertEqual(result["citations"], ["https://nextjs.org"])
        self.assertAlmostEqual(result["cost"], 0.0051, places=4)
        self.assertIsInstance(result["search_results"], list)

    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_sends_correct_payload(self, mock_post):
        mock_post.return_value = make_real_sonar_response("ok")
        sonar_search("test query", model="sonar-pro", system="You are a helper.")
        call_args = mock_post.call_args
        payload = call_args[1]["json"]
        self.assertEqual(payload["model"], "sonar-pro")
        self.assertEqual(payload["messages"][0]["role"], "system")
        self.assertEqual(payload["messages"][1]["role"], "user")
        # Verify it hits the right endpoint
        self.assertIn("chat/completions", call_args[0][0])


class AgentQueryTests(unittest.TestCase):
    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_parses_agent_response(self, mock_post):
        mock_post.return_value = make_real_agent_response("Four")
        result = agent_query("What is 2+2?", model="openai/gpt-5.2")
        self.assertEqual(result["content"], "Four")
        self.assertEqual(result["model"], "openai/gpt-5.2")

    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_sends_input_not_messages(self, mock_post):
        mock_post.return_value = make_real_agent_response("ok")
        agent_query("test", model="openai/gpt-5.2", instructions="Be concise.")
        payload = mock_post.call_args[1]["json"]
        # Agent API uses 'input' not 'messages'
        self.assertIn("input", payload)
        self.assertNotIn("messages", payload)
        self.assertEqual(payload["instructions"], "Be concise.")
        # Verify it hits the agent endpoint
        self.assertIn("/v1/agent", mock_post.call_args[0][0])


class DiscoverReposTests(unittest.TestCase):
    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_parses_json_repos(self, mock_post):
        repos_json = json.dumps([
            {"name": "t3-app", "url": "https://github.com/t3-oss/create-t3-app", "reason": "Full-stack starter"},
        ])
        mock_post.return_value = make_real_sonar_response(f"Here are repos: {repos_json}")
        repos = discover_repos("next.js starter")
        self.assertEqual(repos[0]["name"], "t3-app")

    @patch.dict("os.environ", {"PERPLEXITY_API_KEY": "test-key"})
    @patch("perplexity_code.discovery.requests.post")
    def test_fallback_on_non_json(self, mock_post):
        mock_post.return_value = make_real_sonar_response("I recommend t3-app.")
        repos = discover_repos("next.js starter")
        self.assertEqual(repos[0]["name"], "raw_response")


class FetchUrlTests(unittest.TestCase):
    @patch("perplexity_code.discovery.requests.get")
    def test_strips_html(self, mock_get):
        mock_resp = MagicMock(status_code=200, text="<html><body><p>Hello</p></body></html>")
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp
        result = fetch_url_content("https://example.com")
        self.assertIn("Hello", result)
        self.assertNotIn("<html", result)

    def test_handles_connection_error(self):
        result = fetch_url_content("https://this-will-fail-12345.invalid")
        self.assertIn("Error", result)


if __name__ == "__main__":
    unittest.main()
