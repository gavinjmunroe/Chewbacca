# PeopleRank v2 design

Owner workstream: Caleb + Shirley, on branch `feat/peoplerank-v2` in
`amber-organization/togari-search` (Karthik's production PeopleRank engine).
This is the design we build against. It is the synthesis of Karthik's guidance,
the reference articles he sent, and the decisions locked with Caleb.

Status: design locked, implementation sequenced. Nothing here changes the live
`main` engine until it is proven on the eval harness and reviewed by Karthik.

---

## 1. What we are building, in one paragraph

PeopleRank v2 is a multi-stage people recommender. Given a person (the user) and
an intent ("who should I reconnect with to invite to my LA housewarming",
"who could intro me to a healthcare founder"), it retrieves candidates from the
user's own network, scores them with intent-conditioned signals, and returns a
ranked list with a reason per person. It is not keyword matching ("blonde model
in, 50 blonde models out"). It conditions on why you are matching, weighs the
factors a good human connector actually uses (geography, alma mater, vibe,
momentum, mutual ties, warmth), and gates hard on the things that must never be
violated (do-not-contact, dealbreakers).

---

## 2. Decisions locked

| Decision                           | Choice                                                                                       | Why                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Where the algorithm lives          | Branch in `togari-search` (PeopleRank), not a new repo                                       | Karthik: the engine already APIs anywhere; a separate deploy is wasted surface                               |
| v1 shape                           | One-sided ranking ("who should I reach out to")                                              | Matches the Clay outbound / warm-network revenue thesis; no stable-matching stage needed yet                 |
| Immutable spine                    | Canonical row in BigQuery (alongside DNC), Clay enriches it                                  | Karthik: immutables stay consistent and are always enriched; reuse the structured store DNC already lives in |
| Variable + derived data            | Pinecone embeddings (per-user namespace)                                                     | "Vectorization over schema rigidity"; this is the soft-signal layer                                          |
| Centrality (personalized PageRank) | Designed now, implemented after the harness proves the simpler features                      | Avoid guessing; only add it once we can measure that it helps                                                |
| Outcome signal for learning        | Sagar / Maggie manual thumbs up/down on suggested matches                                    | Highest-quality label we can get now; the placebo loop that props up dating apps does not transfer to us     |
| Proof of quality                   | Both: offline eval harness on Carlo's Blind Aid data + internal stress test on team contacts | Every change measured, not vibed                                                                             |
| DNC                                | Extend Karthik's existing BigQuery DNC (`togari_dnc.contacts`, `/api/dnc/check`)             | Already wired for Clay; do not rebuild                                                                       |

---

## 3. Architecture: a multi-stage recommender

Every resource Karthik sent is one stage of the same standard pipeline. This is
what "sophisticated and not brute-forced" actually means in practice.

```
Stage 0  Canonical identity + enrichment   (immutables; IBM personalization)
            -> every contact gets a consistent enriched spine
Stage 1  Retrieval                          (shaped.ai "narrow the pool")
            -> vector recall from Pinecone + hard gates (DNC, geography)
Stage 2  Scoring / ranking                  (learning-to-rank articles)
            -> intent-conditioned features, pointwise -> pairwise later
Stage 2.5 Authority via personalized PageRank (techrxiv + Google PageRank)
            -> who is central/influential in THIS user's graph (the centrality
               signal currently pinned at 0.0)
Stage 3  Allocation                         (NRMP / Gale-Shapley stable matching)
            -> ONLY for two-sided or group matching. Not in v1.
Stage 4  Outcome loop                       (IBM personalization + ELO)
            -> log thumbs, learn weights/ratings over time
```

Article-to-stage map (so the reading is not abstract):

- NRMP "How the Matching Algorithm Works": applicant-proposing deferred
  acceptance, i.e. Gale-Shapley stable matching. Relevant only to Stage 3
  (two-sided / group). v1 is one-sided, so we note it and skip it.
- shaped.ai "Modern ranking models": the retrieval -> scoring -> ordering
  pipeline, and pointwise/pairwise/listwise. This is Stages 1 and 2.
- towardsdatascience + ACM ranking papers: the same learning-to-rank family in
  more depth. They inform how we train Stage 2 once we have labels.
- techrxiv PageRank + Google ranking systems: Stage 2.5. Personalized PageRank
  seeds the random walk at the user, so it is inherently per-user. "Health
  oriented" means we can later run it per health dimension.
- IBM AI personalization: Stage 0 (know the entity) and Stage 4 (adapt per user).

---

## 4. The "ELO" question, answered honestly

ELO is a rating updated from match outcomes (who won). PeopleRank today is a
one-shot compatibility score with no outcome loop, so calling it ELO now would
be cargo-culting. We split it into two layers:

- Layer 1 (build now): intent-conditioned compatibility. The same pair scores
  differently depending on the intent. Cofounder, date, hire, investor, and
  friend are different objective functions over the same data. Intent is an
  explicit input that reweights the signals. This is the core anti-rote lever.
- Layer 2 (architect now, populate later): an outcome ledger. Every suggested
  match can receive a Sagar/Maggie thumb. Those labels are the only thing a
  real ELO-style rating could ever learn from. We design the table and the
  write path now even while it is empty, then turn on learned weights once
  there is enough signal.

Honest caveat we are designing around (Caleb's insight): dating apps partly
"work" via a placebo / self-fulfilling-prophecy effect that does not transfer to
us, and social connection has weaker intrinsic motivation than romance. So our
outcome signal is sparse and noisy. We therefore weight observed/expert labels
(thumbs, and peer reviews in eval) over self-reported satisfaction, and we do
not expect dating-app engagement baselines.

---

## 5. Data taxonomy

Three tiers, plus a gate layer on top.

### Immutable / slow facts (canonical spine, BigQuery, Clay-enriched)

name, phone number, geographic location, gender, age / DOB, alma mater,
languages. Stable, high-trust, always enriched. Used for hard filters and as
stable features. This is Karthik's list.

### Variable / state (Pinecone embeddings + structured where useful)

current city, role, company, interests, "recently moved", life situation,
availability. Changes often; needs recency decay; mostly soft signal.

### Derived / inferred (computed, never self-stated)

vibe, humor, values, archetype, seniority, influence / centrality. Computed
from text (embeddings) and the graph (personalized PageRank). This is the
"Sagar intuition" layer expressed as features.

### Hard gates (cross-cutting, always enforced before ranking)

- Do-not-contact (Karthik's BigQuery DNC). Always.
- Dealbreakers for the specific intent (e.g. geography for an in-person intro,
  same-company exclusion for certain intros).

Storage principle: keep a thin structured spine only for the few things we must
filter or gate on, and embed everything else. That honors "data agnostic /
vectorization over schema" without letting DNC or a dealbreaker leak through a
vector.

---

## 6. v1 scope (one-sided ranking)

Input: `{ user, intent, candidates[] }` where candidates are the user's own
contacts. Output: ranked candidates with a per-person reason.

Pipeline for v1:

1. Gate: drop DNC and intent-dealbreakers.
2. Retrieve: embed the intent, vector-recall top N from the user's namespace.
3. Score: intent-conditioned blend of
   - relevance (intent vs candidate embedding),
   - warmth (closeness to the user; same-city, shared field),
   - immutable affinity (shared alma mater, geography, age band where it helps),
   - recency (how recently in touch),
   - centrality placeholder (0.0 until Stage 2.5 lands).
4. Order and return top K with reasons.

What v1 deliberately excludes: stable-matching allocation (Stage 3), live ELO
updates (Stage 4 is logged but not yet learned from), personalized PageRank
(designed, implemented after harness).

---

## 7. Testing data: Sagar's contacts

Sagar's contacts live in medha-id (Firestore canonical + Pinecone DID namespace
`tenant-did-privy-cmobxrpvr00ml0cjp5gq5mdyd`, index `amber-people`). PeopleRank
is stateless about contacts: it receives them in the request body. So "test on
Sagar's contacts" means:

- Live path: Clay or a caller hits medha-id `/internal/users/:did/people-rank`,
  which loads Sagar's contacts and calls this engine. Already wired.
- Dev/eval path: export Sagar's contacts to JSON once and run the engine /
  harness against the file offline (no medha-id round-trip while iterating).

Action item: add a small exporter (medha-id side) that dumps a DID's contacts to
the engine's `contacts[]` shape for offline runs.

---

## 8. Clay integration (the four jobs)

All four route through medha-id (the only service allowed to touch Pinecone /
Firestore) and, where ranking is needed, into this engine.

| Clay job                                | Path                                                                     | Notes                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Semantic find ("who do I know that...") | medha-id `/internal/users/:did/people-rank` (query) -> this engine       | Already live                                            |
| Dedup / "already known?"                | medha-id contacts vector near-match (new thin endpoint)                  | Distinct from the exact phone/email match already built |
| Enrich on entry                         | Clay enrichment -> writes the BigQuery immutable spine + medha-id upsert | Fills Stage 0                                           |
| DNC check                               | Karthik's `/api/dnc/check` (BigQuery)                                    | Reuse as-is                                             |

---

## 9. Personalized PageRank (designed, deferred)

Build a directed/weighted graph of the user's network (edges from co-occurrence,
mutual contacts, interaction frequency). Run personalized PageRank seeded at the
user to get a per-user centrality/authority score per contact. Optionally run it
per health dimension later (a topic-sensitive PageRank) so "who is central in my
financial world" differs from "who is central in my spiritual world." This
replaces the 0.0 centrality seam. We implement it only after the harness shows
the simpler features are solid and can measure PageRank's marginal lift.

---

## 10. Proof: eval harness + internal stress test

### Offline eval harness (on Carlo's Blind Aid JSON)

Carlo's data has profiles, personality assessments, peer reviews, and real
compatibility outcomes. The engine's `score.py` already has a `--blind
--validate` mode to extend.

- Blind the inputs (strip post-event signal), produce ranked matches.
- Score against ground truth. Metrics:
  - precision@k and recall@k vs peer-reviewed good matches,
  - rank correlation (Spearman) between our score and peer-review compatibility,
  - for any group data, intra-group cohesion.
- Every algorithm change reruns the harness; we accept a change only if a metric
  improves. This is the discipline that keeps us out of brute-force land.

### Internal stress test

Run on Sagar / Karthik / team contacts and eyeball the suggestions and reasons.
Sagar/Maggie thumbs feed both this and the Stage 4 outcome ledger.

---

## 11. Build sequence

1. Branch + this doc (done).
2. Contacts exporter (medha-id) -> Sagar's contacts as `contacts[]` JSON.
3. Eval harness: wire Carlo's JSON through `--blind --validate`, add the metrics
   above, establish a baseline number for today's engine.
4. v1 ranking changes behind the harness: intent input, intent-conditioned
   weights, immutable-affinity feature, hard-gate layer. Measure each.
5. Outcome ledger (Stage 4) table + thumb write path. Empty but live.
6. Personalized PageRank (Stage 2.5) once 4 is proven; measure lift.
7. Clay endpoints: dedup near-match + enrichment write-back.
8. PR to Karthik for review before anything touches `main` / prod.

---

## 12. Open dependencies (what we need)

- Confirm `feat/peoplerank-v2` is the agreed branch with Shirley (and Karthik's
  blessing to push it).
- Carlo's Blind Aid JSON (path or file) for the harness ground truth.
- BigQuery access + the immutable-spine table schema (or agree it with Karthik).
- Confirm the intent vocabulary for v1 (cofounder / date / hire / investor /
  friend / reconnect / event-invite), since intent conditioning is the core.
