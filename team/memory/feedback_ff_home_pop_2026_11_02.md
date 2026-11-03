---
name: feedback_ff_home_pop_2026_11_02
description: Firm Foundation home page (firmfoundation.tech) has to stand out next to church site builders; flat paper everywhere read "pdf-like 1 dimensional", and big generated shapes read as slop
metadata:
  type: feedback
---

The Firm Foundation home page (site/ in calebnewtonusc/firm-foundation) is judged against
church site builders like thechurchco.com/portfolio, not against minimal design studios.
On 2026-11-02, after Gavin's simplify pass put every section on the same warm paper,
Caleb wrote "black text on dull background ... super pdf-like 1 dimensional", "we
literally dont stand out anymore bro" and "I want a pastor to go onto the site and think
this is pretty cool".

What he corrected that night, in order:

- Text and picture need different visual weight. Headline and pull quote go big and
  two-tone (royal or ice on the second half), the drawing stays a line drawing.
- No section sits on default paper without a reason. Each gets its own ground: the hero
  on the calm ice field, what we do on an ice gradient, work we've done on night, the team
  on the calm field with a royal glow, the close as one royal mesh block.
- Show the real work. Their live sites go in big browser frames (desktop captures in
  public/media/work), because "a simple pdf isnt gonna make them want to get a website
  from us".
- Decoration in the hero must be small, placed in open paper on purpose, and playable.
  Big canvas-drawn boxes were "so big so slop unintentionally placed". The old plate
  drawings (rose window, arch, cornerstone, dome), unframed at about 100px with one
  purpose label each, are the version he asked for: "similar vibe not just blocky tech bro".
- A break tag's leader must not cross the whole church. It sits under the break.
- Later the same night: a moving field reused in three sections was "spamming the wavy
  background". One technique per section, chosen by the section's job (site/HOME-POP-SPEC.md
  in the repo): motion in the hero, the product lit in what we do, photos on night for the
  work, faces on paper with the hero's sand for the team, the hero's cross for the close.
- Hero props drawn as stroked canvas hairlines read as "desmos", and as DOM drawings they
  read as "2d pasted on". Anything in the hero is drawn in the church's medium: paper faces
  in the slab tones, dotted edges, royal cubes. Six prop passes missed that night; the
  instruments are parked in heroScene.ts until there's a model to match first.
- The church's dots are drawn right after their own face (housePts.slot), so the near roof
  hides the wall's top and corner. Drawn after every face, they showed through the roof.

**Why:** a pastor decides in seconds whether two college founders can build something
better than their current site. A flat page gives them nothing to picture.

**How to apply:** before shipping a home page pass, look at it beside thechurchco.com and
ask whether a pastor would say "this is way better than our church's site". Gavin's
11/2 rules (no dark page, no rounded corners) were set aside on branch feat/hero-pop for
Caleb to settle with him. Related: [[feedback_ff_site_is_for_church_staff]],
[[feedback_ff_hero_not_lemma]].
