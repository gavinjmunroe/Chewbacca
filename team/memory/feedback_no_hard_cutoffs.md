---
name: feedback_no_hard_cutoffs
description: Never place a bright-edged photo on a dark section; cut the subject out or use an asset with its own dark edge; site-gate check fails it
metadata:
  type: feedback
---

No image on a site may draw a hard line round itself: a bright-edged picture
(a product photo on a white wall, a screenshot) on a dark section, or the same
picture squeezed into a soft radial mask. Cut the subject out, use an asset
whose edge is already dark, or feather it into the ground. `site-gate check`
fails a bright edge (inner ring over 0.5 luminance) on a dark ground (under 0.18).

**Why:** 2026-10-10, Erik Fish's Turtle Island mockup sat on a light wall and was
masked into an oval over a near-black section. Caleb: "Fix chewb to NEVER have
ugly hard cutoffs!!!!!!" The fix flattened the front cover out of the photo with
a perspective warp and showed it as a real book with a shadow.

**How to apply:** before placing any photo on a dark ground, look at its edge
pixels; then run `site-gate check`. Related: [[feedback_no_walls_of_text]],
[[feedback_website_four_layers]].
