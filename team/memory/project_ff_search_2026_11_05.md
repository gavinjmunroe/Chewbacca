---
name: project_ff_search_2026_11_05
description: Firm Foundation's Google state and search plan on 11/5; team@ owns Search Console, /audit requested for indexing, keyword volumes and the study idea
metadata:
  type: project
---

firmfoundation.tech launched to search 11/2. Search Console's domain property is owned by team@firmfoundation.tech; caleb@ has no access. The sitemap was read 11/4 with 6 pages. On 11/5, /audit was "Discovered, currently not indexed", so indexing was requested for it. Its title now says "Free church website audit" (7bb93b6), and IndexNow accepted all 6 pages (202).

US volumes from DataForSEO, 11/5: church website builder 1,000, church website design 590, best church websites 590, ai for churches 480 (about 1,300 a month June to Sept, competition index 2), church website examples 210, church website design company 70, church website audit 10.

**Why:** A US desktop check on 11/5 did not show us in the 9 results returned for "firm foundation tech" or the top 28 for "firm foundation church websites". Songs, sermons and other companies hold those. /watch ranked 2 in the 2 organic results parsed for "firm foundation tech church website".

**How to apply:** Check Search Console under authuser=team@firmfoundation.tech before calling something unindexed. Inbound links are the next brand-search lever. The unused asset is our 1,297 church audit, a study nobody else can publish; any public number needs its source and weakness per the repo's CLAUDE.md. Related: [[project_firm_foundation_site]], [[reference_ff_site_deploys_railway]].

**Update 11/5 9:45am PT.** The study is live at /research/church-websites (965793f): 146 sites coded by AI reviewers, CSV and codebook public, lib/study.test.ts recomputes every number. No person had checked the codes at launch; the sheet is ~/Downloads/FF study spot check.md. Private captures are in ~/code/ff-reaudit-1103/study. The script over-reads stale content (agreed with reviewers 66%) and hid first-screen times on 488 of 1,042 sites, so don't quote script rates publicly.

**Update 11/5 2:50pm PT.** The study now reads all 1,041 sites, with 1,023 counted (c4eb313). Key numbers: 92% show a time on the home page, 36% on the first screen, 13% an address on the first screen, 40% a first-time button, 11% a way to say you're coming, 3 answer all five, 637 answer none. The 0 of 146 line is dead. Still no human check of the codes. Pitches are in ~/Downloads/FF study pitches.md, unsent.

**Update 11/5 4:40pm PT.** Live at 2941bd2: a self-score check on /research/church-websites that sends nothing off the page, and a share image built from the CSV. The story's rule is that no beat lights over half the town (lib/study.test.ts). Pitches are drafts only while Caleb's hold on texts and emails stands. Next ideas not built: each church's own row as an outbound line, and a timed test with real people, which is the real gap in the argument.

**Update 11/5 6:15pm PT, Google listings.** Pulled logged out for all 1,041 sites, of 1,023 counted: 1,006 have a listing and 998 show a street address, so the address beat and any address hook are weak, a guest can get it from Google. Sunday hours are much less reliable: 201 have no hours, 75 show closed on Sunday, and of 686 comparable to the service times the audit script found, 347 open at a service time, 287 before the first one, 52 after it. That comparison leans on script-read times. Speed test is paused by the job queue while the Mac's in use, 20 of 1,041 done, too few to quote. Data: ~/code/ff-reaudit-1103/study/listings.jsonl.

**Correction 11/5 6:30pm PT.** Caleb caught that Adventists are closed on Sunday because they worship Saturday. After moving 26 Saturday churches and 2 non-church listings out, of 1,023: 60 listings say closed on Sunday (was 75), and 208 show no hours including sites with no listing (was 218, and the 201 quoted earlier left out the no-listing sites). 347 start at a service time. Any church count by weekday has to separate Saturday worship.
