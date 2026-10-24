---
name: feedback_reference_video_is_a_spec
description: A screen recording handed over for a site scene is the visual spec to rebuild in HTML, never an asset to embed; scroll scenes pin and are judged on the live deploy
metadata:
  type: feedback
---

When the user drops a screen recording (WhatsApp, an app, a HUD) into a pitch
or site build, it is the reference for an exact HTML/CSS replica driven by
scroll. Never embed the video and never commit it. A scroll scene pins its
stage (`position: sticky` inside a tall track) so scrolling plays the scene
in place, and it is checked on the live URL, not a local server.

**Why:** 2026-10-24, Anchored pitch at the FaithTech hackathon. Caleb: "Whatsapp
shouldn't be a video it should be scroll activated. The video was just to give
context of an exact replica of what whatsapp looks like." Then on the Mac HUD
scene: "there's no freeze, so it doesn't rlly give a scroll to show a scene
effect." The live site and the local dev server on 3019 were both serving an
older build, so what he saw was not the latest commit; Railway on that project
is not GitHub-linked and needs `railway up` per update.

**How to apply:** leave the reference mp4 untracked; build the scene as markup
that matches it; give every scroll scene a tall `.run` section and a sticky
`.stage`; before judging a scene, confirm the deploy that contains the commit
reports SUCCESS, then scroll the live page and measure that the stage top stays
at 0 across the run. The scene's main overlay (the HUD card) is the hero of
each beat, not a corner box. Related: [[feedback_pitch_site_not_pdf]],
[[feedback_morning_done_means_seen_live]].
