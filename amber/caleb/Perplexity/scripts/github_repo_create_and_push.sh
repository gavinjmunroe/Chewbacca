#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-}"
VISIBILITY="${2:-public}"

if [ -z "$REPO_NAME" ]; then
  echo "Usage: ./scripts/github_repo_create_and_push.sh <repo-name> [public|private]"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI not found. Install with: brew install gh"
  exit 1
fi

gh auth status >/dev/null 2>&1 || gh auth login

if [ ! -d .git ]; then
  git init -b main
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git add -A
  git commit -m "Initial commit"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
else
  BRANCH="$(git branch --show-current)"
  git push -u origin "$BRANCH"
fi

git remote -v
