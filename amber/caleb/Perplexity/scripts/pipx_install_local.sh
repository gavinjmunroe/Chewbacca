#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pipx >/dev/null 2>&1; then
  echo "pipx is not installed."
  echo "Install it first with:"
  echo "  brew install pipx"
  exit 1
fi

pipx ensurepath
pipx install --force .
echo
echo "Installed with pipx."
echo "Open a new terminal or run: source ~/.zshrc"
echo "Then run: perplexity"
