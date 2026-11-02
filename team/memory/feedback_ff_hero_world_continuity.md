---
name: feedback_ff_hero_world_continuity
description: FF home hero: the world never ends on screen, and every element changes by a physical process
type: feedback
---

The Firm Foundation home hero (site/lib/motion/heroScene.ts) is judged on continuity. Caleb rejected each of these on 2026-11-01:

- **Edges:** a terrain or wave that stops on screen ("a rectangle of dots", "firm lines/corners", "no wave is just X amount long"). The ground is one hill whose foot is below every edge. The wave's crest runs off both edges with the whole sea behind it. Sample stipple across and past the screen, and thin it with distance rather than cutting it.
- **Swaps:** anything that appears, fades or prints in place of a process. That includes debris floating in the air, a rock rising as a cylinder, cracks popping in, and a church fading as a translucent sheet. What he accepted was a chain: the flood carries the parts, the water drains, they settle flat on the floor, then the rock forms under them and pushes them up. The church gets torn where the wave reaches it.
- **Floating:** drop shadows make the slab float. A lip of rock rising over part of the bottom course, on a canvas above the SVG, seats it.

**How to apply:**
- Before a hero round, list every element's entrance and exit. Each one must be a process with a physical cause.
- Capture the exact beats at fine scroll steps, 0.004 apart through the wave. Coarse steps missed a wave that crossed in a sixth of a screen.
- When a helper edits the same Next app, its HMR reloads break Playwright captures. Wait for the selector before every scroll, and read the browser console first when the scene is missing. `tsc --noEmit` passed while a shadowed `out` variable crashed `buildSand` at runtime.

**Added 2026-11-01, 6:24pm round:**
- A canvas inside a container that slides (`.hs-rise` starts 22vw right) shows its own edge as a straight line through the stipple. Size the canvas past the slide's travel and offset the drawing to match.
- Extend the "nothing ends on screen" rule to the rock: the plateau and its slopes must run past both sides, and the floor the flood drains to must sit on screen. A floor below the frame made the pile "disappear".
- Water reads as water when it moves along a current: streaks along the flow, advected and wrapped, with swell bands. Still points read as stars.
