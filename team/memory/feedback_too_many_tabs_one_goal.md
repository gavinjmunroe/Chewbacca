---
name: feedback_too_many_tabs_one_goal
description: Thirteen tabs all told "make chewb perfect" made it worse (load 33, duplicate answers, push races); the smart move is about four lanes, each owned by one tab
metadata:
  type: feedback
---

On 2026-10-10 around 10:45 Caleb had 13 agent tabs open on the Chewbacca repo, most of them given some form of "make chewb perfect". Measured in one tab: the 1-minute load was 27 to 33, a build job sat queued because the jobs runner had no room, pushes were rejected over and over on SHA256SUMS.txt and README counts, two tabs answered "is chewb intelligently engineered" at the same time, two worked GTM reply handling, and two worked brain recall.

**Why:** more tabs on one open-ended goal turns into overlap and coordination cost faster than it turns into output, and the Mac's capacity is shared ([[feedback_one_job_not_six]], [[feedback_high_load_reads_as_bugs]]).

**How to apply:** when he says "make it perfect" with many tabs live, read `tabs list` first and say whether this tab adds a lane or duplicates one. Recommend about four lanes, each owned by exactly one tab (on 10/10: GTM, HUD/voice, brain recall, sales readiness for Jake), and name which tabs to close. Only he can close them; never stop another tab's session yourself, because its in-flight work is lost. A tab whose lane is done says so and stops picking up new work.
