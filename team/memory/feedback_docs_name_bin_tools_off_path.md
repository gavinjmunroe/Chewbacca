---
name: feedback-docs-name-bin-tools-off-path
description: "Docs telling agents to run bin/ tools by bare name (gtm, decision-inbox) break, because setup only links some of bin/ onto PATH; found in the backlog 26 audit, 2026-10-16"
metadata:
  type: feedback
---

The staleness audit on 2026-10-16 (backlog 26, docs/reference/STALENESS-COVERAGE.md) found always-loaded docs naming commands that don't run as written. `decision-inbox check` (unattended-lane.md) and `gtm clients` (gtm-engineering) are bin/ scripts, but neither is on PATH on this Mac. `chewbacca skills <query>` (AGENTS.md, agent-neutral.md) printed usage and exited 2 until a5f00c9c.

**Why:** `which` checks the PATH, and a doc tested only from inside the repo with bin/ handy passes by accident. setup.sh links some bin/ tools into ~/.local/bin and not others.

**How to apply:** in any doc an agent loads, write a command the way it runs from anywhere: `chewbacca <verb>` or a `bin/<tool>` path. Before you document one, run `command -v <tool>` in a plain shell. The batch scanner checks every backticked command this way.
