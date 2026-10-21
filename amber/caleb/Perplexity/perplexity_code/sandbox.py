"""Sandboxed execution for Perplexity Code.

Matches Codex's sandboxed VM approach by optionally running
shell commands inside Docker containers. Keeps the host safe.

Usage:
  /sandbox on          Enable sandboxed execution
  /sandbox off         Disable (run on host)
  /sandbox status      Show current mode

When enabled, run_shell commands execute inside a Docker container
with the project directory mounted read-write.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any


def docker_available() -> bool:
    """Check if Docker is installed and running."""
    try:
        proc = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return proc.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def run_sandboxed(
    command: str,
    cwd: str,
    image: str = "node:22-slim",
    timeout: int = 120,
    mount_readonly: bool = False,
) -> tuple[str, str, int]:
    """Run a command inside a Docker container.

    Args:
        command: Shell command to execute
        cwd: Host directory to mount as /workspace
        image: Docker image to use
        timeout: Max seconds
        mount_readonly: If True, mount as read-only (safe mode)

    Returns: (stdout, stderr, returncode)
    """
    mount_mode = "ro" if mount_readonly else "rw"

    docker_cmd = [
        "docker", "run", "--rm",
        "-v", f"{cwd}:/workspace:{mount_mode}",
        "-w", "/workspace",
        "--network", "none",  # No network access for safety
        "--memory", "512m",    # Memory limit
        "--cpus", "2",         # CPU limit
        image,
        "sh", "-c", command,
    ]

    try:
        proc = subprocess.run(
            docker_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired:
        return "", "Sandboxed command timed out", 1
    except FileNotFoundError:
        return "", "Docker not found. Install Docker or disable sandbox mode.", 1
    except Exception as e:
        return "", f"Sandbox error: {e}", 1


def detect_image_for_project(project_root: Path) -> str:
    """Auto-detect the best Docker image for the project type."""
    if (project_root / "package.json").exists():
        return "node:22-slim"
    if (project_root / "pyproject.toml").exists() or (project_root / "requirements.txt").exists():
        return "python:3.12-slim"
    if (project_root / "Cargo.toml").exists():
        return "rust:slim"
    if (project_root / "go.mod").exists():
        return "golang:1.22-alpine"
    return "ubuntu:24.04"


class SandboxManager:
    """Manages sandbox state for the session."""

    def __init__(self) -> None:
        self.enabled = False
        self.image: str | None = None  # Auto-detect if None
        self.readonly = False

    def enable(self, project_root: Path) -> str:
        """Enable sandbox mode."""
        if not docker_available():
            return "Docker is not available. Install Docker Desktop to use sandbox mode."
        self.enabled = True
        if not self.image:
            self.image = detect_image_for_project(project_root)
        return f"Sandbox enabled. Image: {self.image}. Commands will run in isolated containers."

    def disable(self) -> str:
        """Disable sandbox mode."""
        self.enabled = False
        return "Sandbox disabled. Commands will run on host."

    def status(self) -> str:
        """Get current sandbox status."""
        if not self.enabled:
            return "Sandbox: OFF (commands run on host)"
        return f"Sandbox: ON (image: {self.image}, readonly: {self.readonly})"

    def execute(self, command: str, cwd: str) -> str:
        """Execute a command, sandboxed if enabled."""
        if not self.enabled:
            # Run on host (original behavior)
            try:
                proc = subprocess.run(
                    command,
                    shell=True,
                    cwd=cwd,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                out = proc.stdout[-12000:]
                err = proc.stderr[-12000:]
                return (
                    f"COMMAND: {command}\n"
                    f"EXIT CODE: {proc.returncode}\n\n"
                    f"STDOUT:\n{out}\n\n"
                    f"STDERR:\n{err}"
                )
            except subprocess.TimeoutExpired:
                return f"COMMAND: {command}\nTIMEOUT after 120s"

        # Run in Docker
        image = self.image or "node:22-slim"
        stdout, stderr, code = run_sandboxed(
            command, cwd, image=image, mount_readonly=self.readonly,
        )
        return (
            f"COMMAND (sandboxed): {command}\n"
            f"IMAGE: {image}\n"
            f"EXIT CODE: {code}\n\n"
            f"STDOUT:\n{stdout[-12000:]}\n\n"
            f"STDERR:\n{stderr[-12000:]}"
        )
