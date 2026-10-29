---
name: project_ff_team_page_2026_10_28
description: Firm Foundation /team page (PR #3), founders plus a board of advisors and Christian tech advisors; what's sourced, what's NEED, what's left before Gav merges
metadata:
  type: project
---

Firm Foundation's site got a /team page on 2026-10-28 (Caleb's ask: move the founders off /mission onto a new Team tab and add advisors). It's PR #3 on gavinjmunroe/firm-foundation, branch `feat/team-page`, worktree ~/code/wt-ff-team. Not merged. Gav merges, since Vercel only deploys his commits.

What's on it, in Caleb's order:

- Board of advisors: Andrew Laffoon (lead advisor, full-width card), Joel Newton, Jim Munroe, Erik Fish, Holly Dunlap
- Christian tech advisors: Duncan Inganji, Pastor Joe Hwang, Joel George, Luke Ren
- Copy lives in `team` in site/lib/content.ts, layout in site/components/Advisors.tsx, page at site/app/team/page.tsx

Sources for every bio line: Andrew (his LinkedIn About + Crunchbase: Mixbook 2006, #1 on Wirecutter, 23K five-star Trustpilot, Inc 30 Under 30, Forbes Most Promising CEOs Under 35, UC Berkeley), Joel Newton (Praxis + XR Must: co-founded The Virtual Reality Company, Jurassic World VR, CityLights, directed Tutankhamun: Enter the Tomb), Holly (LinkedIn + Crunchbase), Erik (erikfish.com), Luke (LinkedIn headline + MindFort's YC page), Duncan "Google" (Caleb's Contacts only).

Headshots: only Andrew (LinkedIn public og:image, 200px) and Joel Newton (his Praxis headshot) are real. The rest show royal-to-ice monograms. LinkedIn's voyager photo endpoint 302-looped and public pages 999'd, Instagram ops returned drift, and Contacts only had a flower for Joel.

Still open before merge:

- Every advisor says yes first. Andrew hadn't been called as of 10/28.
- NEED boxes: Jim Munroe (title + bio; a DFW "Director of Sales, Ashton and Associates" exists on LinkedIn but isn't confirmed as Gav's Jim), Duncan (bio), Pastor Joe (church + bio), Joel George (title, church, bio)
- Headshots from Jim, Erik, Holly, Duncan, Joe, Joel George, Luke
- Suggested adds Caleb hasn't answered: John Knox (Medrano, ex Gloo), Grandpa Stan (Crown Institute of Theology)
- Railway preview (firm-foundation.up.railway.app) had 3 builds queued at 11:06 and /team still 404'd; check `railway deployment list` from site/

Design calls Caleb made on it: "make it as useful as possible so they look at the page and think dang this is legit", descriptions for each person "ESPECIALLY Andrew Laffoon", real headshots ("stop being lazy"), and "don't make it a funeral pdf" (grayscale photos in hairline boxes were rejected; it's now the navy night band, full-colour photos, rounded cards, 2-column grid).

Also 10/28: D14 ("website first, then more" for the site demo) confirmed by Caleb in DECISIONS.md, 5729d7d. See [[project_firm_foundation_site]], [[project_firm_foundation_site_motion_split]].
