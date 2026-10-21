#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source .venv/bin/activate
python -m py_compile perplexity_code/cli.py perplexity_code/hooks.py perplexity_code/logging_hook.py scripts/alpha_preflight.py
python -m unittest discover -s tests -v
python scripts/alpha_preflight.py

echo
echo "Public alpha release checks passed."
