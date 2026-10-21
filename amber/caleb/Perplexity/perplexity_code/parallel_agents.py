"""Parallel agent system for Perplexity Code.

Matches and exceeds Claude Code's Agent Teams by running
multiple independent agent tasks concurrently as subprocesses.

Usage:
  /parallel "build auth page" "write tests for auth" "update API docs"
  /parallel status
  /parallel results

Each task gets its own agent loop, own context, own tool execution.
Results are collected and merged.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class AgentTask:
    """A single parallel agent task."""

    def __init__(self, task_id: int, description: str, cwd: str) -> None:
        self.task_id = task_id
        self.description = description
        self.cwd = cwd
        self.status = "pending"  # pending, running, completed, failed
        self.started_at: str | None = None
        self.completed_at: str | None = None
        self.result: str = ""
        self.error: str = ""
        self.duration_ms: int = 0
        self._thread: threading.Thread | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.task_id,
            "description": self.description,
            "status": self.status,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result[:500] if self.result else "",
            "error": self.error,
            "duration_ms": self.duration_ms,
        }


class ParallelAgentPool:
    """Manages concurrent agent tasks."""

    def __init__(self, max_concurrent: int = 4) -> None:
        self.max_concurrent = max_concurrent
        self.tasks: list[AgentTask] = []
        self._next_id = 0
        self._lock = threading.Lock()

    def submit(self, description: str, cwd: str | None = None) -> AgentTask:
        """Submit a new task for parallel execution."""
        with self._lock:
            task = AgentTask(self._next_id, description, cwd or str(Path.cwd()))
            self._next_id += 1
            self.tasks.append(task)
        return task

    def run_all(self) -> None:
        """Execute all pending tasks in parallel."""
        pending = [t for t in self.tasks if t.status == "pending"]
        if not pending:
            return

        threads = []
        for task in pending:
            task.status = "running"
            task.started_at = datetime.now(timezone.utc).isoformat()
            thread = threading.Thread(target=self._execute_task, args=(task,), daemon=True)
            task._thread = thread
            threads.append(thread)

        # Start threads respecting max_concurrent
        active: list[threading.Thread] = []
        idx = 0
        while idx < len(threads) or active:
            # Start new threads up to limit
            while idx < len(threads) and len(active) < self.max_concurrent:
                threads[idx].start()
                active.append(threads[idx])
                idx += 1

            # Wait for any to complete
            still_active = []
            for t in active:
                t.join(timeout=0.1)
                if t.is_alive():
                    still_active.append(t)
            active = still_active

        # Final join
        for t in threads:
            t.join(timeout=60)

    def _execute_task(self, task: AgentTask) -> None:
        """Execute a single task via the Perplexity Code CLI in non-interactive mode."""
        start = time.monotonic()
        try:
            # Run perplexity as a subprocess with the task as initial argument
            # This gives each task its own agent loop and context
            env = os.environ.copy()
            proc = subprocess.run(
                [sys.executable, "-m", "perplexity_code.cli", task.description],
                cwd=task.cwd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout per task
                env=env,
            )

            task.result = proc.stdout
            if proc.returncode != 0:
                task.error = proc.stderr[:500]
                task.status = "failed"
            else:
                task.status = "completed"

        except subprocess.TimeoutExpired:
            task.status = "failed"
            task.error = "Task timed out after 5 minutes"
        except Exception as e:
            task.status = "failed"
            task.error = str(e)[:500]
        finally:
            task.duration_ms = round((time.monotonic() - start) * 1000)
            task.completed_at = datetime.now(timezone.utc).isoformat()

    def get_status(self) -> str:
        """Get human-readable status of all tasks."""
        if not self.tasks:
            return "No parallel tasks."

        lines = [f"Parallel tasks ({len(self.tasks)} total):"]
        for task in self.tasks:
            icon = {
                "pending": "[..]",
                "running": "[>>]",
                "completed": "[ok]",
                "failed": "[!!]",
            }.get(task.status, "[??]")

            duration = f" ({task.duration_ms}ms)" if task.duration_ms else ""
            lines.append(f"  {icon} #{task.task_id}: {task.description[:60]}{duration}")
            if task.error:
                lines.append(f"       Error: {task.error[:80]}")

        completed = sum(1 for t in self.tasks if t.status == "completed")
        failed = sum(1 for t in self.tasks if t.status == "failed")
        running = sum(1 for t in self.tasks if t.status == "running")
        lines.append(f"\n  {completed} completed, {failed} failed, {running} running")

        return "\n".join(lines)

    def get_results(self) -> list[dict]:
        """Get results from all completed tasks."""
        return [t.to_dict() for t in self.tasks if t.status in ("completed", "failed")]

    def clear(self) -> None:
        """Clear all tasks."""
        self.tasks.clear()
        self._next_id = 0
