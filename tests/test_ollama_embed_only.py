#!/usr/bin/env python3
"""Chewbacca's live code calls Ollama only for embeddings.

2026-11-03, Caleb, after llama-server showed up at 55% CPU with 15 tabs open:
"We should only use ollama for things better done w Ollama! Bro we hv the
claude max plan we hv tokens to spend". Embeddings are that job: no Claude
embeddings API exists, and a hook can't wait on a model call per prompt.
Text generation goes to Claude or Codex. This fails if live code (hooks, bin,
tools, apps/*/src) posts to Ollama's /api/generate or /api/chat, or shells out
to `ollama run`. A generate call with keep_alive 0 and no prompt only
unloads a model (bin/orphan-reap), so it passes. Benches and tests are exempt. hud-ollama is exempt because
the user picks that runtime by voice on purpose.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = [".claude/hooks", "bin", "tools", "apps"]
SKIP_DIRS = {"node_modules", "bench", "tests", "test", ".git", "worktrees", "__pycache__"}
EXEMPT = {"bin/hud-ollama"}
EXTS = (".py", ".sh", ".js", ".ts", ".mjs", "")
GEN = re.compile(r"""(11434|OLLAMA)[^\n]{0,200}/api/(generate|chat)\b|/api/(generate|chat)["'][^\n]{0,80}(ollama|11434)|\bollama\s+run\s""", re.I)

hits = []
for top in LIVE:
    base = os.path.join(ROOT, top)
    for dirpath, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, ROOT)
            if rel in EXEMPT or not name.endswith(EXTS) or os.path.getsize(path) > 2_000_000:
                continue
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            for n, line in enumerate(text.splitlines(), 1):
                unload = re.search(r"keep_alive\W+0\b", line) and "prompt" not in line
                if GEN.search(line) and not unload and not line.lstrip().startswith("#"):
                    hits.append(f"{rel}:{n}: {line.strip()[:120]}")

if hits:
    print("Ollama text generation in live code; route it to Claude/Codex:")
    print("\n".join(hits))
    sys.exit(1)
print("ok: live Ollama calls are embeddings only")
