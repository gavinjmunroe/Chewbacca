# presence

Agent-neutral copy of CLAUDE.md. Same content; edit both.

Making Chewbacca ambient: an agent that notices and surfaces things unprompted,
instead of one that only answers when typed at.

## Read in this order

1. [docs/PHASE-0-AUDIT.md](docs/PHASE-0-AUDIT.md). What is actually on the
   machine, verified. Includes three corrections to the assumed inventory
2. [crafts/ambient-agent.md](crafts/ambient-agent.md), eighteen rules with a
   source next to each. **Read before changing anything that interrupts**
3. [docs/PHASE-2-GAP.md](docs/PHASE-2-GAP.md). The distance, ranked by
   impact over effort, with the math shown
4. [docs/PHASE-3-ARCHITECTURE.md](docs/PHASE-3-ARCHITECTURE.md)
5. [docs/PHASE-4-ROADMAP.md](docs/PHASE-4-ROADMAP.md)
6. [skills/presence/SKILL.md](skills/presence/SKILL.md)

## The finding that reframed the work

The diagnosis going in was "everything in the kit is PULL." That is right about
behavior and wrong about cause. **The proactive engine was already built.**
`bin/hud-watch` in the chewbacca repo implements dedup, worst-only selection, a
per-hour cap persisted across restarts, an escalation gate and self-expiry. It
had never been scheduled. The single remembered finding in its state file was
from a manual run fifteen days earlier.

The gap was mostly wiring, not construction.

## The governing constraint

Two surfaces per hour. The budget governs, not the finding. This comes from
Mark, Gudith and Klocke (CHI 2008), who found that same-context interruptions
cost as much as unrelated ones, so relevance cannot be used to justify one
more.

## Status

Stage 1 shipped 2026-09-20 and verified on screen. Stages 2 to 5 in the
roadmap. Stage 5 (speech) is conditional and may be cancelled rather than
shipped, on purpose.
