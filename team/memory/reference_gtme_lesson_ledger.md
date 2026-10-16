---
name: reference_gtme_lesson_ledger
description: "The GTME lesson ledger (team/gtme-lessons, `chewbacca gtme lesson`): every campaign experiment as hypothesis, change, oracle, result, next decision; oracles refuse what they can't support; `lesson plan` hands a new client the last client's checks (2026-10-16)."
metadata:
  type: reference
---

The GTME lesson ledger, built 2026-10-16 from REA's Touhou essays at Caleb's ask to make Chewbacca a GTME that compounds. The design and sealed test cases are in `docs/plans/GTME-MEMORY.md`, the code in `tools/gtme_lessons.py` and the tests in `tests/test_gtme_lessons.py`.

- One JSON file per experiment in `team/gtme-lessons/`, in git: hypothesis, change, oracle (metric, numerator, denominator, unit, source, baseline), result, verdict, next decision, check, evidence paths. Failures and inconclusive results stay; `gtme lesson record` appends to history, never overwrites.
- Oracles decide verdicts. `confirmed` or `refuted` needs an outcome oracle, the metric's floor (500 per arm for reply rates), a baseline and evidence. Positive replies never come from a Clay category, a verified email counts only after its domain matches the account or parent (`gtme lesson verified-email`), meetings never inferred, cost is per verified result. Proxies (grade, spam score, Jev fit) never confirm. Each rule has reject cases in the tests.
- Before planning a campaign, list or table: `chewbacca gtme lesson plan "<what you're building>" --client X`. `gtme start` and `gtme list` print the top three on their own.
- Title and check can't name the client (refused at add), so a check travels to the next client without leaking the last one.
- `gtme lesson audit` exits 1 on a broken lesson; PROSE means the check is words only, CHECKED means a `check_ref` (path::needle) still exists, REVISIT means the oracle tightened since the verdict.
- Seeded with 11 Zeutara and 6 Sabo lessons. With every Sabo lesson hidden, a Sabo planning query puts Zeutara's email-domain lesson first, the one Sabo's chain rediscovered by hand.
