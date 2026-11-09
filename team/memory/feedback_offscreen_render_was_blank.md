---
name: feedback_offscreen_render_was_blank
description: Every HUD_LINES_FILE render of a panel taller than its cap was an empty card until 10/11; ImageRenderer draws a ScrollView as nothing, and the coverage check passed on the glass alone
metadata:
  type: feedback
---

On 2026-10-11 the agents card and the meetings panel both rendered offscreen as an empty glass card with a close button. The cause: a card taller than its cap swaps to a ScrollView (OverlayView.swift, ViewThatFits), and ImageRenderer draws AppKit-backed scrollers as nothing. SnapshotTests.linesFile only checked that 5% of the frame changed, which the glass itself satisfies, so every blank review passed.

**Why:** an instrument with no test of its own reports blank as fine ([[feedback_the_instrument_needs_a_test]]). Reviews of long panels were being judged from blank images.

**How to apply:** offscreen (`hudOffscreen`) the card now draws its plain layout clipped at the cap, top first, and `tallPanelRenders` diffs a card with words against the same card with none. NSViewRepresentables (the File editor, Web, a Field) still draw as empty or a stand-in offscreen: check those live, and look at every render before calling it reviewed. Related: [[feedback_hud_agents_build_on_realm]].
