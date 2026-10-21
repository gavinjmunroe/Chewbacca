#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .

mkdir -p "$HOME/.local/bin"
ln -sf "$PWD/.venv/bin/perplexity" "$HOME/.local/bin/perplexity"

grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.zshrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"

echo
echo "Installed."
echo "Open a new terminal or run: source ~/.zshrc"
echo "Then run: perplexity"
