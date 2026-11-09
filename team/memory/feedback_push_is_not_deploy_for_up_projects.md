---
name: feedback_push_is_not_deploy_for_up_projects
description: Railway projects first deployed with `railway up` (anchored, bio-midterm2, learn-what-i-build) do NOT redeploy on git push; after pushing, run railway up from the linked dir and read the live URL back
metadata:
  type: feedback
---

Some of Caleb's Railway services are GitHub-connected and deploy on push ([[feedback_railway_autodeploy]]). Others were created with `railway up` and have no repo source, so a push changes nothing live.

**Why:** 2026-10-26 overnight, the Anchored phone-scroll fix and the BISC Midterm 2 Ch 9 to 11 drills were both pushed and called done, and both live sites still served the old build (anchored hero 2.6 screens on a phone instead of 1.6; bio-midterm2 header unchanged after 3 minutes). `railway deployment list` showed the last deploy was the 10/24 `railway up`.

**How to apply:** after a push, check `railway deployment list` in the linked dir. If the newest deploy predates the push, run `railway up --detach`, wait for SUCCESS, then fetch the live URL and grep for a string the change added. "Pushed" is never "live" until that grep hits. Related: [[feedback_prove_it_on_prod]], [[feedback_morning_done_means_seen_live]].
