from __future__ import annotations

import os
import sys
from pathlib import Path

REQUIRED = [
    "README.md",
    "install.sh",
    "PERPLEXITY_HOOKS.json.example",
    "PERPLEXITY.md.example",
    "perplexity_code/cli.py",
    "perplexity_code/hooks.py",
    "perplexity_code/logging_hook.py",
    "tests/test_smoke.py",
]

failed = False

print("Perplexity Code alpha preflight")
print()

for item in REQUIRED:
    exists = Path(item).exists()
    print(f"[{'OK' if exists else 'FAIL'}] {item}")
    if not exists:
        failed = True

key_set = bool(os.getenv("PERPLEXITY_API_KEY"))
print(f"[{'OK' if key_set else 'WARN'}] PERPLEXITY_API_KEY {'is set' if key_set else 'is not set in this shell'}")

sys.exit(1 if failed else 0)
