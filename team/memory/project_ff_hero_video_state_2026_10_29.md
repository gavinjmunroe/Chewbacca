---
name: project_ff_hero_video_state_2026_10_29
description: FF hero film is v29 at /watch (calebnewtonusc/firm-foundation 604eba3), with Caleb's 10/29 rules for its logos and photos and the one open item
metadata:
  type: project
---

Firm Foundation's hero film (video/ in calebnewtonusc/firm-foundation) is v29, live at firm-foundation.up.railway.app/watch as of 2026-10-29 (commit 604eba3, web copy 11,769,900 bytes, 34.7 s, -15.9 LUFS). Railway deploys the repo's main; the old gavinjmunroe repo and its Vercel Action are retired ([[feedback_ff_deploy_push_is_not_live]]).

What Caleb set on 10/29:
- Team beat logos: "add all the ones that increase our aura" and "remove anything that doesn't add much". 36 logos, every one tied to a person in site/lib/content.ts `team.groups[].people[].orgs`, plus FF's builds (Anchored, Silo U, A15 TTS helmet), ministries (UPPERROOM, ACTS, Praxis, Impact 360) and Gav's Veyra and Fleurs Et Sel. USC is out (he cut it the same day the emails dropped "USC student"); so are Zeutara, Amber, Beamlink, Cosasco and Echo. Each mark is cropped to fill its chip.
- Hallway: SUN stays the Everything Night cross shot; MON is Epicentre; TUE, WED and FRI are UPPERROOM (his photos, OK to show).
- End card: "Book a call" box under firmfoundation.tech. No "LLC" in the film; the LLC name goes in the site and email footers.

Open: two Epicentre photos (worship, tug of war) came mid-turn and never saved; they go on WED and FRI once he resends them ([[feedback_ff_video_ship_web_copy_only]]). Render with `--concurrency=2 --timeout=900000` ([[feedback_jobs_heavy_render_pauses_itself]]).
