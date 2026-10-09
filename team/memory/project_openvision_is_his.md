---
name: project_openvision_is_his
description: Caleb already built browser hand tracking, eye tracking and a Doctor Strange portal in calebnewtonusc/OpenVision on 2026-09-04; check his other repos before building
metadata:
  type: project
---

`calebnewtonusc/OpenVision` is **his**, public, TypeScript, live at
`openvision.vercel.app`, last touched **2026-09-04**. It holds a documented
zero-dependency spatial toolkit: MediaPipe hand tracking (21 landmarks, 30fps+),
a gesture classifier with 151 lines of tests, a pinch detector with 130 lines of
tests, WebGazer eye tracking with 9-point calibration, dwell-to-click, glass
panels, an air keyboard, and a **Portal** mode of ~100 lines of Canvas 2D.

He sent the link on **2026-09-20 at 22:20** and again on **2026-09-21** with
*"Bro ru stupid and not listening?"*. Both times the session rebuilt hand
tracking from scratch in Swift instead of opening it.

**Why:** the portal is the exact "Doctor Strange portal" he had been asking for
all night, and it was already written, tested and deployed by him months
earlier. It reads 21 landmarks and draws, so anything producing landmarks drives
it unchanged.

**How to apply:** before building any capability for him, check his own GitHub
first. `gh repo list calebnewtonusc --limit 100`. He has been shipping for
years and the thing being specced is often already in one of his repos. This is
the tenth instance of a private note and the first where the
existing capability lived in a different repo of his.

The seam and the build order are written up at
`chewbacca/docs/SPATIAL-OS.md`. See also [[project_hud_voice_key_chain]].
