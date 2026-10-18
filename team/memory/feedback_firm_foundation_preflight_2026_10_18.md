---
name: firm-foundation-preflight-2026-10-18
description: "Before a Firm Foundation send day, prove the sending Gmail answers and re-audit the hooks; on 10/18 the SoCal sending Gmail had no Chewbacca sign-in and one hook was false"
metadata:
  node_type: memory
  type: feedback
---

Firm Foundation's own-inbox outbound (`chewbacca gtme`, clients "Firm Foundation SoCal" and "Firm Foundation DFW") needs two checks the night before any send day.

1. The plan's `sender.inbox` must have a sign-in under `~/.chewbacca/email/<address>`. On 2026-10-18 SoCal's plan named Caleb's personal Gmail, only his school address was connected, and `gws gmail users getProfile` with `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` set to that inbox's folder returned 401. Batches still built and `ff-inbox-socal` still exited 0, so nothing surfaced it. `gtme send` would have failed Monday and no replies were being read. Fix: `chewbacca email add <address>`, then rerun getProfile.

2. Re-audit each lead's hook with `ops/audit/audit_site.py --browser` and read the site before trusting a lines.json line. On 10/18, 25 SoCal rows re-measured the same, but The Warehouse's line ("the only next step is an email link") was false, because the site has a Subsplash plan-a-visit form the hook ignored. The row was dropped.

Two more from the same night:
- The 10/11 template line "can't tell you they're coming. There's no plan a visit form, just information." grades about 82 on Jev and gets held. Name the menu or page you checked instead ("...menu has no page for first-time guests, so the contact form is a newcomer's only way in": 92).
- Jev's grader gives punch 10 at 50 to 90 words and 5 above. Every 10/18 email ran 93 to 96 words, so a 2 or 3 word shorter first line is worth 5 points.

The week's plan with sources is `ops/OUTBOUND-PLAN.md` in gavinjmunroe/firm-foundation.
