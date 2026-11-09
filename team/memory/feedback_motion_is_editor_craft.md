---
name: feedback_motion_is_editor_craft
description: Web motion follows library/crafts/motion-film.md and reuses apps/ux-engine/motion/primitives/motion.ts; a hero of fade-ups, a "1 2 3" word sequence, unmotivated gradients, overlapping labels and props with no job kept shipping as slop until the editor craft was written down (10/31)
metadata:
  type: feedback
---

Website motion is judged as an edit, not as CSS. A hero kept shipping with fade-and-move entrances, a literal "1 2 3" word sequence, unmotivated gradients, labels overlapping and props with no purpose. Colin pointed Caleb at an editing reference (jayd3nfx, "Why Simple Edits LOOK So Much BETTER"), and Caleb asked for chewbs to learn all of it for every project. The rules, each sourced to that video, a second clip from Colin and FilmCraft's Rust source, are in `library/crafts/motion-film.md`. The tested, dependency-free code (range-selector text reveal, triple wheel, whip blur, FilmCraft's Bezier influence keyframes, lagged scroll follower, parallax depth, and the transitions mapped to scroll progress) is `apps/ux-engine/motion/primitives/motion.ts`.

**Why:** every slop tell on that hero came from generating motion per element with no editor's model behind it: everything moved, so nothing was the focal point, and new objects appeared instead of existing ones transforming.

**How to apply:** before animating any page, read motion-film.md and copy curves from motion.ts instead of writing new ones. One focal motion per moment, morph what is already on screen, tie every blur to a velocity, and run the slop tells list plus its six checks (including scrubbing every transition backward) before showing it. Related: [[project_ux_engine]].
