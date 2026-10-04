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

# Every prompt also leaves one row in a private shadow log (route_shadow below)
# so the bar can be set from labeled real traffic instead of two observations.
# bin/route-label labels the rows, tools/route_tune.py reads the labels.

BRAIN_RECALL_PAYLOAD=$(cat)
export BRAIN_RECALL_PAYLOAD

exec python3 <<'PY'
import atexit, json, os, re, shutil, subprocess


def route_shadow(row):
    """Append one row to ~/.chewbacca/state/route-shadow.jsonl. Never raises.

    Shared verbatim with skill-route.sh, because install.sh copies only *.sh
    into ~/.claude/hooks and a helper module would not arrive. The log holds
    the start of every typed prompt, so it must never land in a git work tree:
    any ancestor holding .git makes this refuse, whatever path it was handed.
    ROUTE_SHADOW_LOG overrides the path, which is how the suite keeps test
    prompts out of the real log."""
    try:
        import hashlib, time
        path = os.environ.get("ROUTE_SHADOW_LOG") or os.path.join(
            os.environ.get("CHEWBACCA_HOME") or "~/.chewbacca", "state", "route-shadow.jsonl")
        path = os.path.realpath(os.path.expanduser(path))
        probe = os.path.dirname(path)
        while True:
            if os.path.exists(os.path.join(probe, ".git")):
                return
            parent = os.path.dirname(probe)
            if parent == probe:
                break
            probe = parent
        # 20 MB is years of prompts at a few hundred bytes a row; past it the
        # log stops growing rather than eating the disk. Guessed, never measured.
        if os.path.exists(path) and os.path.getsize(path) > 20_000_000:
            return
        prompt = row.pop("prompt", "") or ""
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "prompt_sha": hashlib.sha256(prompt.encode()).hexdigest()[:16],
               "prompt80": " ".join(prompt.split())[:80], **row}
        row["id"] = hashlib.sha256(f"{row['ts']}|{row['hook']}|{prompt}|{os.getpid()}"
                                   .encode()).hexdigest()[:12]
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, (json.dumps(row, separators=(",", ":")) + "\n").encode())
        finally:
            os.close(fd)
    except BaseException:
        pass

# Not measured on the sealed set. Started at 0.6, and on its first live day
# "Alr, is chewb perfect now?" pulled two unrelated Chewbacca memories at 0.60
# and 0.62 (a Clay history fix and the brain mirror), because a short prompt
# naming a project matches every note about that project. The one real hit
# seen so far, the church-mentor question, scored 0.76. 0.66 drops the noise
# and keeps that; it is still a guess between two observations.
MIN_COS = float(os.environ.get("BRAIN_RECALL_MIN_COS", "0.66"))
try:
    payload = json.loads(os.environ.get("BRAIN_RECALL_PAYLOAD") or "{}")
    prompt = (payload.get("prompt") or "").strip()
except Exception:
    raise SystemExit(0)
# One row per prompt, written on every exit path, silent ones included: a
# threshold tuned only on the prompts where it spoke cannot see what it missed.
SHADOW = {"hook": "brain-recall", "session_id": str(payload.get("session_id") or ""),
          "prompt": prompt, "gate": "", "method": "cosine", "threshold": MIN_COS,
          "candidates": [], "shown": []}
atexit.register(lambda: route_shadow(dict(SHADOW)))
# Same gates as skill-route.sh: too short to mean anything, a slash command the
# person already chose, or machine traffic nobody typed.
NOISE = ("SYSTEM NOTIFICATION", "task-notification", "<task-id>",
         "exited with code", "hookSpecificOutput")
if len(prompt) < 12 or prompt.startswith("/"):
    SHADOW["gate"] = "short-or-slash"
    raise SystemExit(0)
if any(n in prompt for n in NOISE):
    SHADOW["gate"] = "machine"
    raise SystemExit(0)
# Requires `brain` on PATH (calebnewtonusc/brain-retrieval). Without it this
# exits 0 and says nothing.
if not shutil.which("brain"):
    SHADOW["gate"] = "no-brain"
    raise SystemExit(0)

try:
    out = subprocess.run(["brain", "ask", prompt[:2000], "--k", "3", "--width", "160"],
                         capture_output=True, text=True, timeout=2.5).stdout
except Exception:
    SHADOW["gate"] = "brain-failed"
    raise SystemExit(0)
if not out.startswith("# brain mode=hybrid"):
    SHADOW["gate"] = "not-hybrid"
    raise SystemExit(0)

hits = []
# The anchor after # is a heading and can hold spaces ("#7. The line for when
# he feels behind"). The first version stopped the anchor at a space, so every
# hit inside a sectioned file failed to parse and was dropped unseen; the
# shadow log's first live row on 2026-10-03 came back with no candidates.
for m in re.finditer(r"^\[\d+\] (\S+?)(?:#[^\n]*?)? cos=([\d.]+)( \[stale\])?\n\s+(.*)$", out, re.M):
    path, cos, stale, text = m.group(1), float(m.group(2)), m.group(3), m.group(4)
    SHADOW["candidates"].append({"name": path, "score": round(cos, 4)})
    if cos >= MIN_COS:
        SHADOW["shown"].append(path)
        hits.append(f"  ~/second-brain/{path}  (cos {cos:.2f}{', stale' if stale else ''})\n    {text[:140]}")
SHADOW["candidates"] = sorted(SHADOW["candidates"], key=lambda c: -c["score"])[:3]
if hits:
    print("Second brain, matched by meaning. Read the file before answering if it bears on this:")
    print("\n".join(hits))
PY
