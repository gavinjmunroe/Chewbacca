---
name: feedback_design_gate_ff_wordmark_false_collision
description: design-gate flags the FF Wordmark svg against its own TECHNOLOGIES text as a 78% collision; it is one element, not a broken page
metadata:
  type: feedback
---

On 2026-10-29 design-gate refused https://firm-foundation.up.railway.app/watch twice with "svg.w-auto block h-7 collides with text.fill-current font-mono over 78%" at y=304 and y=381. The captures show the footer lockup rendering cleanly: the `<text>` is the TECHNOLOGIES line inside the Wordmark's own `<svg>` (site/components/Wordmark.tsx), so the gate compares a child with its parent. The LOUD ink readings on the same page come from the hero video's frames.

**Why:** the gate's collision check doesn't skip descendants of an svg, so any lockup that draws text inside its svg reads as a collision.

**How to apply:** on an FF page, look at the capture before "fixing" this collision; if it is the Wordmark, it is a gate false positive. The fix belongs in the gate (skip svg descendants), not in the lockup.
