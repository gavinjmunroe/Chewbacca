---
name: project_sabo_design_partner_2026_10_16
description: Sabo (Aucta, Rawdawg Run Club) became Chewbacca's first creator-manager design partner on 2026-10-16; the live Clay chain that convinced him
metadata:
  type: project
---

Sabo (Sabastian Garcia) manages fitness creators (Noah Rolette, Rawdawg Run Club) and pitches brands by email. On the 2026-10-16 call with Gav and Caleb he agreed to be a design partner. There's a weekly sync on Tuesdays at 3:45 Central, and he'll send his creator list. The deliverable is a brand list per creator, each brand with the person who pays creators and a verified email, spending brands first.

The proof that landed: Clay found nobody at barebells.com or nocco.com, so we searched the parent, vitaminwell.com, and found Scout Brown. She turned out to be his own contact, worth about $10K a year to him. Finding her cold is what made him believe the system.

The live chain is `live_chain.py` in Caleb's Sabo folder. It runs one brand through the Clay table with no UI: add-rows, Clay people search, a Jev buyer pick, Findymail, then ZeroBounce. That's about 1.1 credits and 20 to 40 s a brand. Since later on 10/16 the chain falls back to the parent domain automatically, ranks candidates with Jev, retries the runner-up when an email is invalid, missing or at another company, and writes a "Why this person" column. See [[reference_clay_people_search_finds_buyers]]. Open gaps: view sort and hide have no endpoint, and launch-guard blocks jev-browse near Clay.

Gav's ruling after the call: stay on Clay, install nothing for the client, get paid first. Gav leads sales calls. Pricing is unsettled; a percent of deals was floated.

**2026-10-23:** Caleb's login now gets a 403 on BMA's workspace 1149025, which holds the Sabo table, so live_chain, Findymail and ZeroBounce can't run. That fits BMA separating from Amber on 10/19. The 300-credit Sabo allowance also ran out on 10/20. New emails need restored access or a workspace of our own, plus a new allowance. Reformed's real domain is feelreformed.com, not drinkreformed.com. The 10/27 file is in Caleb's Downloads as "Sabo 10-27 brands.md".
