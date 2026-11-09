---
name: feedback_linkedin_match_is_a_guess
description: A LinkedIn URL an agent matched to a lead is a guess until a person checks it; Dough holds 'picked' matches and headlines that name another firm before anything loads
metadata:
  type: feedback
---

A LinkedIn profile URL on a lead row is a guess unless the match was unique. On 2026-10-30 the 164-row Junto MSP list (ranks 201 to 501) had 138 URLs, and 9 of them were marked `picked`, meaning an agent chose one of several people with that name. Two of those were plainly the wrong person: the Fisch Solutions founder came back as a "Luxury Travel Advisor at JFisch Travel" and the Results Technology exec as an economics educator. Four more headlines named a different firm outright (ExcalTech's profile said "Managing Partner at McLachlan, Rissman & Doll"). A connection request to the wrong person under a founder's name is worse than no request.

**Why:** Dripify sends to whoever the URL points at, and nobody rereads 164 profiles before a load.

**How to apply:** `dough plan` now holds rows whose `linkedin_match` is in the client's `hold_linkedin_matches` (Junto: picked, ambiguous, none) and rows whose headline says "at X" or "@ X" for a firm that doesn't overlap the lead's company or domain. Held rows go to a review sheet (Junto: `~/Downloads/Junto/Junto held rows to check.csv`) for a person to confirm. Any list builder that writes LinkedIn URLs should write how sure it was in a column, so the gate can read it. Related: [[feedback_dough_is_the_built_engine]], [[project_dough_direction_2026_10_29]].
