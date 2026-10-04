#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init brain-recall.sh 3
# Pull the memories that answer this prompt into context, at the moment it is
# typed.
#
# THE FAILURE THIS EXISTS FOR, 2026-10-03. MEMORY.md is the only part of the
# second brain that loads on its own, and it has a byte budget, so every new
# memory costs an old one its place in the index. Caleb: "why is there a max on
# memory? I feel like that is a skill issue". It was. A local vector retriever
# had already been built and measured (brain-retrieval, 2026-09-22: grep 12%,
# tuned hybrid 68% recall@5 on a sealed 73-question set) and nothing called it.
#
# Silent unless the match is real. `brain ask` abstains on its own below a top
# cosine of 0.55, which on that sealed set caught 8 of 8 questions with no
# answer in the brain while wrongly refusing 2 of 65 real ones. Each file shown
# must also clear MIN_COS on its own, so a strong first hit does not drag two
# weak ones in behind it. Lexical-only mode (Ollama down) prints nothing,
# because BM25 scores are not cosines and the threshold means nothing there.
#
# Requires `brain` on PATH (calebnewtonusc/brain-retrieval). Without it this
# exits 0 and says nothing.

BRAIN_RECALL_PAYLOAD=$(cat)
export BRAIN_RECALL_PAYLOAD
command -v brain >/dev/null 2>&1 || exit 0

exec python3 <<'PY'
import json, os, re, subprocess

# Not measured on the sealed set. Started at 0.6, and on its first live day
# "Alr, is chewb perfect now?" pulled two unrelated Chewbacca memories at 0.60
# and 0.62 (a Clay history fix and the brain mirror), because a short prompt
# naming a project matches every note about that project. The one real hit
# seen so far, the church-mentor question, scored 0.76. 0.66 drops the noise
# and keeps that; it is still a guess between two observations.
MIN_COS = float(os.environ.get("BRAIN_RECALL_MIN_COS", "0.66"))
try:
    prompt = (json.loads(os.environ.get("BRAIN_RECALL_PAYLOAD") or "{}").get("prompt") or "").strip()
except Exception:
    raise SystemExit(0)
# Same gates as skill-route.sh: too short to mean anything, a slash command the
# person already chose, or machine traffic nobody typed.
NOISE = ("SYSTEM NOTIFICATION", "task-notification", "<task-id>",
         "exited with code", "hookSpecificOutput")
if len(prompt) < 12 or prompt.startswith("/") or any(n in prompt for n in NOISE):
    raise SystemExit(0)

try:
    out = subprocess.run(["brain", "ask", prompt[:2000], "--k", "3", "--width", "160"],
                         capture_output=True, text=True, timeout=2.5).stdout
except Exception:
    raise SystemExit(0)
if not out.startswith("# brain mode=hybrid"):
    raise SystemExit(0)

hits = []
for m in re.finditer(r"^\[\d+\] (\S+?)(?:#\S*)? cos=([\d.]+)( \[stale\])?\n\s+(.*)$", out, re.M):
    path, cos, stale, text = m.group(1), float(m.group(2)), m.group(3), m.group(4)
    if cos >= MIN_COS:
        hits.append(f"  ~/second-brain/{path}  (cos {cos:.2f}{', stale' if stale else ''})\n    {text[:140]}")
if hits:
    print("Second brain, matched by meaning. Read the file before answering if it bears on this:")
    print("\n".join(hits))
PY
