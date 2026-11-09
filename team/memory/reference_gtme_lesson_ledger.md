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
- State at end of 2026-10-16: 26 lessons, 13 CHECKED and 13 PROSE, 0 BROKEN. 04998fdf turned list fit, the 500-per-arm split floor and the unit rule into code; 55d03aa7 moved 9 dated experiments out of the gtm skill (559 to 500 lines). Still PROSE on purpose: the recovery-window lesson waits on fix/zeutara-claude-recovery merging. tools/brand_buyer.py (the productized Sabo chain) calls verified_email, so a catch-all is never Ready.
- Seeded with 11 Zeutara and 6 Sabo lessons. With every Sabo lesson hidden, a Sabo planning query puts Zeutara's email-domain lesson first, the one Sabo's chain rediscovered by hand.
- Two lesson checks run as code since 04998fdf (2026-10-16). `gtme-score fit-share leads.csv` exits 1 when under half the list fits, and an unscored row counts against it (zeutara-list-fit-before-copy). `gtme-learning split --unit people --arm A=12/366 --arm B=3/351` names no winner without a unit, under 500 per arm, under the powered size for the gap, or at p of .05 or more (zeutara-variant-a-leads-unit-unstated, zeutara-grader-not-validated). Audit went from 4 to 7 CHECKED. gtme-grade does not call fit-share yet, so it only stops someone who runs it.
- Still PROSE on purpose: zeutara-recovery-window-before-resume. Its check belongs in the resume op on fix/zeutara-claude-recovery, which was 6 commits off main on 10-16. Once that branch merges, point the lesson's check_ref at the window check there.
- To turn a PROSE lesson into CHECKED: write the refusal in the tool, a test with the lesson's own real numbers as the reject case, then add `check_ref` (kit:path::needle) right after `check` in the JSON. Regenerate SHA256SUMS.txt in the same commit or the manifest guard refuses it, and run bin/gtme-* shims with python3, never bash.

Moving skill prose into the ledger (learned on 55d03aa7):

- Experiments with a number, commit or file go in the ledger; Caleb's rulings and standing procedure stay in the skill.
- Cite a commit or a kit file as evidence, never the SKILL.md text you're about to delete. Four seed lessons cited SKILL.md and now cite a40ec6ce.
- `derived_from` means a lesson from ANOTHER client. The H6 test hides the lesson's own client and expects the parent in the top 5, so a same-client parent fails it.
- A new lesson can push a sealed case's expected lesson out of the top 5 (H2: a Sabo sponsor lesson outranked list-fit). Reword the new lesson's words that overlap the query; never edit the sealed fixture.
- Debug ranking with `chewbacca gtme lesson plan "<query>" --json | jq -c '.[] | [.score, .id, .matched]'`. launch-guard refuses python3 scripts, sed -i and heredocs in a command near GTM words, so edit lesson files with the Edit tool.
- Check that a SKILL.md pointer query returns the lessons it names at the default limit; when it doesn't, name the ids and `gtme lesson show <id>`.
