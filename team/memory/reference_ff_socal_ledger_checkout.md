---
name: reference_ff_socal_ledger_checkout
description: FF SoCal's gtme ledger lives in ~/code/ff-ledger (branch ff-ledger tracking origin/main), not the shared ~/code/firm-foundation working copy, which couldn't pull (11/2)
metadata:
  type: reference
---

Since 2026-11-02, `~/.chewbacca/gtm/clients.json` points "Firm Foundation SoCal"
at `/Users/joelnewton/code/ff-ledger/ops/gtme/socal`. That's a worktree of the
FF repo on branch `ff-ledger`, which tracks origin/main, and the repo has
`push.default upstream`, so gtme's push lands on main. The old file is kept as
`clients.json.bak-2026-11-02`.

**Why:** gtme pulls with rebase and autostash before every command. The shared
`~/code/firm-foundation` working copy had a leftover no-op rebase from 10/29,
sat 81 commits behind, and held uncommitted video edits to files upstream had
also changed. So `gtme today` and the `ff-inbox-socal` reply checker printed
"Couldn't pull the shared ledger" and worked off a stale copy.

**How to apply:** never point a gtme state_dir at a working copy people edit by
hand. Give each ledger its own worktree. The SoCal lead order and the held
Catholic and mainline rows (`leads-held.csv`) follow ops/WAVE-1.md, and The
Warehouse Foursquare stays held (its site has a plan-a-visit form, 10/18).

Related: [[project_ff_wave1_trust_and_pool_2026_11_02]], [[project_firm_foundation_outbound]].
