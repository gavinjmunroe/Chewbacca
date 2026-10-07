---
name: interface
description: "Build any interface by loading a preset instead of re-deriving one: dashboards, tables, forms, detail views, settings, wizards, feeds, HUD panels, landing pages. Use when asked to build, show, visualize, lay out or mock up a screen, dashboard, chart, UI or app, when the user wants to see data rather than be told it, and before generating any UI from a data source. Also fires on: looks bad, looks generic, ai slop, slop, ugly, redesign, restyle, make it look, landing page, hero section, component, layout, typography, spacing, visual design."
---

# Interface

Build it by loading, not by inventing.

The problem this exists for, in Caleb's words: **"right now it's laggy because
it's needed to every time recalibrate how to make something."** The cost of
generating a UI is not rendering. It is the model re-deciding, per request,
what a dashboard is, what spacing to use, what a good table looks like and
where the data comes from. All four of those are written down here, once.

## The order, every time

1. **Name the template.** `references/taxonomy.md` has ten. The request is
   almost always one of them, and the one most people mean is Dashboard.
2. **Name the organisms it holds**, from the same file. Stop here if you are
   about to invent a component that already has a name.
3. **Find the data** in `references/data-loaders.md`, and when it is not there
   use `references/discover-data.md` to go find it, appending what you learn
   back into the loaders file so the next session does not repeat the search.
4. **Apply the system**, from [library/crafts/interface.md](../../library/crafts/interface.md):
   grayscale first, the constrained scale, hierarchy by size and weight and
   color, too much whitespace then remove, details last.
5. **Build the three states.** Loading, empty, error. This is the step that
   gets skipped, because the prompt only ever describes the happy path.

6. **Verify the rendered result.** Use the project's existing capture tools,
   then inspect desktop, narrow, reduced-motion, and transition frames. When
   ux-engine is available, run `design-gate <url> --shots 8`; treat capture
   failure as unverified, and inspect reported defects before delivery. Keep
   quality judgments separate from source lint and descriptive motion metrics.
   For a continuous morph, verify element identity through the transition,
   including reverse scroll. An opacity sum of one does not prevent collisions.
   Refresh the actual preview the user is viewing before claiming a fix. Test
   its current viewport too; a desktop screenshot does not prove that a narrow
   rule preserved the figures or controls the user cares about.

   For a narrative page, review the whole journey before polishing individual
   sections. At each handoff, name what persists, what changes, and what the
   change tells the viewer. Reference studies must produce a concrete change
   to this journey. Inspect adjacent frames before calling an effect a morph:
   a prepared match cut can carry continuity too. Do not equate creative motion
   with complexity, prohibit all cuts, or use motion metrics as taste scores.
   Study scroll references between endpoints in both directions. Record the
   order of detail removal, resizing, rotation, relocation, and reveal before
   reducing them to an interpolation. Check held-scroll behavior separately
   so timed loops are not mistaken for scroll-driven transitions.

7. **For a website, run `site-gate check <every page url>` and get exit 0.**
   It refuses console errors, horizontal scroll at 390, dead links, controls
   with no hover or focus state, and loops that run under reduced motion.
   Then `site-gate idle <url>` and confirm the ambient layer you planned is
   moving. The four layers a site needs (layout, choreography, ambience,
   response) are in [library/crafts/website.md](../../library/crafts/website.md); read it
   before building, because three of the four never show in a screenshot.

Steps 1 to 3 are lookups and should cost almost nothing. That is the point.

## Pick the stance from the reader, not from taste

On 2026-09-27 Amber Circles passed ux-lint, axe, layout-check and design-gate
in the editorial stance (serif display, one gold italic phrase, an uppercase
kicker over every heading, outline buttons) and Caleb called it AI slop. It
was: that look is now the median "tasteful" generated page, and every gate
scores the absence of the old tells, not this one.

The fix that landed was choosing the stance from who reads it. The users were
older people opening links from texts, so it became signage (ux-engine
`material`) in Atkinson Hyperlegible, the Braille Institute's face for low
vision. Two rules came out of it:

- **Give the accent exactly one meaning** ("you can tap this") and write a
  test that fails when it fills anything else. The first signage landing had
  four amber things above the fold and design-gate read it LOUD at ink 0.52.
- **Show the content as itself.** The text a group actually receives, each
  tool as a live thumbnail the way Docs shows pages, faces instead of counts.
  A description of the product is the generated move.

## One theme, never re-chosen

Caleb: "keep it the same theme." Tokens are defined once per surface and
referenced everywhere. A generator that picks a fresh accent color per artifact
produces a pile of demos rather than a product, and the tell is obvious the
moment two of them sit side by side.

## Where the thing renders

| Surface         | Use                                       | Reach it with                              |
| --------------- | ----------------------------------------- | ------------------------------------------ |
| **HUD**         | Ambient, live, over other apps, no window | `hud` and the `hud` skill                  |
| **Local page**  | Something to click through or keep open   | an HTML file, opened                       |
| **In the repo** | Part of a product being built             | the project's own stack, per `stack-rules` |

Pick the surface before the layout. An overlay HUD and a settings page are
different templates, and building the second one into the first is the common
mistake.

## Reference files

- [references/taxonomy.md](references/taxonomy.md): every component and
  template, named, grouped by the job it does. Read at steps 1 and 2.
- [references/data-loaders.md](references/data-loaders.md): every data source
  already reachable on this machine, and the four shapes any new one arrives
  in. Read at step 3.
- [references/discover-data.md](references/discover-data.md): the procedure for
  a source nothing covers yet, cheapest method first, ending in pixels only as
  a last resort. Read when step 3 misses.
- [library/crafts/interface.md](../../library/crafts/interface.md): the researched rules, from
  Refactoring UI and Atomic Design. Read at step 4.

## Ask what it is made of before drawing it

Caleb, 2026-10-07, on the same fridge: "Make sure pencil and pen look like
pencil and pen, and make sure based on the surface they are on they actually
look like that surface. Whenever you make smth, ask the questions that will
lead you to concluding things like this."

Before making any object that stands in for a real one, answer these, and let
the answers set the rendering:

- What made the mark? Ballpoint is thin, even, a little gloopy where a stroke
  starts, and skips. Pencil is grey graphite that catches only the tops of the
  paper grain and shines slightly. A Sharpie is flat black and bleeds on
  paper but not on plastic. Crayon is waxy and leaves the grain showing.
- What is it on? Notebook paper takes ink, a sticky note is thin and slightly
  translucent, a polaroid border is smooth and slick, coated cardstock makes a
  ballpoint skip.
- Who made it, and in what hurry? A grocery list is fast and slanting. A card
  for a wedding is slow. A kid presses hard.
- How old is it, and what has happened to it since? Sun fade, a fold, tape
  that yellowed, a magnet that has been moved twice.
- How is it lit, and does its shadow agree with the room it sits in?

An answer nobody wrote down is a default, and defaults are what read as made
by a machine.

## Handwriting is never perfect

A handwriting font set straight onto a page repeats the same "e" every time,
sits exactly on the ruling, and reads as generated at a glance. Caleb, on the
Amber fridge notes, 2026-10-06: "The handwriting is too perfect bruh" and then
"Never make perfect handwriting." Draw it glyph by glyph instead: its own
rotation, size, ink density and pressure for each letter, a baseline that
wanders as a smooth random walk rather than per-letter noise, a slight blur
for ink bleed, and lines that start at different indents. The working
implementation is `scrawl()` in `amber-website/scratch-render/make_items.py`.

## The hard line

**Never invent a component that has a name in the taxonomy.** A bespoke variant
of a table is the recalibration this skill exists to prevent, it will not match
the next one generated, and nobody asked for it.
