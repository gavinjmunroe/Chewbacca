---
name: reference_intro_ledger
description: The intro ledger is the append-only, server-dated, hash-chained record of every contact we hand a creator-GTM client, so a deal that closes months later is provably ours; live on Railway, Sabo intros #1 to #5 (2026-10-16)
metadata:
  type: reference
---

The intro ledger is how a creator-partnership client's late deal gets attributed to us. Sabo asked for it on the 10/16 call ("It could happen 3 months down the line. Like, how do you protect yourself?") and Gav floated a percent of deals, so this is what gets us paid.

- Service: https://intro-ledger.up.railway.app, Railway project `intro-ledger` in Caleb's workspace, volume at /data. Code in `tools/creator_gtm/intro_ledger/`, how-to in its README.
- The server stamps the date from its own clock and refuses a caller-supplied one, has no update or delete, and chains each record to the last by SHA-256. A mistake gets a correction record. `/verify` checks the chain.
- `tools/creator_gtm/deliver.py <client.json> --live` records every Ready row of the client's Clay table, then writes Delivered On, Delivered For and Ledger Record on the row. Record first, stamp second, so a failed Clay write is fixed by rerunning. Same client, email and creator returns the original record.
- The Ledger Record cell holds the record number and a hash prefix, so Clay's own edit history is an outside copy of every hash.
- A Ready row with an email check that isn't "valid" is skipped, never recorded.
- First records, 2026-10-16, for Noah Rolette: Klarna, Strava, Celsius, Gymshark, Barebells. Barebells is Scout Brown, Sabo's existing contact, so the draft term's pre-existing carve-out excludes it.
- A new client is a new `~/.chewbacca/gtm/clients/<slug>.json`. Nothing about it is Sabo-specific.
