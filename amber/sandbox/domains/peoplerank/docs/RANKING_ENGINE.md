# PeopleRank ranking engine: deploy and tuning contract

This documents the ranking engine that Tab 13 owns: `api/people_rank.py`,
`api/rationale.py`, `api/scoring.py`, and the shared `api/persist_cache.py`.
It is the contract between this FastAPI service and the surfaces that call it
(the Amber middle tab via medha-id, and UC1/UC3 event matching).

## Surfaces

| Endpoint                                           | Handler                      | Engine module                                                                  | Consumer                                                        |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `POST /v1/me/people-rank`                          | `main.people_rank`           | `people_rank.run_people_rank`                                                  | Amber middle tab (through medha-id, `PEOPLERANK_ENGINE=togari`) |
| `POST /v1/match/community-event`                   | `main.match_community_event` | `scoring.score_people_openai` + `rationale.generate_rationale`                 | UC1 pair matching                                               |
| `POST /v1/match/community-event` (with `grouping`) | `main.handle_uc3`            | `scoring` + `rationale.generate_member_rationale` / `generate_group_rationale` | UC3 group matching                                              |

## Deploy wiring

- Build: `railway.json` -> `DOCKERFILE` -> `Dockerfile`.
- Start: `uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}`.
- Railway sets `PORT`. The container exposes 8000 as a default.

## Required environment

| Var                 | Used by                               | Effect if missing                                                                                                                            |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLIND8_API_KEY`    | `api/auth.py` bearer check            | Every request 503s. Hard requirement.                                                                                                        |
| `OPENAI_API_KEY`    | embeddings (`scoring`, `people_rank`) | Ranking degrades: `people_rank` falls back to local TF-IDF then keyword overlap; `score_people_openai` will raise (UC1/UC3 need embeddings). |
| `ANTHROPIC_API_KEY` | rationales + grounded answer          | `people_rank` returns ranked people with `answer_status="no_key"` and no prose; UC1/UC3 rationales return best-effort/unavailable.           |

## Optional tuning (no redeploy needed, read at import)

### Ranking blend (`people_rank.py`)

| Var                           | Default | Meaning                                                                                                                    |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PEOPLERANK_W_RELEVANCE`      | `0.85`  | Weight on query relevance in the final score when a query is present.                                                      |
| `PEOPLERANK_W_WARMTH`         | `0.15`  | Weight on structured warmth (tie-breaker toward close contacts).                                                           |
| `PEOPLERANK_ANSWER_TIMEOUT_S` | `20`    | Per-request timeout on the grounded-answer Claude call. On timeout the people still return with `answer_status="timeout"`. |

Weights are renormalized, so they need not sum to 1. With no query, warmth
carries the whole signal regardless of the weights.

### Relevance fallback chain (`people_rank.py`)

`OpenAI embeddings` -> `local TF-IDF cosine` -> `keyword (Jaccard) overlap`.
Each step is tried only when the previous one fails or is unavailable, so the
tab always returns a ranked list even with no embeddings key.

### Rationale generation (`rationale.py`)

| Var                     | Default  | Meaning                                                                                                                                                                 |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATIONALE_MAX_RETRIES` | `1`      | Generate-and-validate attempts before returning best-effort text.                                                                                                       |
| `RATIONALE_TIMEOUT_S`   | `30`     | Per-call Claude timeout (sync and async paths).                                                                                                                         |
| `RATIONALE_STRICTNESS`  | `strict` | `strict` rejects on any banned phrase or detected name. `relaxed` keeps hard rules (em dash, length, sentence count) but downgrades soft style violations to a warning. |
| `RATIONALE_CONCURRENCY` | `8`      | In-flight cap for the async batch path (`generate_rationales_batch`).                                                                                                   |

### Caching (`persist_cache.py`)

| Var                         | Default             | Meaning                                                                  |
| --------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `PEOPLERANK_CACHE_DIR`      | `.peoplerank_cache` | Where score and rationale JSON caches are written.                       |
| `PEOPLERANK_CACHE_DISABLED` | unset               | Set to `1` to force fresh scoring and rationales (skips read and write). |

Both caches are content-addressed (SHA-256 of model id + exact inputs). A
retried event match with the same roster returns identical scored pairs and
rationales instantly with zero API spend. Bump `_SCORE_CACHE_VERSION` /
`_RATIONALE_CACHE_VERSION` when the algorithm or prompt changes so stale
entries are not served after a deploy.

## Response contract (`/v1/me/people-rank`)

The body matches what `apps/mobile/lib/peoplerank.ts` parses. Pinned by
`tests/test_response_shape.py`.

```jsonc
{
  "query": "who do I know in venture", // or null
  "count": 3,
  "people": [
    {
      "contactId": "c1",
      "name": "Ada Lovelace",
      "company": "Analytical Engines", // nullable
      "title": "Founder", // nullable
      "score": 0.82, // 0..1
      "components": {
        "warmth": 0.5,
        "centrality": 0.0,
        "recency": 0.0,
        "relevance": 0.82,
      },
      "reason": "Strong match for what you asked. Founder at Analytical Engines.",
      "profile": { "email": null, "phone": null, "source": "apple" },
      "links": [],
    },
  ],
  "answer": "Reach out to Ada [[p:c1]] first ...", // or null
  "answer_status": "ok", // ok | no_key | skipped | timeout | error
  "citations": [
    {
      "marker": "[[p:c1]]",
      "contactId": "c1",
      "name": "Ada Lovelace",
      "company": "Analytical Engines",
      "title": "Founder",
      "score": 0.82,
      "rank": 1,
    },
  ],
}
```

`centrality` and `recency` are reported as `0.0` today: graph centrality and
interaction-recency are server-side seams not yet wired into this engine.

## Tests

Offline, no network, no API spend (run from the repo root):

```bash
python -m unittest tests.test_response_shape tests.test_rationale_validator tests.test_persist_cache
```
