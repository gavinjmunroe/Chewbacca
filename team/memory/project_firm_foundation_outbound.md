---
name: project_firm_foundation_outbound
description: Firm Foundation's outbound; as of 2026-11-03 the live ledger is ~/code/ff-ledger, both regions pass every gtme check and 0 emails have ever sent; first built 2026-10-11 night, run by chewbacca gtme from the FF repo's ops/ ledger; 261 DFW and 252 SoCal churches loaded, waiting on the first approved batch
metadata:
  type: project
---

Firm Foundation (gavinjmunroe/firm-foundation) runs outbound through `chewbacca gtme` with two clients, "Firm Foundation SoCal" (Caleb sends) and "Firm Foundation DFW" (Gavin sends). Each keeps its ledger in the repo at `ops/gtme/<region>/` (`gtme share`), so both Macs read one memory. Rulings with who said them are in the repo's DECISIONS.json; setup for a new Mac is ops/README.md.

State on 2026-10-11 around 8:30pm: every church within 25 mi of USC and of downtown Dallas was enumerated (Maps plus OSM, 10,010 after dedupe) and audited with Gavin's 13 checks (research/WEBSITE-PRESSURE-TEST.md). 261 DFW and 252 SoCal in-band churches have an on-domain contact and a plain-words opener (`ops/lists/to_gtme.py`). Copy grades 86 to 95 on the Jev rubric with min_grade 85 and says plainly we're Christians (Caleb: "Authenticity and clear faith are killer"), no scripture. Yes-replies get Caleb's Calendly. SoCal replies are checked every 15 min and a Friday 8am `gtme week` report runs on Caleb's Mac (chewbacca-daemon jobs ff-inbox-socal and ff-week-socal).

**Why:** Caleb, 10/11: "We're basically doing our own bma", with Chewbacca as the GTME and nothing FF-specific in the kit.

**How to apply:** nothing has been sent. Next, Gavin connects his Gmail and registers ff-inbox-dfw on his Mac, then the first batch (5 a day in week one) goes after Caleb's ok. Gavin is setting up Workspace (team@firmfoundation.tech, he pays, repaid from the first project); when it exists, switch both senders and add the mail DNS records in Porkbun. Related: [[project_firm_foundation_site]], [[feedback_fix_the_default_path]].

**Update 2026-11-03 4:50pm PT.** The live ledger is `~/code/ff-ledger/ops/gtme/{socal,dfw}` (the FF repo's ops/gtme copy is stale). 0 emails have ever gone out in either region. After the 11/3 eye review (232 churches, keepers in ~/code/ff-reaudit-1103/keepers.jsonl) the list is 25 SoCal and 26 DFW churches, all treg-valid, ranked with the review's worth score written as dated_score; 24 unverified addresses moved to leads-held.csv. `gtme today` shows 0 fail in both regions; the only NOT CHECKED is a test send to a personal inbox. SoCal sends from caleb@firmfoundation.tech, DFW from gavin@firmfoundation.tech and needs Gavin's own ok. At 5 a day the pool lasts about 10 sending days, so the next review wave has to run this week.
