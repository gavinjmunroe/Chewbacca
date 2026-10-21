"""Enhanced session intelligence for Perplexity Code.

Goes beyond basic save/load to provide:
- Repo-state snapshots (git hash, branch, changed files)
- Task lineage (what was attempted, what succeeded, what failed)
- Smart resume with context-aware suggestions
- Compressed session summaries that preserve signal
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def get_repo_snapshot() -> dict[str, Any]:
    """Capture current repo state for session context."""
    snapshot: dict[str, Any] = {}

    try:
        # Current branch
        proc = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            snapshot["branch"] = proc.stdout.strip()

        # Current commit
        proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            snapshot["commit"] = proc.stdout.strip()

        # Changed files count
        proc = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
            snapshot["changed_files"] = len(lines)
            snapshot["dirty"] = len(lines) > 0

        # Recent commit messages (last 3)
        proc = subprocess.run(
            ["git", "log", "-3", "--format=%s"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            snapshot["recent_commits"] = [
                l.strip() for l in proc.stdout.strip().splitlines() if l.strip()
            ]

    except Exception:
        pass

    snapshot["captured_at"] = datetime.now(timezone.utc).isoformat()
    return snapshot


class TaskTracker:
    """Track task lineage within a session."""

    def __init__(self) -> None:
        self.tasks: list[dict[str, Any]] = []

    def start_task(self, description: str, task_type: str = "user_request") -> int:
        """Record the start of a new task. Returns task index."""
        task = {
            "id": len(self.tasks),
            "description": description[:200],
            "type": task_type,
            "status": "in_progress",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "files_touched": [],
            "tools_used": [],
            "outcome": None,
        }
        self.tasks.append(task)
        return task["id"]

    def record_tool_use(self, task_id: int, tool_type: str, path: str = "") -> None:
        """Record a tool use within a task."""
        if 0 <= task_id < len(self.tasks):
            self.tasks[task_id]["tools_used"].append(tool_type)
            if path and path not in self.tasks[task_id]["files_touched"]:
                self.tasks[task_id]["files_touched"].append(path)

    def complete_task(self, task_id: int, outcome: str = "success") -> None:
        """Mark a task as completed."""
        if 0 <= task_id < len(self.tasks):
            self.tasks[task_id]["status"] = "completed"
            self.tasks[task_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
            self.tasks[task_id]["outcome"] = outcome

    def fail_task(self, task_id: int, reason: str = "") -> None:
        """Mark a task as failed."""
        if 0 <= task_id < len(self.tasks):
            self.tasks[task_id]["status"] = "failed"
            self.tasks[task_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
            self.tasks[task_id]["outcome"] = f"failed: {reason}"

    def get_summary(self) -> str:
        """Generate a human-readable task summary."""
        if not self.tasks:
            return "No tasks recorded this session."

        lines = [f"Session tasks ({len(self.tasks)} total):"]
        for task in self.tasks[-10:]:  # Last 10 tasks
            status_icon = {
                "completed": "[done]",
                "failed": "[FAIL]",
                "in_progress": "[...]",
            }.get(task["status"], "[?]")

            files = f" ({len(task['files_touched'])} files)" if task["files_touched"] else ""
            lines.append(f"  {status_icon} {task['description']}{files}")

        return "\n".join(lines)

    def to_dict(self) -> list[dict]:
        return self.tasks

    @classmethod
    def from_dict(cls, data: list[dict]) -> "TaskTracker":
        tracker = cls()
        tracker.tasks = data
        return tracker


def build_resume_context(
    session_data: dict,
    project_root: Path,
) -> str:
    """Build an intelligent resume prompt from a saved session.

    Includes: what was being worked on, repo state changes, and suggestions.
    """
    blocks = []

    # What was happening
    summary = session_data.get("summary", [])
    if summary:
        blocks.append("Previous session context:")
        for item in summary[-8:]:
            blocks.append(f"  - {item}")

    # Task lineage
    tasks = session_data.get("tasks", [])
    if tasks:
        tracker = TaskTracker.from_dict(tasks)
        blocks.append(tracker.get_summary())

    # Repo state comparison
    old_snapshot = session_data.get("repo_snapshot", {})
    current_snapshot = get_repo_snapshot()

    if old_snapshot and current_snapshot:
        changes = []
        if old_snapshot.get("branch") != current_snapshot.get("branch"):
            changes.append(
                f"Branch changed: {old_snapshot.get('branch')} -> {current_snapshot.get('branch')}"
            )
        if old_snapshot.get("commit") != current_snapshot.get("commit"):
            changes.append(
                f"New commits since last session (was {old_snapshot.get('commit')}, now {current_snapshot.get('commit')})"
            )
        if changes:
            blocks.append("Repo changes since last session:")
            for c in changes:
                blocks.append(f"  - {c}")

    # Recent files
    recent = session_data.get("recent_files", [])
    if recent:
        blocks.append("Files from last session:")
        for f in recent[-8:]:
            blocks.append(f"  - {f}")

    if not blocks:
        return "No previous session context available."

    return "\n".join(blocks)


def smart_suggestions(session_data: dict) -> list[str]:
    """Generate smart suggestions based on session state."""
    suggestions = []
    tasks = session_data.get("tasks", [])

    # Find incomplete tasks
    incomplete = [t for t in tasks if t.get("status") == "in_progress"]
    if incomplete:
        for task in incomplete[:3]:
            suggestions.append(f"Resume: {task['description']}")

    # Find failed tasks
    failed = [t for t in tasks if t.get("status") == "failed"]
    if failed:
        for task in failed[:2]:
            suggestions.append(f"Retry: {task['description']}")

    # Check if tests should be run
    files_touched = set()
    for task in tasks:
        files_touched.update(task.get("files_touched", []))
    if any(f.endswith((".ts", ".tsx", ".py")) for f in files_touched):
        suggestions.append("Run tests for changed files")

    # Check dirty state
    snapshot = get_repo_snapshot()
    if snapshot.get("dirty"):
        suggestions.append("Commit or stash uncommitted changes")

    return suggestions
