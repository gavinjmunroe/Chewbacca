---
name: feedback_say_which_work_is_good
description: "An all-clear names the work it covers. 'We good?' answered 'we're good' about one tab's ledger got read as a Zeutara launch claim while gtme ready said NOT READY, 41 blockers. Zeutara's gtme ready also can't rerun without a drafts file (2026-10-16)."
metadata:
  type: feedback
---

When Caleb asks "We good?", the answer names the work it covers, and says the state of any client launch in the same line if one is open.

On 2026-10-16 two GTME tabs answered "we're good" about their lesson-ledger work, and ready-guard read both as launch claims. Zeutara's last `chewbacca gtme ready` was NOT READY with 41 blockers. Caleb then said "Tell the zeutara tab to LOCK TF IN".

A gap a tab ran into: `chewbacca gtme ready --client Zeutara` won't rerun without `--drafts`, and `~/.chewbacca/gtm/clients.json` has no `ready.drafts` path for Zeutara, so nobody could get the per-campaign blocker list fresh. Setting that path is the fix.
