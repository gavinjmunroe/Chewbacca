---
name: feedback_tasteful_editorial_is_the_new_slop
description: Serif display with a gold italic phrase, uppercase kickers and outline buttons read as AI slop to Caleb on 2026-09-27; pick a stance from the audience, and give the accent one meaning.
metadata:
  type: feedback
---

On 2026-09-27 Caleb looked at Amber Circles in the ux-engine "editorial" stance
(Newsreader serif headline, one gold italic phrase, an uppercase tracked kicker
over every heading, thin outline buttons, flat grey page) and said: "TS so ai
slop bruh the font the italics the layout, everything bruh. Be more creative
and more of a designer!" It had passed ux-lint, axe, layout-check and
design-gate. Every check scored the absence of the OLD tells, and this look had
become the new median "tasteful" generated page.

What worked instead: choosing the stance from the audience, not from taste.
The users were older people opening links from texts, so the stance became
ux-engine "material" (printed signage) set in Atkinson Hyperlegible, which the
Braille Institute drew for low vision readers. Plus content-first objects: the
landing shows the actual text a group receives, the tools page shows each tool
live as Docs shows pages, faces instead of counts.

design-gate then flagged the first signage landing LOUD (ink 0.52): four amber
things above the fold. Fix was giving amber one meaning, "you can tap this",
and a deny test that fails if amber fills anything else.

**Why:** a passing gate proves nothing is broken, not that it is good. See
a private note and [[project_design_gate_structural_flaw]].

**How to apply:** before styling, name the reader and pick the stance that
tradition built for them. Never use a serif-plus-italic-accent headline or
uppercase kickers as the default "premium" move. Give the accent colour exactly
one meaning and enforce it with a test. Look at the render before claiming it.
Project: a private note.
