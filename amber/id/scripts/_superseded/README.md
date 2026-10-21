# Superseded scripts

Not deleted, not maintained, and not scanned by the audits. Moved here because
they still ran, still looked authoritative, and would have done damage.

## contact-dedup-backfill.js

Replaced by `scripts/reconcile-contacts.mjs`.

It carried its own copy of the identity-key logic, written when
`contact_identity_keys` stored a plaintext `key_value`. That column became a
salted `key_hash`. `src/` moved with the schema; this did not, and no gate
caught it because `column-drift-audit.mjs` only walked `src/`. The failure
surfaced as a `42703` from production credentials pointed at a real address
book with 2,560 contacts in it.

The replacement has no logic of its own: it claims keys with `claimsForRow` and
`claimIdentityKeys`, finds duplicates with `duplicateCandidatesFromBook`, and
merges through `collapseContactGroup`. The same functions the live path uses,
so it cannot drift from the resolver.

It also needs no manifest file. Every merge records a `contact_merges` row with
a snapshot and a 30-day undo, which is the same rollback the product gives a
person who taps Merge.

The audit now walks `scripts/` as well, so the next script to drift this way
will fail a gate rather than a production run.
