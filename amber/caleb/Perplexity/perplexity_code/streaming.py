"""Streaming support for Perplexity API calls."""

from __future__ import annotations

import json
import os
import sys
import time

import requests


def stream_perplexity(messages: list[dict], model: str, api_url: str) -> dict:
    """Call Perplexity API with SSE streaming. Returns parsed response + usage."""
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        raise RuntimeError("PERPLEXITY_API_KEY is not set.")

    payload = {
        "model": model,
        "messages": messages,
        "disable_search": True,
        "stream": True,
    }

    last_error = None
    for attempt in range(3):
        try:
            resp = requests.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                json=payload,
                timeout=180,
                stream=True,
            )
            resp.raise_for_status()

            full_content = ""
            usage = {}
            spinner_frames = ["|", "/", "-", "\\"]
            frame_idx = 0
            first_token = True

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if not line.startswith("data: "):
                    continue

                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break

                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                if "usage" in chunk:
                    usage = chunk["usage"]

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                token = delta.get("content", "")
                if token:
                    if first_token:
                        sys.stdout.write("\r\033[K")
                        first_token = False
                    sys.stdout.write(token)
                    sys.stdout.flush()
                    full_content += token
                elif first_token:
                    sys.stdout.write(f"\r  {spinner_frames[frame_idx % 4]} thinking...")
                    sys.stdout.flush()
                    frame_idx += 1

            if first_token:
                sys.stdout.write("\r\033[K")

            return {"content": full_content, "usage": usage}

        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = e
            if attempt < 2:
                wait = 2 ** attempt
                print(f"\n[retry] {type(e).__name__}, retrying in {wait}s...", file=sys.stderr)
                time.sleep(wait)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (429, 500, 502, 503, 504):
                last_error = e
                if attempt < 2:
                    wait = 2 ** attempt
                    print(f"\n[retry] HTTP {e.response.status_code}, retrying in {wait}s...", file=sys.stderr)
                    time.sleep(wait)
                continue
            raise

    raise last_error  # type: ignore[misc]
