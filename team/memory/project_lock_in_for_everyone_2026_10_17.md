---
name: project_lock_in_for_everyone_2026_10_17
description: Caleb's direction 2026-10-17, the colin-kit lock-in pattern should be how Chewbacca makes every user lock in, not a one-off kit.
type: project
---

The lock-in pattern is the set of moves colin-kit (calebnewtonusc/colin-kit) runs
for a user with a deadline. Caleb, 2026-10-17, after it shipped: "The way we make
colin lock in I want chewbs to make everyone lock in".

The moves that make it work, all tested in colin-kit:

- Each session opens on ONE block: days left, today's block, its first question. Never a plan dump
- Open-loop dump before any creative work, sorted into today, this week and later, solving nothing (Masicampo and Baumeister 2011)
- Real capacity math against the hours the person has (`tools/capacity.sh`). Said out loud when the work doesn't fit, and the cut is the person's call
- Rough cuts with a nightly deadline that goes to a human coach, plus one thing they're unsure about. Nothing is polished before a set date
- Coach, never ghostwriter, on creative work that goes out under their name: questions, pushback, checks
- A life lane next to the deadline work, and a Sunday review
- A one-page handoff PDF, and a live `claude -p` test of the opener and the hard line

Not built yet: making this the default for any user, beyond hand-built kits.
