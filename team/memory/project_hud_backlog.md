---
name: project-hud-backlog
description: "Where the remaining Bob HUD work lives, and which nine issues actually matter"
metadata:
  node_type: memory
  type: project
  originSessionId: d1a34ef8-4894-48a4-8962-3d029eb9b7ac
  modified: 2026-09-06T04:17:07.648Z
---

The display (Bob HUD, in `calebnewtonusc/bob-the-builder` under `hud/`) was
audited on 2026-09-05 into a thousand specific shortcomings. Forty-four are
fixed and struck through in `hud/docs/1000-WAYS-IT-FALLS-SHORT.md`. The rest is
filed as **38 issues in `bd`** at `~/code/archive/2026-code-root/.beads`, with a durable
copy committed at `hud/docs/BACKLOG.md` because that beads repo has no git
remote and lives on one disk.

**The nine P1s are the ones that decide whether it is trustworthy rather than
impressive:** whether VoiceOver can reach the overlay at all, keyboard access,
not covering the thing it is describing, anchoring marks to content instead of
screen coordinates, surface ownership so any local process cannot impersonate
it, safe file editing, detecting a screen share, and UI tests that drive the
real app.

Seven of the thousand are marked deliberate and are not in the backlog. Item
999 cannot be fixed by code: nobody but Caleb has used it.

Start with `bd ready`. See [[project_chewbacca]] for how the display is reached
from a session, and [[project_bob_the_builder]] for the generative UI library
underneath it.
