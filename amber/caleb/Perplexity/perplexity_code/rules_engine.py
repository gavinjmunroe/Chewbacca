"""Active rules injection engine for Perplexity Code.

Loads rules from .perplexity/rules/ and injects them into prompts
based on file type, workflow, and command context.

Rules files use YAML frontmatter with glob patterns:

---
paths:
  - "**/*.ts"
  - "**/*.tsx"
workflows:
  - review
  - build
commands:
  - audit
  - ship
---
# Rule content here...
"""

from __future__ import annotations

import fnmatch
import re
from pathlib import Path


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML-like frontmatter and body from a rules file."""
    if not content.startswith("---"):
        return {}, content

    end = content.find("---", 3)
    if end == -1:
        return {}, content

    raw = content[3:end].strip()
    body = content[end + 3:].strip()
    meta: dict = {}

    current_key = None
    current_list: list[str] = []

    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("- "):
            value = stripped[2:].strip().strip('"').strip("'")
            if current_key:
                current_list.append(value)
        elif ":" in stripped:
            if current_key and current_list:
                meta[current_key] = current_list
            key, _, val = stripped.partition(":")
            current_key = key.strip()
            val = val.strip().strip('"').strip("'")
            if val:
                meta[current_key] = val
                current_key = None
                current_list = []
            else:
                current_list = []

    if current_key and current_list:
        meta[current_key] = current_list

    return meta, body


def load_all_rules(project_root: Path) -> list[dict]:
    """Load all rules files with parsed metadata."""
    rules_dir = project_root / ".perplexity" / "rules"
    if not rules_dir.exists():
        return []

    rules = []
    for path in sorted(rules_dir.glob("*.md")):
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(errors="replace")

        meta, body = parse_frontmatter(content)
        if body.strip():
            rules.append({
                "name": path.stem,
                "paths": meta.get("paths", []),
                "workflows": meta.get("workflows", []),
                "commands": meta.get("commands", []),
                "always": meta.get("always", False),
                "body": body,
            })

    return rules


def match_rules_for_context(
    all_rules: list[dict],
    active_files: list[str] | None = None,
    workflow: str | None = None,
    command: str | None = None,
) -> list[dict]:
    """Select rules that match the current context."""
    matched = []
    active_files = active_files or []

    for rule in all_rules:
        if rule.get("always"):
            matched.append(rule)
            continue

        # Match by command
        if command and command in rule.get("commands", []):
            matched.append(rule)
            continue

        # Match by workflow
        if workflow and workflow in rule.get("workflows", []):
            matched.append(rule)
            continue

        # Match by file path globs
        path_patterns = rule.get("paths", [])
        if path_patterns and active_files:
            found = False
            for file_path in active_files:
                for pattern in path_patterns:
                    # fnmatch doesn't handle ** properly for root files,
                    # so also check the basename against the extension pattern
                    if fnmatch.fnmatch(file_path, pattern):
                        found = True
                        break
                    # Handle **/*.ext matching root-level files like "main.py"
                    if pattern.startswith("**/"):
                        base_pattern = pattern[3:]  # strip **/
                        if fnmatch.fnmatch(file_path, base_pattern):
                            found = True
                            break
                if found:
                    break
            if found:
                matched.append(rule)
                continue

        # If no filters at all, include as general rule
        if not path_patterns and not rule.get("workflows") and not rule.get("commands"):
            matched.append(rule)

    return matched


def build_rules_prompt(
    project_root: Path,
    active_files: list[str] | None = None,
    workflow: str | None = None,
    command: str | None = None,
    max_chars: int = 12000,
) -> str:
    """Build a rules injection string for the system prompt."""
    all_rules = load_all_rules(project_root)
    matched = match_rules_for_context(all_rules, active_files, workflow, command)

    if not matched:
        return ""

    blocks = []
    total = 0
    for rule in matched:
        body = rule["body"]
        if total + len(body) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                body = body[:remaining] + "\n... (rule truncated)"
                blocks.append(f"### {rule['name']}\n{body}")
            break
        blocks.append(f"### {rule['name']}\n{body}")
        total += len(body)

    if not blocks:
        return ""

    header = f"Active Rules ({len(blocks)} matched"
    if workflow:
        header += f", workflow={workflow}"
    if command:
        header += f", command={command}"
    header += "):"

    return header + "\n\n" + "\n\n".join(blocks)
