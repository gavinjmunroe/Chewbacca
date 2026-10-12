---
name: project_chewbacca_reengineer_2026_10
description: The Daniel/Cole reengineer of Chewbacca's insides, started 10/11; hookd (Rust gate) live on 13 guards, hook CPU per Bash call 5.5s to 2.6s, 16-step flat plan running overnight
metadata:
  type: project
---

Started 2026-10-11 at Caleb's ask to rebuild the kit's insides "the way Daniel Thomas would" (Rust's design philosophy, strangler pattern, never a big rewrite), with Cole Gawin's lens (measure agents in production, replay before you ship).

State after the night:
- crates/hookd: a zero-dependency Rust front door. A guard declares `# gate:` words and hands itself to ~/.local/bin/hookd on its first line, and a Bash call naming none of the words is skipped in under 1 ms. 13 guards are gated. Every verdict goes to ~/.chewbacca/logs/hookd.tsv.
- tools/hookd_replay.py replays a week of real transcripts. Parity gave 0 mismatches over 35k calls. `refusals` ranks guards by real refusals.
- tools/hook_bench.py measures every configured hook's CPU per tool call. A Bash call went from 5.5 s to 2.6 s. The live Pre write-log still runs the shared checkout's stale copy (1.55 s) until that checkout fast-forwards and setup reruns.
- Plans: docs/plans/reengineer-flat-plan.md (16 steps, each with its number), one-supervisor.md, send-approval.md, context-budget.md.
- The overnight chain at ~/.chewbacca/overnight/reengineer-chain.sh runs one headless session per step and appends to ~/.chewbacca/overnight/daniel-reengineer-report.md. Ledger source keys: reengineer-flat-2026-10-11-<n>.

**Why:** every agent action cost seconds of hook CPU across 8+ tabs, and processes ran on deleted kit snapshots.
**How to apply:** port to Rust only after a measurement shows the pain, and prove it with a replay. A guard's smarter reading only ever adds checks: [[feedback_guard_precise_path_never_judges_less]].
