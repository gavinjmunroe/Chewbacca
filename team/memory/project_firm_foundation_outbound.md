---
name: project_firm_foundation_outbound
description: Firm Foundation's outbound as of 2026-10-11 night, run by chewbacca gtme from the FF repo's ops/ ledger; 261 DFW and 252 SoCal churches loaded, waiting on the first approved batch
metadata:
  type: project
---

Firm Foundation (gavinjmunroe/firm-foundation) runs outbound through `chewbacca gtme` with two clients, "Firm Foundation SoCal" (Caleb sends) and "Firm Foundation DFW" (Gavin sends). Each keeps its ledger in the repo at `ops/gtme/<region>/` (`gtme share`), so both Macs read one memory. Rulings with who said them are in the repo's DECISIONS.json; setup for a new Mac is ops/README.md.

State on 2026-10-11 around 8:30pm: every church within 25 mi of USC and of downtown Dallas was enumerated (Maps plus OSM, 10,010 after dedupe) and audited with Gavin's 13 checks (research/WEBSITE-PRESSURE-TEST.md). 261 DFW and 252 SoCal in-band churches have an on-domain contact and a plain-words opener (`ops/lists/to_gtme.py`). Copy grades 86 to 95 on the Jev rubric with min_grade 85 and says plainly we're Christians (Caleb: "Authenticity and clear faith are killer"), no scripture. Yes-replies get Caleb's Calendly. SoCal replies are checked every 15 min and a Friday 8am `gtme week` report runs on Caleb's Mac (chewbacca-daemon jobs ff-inbox-socal and ff-week-socal).

**Why:** Caleb, 10/11: "We're basically doing our own bma", with Chewbacca as the GTME and nothing FF-specific in the kit.

**How to apply:** nothing has been sent. Next, Gavin connects his Gmail and registers ff-inbox-dfw on his Mac, then the first batch (5 a day in week one) goes after Caleb's ok. Gavin is setting up Workspace (team@firmfoundation.tech, he pays, repaid from the first project); when it exists, switch both senders and add the mail DNS records in Porkbun. Related: [[project_firm_foundation_site]], [[feedback_fix_the_default_path]].
