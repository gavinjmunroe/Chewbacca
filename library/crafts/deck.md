# Deck

Researched 2026-10-03 from Frontend Slides (zarazhangrui/frontend-slides, MIT,
`9906a34`, `SKILL.md` and `viewport-base.css`), a single-file HTML deck skill.
Three rules taken. Its presets, templates and deploy script were left out.

**Ask first: is this a reading deck or a speaking deck?** The answer sets the
density of every slide, so it comes before any design.

| Mode | For | Slides |
| --- | --- | --- |
| Speaker-led, low density | talks, keynotes, live walkthroughs | one idea per slide, large type, 1 to 3 bullets, more slides if needed |
| Reading-first, high density | reports, handouts, async review | self-contained slides, grids, tables and annotations, 4 to 8 bullets or 4 to 6 cards |

Either way: no scrolling, no overflow, no overlapping panels, no text below
comfortable reading size. "If content exceeds the selected density mode, split
it into more slides instead of shrinking until it becomes cramped."

**Author every slide on a fixed 1920x1080 stage, then scale the stage.** The
stage scales uniformly to fit the window and may letterbox. It never re-lays
out: no responsive breakpoints rearranging slide content for phones, and fixed
measurements inside the stage. `clamp()` is for UI outside the stage only.
Switch slides with `visibility`, `opacity` and `pointer-events`, never
`display: none`, because a later `display: flex` on a layout class overrides it
and every slide shows at once. Support `prefers-reduced-motion`.

**No process labels on a slide.** The slide shows the deck, not how it was
made:

- No workflow text: `preview`, `generated from`, `template`, `preset`,
  `style option`, `Option A/B/C`, file names, paths or source-doc labels.
- No template or style names. Those belong in the message to the user.
- No requirement notes as content ("sharp and provocative", "safe option",
  "audience: ..."), unless the user wants that exact phrase on the slide.
- Chrome is real deck chrome only: deck title, section, date, author, company,
  page number, or a phrase from the user's own material.
- Read every slide's visible text before opening it, and revise if any
  internal metadata shows.

**Never publish it.** Frontend Slides' `deploy.sh` puts the deck on a public
Vercel URL, which breaks confidentiality for anything client-side or Amber.
Hand over the HTML file, or a PDF printed from the stage with real text
(Playwright `page.pdf()`), not a raster export.
