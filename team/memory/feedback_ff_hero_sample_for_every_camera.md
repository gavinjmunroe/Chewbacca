---
name: feedback_ff_hero_sample_for_every_camera
description: FF hero stipple sampled in the straight-on camera's screen box shows that box's cull as a ruled diagonal once the camera turns; keep ground wherever any camera sees it
metadata:
  type: feedback
---

The Firm Foundation hero (site/lib/motion/heroScene.ts) samples its sand grains at the straight-on camera and used to cull them at that frame's bottom. The storm turns the camera 35 degrees, and then the screen's lower right looks at ground well past that cull: base y 1354 against a cull at 1000 at 1440 x 900. The cull showed as a straight diagonal through the stipple with bare paper under it. Caleb flagged it twice, the second time on 11/3 ("This diagnol hard cutoff is still there"). Fixed in 88be57b: the mound's `reach` keeps ground, full, wherever the straight-on or the turned camera can see it, then it thins over a fifth of a frame.

**Why:** a cull or sampling bound that's straight in one camera's screen space is a straight line in the world, and every other camera angle shows it.

**How to apply:**
- Before calling a scene's edges fixed, invert every camera the scene uses back to the ground plane and check the sampled region covers each screen corner (a debug global with cam, yaw and map, then the inverse of P(); see heroScene.test.ts's storm corner check).
- To find which field draws a stray edge, recolor one field at a time in a throwaway edit and capture; the sea, the crest and the grains all share one ink.
- A decoration SVG stretched with preserveAspectRatio="none" draws slivers on a phone. The home's SandFoot is a canvas at its box's pixel size for that reason (f3b8f9e).

Related: [[feedback_ff_hero_world_continuity]], [[feedback_hidden_pane_stale_scroll_frames]].
