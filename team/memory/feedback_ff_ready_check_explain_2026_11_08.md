---
name: feedback_ff_ready_check_explain_2026_11_08
description: How to run the FF readiness check, why batches go stale after 2 hours, and to explain FF blockers in plain words the first time
metadata:
  type: feedback
---

FF readiness runs per region from the ledger, not from `bin/dough` (absent in ~/code/dough on 2026-11-08) and not `dough ready` (not on PATH):

    cd ~/code/ff-ledger/ops/gtme/socal && chewbacca gtme ready --client "Firm Foundation SoCal" --drafts ready/drafts.json
    cd ~/code/ff-ledger/ops/gtme/dfw && chewbacca gtme ready --client "Firm Foundation DFW" --drafts ready/drafts.json

A batch older than 2 hours fails the start gate because of Caleb's standing rule, written on BATCH_TTL in tools/gtme_solo.py: anything that sends needs his ok in chat within 2 hours. It's about approval, not site freshness. Read the constant's comment before explaining a gate; on 2026-11-08 a reply invented a site-freshness reason and he called the rule dumb before the real one was found. Build the batch the morning it sends, then approve it.

**Why:** On 2026-11-08 a Sunday night prep named "Form 1583" and "the batches expire" as blockers with no explanation, and Caleb had to ask "Form 1583?" and then "Wdym expire?". The ready-guard also pointed at the wrong client and command.

**How to apply:** The first time a blocker names a form, gate or tool, say what it is and why it blocks in one sentence. Form 1583 is the USPS form that lets the Wyoming virtual mailbox receive mail for the LLC; CAN-SPAM needs a real postal address in every cold email, so the footer address waits on it.
