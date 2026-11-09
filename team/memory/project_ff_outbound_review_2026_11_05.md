---
name: project_ff_outbound_review_2026_11_05
description: Firm Foundation's first outbound review with Caleb on 2026-11-05 ended with nothing sent; the copy he decided, what the review caught, and what must change before any send
metadata:
  type: project
---

Firm Foundation's cold email to churches was reviewed line by line with Caleb on 2026-11-05 and 0 church emails went out. He stopped sends at 4:23pm: "dont start FF outbound for now dont send texts or emails just draft them". After the church website study he said "We're def not ready for outbound lol this all changes everything." The FF site tab owns outbound from here.

**Copy he decided for SoCal email 1.** Names his church (Epicentre Church in Pasadena), which replaced "a Christian in LA", and no faith blurb. "Andrew Laffoon of Mixbook advises us": the ask to Andrew was name and Mixbook only, so no title. Chase Durkin's site stays, Popoff was cut for length, and Durango stays out until its site is live. No link, video, CC or BCC. Subject stays "your church website", with no "Tech" after the name. Inboxes that reach a pastor get "Want the full list? It's free, no call needed", and a first-name inbox gets its name. Office inboxes keep the pass-along ask.

**What the review caught, each on a line that had passed every gate.**
- Bible Baptist's streaming "404" looks false. The href is `https:///www.youtube.com/...`, a script resolved it onto their own domain, and browsers should repair it. Not tested in a real browser.
- Renew's "Our Story" 404 from the 11/3 audit answered 200 on 11/5.
- Peninsula's dead Google Maps text sat beside the address and phone, so "taps and gets nothing" oversold it. Caleb saw that by reading the page. Its Oct 31 banner, 5 days old, he called no big deal.
- The first batch was next-in-line rows, while the audit's worst finds sat unused: Victory Royal's raw slider code, First GMC's Visit button 404, Grace UMC's past-dates list. He asked, "Was the audit we did for nothing?"

**What changed in Dough** (calebnewtonusc/dough, main). With `line_proof: true` in a plan, `gtme batch` rechecks each first line live from `proof` in lines.json and a Jev skeptic reads the page around the claim, holding above 0.6. `dough show` prints page, proof and copy apart. `dough plan --max N` stops a held email pulling in an unread church. `copy_direct_inbox`, `direct_inbox` and `greeting` handle pastor inboxes. The skeptic is rough: it reads text and can't see layout, Legacy's true 404 read 0.42 and 0.72 on two excerpts, and Main Street's real date error read 0.63. `shrug_ok` records a person keeping a line.

**How to apply.** Choose from the worst sites first, and say what the problem costs a visitor without guilt. Eye check every line on the real page right before showing it, in a real browser for a dead link. Before any send: settle the pitch, replace "turn first-time guests into second visits" (nothing shows that outcome) and email 2's 688 and 100 line, then add proofs. DFW has line_proof off and no direct copy. 16 SoCal leads hold for no proof. Candidates: `~/Downloads/FF worst sites rechecked.md`. Related: [[feedback_ff_outbound_one_email_at_a_time]], [[feedback_stat_needs_felt_problem]], [[project_firm_foundation_outbound]].
