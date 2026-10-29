---
name: feedback_gtme_ready_own_inbox_batches
description: gtme ready grades own-inbox gtme batches since 98c91525; FF SoCal's first batch was NOT READY on missing verifier verdicts and an unsigned inbox
metadata:
  type: feedback
---

`chewbacca gtme ready` only knew Clay campaigns until 2026-10-29, so Firm Foundation's Gmail sends had no READY to earn: it exited "names no Clay workspace". Since Chewbacca b60597c2 and 98c91525, a drafts entry `{"batch": "<id>"}` (and no `campaign`) is graded from the client's ledger on the same five gates, with a recipient read in `reviews/<id>.json` beside the drafts. FF's file is `ops/gtme/socal/ready/drafts.json`.

On the first real run (batch b484372f04, 10/29) it failed two gates nobody had flagged in two weeks of "ready" talk: none of the 15 SoCal addresses had a verifier verdict (no treg token on Caleb's Mac), and the plan's inbox was still Caleb's personal Gmail while the sender was his firmfoundation.tech Workspace address.

**Why:** a gate that can't run on a path means "ready" on that path is whatever the agent says ([[feedback_ready_means_gtme_ready_passed]]).

**How to apply:**

- Own-inbox send day: `gtme batch`, write the review file after reading every email as the recipient, then `gtme ready --drafts <file>`. Batches expire in 2 hours, so the review is per batch id.
- `gtme sender --email` does not move `--inbox`; set both.
- Bare `chewbacca gtme` with no subcommand runs the 8-question interview on defaults and saves a "My business" client. Always name a subcommand.
- A client that is its own company sets `no_client` in clients.json so the client-messages skip doesn't block.
