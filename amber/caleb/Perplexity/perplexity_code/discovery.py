"""Discovery engine for Perplexity Code.

Integrates three Perplexity API surfaces with their REAL formats:

Sonar API (POST /chat/completions):
  Request: {"model": "sonar|sonar-pro|sonar-reasoning-pro", "messages": [...]}
  Response: {"choices": [{"message": {"content": "..."}}], "citations": [...], "search_results": [...], "usage": {"cost": {"total_cost": ...}}}

Agent API (POST /v1/agent):
  Request: {"model": "openai/gpt-5.2", "input": "...", "tools": [...], "instructions": "..."}
  Response: {"output": [{"content": [{"text": "..."}]}], "usage": {"cost": {"total_cost": ...}}}

Search API (POST /search):
  Request: {"query": ["..."]}
  Response: {"results": [{"title": "...", "url": "...", "snippet": "..."}]}
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

import requests

SONAR_URL = "https://api.perplexity.ai/chat/completions"
AGENT_URL = "https://api.perplexity.ai/v1/agent"
SEARCH_URL = "https://api.perplexity.ai/search"


def _get_api_key() -> str:
    key = os.getenv("PERPLEXITY_API_KEY", "")
    if not key:
        raise RuntimeError("PERPLEXITY_API_KEY is not set.")
    return key


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_get_api_key()}",
        "Content-Type": "application/json",
    }


def sonar_search(
    query: str,
    model: str = "sonar",
    system: str = "",
    max_tokens: int = 2000,
    stream: bool = False,
) -> dict[str, Any]:
    """Web-grounded AI response via Sonar API.

    Uses POST /chat/completions with sonar models.
    Returns: {"answer": str, "citations": list[str], "search_results": list[dict], "cost": float}
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": query})

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }

    if stream:
        payload["stream"] = True
        resp = requests.post(SONAR_URL, headers=_headers(), json=payload, timeout=120, stream=True)
        resp.raise_for_status()
        return _handle_sonar_stream(resp)

    resp = requests.post(SONAR_URL, headers=_headers(), json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    citations = data.get("citations", [])
    search_results = data.get("search_results", [])
    cost = data.get("usage", {}).get("cost", {}).get("total_cost", 0)

    return {
        "answer": answer,
        "citations": citations,
        "search_results": search_results,
        "cost": cost,
    }


def _handle_sonar_stream(resp: requests.Response) -> dict[str, Any]:
    """Handle SSE streaming from Sonar API. Prints tokens as they arrive."""
    full_content = ""
    citations = []
    search_results = []
    cost = 0.0

    for line in resp.iter_lines():
        if not line:
            continue
        decoded = line.decode("utf-8", errors="replace")
        if not decoded.startswith("data: "):
            continue
        data_str = decoded[6:]
        if data_str.strip() == "[DONE]":
            break

        try:
            chunk = json.loads(data_str)
            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
            if delta:
                sys.stdout.write(delta)
                sys.stdout.flush()
                full_content += delta

            # Citations come on every chunk but we only need the final set
            if chunk.get("citations"):
                citations = chunk["citations"]
            if chunk.get("search_results"):
                search_results = chunk["search_results"]

            # Cost comes on the last chunk
            chunk_cost = chunk.get("usage", {}).get("cost", {}).get("total_cost", 0)
            if chunk_cost:
                cost = chunk_cost

        except json.JSONDecodeError:
            pass

    sys.stdout.write("\n")
    sys.stdout.flush()

    return {
        "answer": full_content,
        "citations": citations,
        "search_results": search_results,
        "cost": cost,
    }


def agent_query(
    prompt: str,
    model: str = "openai/gpt-5.2",
    tools: list[dict] | None = None,
    instructions: str = "",
    max_tokens: int = 4000,
) -> dict[str, Any]:
    """Multi-provider model access via Agent API.

    Uses POST /v1/agent with third-party models (openai/*, anthropic/*, etc).
    Request uses 'input' not 'messages'. Response uses 'output' not 'choices'.
    """
    payload: dict[str, Any] = {
        "model": model,
        "input": prompt,
        "max_output_tokens": max_tokens,
    }

    if tools:
        payload["tools"] = tools
    if instructions:
        payload["instructions"] = instructions

    resp = requests.post(AGENT_URL, headers=_headers(), json=payload, timeout=180)
    resp.raise_for_status()
    data = resp.json()

    # Parse Agent API response format
    output = data.get("output", [])
    text = ""
    for item in output:
        if item.get("type") == "message":
            for content_block in item.get("content", []):
                if content_block.get("type") == "output_text":
                    text += content_block.get("text", "")

    cost = data.get("usage", {}).get("cost", {}).get("total_cost", 0)

    return {
        "content": text,
        "model": data.get("model", model),
        "cost": cost,
        "raw_output": output,
    }


def search_raw(query: str) -> list[dict[str, str]]:
    """Raw ranked search results via Search API.

    Uses POST /search. Returns list of {"title", "url", "snippet"}.
    """
    payload = {"query": [query]}

    resp = requests.post(SEARCH_URL, headers=_headers(), json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("results", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("snippet", ""),
        })
    return results


def discover_repos(query: str) -> list[dict[str, str]]:
    """Find relevant GitHub repos for a given intent."""
    system = (
        "You are a code discovery assistant. Find the most relevant GitHub repositories. "
        "For each, provide: repo name, URL, why it is relevant. "
        "Return as JSON array: [{\"name\": \"...\", \"url\": \"...\", \"reason\": \"...\"}]"
    )

    result = sonar_search(query, model="sonar-pro", system=system)
    answer = result["answer"]

    try:
        start = answer.find("[")
        end = answer.rfind("]") + 1
        if start != -1 and end > start:
            return json.loads(answer[start:end])
    except (json.JSONDecodeError, ValueError):
        pass

    return [{"name": "raw_response", "reason": answer, "url": ""}]


def discover_docs(query: str) -> dict[str, Any]:
    """Find documentation and API references."""
    system = (
        "Find the most relevant official documentation. "
        "Provide a concise answer with specific links to doc pages. "
        "Focus on official docs, not blog posts."
    )
    return sonar_search(query, model="sonar-pro", system=system)


def compare_options(query: str) -> dict[str, Any]:
    """Compare libraries, frameworks, or approaches."""
    system = (
        "Compare the options. For each: name, pros, cons, best use case, recommendation. "
        "Be specific and opinionated."
    )
    return sonar_search(query, model="sonar-reasoning-pro", system=system)


def fetch_url_content(url: str) -> str:
    """Fetch and extract text content from a URL."""
    if not url.startswith(("http://", "https://")):
        return f"Blocked: only http:// and https:// URLs are allowed (got {url.split('://')[0]}://)"
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Perplexity-Code/0.5.0"},
            timeout=30,
        )
        resp.raise_for_status()
        text = resp.text

        if "<html" in text.lower():
            text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
            text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()

        if len(text) > 16000:
            text = text[:16000] + "\n... (content truncated)"

        return text
    except Exception as e:
        return f"Error fetching {url}: {e}"
