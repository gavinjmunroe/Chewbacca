"""Source registry and ingestion pipeline for Perplexity Code.

The self-improving loop:
1. Track high-signal source repos and prompt systems
2. Detect meaningful changes
3. Translate into Perplexity-native commands, rules, hooks
4. Stage for review before merging

This is the compounding moat.
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Source categories
CATEGORIES = {
    "commands": "Slash command patterns and workflow definitions",
    "rules": "Code standards, design rules, linting configs",
    "hooks": "Pre/post tool automation patterns",
    "templates": "File templates, project scaffolds, starters",
    "workflows": "Multi-step build/deploy/review workflows",
    "integrations": "Tool and API integration patterns",
}


def get_registry_path(project_root: Path) -> Path:
    path = project_root / ".perplexity" / "sources"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_registry_file(project_root: Path) -> Path:
    return get_registry_path(project_root) / "registry.json"


def get_staging_path(project_root: Path) -> Path:
    path = get_registry_path(project_root) / "staging"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_registry(project_root: Path) -> dict[str, Any]:
    """Load the source registry."""
    reg_file = get_registry_file(project_root)
    if reg_file.exists():
        try:
            return json.loads(reg_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"sources": [], "last_updated": None}


def save_registry(project_root: Path, registry: dict[str, Any]) -> None:
    """Save the source registry."""
    registry["last_updated"] = datetime.now(timezone.utc).isoformat()
    get_registry_file(project_root).write_text(
        json.dumps(registry, indent=2),
        encoding="utf-8",
    )


def add_source(
    project_root: Path,
    name: str,
    url: str,
    category: str,
    description: str = "",
    watch_paths: list[str] | None = None,
) -> dict:
    """Add a source to the watch registry."""
    registry = load_registry(project_root)

    # Check for duplicates
    for source in registry["sources"]:
        if source["url"] == url:
            return source

    source = {
        "name": name,
        "url": url,
        "category": category,
        "description": description,
        "watch_paths": watch_paths or [],
        "added_at": datetime.now(timezone.utc).isoformat(),
        "last_checked": None,
        "last_commit": None,
        "enabled": True,
    }

    registry["sources"].append(source)
    save_registry(project_root, registry)
    return source


def remove_source(project_root: Path, name: str) -> bool:
    """Remove a source from the registry."""
    registry = load_registry(project_root)
    original_len = len(registry["sources"])
    registry["sources"] = [s for s in registry["sources"] if s["name"] != name]
    if len(registry["sources"]) < original_len:
        save_registry(project_root, registry)
        return True
    return False


def list_sources(project_root: Path) -> list[dict]:
    """List all registered sources."""
    registry = load_registry(project_root)
    return registry.get("sources", [])


def check_source_updates(project_root: Path, source: dict) -> dict | None:
    """Check if a git-based source has new commits.

    Returns update info if changes detected, None otherwise.
    """
    url = source.get("url", "")
    if not url:
        return None

    try:
        proc = subprocess.run(
            ["git", "ls-remote", "--heads", url, "main", "master"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            return None

        lines = proc.stdout.strip().splitlines()
        if not lines:
            return None

        latest_commit = lines[0].split()[0]
        if latest_commit == source.get("last_commit"):
            return None

        return {
            "source": source["name"],
            "url": url,
            "old_commit": source.get("last_commit"),
            "new_commit": latest_commit,
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return None


def scan_all_sources(project_root: Path) -> list[dict]:
    """Check all sources for updates. Returns list of detected changes."""
    registry = load_registry(project_root)
    updates = []

    for source in registry["sources"]:
        if not source.get("enabled", True):
            continue

        update = check_source_updates(project_root, source)
        if update:
            updates.append(update)
            source["last_checked"] = datetime.now(timezone.utc).isoformat()
            source["last_commit"] = update["new_commit"]

    if updates:
        save_registry(project_root, registry)

    return updates


def stage_update(
    project_root: Path,
    source_name: str,
    target_type: str,
    target_name: str,
    content: str,
    description: str = "",
) -> Path:
    """Stage an ingested update for review before merging.

    target_type: "command", "rule", "hook", "template"
    """
    staging = get_staging_path(project_root)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{stamp}_{source_name}_{target_type}_{target_name}.md"
    path = staging / filename

    header = (
        f"# Staged Update\n\n"
        f"- **Source**: {source_name}\n"
        f"- **Type**: {target_type}\n"
        f"- **Target**: {target_name}\n"
        f"- **Staged at**: {stamp}\n"
        f"- **Description**: {description}\n\n"
        f"---\n\n"
    )

    path.write_text(header + content, encoding="utf-8")
    return path


def list_staged(project_root: Path) -> list[Path]:
    """List all staged updates pending review."""
    staging = get_staging_path(project_root)
    return sorted(staging.glob("*.md"), reverse=True)


def apply_staged(project_root: Path, staged_path: Path) -> str:
    """Apply a staged update to the appropriate location."""
    content = staged_path.read_text(encoding="utf-8")

    # Parse the header to determine target
    target_type = ""
    target_name = ""
    for line in content.splitlines():
        if line.startswith("- **Type**:"):
            target_type = line.split(":", 1)[1].strip()
        elif line.startswith("- **Target**:"):
            target_name = line.split(":", 1)[1].strip()

    if not target_type or not target_name:
        return "Could not parse staged update metadata."

    # Extract body after ---
    parts = content.split("---", 1)
    body = parts[1].strip() if len(parts) > 1 else content

    # Write to appropriate location
    if target_type == "command":
        dest = project_root / ".perplexity" / "commands" / f"{target_name}.md"
    elif target_type == "rule":
        dest = project_root / ".perplexity" / "rules" / f"{target_name}.md"
    elif target_type == "hook":
        dest = project_root / ".perplexity" / "hooks" / f"{target_name}.py"
    else:
        return f"Unknown target type: {target_type}"

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(body, encoding="utf-8")

    # Remove from staging
    staged_path.unlink()

    return f"Applied {target_type}/{target_name} to {dest}"


def translate_source_to_native(
    project_root: Path,
    source_name: str,
    source_file_path: str,
    source_content: str,
    use_ai: bool = True,
) -> list[dict]:
    """Translate source content into Perplexity-native artifacts.

    When use_ai=True and PERPLEXITY_API_KEY is set, uses the Sonar API
    to intelligently rewrite the content for Perplexity Code's context.
    Otherwise falls back to deterministic string replacement.
    """
    staged = []

    # Determine target type from source path
    lower_path = source_file_path.lower()
    if "rule" in lower_path:
        target_type = "rule"
    elif "hook" in lower_path:
        target_type = "hook"
    elif "command" in lower_path:
        target_type = "command"
    elif lower_path.endswith((".md", ".txt")):
        target_type = "command"
    else:
        target_type = "command"

    from pathlib import PurePosixPath
    name = PurePosixPath(source_file_path).stem

    translated = source_content

    # Try AI-powered translation
    if use_ai and os.environ.get("PERPLEXITY_API_KEY"):
        try:
            import requests as req
            resp = req.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ['PERPLEXITY_API_KEY']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "sonar",
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You translate coding tool configurations from one tool to another. "
                                "The source is Claude Code (uses .claude/ directories, CLAUDE.md, Claude-specific language). "
                                "The target is Perplexity Code (uses .perplexity/ directories, PERPLEXITY.md). "
                                "Rewrite the content so it works natively in Perplexity Code. "
                                "Replace all Claude-specific references, paths, and branding. "
                                "Preserve the actual functionality and rules. "
                                "Do NOT add commentary. Return only the translated content."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Translate this {target_type} file from Claude Code to Perplexity Code:\n\n{source_content[:8000]}",
                        },
                    ],
                    "disable_search": True,
                },
                timeout=60,
            )
            if resp.status_code == 200:
                data = resp.json()
                ai_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if ai_content and len(ai_content) > 20:
                    translated = ai_content
        except Exception:
            pass  # Fall back to deterministic translation

    # Deterministic fallback: string replacement
    if translated == source_content:
        replacements = [
            ("Claude Code", "Perplexity Code"),
            ("claude code", "perplexity code"),
            (".claude/", ".perplexity/"),
            ("~/.claude", "~/.perplexity"),
            ("CLAUDE.md", "PERPLEXITY.md"),
            ("claude.md", "perplexity.md"),
        ]
        for old, new in replacements:
            translated = translated.replace(old, new)

    path = stage_update(
        project_root,
        source_name,
        target_type,
        name,
        translated,
        description=f"Translated from {source_name}:{source_file_path}" + (" (AI)" if translated != source_content else " (deterministic)"),
    )

    staged.append({
        "type": target_type,
        "name": name,
        "source": source_name,
        "path": str(path),
    })

    return staged


def ingest_source_files(
    project_root: Path,
    source_name: str,
    files: dict[str, str],
    use_ai: bool = True,
) -> list[dict]:
    """Ingest multiple files from a source, translate, and stage them all.

    files: dict of {relative_path: content}
    Returns list of all staged updates.
    """
    all_staged = []
    for file_path, content in files.items():
        if not content.strip():
            continue
        results = translate_source_to_native(project_root, source_name, file_path, content, use_ai=use_ai)
        all_staged.extend(results)
    return all_staged


def fetch_source_files(source: dict, paths: list[str] | None = None) -> dict[str, str]:
    """Fetch specific files from a git source repo.

    Uses git archive or raw GitHub URLs to get file content without cloning.
    """
    url = source.get("url", "")
    if not url:
        return {}

    # Convert git URL to raw GitHub URL
    raw_base = ""
    if "github.com" in url:
        # https://github.com/owner/repo.git -> https://raw.githubusercontent.com/owner/repo/main/
        clean = url.replace(".git", "").replace("https://github.com/", "").replace("git@github.com:", "")
        raw_base = f"https://raw.githubusercontent.com/{clean}/main/"

    if not raw_base:
        return {}

    watch_paths = paths or source.get("watch_paths", [])
    fetched: dict[str, str] = {}

    import requests as req
    for wp in watch_paths:
        # Try fetching the path directly (works for files, not directories)
        try:
            resp = req.get(raw_base + wp.rstrip("/"), timeout=15)
            if resp.status_code == 200 and len(resp.text) < 50000:
                fetched[wp] = resp.text
        except Exception:
            pass

    return fetched


def init_default_sources(project_root: Path) -> int:
    """Initialize the registry with high-signal default sources."""
    defaults = [
        {
            "name": "d1-vibe-coding",
            "url": "https://github.com/calebnewtonusc/D1-Vibe-Coding.git",
            "category": "workflows",
            "description": "Claude Code command/rule/hook system (Caleb's D1 setup)",
            "watch_paths": [".claude/commands/", ".claude/rules/", ".claude/hooks/"],
        },
        {
            "name": "claude-code-official",
            "url": "https://github.com/anthropics/claude-code.git",
            "category": "workflows",
            "description": "Official Claude Code repo for feature tracking",
            "watch_paths": ["src/", "docs/"],
        },
        {
            "name": "shadcn-ui",
            "url": "https://github.com/shadcn-ui/ui.git",
            "category": "templates",
            "description": "Component library, new component patterns",
            "watch_paths": ["apps/www/registry/"],
        },
        {
            "name": "vercel-ai-sdk",
            "url": "https://github.com/vercel/ai.git",
            "category": "integrations",
            "description": "AI SDK patterns, streaming, tool calling",
            "watch_paths": ["packages/ai/"],
        },
        {
            "name": "next-js",
            "url": "https://github.com/vercel/next.js.git",
            "category": "templates",
            "description": "Next.js App Router patterns and examples",
            "watch_paths": ["examples/", "docs/"],
        },
    ]

    count = 0
    for source in defaults:
        existing = load_registry(project_root)
        if not any(s["name"] == source["name"] for s in existing["sources"]):
            add_source(project_root, **source)
            count += 1

    return count
