"""Language Server Protocol integration for Perplexity Code.

Provides real-time diagnostics from language servers without
requiring a full IDE. Shells out to installed language tooling.

Supports: TypeScript (tsc), Python (pyright/mypy), ESLint, Rust (cargo check)
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


def get_typescript_diagnostics(project_root: Path) -> list[dict[str, Any]]:
    """Run tsc --noEmit and parse diagnostics."""
    tsc = project_root / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        return []

    try:
        proc = subprocess.run(
            [str(tsc), "--noEmit", "--pretty", "false"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception:
        return []

    if proc.returncode == 0:
        return []

    diagnostics = []
    for line in proc.stdout.splitlines():
        # Format: file(line,col): error TSxxxx: message
        if ": error TS" in line or ": warning TS" in line:
            parts = line.split(":", 1)
            if len(parts) >= 2:
                location = parts[0].strip()
                message = parts[1].strip()
                severity = "error" if "error TS" in message else "warning"
                diagnostics.append({
                    "location": location,
                    "message": message,
                    "severity": severity,
                    "source": "tsc",
                })

    return diagnostics


def get_eslint_diagnostics(project_root: Path, files: list[str] | None = None) -> list[dict[str, Any]]:
    """Run ESLint and parse diagnostics."""
    eslint = project_root / "node_modules" / ".bin" / "eslint"
    if not eslint.exists():
        return []

    args = [str(eslint), "--format", "json", "--max-warnings", "999"]
    if files:
        args.extend(files)
    else:
        args.append(".")

    try:
        proc = subprocess.run(
            args,
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception:
        return []

    diagnostics = []
    try:
        results = json.loads(proc.stdout)
        for file_result in results:
            filepath = file_result.get("filePath", "")
            rel_path = os.path.relpath(filepath, project_root) if filepath else ""
            for msg in file_result.get("messages", []):
                diagnostics.append({
                    "location": f"{rel_path}({msg.get('line', 0)},{msg.get('column', 0)})",
                    "message": msg.get("message", ""),
                    "severity": "error" if msg.get("severity", 0) == 2 else "warning",
                    "source": "eslint",
                    "rule": msg.get("ruleId", ""),
                })
    except (json.JSONDecodeError, KeyError):
        pass

    return diagnostics


def get_python_diagnostics(project_root: Path) -> list[dict[str, Any]]:
    """Run pyright or mypy and parse diagnostics."""
    diagnostics = []

    # Try pyright first
    try:
        proc = subprocess.run(
            ["pyright", "--outputjson"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.stdout:
            data = json.loads(proc.stdout)
            for diag in data.get("generalDiagnostics", []):
                diagnostics.append({
                    "location": f"{diag.get('file', '')}({diag.get('range', {}).get('start', {}).get('line', 0)})",
                    "message": diag.get("message", ""),
                    "severity": diag.get("severity", "error"),
                    "source": "pyright",
                })
            return diagnostics
    except (FileNotFoundError, json.JSONDecodeError, subprocess.TimeoutExpired):
        pass

    # Fall back to mypy
    try:
        proc = subprocess.run(
            ["mypy", ".", "--no-color-output"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=60,
        )
        for line in proc.stdout.splitlines():
            if ": error:" in line or ": warning:" in line:
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    diagnostics.append({
                        "location": f"{parts[0]}:{parts[1]}",
                        "message": parts[2].strip(),
                        "severity": "error" if "error:" in line else "warning",
                        "source": "mypy",
                    })
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return diagnostics


def get_rust_diagnostics(project_root: Path) -> list[dict[str, Any]]:
    """Run cargo check and parse diagnostics."""
    if not (project_root / "Cargo.toml").exists():
        return []

    try:
        proc = subprocess.run(
            ["cargo", "check", "--message-format=json"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []

    diagnostics = []
    for line in proc.stdout.splitlines():
        try:
            msg = json.loads(line)
            if msg.get("reason") == "compiler-message":
                diag = msg.get("message", {})
                spans = diag.get("spans", [])
                location = ""
                if spans:
                    s = spans[0]
                    location = f"{s.get('file_name', '')}({s.get('line_start', 0)}:{s.get('column_start', 0)})"
                diagnostics.append({
                    "location": location,
                    "message": diag.get("message", ""),
                    "severity": diag.get("level", "error"),
                    "source": "rustc",
                })
        except json.JSONDecodeError:
            pass

    return diagnostics


def get_all_diagnostics(project_root: Path) -> list[dict[str, Any]]:
    """Run all available language diagnostics and merge results."""
    all_diags = []

    # Detect project type and run appropriate diagnostics
    if (project_root / "tsconfig.json").exists() or (project_root / "package.json").exists():
        all_diags.extend(get_typescript_diagnostics(project_root))
        all_diags.extend(get_eslint_diagnostics(project_root))

    if (project_root / "pyproject.toml").exists() or (project_root / "setup.py").exists():
        all_diags.extend(get_python_diagnostics(project_root))

    if (project_root / "Cargo.toml").exists():
        all_diags.extend(get_rust_diagnostics(project_root))

    return all_diags


def format_diagnostics(diagnostics: list[dict[str, Any]]) -> str:
    """Format diagnostics for display."""
    if not diagnostics:
        return "No diagnostics. Code is clean."

    errors = [d for d in diagnostics if d["severity"] == "error"]
    warnings = [d for d in diagnostics if d["severity"] != "error"]

    lines = [f"Diagnostics: {len(errors)} errors, {len(warnings)} warnings"]

    if errors:
        lines.append("\nErrors:")
        for d in errors[:20]:
            lines.append(f"  [{d['source']}] {d['location']}: {d['message']}")

    if warnings:
        lines.append(f"\nWarnings ({len(warnings)} total):")
        for d in warnings[:10]:
            lines.append(f"  [{d['source']}] {d['location']}: {d['message']}")
        if len(warnings) > 10:
            lines.append(f"  ... and {len(warnings) - 10} more")

    return "\n".join(lines)


def diagnostics_as_context(project_root: Path) -> str:
    """Get diagnostics formatted for injection into system prompt."""
    diags = get_all_diagnostics(project_root)
    if not diags:
        return ""

    errors = [d for d in diags if d["severity"] == "error"]
    if not errors:
        return ""

    lines = [f"Current code errors ({len(errors)}):"]
    for d in errors[:8]:
        lines.append(f"  {d['location']}: {d['message']}")

    return "\n".join(lines)
