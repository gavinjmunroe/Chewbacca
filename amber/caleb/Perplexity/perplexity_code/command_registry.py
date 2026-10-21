"""Command registry with metadata support for Perplexity Code.

Commands in .perplexity/commands/ can include YAML frontmatter:

---
description: Build a feature end to end
allowed-tools: Bash(npm:*), Read, Write, Edit
mode: acceptEdits
model: sonar-reasoning-pro
rules:
  - typescript
  - components
  - design
post-actions:
  - tsc --noEmit
  - eslint .
---
# Command prompt content...
"""

from __future__ import annotations

from pathlib import Path

from .rules_engine import parse_frontmatter


def load_command_registry(project_root: Path) -> dict[str, dict]:
    """Load all commands with full metadata."""
    command_dir = project_root / ".perplexity" / "commands"
    registry: dict[str, dict] = {}

    if not command_dir.exists():
        return registry

    for pattern in ("*.md", "*.txt"):
        for path in sorted(command_dir.glob(pattern)):
            try:
                content = path.read_text(encoding="utf-8").strip()
            except UnicodeDecodeError:
                content = path.read_text(errors="replace").strip()

            if not content:
                continue

            meta, body = parse_frontmatter(content)
            name = path.stem

            # Parse allowed-tools into list
            allowed_tools_raw = meta.get("allowed-tools", "")
            if isinstance(allowed_tools_raw, str) and allowed_tools_raw:
                allowed_tools = [t.strip() for t in allowed_tools_raw.split(",")]
            elif isinstance(allowed_tools_raw, list):
                allowed_tools = allowed_tools_raw
            else:
                allowed_tools = []

            registry[name] = {
                "name": name,
                "description": meta.get("description", ""),
                "body": body,
                "allowed_tools": allowed_tools,
                "mode": meta.get("mode", None),
                "model": meta.get("model", None),
                "rules": meta.get("rules", []),
                "post_actions": meta.get("post-actions", []),
                "path": str(path),
            }

    return registry


def get_command_prompt(
    registry: dict[str, dict],
    command_name: str,
    user_input: str = "",
) -> tuple[str, dict]:
    """Build the full prompt for a command, returns (prompt, metadata)."""
    cmd = registry.get(command_name)
    if not cmd:
        return "", {}

    prompt_parts = [
        f"Dynamic command: /{command_name}",
    ]

    if cmd["description"]:
        prompt_parts.append(f"Purpose: {cmd['description']}")

    prompt_parts.append(
        f"\nInstructions from .perplexity/commands/{command_name}:\n{cmd['body']}"
    )

    if user_input:
        prompt_parts.append(f"\nUser input:\n{user_input}")

    return "\n\n".join(prompt_parts), cmd


def list_commands_with_descriptions(registry: dict[str, dict]) -> list[tuple[str, str]]:
    """Return sorted list of (name, description) for display."""
    return sorted(
        [(name, cmd["description"]) for name, cmd in registry.items()],
        key=lambda x: x[0],
    )
