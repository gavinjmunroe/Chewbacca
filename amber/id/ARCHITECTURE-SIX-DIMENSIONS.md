# The Six Dimensions of Health — Amber's Canonical Ontology

Every piece of data in the Amber ecosystem — every Pinecone vector in
`amber-id`, every Tiwari algorithm score in `amber-agent`, every agent
reasoning trace, every check-in, every wearable sample — is tagged with
exactly one of six dimensions (or `*` for cross-dimensional data).

This document is the schema. It is the ontology under which Amber
accumulates the authoritative private dataset of human connection and
health. Changes to this document are changes to the foundation of the
company.

---

## The Six Dimensions

From `Newton/agent/lib/health.js`, preserved verbatim.

| # | Code         | Color   | Gender-coded | Tracks |
|---|--------------|---------|--------------|--------|
| 1 | `spiritual`  | Purple  | Feminine     | Purpose, faith, alignment, inner peace, mindfulness |
| 2 | `emotional`  | Red     | Feminine     | Mood, regulation, distress signals, peace |
| 3 | `physical`   | Green   | Feminine     | Energy, sleep, movement, nutrition, rest |
| 4 | `intellectual` | Orange | Masculine    | Learning, curiosity, mental engagement, growth |
| 5 | `social`     | Blue    | Masculine    | Connection quality, community, belonging, relationships |
| 6 | `financial`  | Teal    | Masculine    | Career momentum, stability, professional networking, abundance |

Three are feminine-coded (spiritual, emotional, physical), three
masculine-coded (intellectual, social, financial). This is not
decorative — it reflects the wholeness Amber is built to restore:
a person is balanced when all six are tended.

The split is also how Amber and Perplexity divide the world. Amber
natively owns the three feminine dimensions (spiritual/emotional/
physical — the connection hemisphere). Perplexity natively owns the
three masculine dimensions (intellectual/social/financial — the
knowledge hemisphere). Neither side is complete alone. See
`amber-agent/docs/PERPLEXITY-AMBER.md` for the full two-hemisphere
doctrine.

**Never invent new dimensions.** Never merge two into one. Never rename
them. These six are the schema of the product and the schema of the
company. Never use "mental health" as a catch-all — it collapses
emotional, spiritual, and intellectual into one fuzzy bucket and
destroys the resolution Amber depends on.

---

## Data Contract

### Every Pinecone vector MUST carry

```jsonc
{
  "user_cnft":       "<base58 Solana mint address>",  // required
  "source":          "agent" | "health" | "checkin" | "relationship",
  "kind":            "imessage" | "oura_sleep" | "daily_score" | ...,
  "health_dimension": "spiritual" | "emotional" | "physical"
                    | "intellectual" | "social" | "financial"
                    | "*",           // "*" only for truly cross-dimensional signals
  "secondary_dimensions": [],         // optional; 0-2 additional dimensions
  "dimension_scores": {               // optional 0-10 per dimension this vector evidences
    "spiritual": 7, "emotional": 4, ...
  },
  "person_id":       "<self|graph-node-id>",
  "person_name":     "<optional display name>",
  "visibility":      "private" | "mutual" | "public",
  "trust":           0.0-1.0,          // set by the ingestion pipe, see below
  "text":            "<the chunk of text being embedded>",
  "created_at":      "<ISO8601>",     // when the data was created in the real world
  "ingested_at":     "<ISO8601>"      // when amber-id received it
}
```

`health_dimension` is **required**. Ingestion rejects vectors without it.

### Cross-dimensional data

Use `"*"` only when the signal is genuinely cross-cutting (e.g., a
photo of a family dinner that evidences social + emotional + physical
simultaneously). Prefer `primary + secondary_dimensions` over `"*"`.

### Dimension scores vs. tags

- `health_dimension` is categorical (the vector *is about* this dimension).
- `dimension_scores` is numerical (this vector *evidences* these scores).

Example: a BeReal check-in might be tagged `health_dimension: "*"` and
carry `dimension_scores: { social: 9, emotional: 7, physical: 5 }`.

---

## The Four Ingestion Pipes

amber-id data enters through exactly four pipes, each with its own
trust score, retention policy, and consent model.

| Pipe | Endpoint | Source | Default trust | Consent model |
|---|---|---|---|---|
| Agent | `POST /ingest/agent` | Autonomous agents reading iMessage, Gmail, Calendar, LinkedIn, WhatsApp, Slack, etc. | 0.65 | Blanket OAuth at first connection; per-source revocable |
| Health | `POST /ingest/health` | Apple Health, Oura, Whoop, Garmin, future Amber hardware | 0.95 | HealthKit authorization; device-level opt-in |
| Check-in | `POST /ingest/checkin` | Daily BeReal-style user self-reports, 6-dim scores, freeform text | 1.00 | User self-authored; always highest trust |
| Relationship | `POST /ingest/relationship` | Data *about another person* (not self) | 0.50 | Stricter: requires `person_id` consent graph; subject can revoke |

**Trust scores feed `/ask` retrieval.** A check-in at trust=1.00 outranks
a scraped LinkedIn note at trust=0.65 for the same query.

**Relationship pipe is the sensitive one.** Anything about another person
requires:
- The `person_id` must resolve to a known entity in the user's relationship graph
- If the subject is also an Amber user (their cNFT is known), they get
  notification and can revoke
- Visibility defaults to `private` and can be upgraded to `mutual`
  (both parties see) or `public` (graph sees) only with explicit action

---

## Tiwari Algorithms Must Be Dimension-Aware

Every Tiwari primitive operates under the six dimensions:

- **tiwari-peoplerank** — runs a *personalized random walk per dimension*
  and fuses the six dimensional stationary distributions into a joint
  score. See `Tiwari/papers/peoplerank.tex` for the formalism.
- **tiwari-enrich** — fuses evidence from Togari (web/scraped) and
  amber-id (private) using Dempster-Shafer combination, with belief
  masses distributed across dimensions. See `papers/enrich.tex`.
- **tiwari-opportunity** — bandit policy optimizes for
  *dimension-balanced* human connection. Reward function includes a
  diversity term that penalizes overserving one dimension. See
  `papers/opportunity.tex`.

---

## Why This Matters

The six dimensions are **the moat**. Competitors will scrape the same
LinkedIn profiles, ingest the same iMessages, build the same agent
loops. What they will not do — because they do not have our philosophy
— is organize all that data under a coherent, whole-human ontology that
makes Amber's answers feel like wisdom rather than data.

Perplexity organizes the world's information. Amber organizes every
person's inner and relational life — and the six dimensions are the
Dewey Decimal System of that library.

---

## Evolution Rules

- **Adding a dimension** requires: (1) this doc updated, (2) Newton's
  `health.js` updated, (3) a migration for every existing vector
  (they must get a value for the new dimension), (4) every Tiwari
  algorithm re-derived, (5) a written justification in `vision/`.
  This is a foundational change. Treat it like a constitutional
  amendment.
- **Renaming a dimension** is forbidden. If the concept of one dimension
  evolves, update its description here but keep the code stable.
- **Removing a dimension** is forbidden. Period.
