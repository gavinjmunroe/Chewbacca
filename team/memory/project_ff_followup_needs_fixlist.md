---
name: project_ff_followup_needs_fixlist
description: FF's email 2 says the church's list is already done, and dough plan never checks that a fix list exists
metadata:
  type: project
---

Firm Foundation's follow-up (email 2) tells each church "The list for <church>'s site is already done." Dough's plan and ready checks never look for that list. On 2026-11-13 Radiance International's follow-up passed every check with no fix list anywhere in the ledger. Gavin's session wrote `ops/fixlists/radianceinternational.org.md` from a live phone render minutes before the send. Northview's list sat in `ops/gtme/dfw/audits/` instead, dated Oct 18.

**Why:** a church that replies "send it" gets nothing to send if the list doesn't exist. AEBC, Lavon Drive and Lighthouse all asked for theirs that week.

**How to apply:** before approving a batch with follow-ups, confirm each church has `ops/fixlists/<domain>.md` or `ops/gtme/<region>/audits/<domain>.md`, and write one if it's missing. The real fix is a check in dough plan that holds a follow-up with no list. Dough's run-outbound skill carries the manual step since 85c0fd4.
