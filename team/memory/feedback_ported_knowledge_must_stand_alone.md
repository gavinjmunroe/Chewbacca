---
name: feedback_ported_knowledge_must_stand_alone
description: Knowledge pulled into Chewbacca from a private repo is written out in full and its test data is anonymized; a pointer into a repo strangers can't open is worth nothing, and real client replies in fixtures are a leak
metadata:
  type: feedback
---

Caleb, 2026-10-09, mid BMA funnel: "Chewbacca has to work perfectly for anyone that needs gtme. They shouldn't need to setup any other repos."

**Why:** the first pass wrote maps that said "see togari-platform/src/...:120". Nobody outside BMA can open that. The same pass copied 27 real investor replies (names, emails, phone numbers, firms) verbatim into `tests/fixtures/gtme-reply/` because they made good test cases; Chewbacca ships to strangers, so that would have published other people's mail.

**How to apply:**
- Distill into the skill's own references: every rubric, number, threshold, endpoint and checklist written out. Repo maps are labeled maintainer-only, and nothing reads the clones at run time (`skills/gtm-engineering/references/bma/README.md` is the model).
- Port code with parity tests, but anonymize every fixture before commit: `.example` domains, 555-01xx numbers, invented names, free-mail domains kept so the classifier logic still fires. Map consistently so assertions still hold; never weaken one.
- Scan the folder for emails, phones, Slack IDs, tokens and webhook URLs before every push.
- Credit lines: none for BMA code, per [[project_bma_code_no_credit_needed]] in private memory.

Related: [[feedback_scan_before_import]], [[reference_chewbacca_gtm_arsenal]].
