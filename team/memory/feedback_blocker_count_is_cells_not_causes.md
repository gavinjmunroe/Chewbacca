---
name: feedback_blocker_count_is_cells_not_causes
description: gtme ready's blocker count is gate cells (drafts x 5 + checks), so "41 blockers" was reported all day on 2026-10-17 while the causes underneath changed three times; it now names the causes, labels a grader crash as the crash, and flags week-old files pinned in clients.json
metadata:
  type: feedback
---

`chewbacca gtme ready` counts every non-PASS gate cell. With 8 drafts, one shared problem always reads 41 (8 x 5 + 1). On 2026-10-17 the agent reported "41 blockers" several times. Caleb: "you've been saying that all day... find the root cause in Chewb's correction process that is flawed".

Three flaws, all in how failures were reported:

1. **A grader crash was labelled as a missing input.** gtme-grade died on "--field-map names firm, which the leads file lacks", then on first_name. All five gates went NOT CHECKED, and the first-reason column printed "recipient read missing". Nobody saw the crash.
2. **The count hid the cause.** Cells, not causes. Catch-alls on the 10-12 drafts, then a crash, then missing reads all printed the same 41.
3. **Stale config won silently.** clients.json `ready.verification` and `ready.suppress` still pointed at the 10-12 files. So 42 freshly verified people read as unverified, and last week's merged suppression flagged 3 Goldie's rows.

Fixed in Chewbacca 3f3200ae. The first reason says "gtme-grade did not run: <error>", the table prints "N blockers come from K causes" with each cause, and a clients.json path outside the drafts folder prints a warning. Working the real causes took the 10-19 drafts from 41 to 9. The 9 are the 8 recipient reads plus the presend receipt, all of which must be fresh on Monday morning.

**How to apply:** never report a blocker count without its causes line. When every gate in a row is NOT CHECKED, read the per-gate `first` in ~/.chewbacca/state/gtme-ready/<client>.json before believing the summary column.
