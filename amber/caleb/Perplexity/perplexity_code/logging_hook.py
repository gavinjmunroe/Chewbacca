"""Built-in JSONL logging hook."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def get_log_path() -> Path:
    return Path.cwd() / "tool_activity.log"


def log_tool_activity(**kwargs) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hook": kwargs.get("hook_name", "unknown"),
        "action_type": kwargs.get("action_type", "unknown"),
    }

    if "path" in kwargs:
        entry["path"] = kwargs["path"]
    if "command" in kwargs:
        entry["command"] = kwargs["command"]
    if "content_length" in kwargs:
        entry["content_length"] = kwargs["content_length"]
    if "result" in kwargs:
        result = kwargs["result"]
        entry["result_length"] = len(result) if isinstance(result, str) else 0
    if entry["hook"] == "on_error":
        entry["error_type"] = kwargs.get("error_type", "")
        entry["error_message"] = kwargs.get("error_message", "")

    try:
        with open(get_log_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass
