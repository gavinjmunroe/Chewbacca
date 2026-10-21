"""Git-first auto-commit mode for Perplexity Code.

Matches Aider's core philosophy: every AI edit becomes a git commit
with a descriptive message. Complete audit trail of what the AI did.

Usage:
  /autocommit on       Enable auto-commit after every file write
  /autocommit off      Disable
  /autocommit status   Show current mode
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def git_available(cwd: str | None = None) -> bool:
    """Check if we're in a git repo."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return proc.returncode == 0
    except Exception:
        return False


def auto_commit(
    files: list[str],
    message: str,
    cwd: str | None = None,
) -> tuple[bool, str]:
    """Stage specific files and commit with a message.

    Returns (success, output_message)
    """
    if not files:
        return False, "No files to commit."

    if not git_available(cwd):
        return False, "Not in a git repository."

    try:
        # Stage specific files (never git add -A)
        for f in files:
            proc = subprocess.run(
                ["git", "add", f],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if proc.returncode != 0:
                return False, f"Failed to stage {f}: {proc.stderr}"

        # Check if there's anything staged
        proc = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            return False, "Nothing to commit (no staged changes)."

        # Commit
        proc = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if proc.returncode == 0:
            # Extract short hash
            hash_proc = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=5,
            )
            short_hash = hash_proc.stdout.strip() if hash_proc.returncode == 0 else "?"
            return True, f"[{short_hash}] {message}"
        else:
            return False, f"Commit failed: {proc.stderr}"

    except Exception as e:
        return False, f"Auto-commit error: {e}"


def generate_commit_message(action_type: str, path: str, description: str = "") -> str:
    """Generate a descriptive commit message for an AI action."""
    if action_type == "write_file":
        if description:
            return f"perplexity: {description}"
        return f"perplexity: create {path}"

    if action_type == "write_patch":
        if description:
            return f"perplexity: {description}"
        return f"perplexity: edit {path}"

    return f"perplexity: {action_type} {path}"


class AutoCommitManager:
    """Manages auto-commit state and file tracking."""

    def __init__(self) -> None:
        self.enabled = False
        self.pending_files: list[str] = []
        self.commit_count = 0

    def enable(self) -> str:
        if not git_available():
            return "Cannot enable auto-commit: not in a git repository."
        self.enabled = True
        return "Auto-commit enabled. Every file edit will be committed automatically."

    def disable(self) -> str:
        self.enabled = False
        return "Auto-commit disabled."

    def status(self) -> str:
        mode = "ON" if self.enabled else "OFF"
        return f"Auto-commit: {mode} ({self.commit_count} commits this session)"

    def track_file(self, path: str) -> None:
        """Track a file that was modified."""
        if path and path not in self.pending_files:
            self.pending_files.append(path)

    def commit_if_enabled(self, action_type: str, path: str, cwd: str | None = None) -> str | None:
        """Auto-commit tracked files if enabled. Returns commit message or None."""
        if not self.enabled or not self.pending_files:
            return None

        message = generate_commit_message(action_type, path)
        success, result = auto_commit(self.pending_files, message, cwd=cwd)
        self.pending_files.clear()

        if success:
            self.commit_count += 1
            return result

        return None
