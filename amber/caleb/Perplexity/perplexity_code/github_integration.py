"""GitHub integration for Perplexity Code.

Deep GitHub flows: repo discovery, PR management, issue tracking,
branch operations, and commit intelligence.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def _run_gh(args: list[str], timeout: int = 30) -> tuple[str, str, int]:
    """Run a gh CLI command and return (stdout, stderr, returncode)."""
    try:
        proc = subprocess.run(
            ["gh"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except FileNotFoundError:
        return "", "GitHub CLI (gh) not found. Install with: brew install gh", 1
    except subprocess.TimeoutExpired:
        return "", "GitHub CLI command timed out.", 1


def _run_git(args: list[str], cwd: str | None = None, timeout: int = 15) -> tuple[str, str, int]:
    """Run a git command and return (stdout, stderr, returncode)."""
    try:
        proc = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
        )
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except Exception as e:
        return "", str(e), 1


def gh_available() -> bool:
    """Check if GitHub CLI is installed and authenticated."""
    _, _, code = _run_gh(["auth", "status"])
    return code == 0


def get_repo_info() -> dict[str, str]:
    """Get current repo owner/name from git remote."""
    stdout, _, code = _run_git(["remote", "get-url", "origin"])
    if code != 0 or not stdout:
        return {}

    url = stdout
    # Parse GitHub URL
    if "github.com" in url:
        # SSH: git@github.com:owner/repo.git
        # HTTPS: https://github.com/owner/repo.git
        parts = url.replace("git@github.com:", "").replace("https://github.com/", "")
        parts = parts.replace(".git", "")
        segments = parts.split("/")
        if len(segments) >= 2:
            return {"owner": segments[0], "repo": segments[1], "full": f"{segments[0]}/{segments[1]}"}

    return {}


def list_open_prs(repo: str = "") -> list[dict]:
    """List open PRs for current or specified repo."""
    args = ["pr", "list", "--json", "number,title,author,createdAt,headRefName,reviewDecision,isDraft"]
    if repo:
        args.extend(["--repo", repo])

    stdout, _, code = _run_gh(args)
    if code != 0 or not stdout:
        return []

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return []


def get_pr_details(pr_number: int, repo: str = "") -> dict:
    """Get detailed PR info including diff stats."""
    args = [
        "pr", "view", str(pr_number),
        "--json", "number,title,body,author,state,headRefName,baseRefName,additions,deletions,changedFiles,reviewDecision,comments,reviews",
    ]
    if repo:
        args.extend(["--repo", repo])

    stdout, _, code = _run_gh(args)
    if code != 0 or not stdout:
        return {}

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {}


def get_pr_diff(pr_number: int, repo: str = "") -> str:
    """Get the full diff for a PR."""
    args = ["pr", "diff", str(pr_number)]
    if repo:
        args.extend(["--repo", repo])

    stdout, _, code = _run_gh(args, timeout=60)
    if code != 0:
        return ""

    if len(stdout) > 32000:
        stdout = stdout[:32000] + "\n... (diff truncated)"

    return stdout


def list_open_issues(repo: str = "", labels: str = "") -> list[dict]:
    """List open issues."""
    args = ["issue", "list", "--json", "number,title,labels,author,createdAt,assignees"]
    if repo:
        args.extend(["--repo", repo])
    if labels:
        args.extend(["--label", labels])

    stdout, _, code = _run_gh(args)
    if code != 0 or not stdout:
        return []

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return []


def get_issue_details(issue_number: int, repo: str = "") -> dict:
    """Get detailed issue info."""
    args = [
        "issue", "view", str(issue_number),
        "--json", "number,title,body,author,state,labels,assignees,comments,createdAt",
    ]
    if repo:
        args.extend(["--repo", repo])

    stdout, _, code = _run_gh(args)
    if code != 0 or not stdout:
        return {}

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {}


def create_branch(branch_name: str) -> bool:
    """Create and checkout a new branch."""
    _, _, code = _run_git(["checkout", "-b", branch_name])
    return code == 0


def get_recent_commits(count: int = 10) -> list[dict[str, str]]:
    """Get recent commits with hash, message, author, date."""
    stdout, _, code = _run_git([
        "log", f"-{count}",
        "--format=%H|%s|%an|%ai",
    ])
    if code != 0 or not stdout:
        return []

    commits = []
    for line in stdout.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({
                "hash": parts[0][:8],
                "message": parts[1],
                "author": parts[2],
                "date": parts[3],
            })

    return commits


def get_changed_files() -> dict[str, list[str]]:
    """Get files changed in working tree, grouped by status."""
    stdout, _, code = _run_git(["status", "--porcelain"])
    if code != 0 or not stdout:
        return {}

    result: dict[str, list[str]] = {
        "modified": [],
        "added": [],
        "deleted": [],
        "untracked": [],
    }

    for line in stdout.splitlines():
        if not line or len(line) < 3:
            continue
        status = line[:2].strip()
        filepath = line[3:]
        if status == "M":
            result["modified"].append(filepath)
        elif status == "A":
            result["added"].append(filepath)
        elif status == "D":
            result["deleted"].append(filepath)
        elif status == "??":
            result["untracked"].append(filepath)

    return result


def search_repos(query: str, limit: int = 10) -> list[dict]:
    """Search GitHub repos via gh CLI."""
    stdout, _, code = _run_gh([
        "search", "repos", query,
        "--json", "fullName,description,stargazersCount,language,updatedAt",
        "--limit", str(limit),
    ])
    if code != 0 or not stdout:
        return []

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return []


def get_workflow_runs(repo: str = "", limit: int = 5) -> list[dict]:
    """Get recent workflow runs (CI status)."""
    args = [
        "run", "list",
        "--json", "databaseId,displayTitle,status,conclusion,headBranch,createdAt",
        "--limit", str(limit),
    ]
    if repo:
        args.extend(["--repo", repo])

    stdout, _, code = _run_gh(args)
    if code != 0 or not stdout:
        return []

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return []


def build_github_context() -> str:
    """Build a GitHub context string for system prompt injection."""
    blocks = []

    repo = get_repo_info()
    if repo:
        blocks.append(f"GitHub repo: {repo.get('full', 'unknown')}")

    changes = get_changed_files()
    if any(changes.values()):
        parts = []
        for status, files in changes.items():
            if files:
                parts.append(f"{status}: {len(files)} files")
        blocks.append("Working tree: " + ", ".join(parts))

    commits = get_recent_commits(3)
    if commits:
        lines = ["Recent commits:"]
        for c in commits:
            lines.append(f"  {c['hash']} {c['message']}")
        blocks.append("\n".join(lines))

    return "\n".join(blocks) if blocks else ""
