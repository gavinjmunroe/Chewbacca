---
name: feedback_angel_lists_judge_alone
description: "gtme-investors drops every angel (no portfolio page to prove fit); an angel pass judges each row ALONE with Jev, never in batches of 20, and needs email-domain company + MX checks to pass list-gate"
metadata:
  type: feedback
---

Built 2026-10-26 for an OPAL pre-seed round ($150K SAFE, 12 to 15 angels at $5K minimum).

`gtme-investors` with judge mode "all" proves fit by walking a firm's portfolio page. Angels have no
portfolio page, so the engine drops them as "no evidence" and a $5K-check round gets only funds. On
OPAL it returned 9 rows, all institutional (Felix, Lerer Hippeau, Forerunner, Index...), and none
of them write into a $150K SAFE.

The angel pass that worked (script: `~/.chewbacca/gtm/scripts/opal_angels.py` + `opal_angels_finalize.py`):

- Pool: org_type Angel or check_size "Angel (individual)", geography, valid non-role email, sector on file.
  6,083 candidates.
- Jev judges each row ALONE on title, company and sectors against the pitch. Batches of 20 put plain
  "software" rows at the top (0.77). Alone, 25 clear consumer/apparel angels scored 0.45 to 0.85 and
  25 pure software/fintech angels scored 0.08 to 0.18. Keep at 0.6. 6,083 single calls took 122 s at 8 threads.
- 329 kept, tiered A (0.8+) / B (0.7+) / C.
- list-gate failed it three ways: blank company on 280 rows (angels invest as themselves), one .gov
  address, one free mailbox. Fix: company = the email domain they get mail at, drop dead/no-MX domains
  (`dig MX`), drop .gov/.mil, one angel per domain. 266 rows, list-gate pass.

Traps:

- `import jev` can resolve to some other module on the path; load `bin/lib/jev.py` by file path.
- The Clay CLI on Caleb's Mac is signed into "BMA Old" as his BMA account. Never spend it on
  non-BMA work. Inbox-level verification needs a verifier account of his own (MillionVerifier was the pick).

**How to apply:** for any raise that needs angels, run the angel pass beside `gtme-investors`, not
instead of it. The real fix is an angel mode in `tools/gtme_investors.py`.
