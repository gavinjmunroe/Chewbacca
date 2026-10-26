---
name: cinematic-scroll
description: "Build a site as one continuous scroll take: rendered 3D scenes that hand off as the same object, live content mapped into renders, a low poly preview before any final render, and seam checks after every change. Use for a film, portfolio or story site that should feel like a movie."
triggers: >-
  Use when the ask is a site that should feel like a film or one continuous take, a portfolio for a filmmaker, photographer or artist, a scroll scene, scroll-driven 3D, a section that should "transition into" the next, or when someone says a site looks like a slideshow, a PDF, HTML/CSS, a video game or "claude slop". Learned on the Parker Manley site, 2026-10-23 to 10-26, about 9 hours and roughly 130 corrections.
---

# Cinematic scroll

A cinematic site is one take. Every section ends on the frame the next one
starts on, and every object on screen reads as a real thing. Most of the 9
hours on the Parker site went to five failures that kept coming back, and this
skill exists so they don't come back again.

## The bar, from the person who judged it

Check every section against these before showing it:

1. **Nothing that could have been a slideshow.** A section is a thing
   happening: a film playing, a camera rolling, an edit session. It is never
   cards that swap. `site-gate` refuses pinned scenes that hold still and swap.
2. **Real objects, not HTML/CSS.** The verdicts were "looks like a pdf",
   "made in 2004", "video game" and "claude slop". Render the object in
   Nalana/Blender (see the `nalana` skill) and map live content into it.
3. **Transitions are motivated, and they keep the same object.** "it should be
   the same object, not the same image showing up out of nowhere with a diff
   size and position." No iris circles, no unintentional gradients, lines or
   rectangles.
4. **A real tool in the scene is copied exactly and named as itself**:
   Premiere Pro, Chrome, the macOS Dock, Netflix, Instagram. Copy the
   signature details, and make it iconic, not a sterile replica.
5. **Each piece of content appears once**, except in a library view.
6. **Cues are obvious but not forced.** The way on from the Mac was the
   Dock's own attention bounce, not an arrow saying "scroll".

7. **Every film on screen is one click from watching it**, including the one
   playing on a monitor or a theater screen inside a render.
8. **Nothing shows up unmotivated.** That covers a header that slides in, a
   scene visible for a split second before the opening frame paints, and an
   intro that scales down for no story reason. First paint is the opening
   frame. Decide the leader or opening state in an inline head script.
9. **Sound is part of the take.** Music fades in and out over about 2 s with
   the scroll, both ways, and an outro song carries through everything that
   belongs to the ending. Camera and UI effects stay quiet.

## Order of work

1. Write `SPEC.md` from every message the client sent. Extract them from the
   transcript, including mid-turn messages, which are stored as
   `"type": "attachment"`. Each item stays on the list until they cut it.
2. Ask the questions that change renders, then ship a **low poly preview**
   of the whole take with draft renders, each tagged. Final renders wait until
   the client has scrolled it and their own client has signed off. On the
   Parker site, hours of renders were queued for scenes that then got
   redesigned.
3. Mark unfinished parts on the page with a red frame and a line saying what
   they will become, so the reviewer sees the plan, not a gap.
4. Build each scene with the method below, then run the checks.

## Method that held up

- **Render with the screen left empty, and export its quad.** For every screen,
  monitor, paper or sign, render the prop with that region blank and export
  the region's four corners as JSON. On the page, map the live content (a
  video, a HUD, text) into the quad with a `matrix3d` homography. Glass
  reflections go on top. Never lay a flat image over a render.
- **A hand-off moves the camera, not the picture.** To enter a monitor, scale
  the rig, its glass and the mapped picture together about the screen's center
  until the screen covers the window, in log space so it reads as a dolly.
  Settle the quad onto the exact full frame in the last 20%, and fade the
  bezel to whatever the next scene opens on.
- **Overlap consecutive sections by exactly one window, measured in JS.** Set
  the next section's margin-top to `prevBottom - innerHeight - naturalTop`,
  and keep its pinned layer hidden until it is pinned.
- **Frame sequences on a canvas.** Draw only when the frame index changes. A
  full-window repaint on every scroll event made credits stutter.

## Layout traps that each cost a round

- A generic `section { padding }` boxes full-bleed scenes in, so the previous
  scene shows in strips. Zero the padding on every pinned scene.
- Raising one section's `z-index` raises it over every neighbor. The Mac went
  over the credits and over the edit bay. Rerun the seam walk after any
  z-index change.
- A transparent section laid over another eats its clicks. Give it
  `pointer-events: none` and turn them back on for the window inside it.
- A sticky pin can't get its room from a last child's bottom margin, because
  the margin collapses out of the parent. Use a spacer element.
- When a new render lands, every live layer mapped onto it moves with it.
  A new desk draft enlarged the headshot and the printed call sheet text sat
  on his face. Lay live text out from the render's exported object boxes,
  never from fixed percentages, and rerun the seam walk after swapping in any
  render.
- A wheel turn or touchmove is not user activation, so audio can't start
  from it. An intro that plays on scroll (Parker's ticket, 2026-10-26) runs
  silent until a click or key. Start sound from the first click, or say so.
- A page inside a scene (a fake browser tab) needs `overscroll-behavior:
  contain`, or the wheel leaks out and moves the scene behind it with
  nothing visible changing. That reads as "the scrolling seems off".
- `overflow-x: auto` on a row clips hover cards vertically. Pad the row and
  pay the padding back with a negative margin.

## While renders run

Say what's rendering, its frame count, the per-frame time you measured and an
ETA, before anyone asks. "What's rendering again?" and "Roughly how much
longer?" both got asked. Pause heavy renders while the person is using the
Mac.

## Checks after every change

```bash
python3 ~/code/chewbacca/skills/cinematic-scroll/scripts/full_bleed.py <url> ".pin-a,.pin-b"
python3 ~/code/chewbacca/skills/cinematic-scroll/scripts/walk_seams.py <url> ".scene-a:0,.scene-a:0.99,.scene-b:0" seams.png
```

Then walk the whole site as each person who'll see it (for Parker that was a
crew lead, an SCA professor and a friend on a phone), the way Caleb asked:
"brute force put yourself in the pov of everyone who will see it".

The first script fails if a pinned layer doesn't fill the window. The second shoots a
frame just before and after each listed scroll point at 1000x506 (Caleb's
window) and writes one sheet. Look at the sheet. A diff can't prove a seam.

When a Playwright run times out, kill its browsers (`pkill -f ms-playwright`).
Leftovers ran at 80% CPU each and made the site feel laggy.
