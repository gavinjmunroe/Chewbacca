# tiwari-training

Training harness for the three Tiwari primitives. **This is not a product
surface.** It is a set of offline jobs Perplexity Computer runs on a
schedule to maximize what Computer can extract, fit, and publish.

See `docs/TRAINING-LOOPS.md` for the full doctrine.

## Two tracks

```
Tiwari/tiwari-training/
├── world/          weekly zeitgeist refinement; public + semi-public corpora
│   ├── peoplerank.js
│   ├── enrich.js
│   ├── opportunity.js
│   └── state/      published weekly as training/world/<iso-week> PRs
├── sagar-mirror/   nightly refresh of Sagar's personal priors
│   ├── peoplerank.js
│   ├── enrich.js
│   ├── opportunity.js
│   └── state/      written to amber-id scoring tables, never committed
├── runs/           audit logs: input window, hyperparams, output deltas
└── scripts/        CLI entry points the crons invoke
```

## Invariants

- **Never edits Newton/.** All data access goes through amber-id's four
  ingest pipes (read side) or amber-id scoring endpoints (write side).
- **Never sends messages.** Training emits state files and (for world)
  PRs. Nothing else.
- **Never blocks on the product.** If Sagar did not reply to a single
  check-in this week, training still runs on everything else. The
  `sagar-mirror/*` jobs handle sparse input gracefully.
- **Six-dim ontology is frozen.** Training can only adjust weights over
  the six dimensions, not invent new ones.
- **Auditable.** Every run writes a row to `runs/<iso-timestamp>.json`
  with `{inputs_window, hyperparams_before, hyperparams_after,
  rows_touched, delta_l2}`.

## Stubs — to be fleshed out as real corpora become available

All six trainers are currently stubs that:
1. Read a window of evidence records from amber-id (via the REST client
   in `Tiwari/shared/amber-id-client`).
2. Fit their primitive's weights with the algorithm from the papers
   under `Tiwari/papers/`.
3. Write the resulting state JSON to their `state/` directory.
4. Log the run to `runs/`.

The stubs currently use small hand-curated fixtures so the crons run
green; replace with real pipeline access as each data source comes online.

## CLI

Each script is invokable standalone:

```bash
node Tiwari/tiwari-training/scripts/train.js --primitive peoplerank --track world
node Tiwari/tiwari-training/scripts/train.js --primitive enrich     --track world
node Tiwari/tiwari-training/scripts/train.js --primitive opportunity --track world

node Tiwari/tiwari-training/scripts/train.js --primitive peoplerank   --track sagar-mirror
node Tiwari/tiwari-training/scripts/train.js --primitive enrich       --track sagar-mirror
node Tiwari/tiwari-training/scripts/train.js --primitive opportunity  --track sagar-mirror
```

The six scheduled tasks call exactly those commands.
