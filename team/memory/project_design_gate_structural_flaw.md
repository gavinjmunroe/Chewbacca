---
name: project_design_gate_structural_flaw
description: The design system was entirely feed-forward; no hook read a rendered image, so a page passed every rule and shipped unreadable
metadata:
  type: project
---

2026-09-23. Caleb, after a screenshot of a hero rendered on top of the next
scene: "don't just fix the thing, analyze why that bad thing was possible to
exist in the first place given we have a dense design engineering system built
in."

**The audit, verified by grep rather than assumed:**

- NO hook in the kit reads a rendered image. Not one.
- `design-context.sh` INJECTS constants and gates nothing.
- `crafts/interface.md` has no verification step.
- the `interface` skill's five steps end at "build the three states".

Every generative rule had been followed: components from the taxonomy, tokens
consistent, ink in band, no stagger over 400ms. The page was still garbage.

**Why:** the whole design system is feed-forward. It can say what to do and has
no way to say what was done. `feedback_the_screenshot_beat_the_code` recorded
this exact lesson on 2026-09-21 and changed nothing, because a memory is prose
and prose does not fail CI.

**The fix:** `design-gate` exits 2, verified directly (not through a pipe, per
[[feedback_measure_exit_codes_directly]]). It refuses on illegible text,
box collision, pinned-and-clipped elements, and dead runs.

**The invariant pattern, which is the reusable part.** Each failure seen once
becomes an equation that fails loud. The first was scene presence: neighbouring
scenes satisfy `d_i + d_next = 1`, so their opacities must SUM TO 1. Two versions
were wrong in opposite directions (sum 1.5, then sum 2.0 across half of every
transition) and both read as correct until someone summed them. Now asserted over
400 positions at startup, throwing rather than degrading quietly.

Related: [[feedback_enforce_dont_document]], [[feedback_advisory_hooks_do_nothing]],
[[project_ux_math_layer]].
