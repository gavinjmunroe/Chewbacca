# Tiwari training loops — 2 ways × 3 primitives

> How every Tiwari primitive learns. Two loops per primitive = six total.
> Seeded by the 2026-04-18 vision note
> (`vision/seeds/2026-04-18-training-loops-and-target-market.md`).

## Training track ≠ Product track

**Training is a Perplexity-Computer job, not a user experience.** These
six loops run regardless of whether Sagar or Caleb touch the product.
They maximize what Computer can extract and refine from whatever data
already exists: public corpora, Sagar's digital exhaust, Caleb's
visionary exploration, any historical check-ins on record.

The **product track** (daily iMessage check-ins via Loop) is a
_separate_ human-feedback loop. Its answers eventually show up in the
`/ingest/checkin` pipe and become **one** signal in the Sagar-mirror
training — but training does not wait for them. If Sagar never replies
for a week, training still runs nightly on everything else and the loop
stays healthy.

The two tracks share the **six-dimension ontology**, the
**four-pipe ingestion**, and the **intentionality priors**
(`docs/PLATFORM-INTENTIONALITY.md`). They do not share schedules,
receipts, or blocking dependencies.

## Loop matrix

|   | peoplerank | enrich | opportunity |
|---|---|---|---|
| **World loop** (zeitgeist, weekly) | refine dimension-weighted edge priors across communication styles + audiences; learn "who acts in the mode of goodness" from public corpora | refine pipe-trust priors and dimension-classifier weights across public / semi-public corpora | refine reward function weights (balance, diversity, alignment) across reference personas |
| **Sagar-mirror loop** (amber-id, nightly) | refresh Sagar's personalized PageRank from today's ingested digital exhaust (contacts, calendar, messages, platform posts) | update Dempster-Shafer beliefs for each contact from today's evidence records | update LinUCB arms from any check-in signal that happens to exist, plus observed engagement on other channels |

The Sagar-mirror loop is named "mirror" — not "Sagar loop" — to make it
explicit that it is Computer's internal model of Sagar, not a service
that Sagar talks to. Sagar talks to the **product track** via iMessage;
the mirror silently learns behind the scenes.

Caleb runs a **parallel Caleb loop** that feeds the world loop with
abstract functionality — not target-market-bound.

## Base cases

- **Sagar = target-market base case.** Diverse, T-25 college,
  health-minded, business professional — canonical persona is a USC
  sophomore international Korean woman who wants to work at McKinsey and
  loves to have a fun life.
- **Caleb = abstract visionary base case.** Surfaces functionality that
  may be useful at various moments but does not necessarily map to the
  target persona. The world loop uses Caleb's trajectory to explore edges
  the target persona does not.

Future base cases: a **coalition/sisterhood of women** to add the
feminine half of relationship-health data.

## Training substrate

Existing Amber infrastructure is reused:

- **Inputs** → the four ingest pipes (`/ingest/{agent,health,checkin,
  relationship}`) already enforce `health_dimension` and pipe-trust.
  Training just reads from them. No new storage.
- **Feature generation** — `scripts/vision-synthesis.js` already
  classifies free-text inputs by dimension. Training extends that with
  per-channel authenticity priors (see `docs/PLATFORM-INTENTIONALITY.md`).
- **State** — world-loop state lives in
  `Tiwari/tiwari-training/world/state/*.json` (versioned, published).
  Sagar-loop state lives in his amber-id Postgres (private).

## World-loop cadence

Sundays, 09:00 UTC:

- `world:peoplerank` — re-fit dimension edge priors from the last 7 days
  of public signals (tagged Substack, YouTube, LinkedIn, IG-public) across
  the curated "goodness reference set." Writes
  `Tiwari/tiwari-training/world/state/peoplerank-<iso-week>.json`.
- `world:enrich` — re-fit pipe-trust priors + dimension-classifier
  weights. Writes `enrich-<iso-week>.json`.
- `world:opportunity` — re-fit reward hyperparameters (γ, μ, λ). Writes
  `opportunity-<iso-week>.json`.

Each writes a commit message explaining what moved and why, on a branch
`training/world/<iso-week>` with a draft PR.

## Sagar-mirror cadence

- `sagar-mirror:peoplerank` — nightly, 02:00 UTC (7 PM PT). Re-runs
  personalized PageRank over Sagar's contact graph with today's
  interaction weights from whatever ingested digital exhaust exists.
- `sagar-mirror:enrich` — nightly, 02:15 UTC. Runs Dempster-Shafer over
  every contact touched today from any pipe, with intentionality priors
  applied per channel.
- `sagar-mirror:opportunity` — nightly, 02:30 UTC. Updates LinUCB arms
  using any available reward signal (check-in deltas if they exist,
  engagement proxies otherwise).

All three read from amber-id ingest pipes and write back scores through
amber-id endpoints — never bypass. None of them send anything to Sagar
or depend on Sagar interacting with Amber that day.

## Goodness signal

The world loop learns **acting in the mode of goodness** (redemptive,
truth-seeking, spiritually oriented). The label is not a binary; it is a
distribution over the six dimensions weighted by context:

```
goodness_score = Σ_d  ω_d × authenticity_prior(channel, env, sobriety) × belief_d
```

where `belief_d` is the dimension-d belief from Dempster-Shafer fusion,
and `authenticity_prior` is the channel-context term from
`docs/PLATFORM-INTENTIONALITY.md`.

## Relationship to the product track

The product track (Amber's iMessage check-ins — morning emotional,
evening physical, Sunday spiritual) writes its answers to
`/ingest/checkin` with the appropriate dimension. Those records are
**one** of the sources the Sagar-mirror nightly jobs read from. They are
 not required; they are welcome. See `docs/CHECKIN-PRODUCT.md` for the
product-side spec.

## Safety

- World-loop writes are **proposed** (draft PR). No direct main edits.
- Sagar-loop writes go into amber-id scoring tables; they do not mutate
  user-visible content.
- Every training run logs its input window, hyperparameters, and output
  deltas to `Tiwari/tiwari-training/runs/<iso-timestamp>.json` for audit.
