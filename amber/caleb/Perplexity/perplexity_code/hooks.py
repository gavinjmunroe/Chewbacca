"""Minimal hook system for Perplexity Code."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Callable


PRE_TOOL = "pre_tool"
POST_TOOL = "post_tool"
ON_ERROR = "on_error"
VALID_HOOK_EVENTS = {PRE_TOOL, POST_TOOL, ON_ERROR}


class Hooks:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable]] = {}

    def on(self, hook_name: str, handler: Callable) -> None:
        self._handlers.setdefault(hook_name, []).append(handler)

    def off(self, hook_name: str, handler: Callable) -> None:
        if hook_name in self._handlers:
            try:
                self._handlers[hook_name].remove(handler)
            except ValueError:
                pass

    def trigger(self, hook_name: str, **kwargs) -> None:
        for handler in self._handlers.get(hook_name, []):
            try:
                handler(hook_name=hook_name, **kwargs)
            except Exception as e:
                print(f"[Hook Error] {hook_name}: {e}", file=sys.stderr)

    def handlers_for(self, hook_name: str) -> list[Callable]:
        return self._handlers.get(hook_name, [])

    def clear(self, hook_name: str | None = None) -> None:
        if hook_name is None:
            self._handlers.clear()
        else:
            self._handlers.get(hook_name, []).clear()


_global_hooks = Hooks()


def get_hooks() -> Hooks:
    return _global_hooks


def _make_command_hook(command: str) -> Callable:
    def handler(**kwargs) -> None:
        env = os.environ.copy()
        env["HOOK_EVENT"] = kwargs.get("hook_name", "")
        env["HOOK_ACTION_TYPE"] = kwargs.get("action_type", "")
        env["HOOK_PATH"] = str(kwargs.get("path", ""))
        env["HOOK_COMMAND"] = str(kwargs.get("command", ""))
        env["HOOK_ERROR_TYPE"] = str(kwargs.get("error_type", ""))
        env["HOOK_ERROR_MESSAGE"] = str(kwargs.get("error_message", ""))
        result = kwargs.get("result", "")
        env["HOOK_RESULT_LENGTH"] = str(len(result)) if isinstance(result, str) else "0"

        proc = subprocess.run(
            command,
            shell=True,
            cwd=str(Path.cwd()),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0 and proc.stderr:
            print(f"[Hook Command Error] {kwargs.get('hook_name', '')}: {proc.stderr.strip()}", file=sys.stderr)

    return handler


def load_project_hook_config(path: Path | None = None, hooks: Hooks | None = None) -> list[dict]:
    hooks = hooks or _global_hooks
    path = path or (Path.cwd() / "PERPLEXITY_HOOKS.json")
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[Hook Config Error] {e}", file=sys.stderr)
        return []

    loaded: list[dict] = []
    for item in data.get("hooks", []):
        if not item.get("enabled", True):
            continue
        event = item.get("event")
        kind = item.get("type", "command")
        command = item.get("command", "").strip()

        if event not in VALID_HOOK_EVENTS or kind != "command" or not command:
            continue

        hooks.on(event, _make_command_hook(command))
        loaded.append(item)

    return loaded
