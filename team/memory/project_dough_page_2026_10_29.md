---
name: project_dough_page_2026_10_29
description: The Dough brand page is a dark proofing room where dough rises, bakes into a sourdough boule and gets cut; branch feat/dough-page in calebnewtonusc/dough, not deployed, cut clip needs a redo
metadata:
  type: project
---

The Dough page (asked 2026-10-29: "super ominous", the white-construct-in-the-Matrix feeling without anyone saying "they copied the Matrix", more aura than the Amber kitchen and Eigen pages) lives in `site/` of calebnewtonusc/dough on branch `feat/dough-page` (3f66a43). Not on main, not deployed.

The scene: pitch dark room, one warm downlight on a steel counter (rendered in Nalana, `site/nalana/render.py`), real tool logos dusted in flour around the center (Clay arch and wordmark, Apollo, HeyReach, Dripify, Smartlead, Instantly, lemlist, Attio, HubSpot, Salesforce, Google, Microsoft and more), four typed lines. The dough, the sourdough boule and the knife cut are photoreal footage from Gemini 3 Pro Image edits and Seedance 1 lite clips via treg, set into the room under a feathered mask (`site/gen/*.json` holds every prompt). Scroll raises the dough, an oven-heat flash turns it into the boule, the cut plays on its own past the line, and the page loops back to fresh dough.

Open: the cut clip has the blade's flat face to camera while the halves part left and right, which Caleb caught ("why would it split the opposite direction of the knife"). The corrected prompt is in `site/gen/clip-cut.json`; it needs about $0.36 of treg credit (balance was $0.0025) or Higgsfield credits. Deploy plan: Railway from GitHub with service root `site/`, the Dockerfile serves only `public/`.

Caleb's rulings this session: real logos exactly as shipped (the 3D Clay arch at its own angle, not a front-on redraw), photoreal over hand-built 3D ("IT HAS TO LOOK REALISTIC NOT LIKE A VIDEO GAME"), a sourdough loaf over plain bread. Lessons are in skills/nalana and skills/creative-video. Related: [[feedback_dough_is_the_built_engine]], [[project_dough_name_2026_10_28]].
