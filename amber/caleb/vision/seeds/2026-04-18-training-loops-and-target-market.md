# Training loops, intentionality, and target market

> Seed captured 2026-04-18 from Sagar's voice note. Canonical. Do not edit
> except to clarify; append new seeds instead.

## The two ways every Tiwari primitive is trained

Each of the three primitives (peoplerank, enrich, opportunity) runs in
**two loops**:

1. **World loop** — in-depth refinement of weights across inputs,
   communication styles, and audiences. Goal: learn who is acting in the
   mode of goodness (redemptive, truth-seeking, spiritually oriented) vs.
   not. This is the macro model. It reads public/semi-public signals and
   adjusts priors across the six health dimensions.

2. **Sagar loop (amber-id level)** — continuously refines from Sagar's
   constant digital + IRL interactions. Sagar is the **base case** of
   the target market because he believes he has the broadest life
   experience of it. Caleb is the **abstract visionary** base case —
   surfacing functionality that may be useful at many moments but does
   not necessarily map to the target persona.

Both Sagar and Caleb are willing to give all their data to this vision to
inspire others to do the same, so the network can learn how our
interactions make others healthier — or not. A coalition / sisterhood of
women will be recruited to contribute the feminine side of this data, the
way women build healthy relationships.

## Target market (explicit)

**Diverse, T-25-college-educated, health-minded, business professionals
to-be.** Canonical persona: a USC sophomore, international Korean woman,
wants to work at McKinsey and loves to have a fun life.

Every product decision ships through that persona before it ships to the
public.

## Weight and intentionality of communication

Not all signal is equal. Channels carry different intentionality priors.
Across channels and environments, the belief that a given message
reflects the wearer's spiritual truth is modulated by:

| Channel / context | Authenticity prior | Note |
|---|---|---|
| Substack | **highest** (text) | Most authentic written form; aims to be Sagar's spiritual-health writing |
| YouTube | **highest** (multimedia) | Most authentic multimedia; spiritual-health video |
| Voice to Perplexity / Amber | high | Voice > typed: captures clarity of thought |
| Typed to Perplexity / Amber | medium | Faster but more curated |
| Instagram | nuanced | Public persona; biased toward performance |
| LinkedIn | nuanced | Professional persona; biased toward career signals |
| Other online comms | variable | Always carries bias |
| IRL conversation (remembered) | **highest among all** | Who you saw today, how you remember them |

Additional modulators applied on every packet:

- **Sobriety state** at time of the interaction
- **Environment** at time of the interaction (room, weather, city, group)
- **Relationship** — who Sagar was with when he said / wrote it

## Platform → Tiwari primitive mapping (current, will evolve)

Sagar will provide priorities/weightages between platforms over time. The
current seed mapping:

| Sagar's current platform | Tiwari primitive it feeds |
|---|---|
| Apple Contacts | tiwari-peoplerank (graph + relationship scoring) |
| Find My Friends | tiwari-enrich (location-derived evidence records) |
| Dimensional | tiwari-opportunity (state / context triggers) |
| Instagram | tiwari-opportunity (social context + nuanced auth prior) |
| LinkedIn | tiwari-opportunity (professional context + nuanced auth prior) |
| Substack | tiwari-enrich (highest-auth written) |
| YouTube | tiwari-enrich (highest-auth multimedia) |

## The Amber ⟷ Perplexity split (reaffirmed)

- **Amber** is a thin wrapper around Perplexity for social / intellectual
  / financial. Perplexity is Sagar's assistant in those three dimensions
  because he trusts its technology.
- **Amber** focuses training on:
  1. People-first modeling — network, graph, relationships.
  2. Spiritual / physical / emotional health — the three dimensions that
     require more user input and processing of abstract content that
     even spatial or immersive video cannot yet understand.

Training effort is disproportionately invested in the three Amber-owned
dimensions because existing data sources are shallow there.

## Base case: Sagar

- Sagar is the ground truth for target-market fit.
- Caleb is the ground truth for abstract functionality that might be
  useful at a moment.
- Both Sagar and Caleb are trying to be redemptive, chasing spiritual
  visions. Both are human and make mistakes. The training loops
  explicitly account for **this** being the truth of the base cases:
  the model is **not** trying to learn "perfection," it is trying to
  learn redemptive intentionality.

## Proactive check-in policy (product track)

> The training crons and the check-in crons are **not** the same thing.
> Training refines weights continuously on Perplexity Computer. Check-ins
> are a human-feedback product loop. They share the six-dim ontology and
> the four-pipe ingest, nothing else.

- **Morning (7:30 AM PT)** — emotional dimension. "How do you feel? What
  did you dream?"
- **Evening (9:30 PM PT)** — physical dimension. "Who did you meet IRL?
  What did you do? What environments were you in?"
- **Sunday (10:00 AM PT)** — spiritual dimension. Weekly reflection.

Transport: Loop Message iMessage. Phase 0 routes to Caleb's phone (the
only one wired today). Phase 1 (in ~2 days) adds Sagar's Loop number.
Phase 2 generalizes: every Amber cNFT mint provisions its own Loop
number.

## Governance

These doctrine claims live under `vision/seeds/` and are **canonical**.
If they conflict with code, the code is wrong.
