"""Extended hook system for Perplexity Code.

Adds testing, CI, benchmarking, and notification hooks
on top of the base pre_tool/post_tool/on_error system.
"""

from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .hooks import Hooks, get_hooks

# Extended hook events
POST_EDIT = "post_edit"
POST_COMMAND = "post_command"
SESSION_START = "session_start"
SESSION_END = "session_end"
QUALITY_GATE = "quality_gate"


def register_extended_hooks(hooks: Hooks) -> None:
    """Register all extended hook handlers."""
    hooks.on(POST_EDIT, _auto_typecheck_hook)
    hooks.on(POST_COMMAND, _benchmark_hook)
    hooks.on(SESSION_END, _session_summary_hook)
    hooks.on(QUALITY_GATE, _quality_gate_hook)


# --- Hook handlers ---

def _auto_typecheck_hook(**kwargs: Any) -> None:
    """After editing a .ts/.tsx file, check if tsc is available and note errors."""
    path = kwargs.get("path", "")
    if not path or not any(path.endswith(ext) for ext in (".ts", ".tsx")):
        return

    # Find nearest package.json
    current = Path(path).parent
    while current != current.parent:
        if (current / "package.json").exists():
            tsc = current / "node_modules" / ".bin" / "tsc"
            if tsc.exists():
                try:
                    proc = subprocess.run(
                        [str(tsc), "--noEmit", "--pretty", "false"],
                        cwd=str(current),
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    if proc.returncode != 0:
                        error_count = proc.stdout.count("error TS")
                        if error_count > 0:
                            print(f"[typecheck] {error_count} TypeScript error(s) detected")
                except Exception:
                    pass
            break
        current = current.parent


def _benchmark_hook(**kwargs: Any) -> None:
    """Record command execution time for benchmarking."""
    command = kwargs.get("command", "")
    duration = kwargs.get("duration", 0)
    if command and duration:
        try:
            log_path = Path.cwd() / ".perplexity" / "benchmarks.jsonl"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "command": command,
                "duration_ms": round(duration * 1000),
            }
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass


def _session_summary_hook(**kwargs: Any) -> None:
    """Generate session summary at end."""
    tasks = kwargs.get("tasks", [])
    recent_files = kwargs.get("recent_files", [])

    if not tasks and not recent_files:
        return

    print("\n--- Session Summary ---")
    if tasks:
        completed = sum(1 for t in tasks if t.get("status") == "completed")
        failed = sum(1 for t in tasks if t.get("status") == "failed")
        print(f"Tasks: {completed} completed, {failed} failed, {len(tasks)} total")

    if recent_files:
        print(f"Files touched: {len(recent_files)}")

    print("--- End Summary ---\n")


def _quality_gate_hook(**kwargs: Any) -> None:
    """Run quality checks before shipping."""
    project_root = kwargs.get("project_root", Path.cwd())
    results: dict[str, str] = {}

    # Check for TypeScript errors
    tsc = Path(project_root) / "node_modules" / ".bin" / "tsc"
    if tsc.exists():
        try:
            proc = subprocess.run(
                [str(tsc), "--noEmit"],
                cwd=str(project_root),
                capture_output=True,
                text=True,
                timeout=60,
            )
            results["typecheck"] = "PASS" if proc.returncode == 0 else "FAIL"
        except Exception:
            results["typecheck"] = "SKIP"

    # Check for lint errors
    eslint = Path(project_root) / "node_modules" / ".bin" / "eslint"
    if eslint.exists():
        try:
            proc = subprocess.run(
                [str(eslint), ".", "--max-warnings", "0", "--quiet"],
                cwd=str(project_root),
                capture_output=True,
                text=True,
                timeout=60,
            )
            results["lint"] = "PASS" if proc.returncode == 0 else "FAIL"
        except Exception:
            results["lint"] = "SKIP"

    # Check for uncommitted changes
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=5,
        )
        dirty = bool(proc.stdout.strip())
        results["clean_tree"] = "WARN" if dirty else "PASS"
    except Exception:
        results["clean_tree"] = "SKIP"

    # Report results
    all_pass = all(v == "PASS" for v in results.values())
    print("\n--- Quality Gate ---")
    for check, status in results.items():
        icon = {"PASS": "[ok]", "FAIL": "[!!]", "WARN": "[??]", "SKIP": "[--]"}.get(status, "[??]")
        print(f"  {icon} {check}: {status}")

    verdict = "SHIP: YES" if all_pass else "SHIP: NO (fix failures first)"
    print(f"\n  {verdict}")
    print("--- End Gate ---\n")


class CommandTimer:
    """Context manager for timing command execution."""

    def __init__(self) -> None:
        self.start_time = 0.0
        self.duration = 0.0

    def __enter__(self) -> "CommandTimer":
        self.start_time = time.monotonic()
        return self

    def __exit__(self, *args: Any) -> None:
        self.duration = time.monotonic() - self.start_time
