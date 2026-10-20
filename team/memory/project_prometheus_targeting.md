---
name: project-prometheus-targeting
description: "The 1.04M-row investor file is 27,393 personalisable people, and list-audit found two defects a hand-rolled audit missed"
metadata:
  node_type: memory
  type: project
---

## Jonah approved resale, 2026-10-19

Caleb, 2026-10-19: "Jonah gave me the ok to sell prometheus." Given verbally on a call, as thanks for the work: Caleb can "go ham and do wtv I want w the database." No written record yet. Provenance per Jonah (relayed by Caleb, same day): proprietary, built from large investor events Jonah helped a partner run, not a licensed source. Jonah said the sales story can be told as strongly as possible. Caleb called Jonah again the same evening: full approval from Jonah and from his partner, and Jonah asked not to be asked for approval again. Resale rights are settled; do not raise them again. This settles the 9/30 objection below (Sagar's worry was that Jonah would object). Still open: who takes the revenue under the Amber terms.

## Commercial scope update, 2026-09-30

Sagar explicitly says Prometheus should not be publicly sold and that Jonah would object (message 639341). Caleb's later vertical list still includes selling it, so this remains an unresolved contradiction, not an authorized resale offer. No private resale rights were established by the scan. Source and coverage: a private note. Historical targeting analysis below does not grant sending or resale permission.

The old question about which five companies is superseded by the later named scope in a private note.


Sagar's one assignment to Caleb, 2026-09-20: *"i need you to do one thing, which
is GTM engineering for jonah and his 5 companies"*, and specifically *"figure out
how to do a people search for each of the 5 companies we're fundraising. scoring
and prioritizing this 220mb file is tough."*

Tooling shipped 2026-09-21 at **`calebnewtonusc/prometheus-targeting`, private**
because it holds thousands of real investor emails.

**The numbers, which are much smaller than the row count.**

```
1,039,715  rows in prometheus.db (~/Downloads/One-Pagers/)
  445,568  are Organizations, not people
   52,350  people with an email and grade A or B
   51,320  after removing 984 role inboxes      <- can be SENT to
   27,393  that also have a usable company name <- can be PERSONALISED, 2.6%
```

**Plan against 27,000, not a million.** It is an investor database, so
`org_type` is filled on 100% of rows and is the axis that always works: VC
16,116, Investor 9,935, Family Office 9,693, Angel 8,419, LP 3,424, PE 2,264.

**`sectors_norm` is blank or unknown on 43%**, so any sector filter silently
drops half the list. `vc-ai` returns 284 where unfiltered VC returns 9,753, and
most of that gap is missing data rather than absent investors. Enrich sector
first; it is what turns one list into five.

**Two defects `chewbacca list-audit` found that a hand-rolled audit missed.**
This is the lesson, not the data:

1. `organization` is junk on 48%, in four ways that all survive an eyeball
   check: the literal string `Person` on 9,526 rows (entity type leaked into
   the column), blank on 8,259, `Unknown`/`Company` on 5,879, and Airtable
   image attachments like `11283.jpg (https://dl.airtable.com/...)` on 1,289.
   `lp.csv` as first generated had **18 usable rows out of 500.**
2. Where a LinkedIn slug shares no token with the name, **89.7% are confirmed
   wrong**. One row paired Christopher Hehmeyer with
   `/in/shannon-collins-thackray`. Personalising off a stranger's profile is
   worse than not personalising.

**Run `list-audit` on any purchased or inherited list before building a sequence
on it.** See a private note: the skill existed and was not
reached for, which is the same failure as the other five that night.

**Still blocked on one fact:** which five companies are raising. One-pagers
exist for eight (Zeutara/Goldies, Ivy, Kallu, MortgageFi, Qube, RagMetrics, TRN,
Vertocol); the three touched most recently are Kallu, Qube and TRN. One sentence
from Sagar or Kaushik turns the generic profiles into five real lists.
