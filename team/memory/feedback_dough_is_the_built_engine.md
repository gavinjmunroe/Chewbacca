---
name: feedback_dough_is_the_built_engine
description: Dough is the GTM, CRM and data engine already built in Chewbacca (gtme, gtm graph, people, Clay front door, scoring, gates), never "nothing built yet"; the dough repo README is the stale part
metadata:
  type: feedback
---

Dough is the GTM engine already running inside Chewbacca, not a spec waiting for code. Caleb, 2026-10-29, after an agent told him "Dough is a spec rn, zero code" from the dough repo README: "Bro all the gtmos/chewbs stuff we built IS DOUGH", then "WEVE GOT SO MUCH GTM STUFF AND CRM AND DATA MANAGEMENT AND QUERYING STUFF IN CHEWBS".

What Dough already is, on Chewbacca main (bin/ and tools/):

- Finding accounts: `gtme list`, `gtme-signals` (SEC Form D raises), `gtme-investors`, `gtme-portfolio`, treg (`treg_client.py`), `chewbacca api` sites, and the IRS-filing list builders (the Medrano list, 596 orgs).
- Scoring: `gtme-score`, Togari's lead, primary-contact, tier and signal rubrics ported line for line.
- Clean data: `gtme-dedupe` (splink), `gtme-dnc`, `gtm suppress`, `resolve`.
- CRM and memory: `chewbacca gtm` (the sends, replies and meetings graph), `gtm-memory`, the `people` relationship store.
- Querying: `chewbacca clay <op>` (reads and writes taken from Clay's own frontend), `gtm replies/funnel/client`, `graph-fuse`, `table_graph`, `task-graph`.
- Writing and gating: `gtme copy`, `gtme-grade` (Sagar's rules in code), `gtme presend`, `gtme ready`, `gtme-rules`, Jev checks.
- Sending and replies: `gtme_solo` (own inbox, capped), `gtme-reply` (Togari's classifier, 753 of 757 parity), `gtme report`.

**Why:** the dough repo's README says "Nothing is built yet", which is true of that repo's own folder and false of the product. An agent repeated it on a prospect-call prep day.

**How to apply:** describe Dough as this engine. The dough repo is where it gets packaged for founders; the code lives in Chewbacca until it moves. Related: [[project_dough_name_2026_10_28]], [[project_gtm_os_2026_10_28]].
