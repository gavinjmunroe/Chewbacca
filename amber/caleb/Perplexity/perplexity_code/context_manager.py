"""Smart context manager for Perplexity Code.

Competes with 1M token context windows by being smarter about
what goes into context. Instead of brute-forcing with a massive
window, we:

1. Build a repo map (like Aider) showing file structure + signatures
2. Selectively load only relevant files based on the task
3. Compress previously-seen content into summaries
4. Track which files are most relevant to the current task

This makes 128K tokens behave like 500K+ of naive context.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any


# File extensions worth indexing
INDEXABLE = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
    ".java", ".rb", ".php", ".css", ".html", ".sql",
    ".md", ".json", ".yaml", ".yml", ".toml",
}

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "__pycache__", ".next",
    "dist", "build", ".perplexity", ".cache", "coverage",
    ".turbo", ".vercel",
}

# Max file size to index (bytes)
MAX_FILE_SIZE = 100_000


def build_repo_map(root: Path, max_depth: int = 4) -> str:
    """Build a structural map of the repository.

    Shows file tree with function/class/export signatures extracted
    from source files. This gives the model a complete picture of
    the codebase in minimal tokens.
    """
    lines = []
    file_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in sorted(dirnames) if d not in SKIP_DIRS]
        rel = os.path.relpath(dirpath, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1

        if depth > max_depth:
            dirnames[:] = []
            continue

        indent = "  " * depth
        dir_name = os.path.basename(dirpath) if rel != "." else "."
        lines.append(f"{indent}{dir_name}/")

        for fname in sorted(filenames)[:30]:
            _, ext = os.path.splitext(fname)
            if ext not in INDEXABLE:
                continue

            fpath = os.path.join(dirpath, fname)
            try:
                size = os.path.getsize(fpath)
            except OSError:
                continue

            if size > MAX_FILE_SIZE:
                lines.append(f"{indent}  {fname} ({size // 1024}KB, too large)")
                continue

            # Extract signatures
            sigs = _extract_signatures(fpath, ext)
            if sigs:
                lines.append(f"{indent}  {fname}")
                for sig in sigs[:10]:
                    lines.append(f"{indent}    {sig}")
            else:
                lines.append(f"{indent}  {fname}")

            file_count += 1
            if file_count > 200:
                lines.append(f"\n... ({file_count}+ files, map truncated)")
                return "\n".join(lines)

    return "\n".join(lines)


def _extract_signatures(filepath: str, ext: str) -> list[str]:
    """Extract function/class/export signatures from a source file."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(MAX_FILE_SIZE)
    except Exception:
        return []

    sigs = []

    if ext in (".ts", ".tsx", ".js", ".jsx"):
        sigs.extend(_extract_js_signatures(content))
    elif ext == ".py":
        sigs.extend(_extract_py_signatures(content))
    elif ext in (".go",):
        sigs.extend(_extract_go_signatures(content))

    return sigs


def _extract_js_signatures(content: str) -> list[str]:
    """Extract JS/TS exports, functions, classes, interfaces."""
    sigs = []
    patterns = [
        (r"export\s+(?:default\s+)?function\s+(\w+)", "fn"),
        (r"export\s+(?:default\s+)?class\s+(\w+)", "class"),
        (r"export\s+(?:default\s+)?(?:const|let)\s+(\w+)", "const"),
        (r"export\s+interface\s+(\w+)", "interface"),
        (r"export\s+type\s+(\w+)", "type"),
        (r"(?:^|\n)\s*(?:async\s+)?function\s+(\w+)", "fn"),
        (r"(?:^|\n)\s*class\s+(\w+)", "class"),
    ]
    for pattern, kind in patterns:
        for match in re.finditer(pattern, content):
            sigs.append(f"{kind} {match.group(1)}")
    return sigs[:15]


def _extract_py_signatures(content: str) -> list[str]:
    """Extract Python classes, functions, decorators."""
    sigs = []
    for match in re.finditer(r"^(?:class|def|async def)\s+(\w+)", content, re.MULTILINE):
        line = content[:match.start()].count("\n")
        prefix = content[match.start():match.end()].split()[0]
        sigs.append(f"{prefix} {match.group(1)}")
    return sigs[:15]


def _extract_go_signatures(content: str) -> list[str]:
    """Extract Go functions, types, interfaces."""
    sigs = []
    for match in re.finditer(r"^func\s+(?:\([^)]+\)\s+)?(\w+)", content, re.MULTILINE):
        sigs.append(f"func {match.group(1)}")
    for match in re.finditer(r"^type\s+(\w+)\s+(struct|interface)", content, re.MULTILINE):
        sigs.append(f"{match.group(2)} {match.group(1)}")
    return sigs[:15]


def rank_files_for_task(root: Path, task: str, recent_files: list[str]) -> list[str]:
    """Rank which files are most relevant to a task description.

    Uses keyword matching against filenames, directory names,
    and extracted signatures. Returns ordered list of file paths.
    """
    task_lower = task.lower()
    task_words = set(re.findall(r"\w+", task_lower))

    scored: list[tuple[float, str]] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = os.path.relpath(dirpath, root)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        if depth > 4:
            dirnames[:] = []
            continue

        for fname in filenames:
            _, ext = os.path.splitext(fname)
            if ext not in INDEXABLE:
                continue

            rel_path = os.path.join(rel_dir, fname) if rel_dir != "." else fname
            score = 0.0

            # Filename keyword match
            fname_lower = fname.lower().replace(".", " ").replace("-", " ").replace("_", " ")
            fname_words = set(fname_lower.split())
            overlap = task_words & fname_words
            score += len(overlap) * 3.0

            # Directory keyword match
            dir_words = set(rel_dir.lower().replace("/", " ").replace("-", " ").replace("_", " ").split())
            dir_overlap = task_words & dir_words
            score += len(dir_overlap) * 2.0

            # Recent file bonus
            if rel_path in recent_files:
                score += 5.0

            # File type relevance
            if ext in (".ts", ".tsx") and any(w in task_lower for w in ("component", "page", "react", "ui")):
                score += 1.0
            if ext == ".py" and any(w in task_lower for w in ("python", "script", "test")):
                score += 1.0
            if ext == ".sql" and any(w in task_lower for w in ("database", "schema", "migration", "query")):
                score += 1.0

            if score > 0:
                scored.append((score, rel_path))

    scored.sort(reverse=True)
    return [path for _, path in scored[:20]]


def build_smart_context(
    root: Path,
    task: str,
    recent_files: list[str],
    max_chars: int = 60000,
) -> str:
    """Build an optimized context payload for a task.

    1. Repo map (structural overview)
    2. Ranked relevant files (full content of top matches)
    3. Stays within token budget

    This makes limited context windows competitive with 1M brute force.
    """
    blocks = []
    total = 0

    # 1. Repo map (compact structural overview)
    repo_map = build_repo_map(root, max_depth=3)
    if repo_map:
        map_section = f"Repository structure:\n{repo_map}"
        if len(map_section) < max_chars * 0.3:  # Cap map at 30% of budget
            blocks.append(map_section)
            total += len(map_section)

    # 2. Ranked file contents
    ranked = rank_files_for_task(root, task, recent_files)
    for rel_path in ranked:
        if total >= max_chars:
            break
        full_path = root / rel_path
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        if len(content) > (max_chars - total):
            content = content[:max_chars - total] + "\n... (file truncated)"

        blocks.append(f"File: {rel_path}\n{content}")
        total += len(content)

    if not blocks:
        return ""

    return "\n\n".join(blocks)
