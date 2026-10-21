# Platform intentionality — authenticity priors by channel

> Not all signal is equal. This table is the single source of truth for
> the `authenticity_prior(channel, env, sobriety, relationship)` term
> that modulates every Tiwari evidence packet.

## Channel priors (base value, 0..1)

| Channel | Prior | Dimension bias | Notes |
|---|---|---|---|
| Substack | 0.95 | spiritual, intellectual | Sagar's most authentic written form |
| YouTube | 0.95 | spiritual, intellectual, emotional | Most authentic multimedia |
| Voice to Amber / Perplexity | 0.85 | cross | Captures clarity of thought; modulated by environment |
| Typed to Amber / Perplexity | 0.70 | cross | Faster but more curated |
| IRL conversation (remembered same day) | 0.90 | cross | Highest relational authenticity when fresh |
| IRL conversation (remembered 1+ days later) | 0.60 | cross | Memory decay penalty |
| Instagram — stories | 0.50 | social | Public performance; lower weight |
| Instagram — DMs | 0.75 | social, emotional | Private; more authentic |
| LinkedIn | 0.45 | financial, intellectual, social | Professional persona skew |
| Slack / work chat | 0.55 | intellectual, financial | Work-mode bias |
| iMessage (Amber check-ins) | 0.90 | dimension of the check-in | First-person pipe |
| Email | 0.65 | varies | Context-dependent |

Defaults for unlisted channels: `0.50`, cross-dimensional.

## Context modulators (multiplicative)

Each packet's `authenticity_prior` = `channel_base × ∏ modulators`:

| Modulator | Range | Notes |
|---|---|---|
| Sobriety — sober | 1.00 | |
| Sobriety — social drinking | 0.85 | |
| Sobriety — intoxicated | 0.55 | |
| Sobriety — unknown | 0.90 | |
| Environment — home (solo) | 1.00 | Calibration baseline |
| Environment — home (with others) | 0.95 | |
| Environment — work / school | 0.90 | |
| Environment — retreat / nature | 1.05 | Slight uplift for spiritual + emotional packets |
| Environment — nightlife / party | 0.75 | |
| Environment — transit | 0.85 | |
| Relationship to addressee — close (inner circle) | 1.00 | |
| Relationship to addressee — acquaintance | 0.90 | |
| Relationship to addressee — stranger / public | 0.80 | |
| Time of day — 5–9 AM | 1.05 | Morning clarity uplift (emotional packets) |
| Time of day — 10 PM – 2 AM | 0.90 | Late-night lucidity penalty except on voice+journal |

Modulators clamp `authenticity_prior ∈ [0.2, 1.0]` after multiplication.

## Dimension biasing

Each channel carries a **dimension bias vector** — a soft prior over the
six dimensions that the channel's content is more likely to speak to.
The dimension-classifier (amber-id `lib/dimension-classifier.js`) seeds
its output with this prior before the per-text classification runs.

Example: a Substack post defaults to `[0.35 spiritual, 0.15 emotional,
0.10 physical, 0.30 intellectual, 0.05 social, 0.05 financial]` before
the classifier sharpens it with the actual text.

## Writing new channel priors

When Sagar (or Caleb) adds a new platform to training, they update this
doc first — then the world-loop training run picks up the new prior on
its next Sunday cycle. The world loop never invents priors on its own;
it can only refine existing ones.

## Current platform → primitive mapping (seed)

| Platform | Tiwari primitive |
|---|---|
| Apple Contacts | tiwari-peoplerank |
| Find My Friends | tiwari-enrich |
| Dimensional | tiwari-opportunity |
| Instagram | tiwari-opportunity |
| LinkedIn | tiwari-opportunity |
| Substack | tiwari-enrich (high-auth written) |
| YouTube | tiwari-enrich (high-auth multimedia) |

This mapping is a **seed**; Sagar will adjust weightages as the system
matures.
