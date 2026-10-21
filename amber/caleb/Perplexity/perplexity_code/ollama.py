"""Ollama local inference for Perplexity Code.

Free tier for tasks that don't need web search or premium reasoning.
Runs entirely on-device via Ollama (localhost:11434).

Routing priority:
  1. Quick tasks (rename, list, explain, format) -> Ollama (free, fast)
  2. Simple generation (small edits, single files) -> Ollama (free)
  3. Complex generation, debugging -> Sonar API (paid, better reasoning)
  4. Discovery (web search needed) -> Sonar API (paid, search-native)
  5. Architecture, multi-file refactor -> Sonar Reasoning Pro (paid, strongest)
  6. Third-party model preference -> Agent API (paid, multi-provider)

Falls back to Sonar API automatically if Ollama is unavailable.
"""

from __future__ import annotations

import json
import os
from typing import Any

import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_FAST_MODEL = os.getenv("OLLAMA_FAST_MODEL", "llama3.2:latest")

# Track Ollama availability to avoid repeated timeouts
_ollama_available: bool | None = None


def check_ollama() -> bool:
    """Check if Ollama is running and responsive."""
    global _ollama_available
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        _ollama_available = resp.status_code == 200
        return _ollama_available
    except Exception:
        _ollama_available = False
        return False


def is_available() -> bool:
    """Cached check for Ollama availability."""
    if _ollama_available is None:
        return check_ollama()
    return _ollama_available


def list_models() -> list[dict[str, Any]]:
    """List installed Ollama models."""
    if not is_available():
        return []
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "name": m["name"],
                "size_gb": round(m.get("size", 0) / 1e9, 1),
                "family": m.get("details", {}).get("family", ""),
                "params": m.get("details", {}).get("parameter_size", ""),
            }
            for m in data.get("models", [])
        ]
    except Exception:
        return []


def chat(
    messages: list[dict[str, str]],
    model: str | None = None,
    json_mode: bool = True,
    temperature: float = 0.1,
    timeout: int = 60,
) -> dict[str, Any]:
    """Send a chat request to Ollama.

    Returns: {"content": str, "model": str, "duration_ms": int, "tokens": int, "cost": 0.0}
    """
    active_model = model or OLLAMA_MODEL

    payload: dict[str, Any] = {
        "model": active_model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
        },
    }

    if json_mode:
        payload["format"] = "json"

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=payload,
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()

        content = data.get("message", {}).get("content", "")
        eval_duration = data.get("eval_duration", 0)  # nanoseconds
        prompt_tokens = data.get("prompt_eval_count", 0)
        eval_tokens = data.get("eval_count", 0)

        return {
            "content": content,
            "model": active_model,
            "duration_ms": round(eval_duration / 1e6),
            "tokens": prompt_tokens + eval_tokens,
            "cost": 0.0,  # Always free
            "source": "ollama",
        }

    except requests.ConnectionError:
        global _ollama_available
        _ollama_available = False
        raise RuntimeError("Ollama not running. Start with: ollama serve")
    except requests.Timeout:
        raise RuntimeError(f"Ollama timed out after {timeout}s")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


def chat_for_agent(
    messages: list[dict[str, str]],
    model: str | None = None,
) -> str:
    """Ollama chat that returns just the content string.

    Drop-in replacement for call_perplexity's return value.
    Compatible with the agent loop in cli.py.
    """
    result = chat(messages, model=model, json_mode=True)
    return result["content"]
