---
name: reference_ff_dfw_ledger_and_email1_variants
description: Dough reads FF DFW from ~/code/ff-ledger/ops/gtme/dfw, not firm-foundation/ops/gtme/dfw; email 1 lives in three plan.json variants (copy step 1, copy_direct_inbox, copy_role_inbox) that change together
metadata:
  type: reference
---

On Gavin's Mac, Dough's ledger for Firm Foundation DFW is `~/code/ff-ledger/ops/gtme/dfw` (op.client_dir("Firm Foundation DFW")). `~/dev/firm-foundation/ops/gtme/dfw` is an older copy that Dough never reads. On 2026-11-09 the new email 1 got written into the firm-foundation copy first. `dough plan` then printed the old copy with no error, and the cause only showed up from resolving client_dir. Before editing lines.json or plan.json, resolve the path with `python3 -c "import sys; sys.path.insert(0,'engine/tools'); import gtme_operator as op; print(op.client_dir('Firm Foundation DFW'))"` from the dough repo.

Email 1 exists in three places in plan.json, and first_copy picks one per lead:

- `copy_direct_inbox` for leads marked direct_inbox (a named pastor's own address, like scott@northviewbaptist.com), greeted by {{greeting}}
- `copy_role_inbox` for info@, office@ and the like
- `copy` step 1 for everyone else, split with `copy_variant_b` when that key exists

Rewriting step 1 alone left Scott on the old copy, because he's direct_inbox. A copy change goes into all three, or the variants that aren't changed get retired. On 11/9 copy_variant_b moved to copy_variant_b_retired, and copy_role_inbox still held the old copy.

Two merge fields came in with Dough 5f95982. `{{short}}` fills from a lines.json entry's "short" (the name people say, like "Northview") and falls back to the company. A plan's `sender.tagline` signs under the name in the footer. The copy rules themselves are in [[feedback_ff_email1_be_real_2026_11_09]].
