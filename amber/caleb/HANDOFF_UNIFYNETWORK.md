# HANDOFF — UnifyNetwork (Connection Graph) consumer port

This document is the operator handoff for the **UnifyNetwork** consumer feature:
the CTO's `connection_network` engine ported into medha-platform, fronted by a
caller-scoped consumer API at `/v1/network/*` that the **amber-ios** app calls
with the same medha-id Privy JWT it already uses for `/api/ask/stream`.

**Status: code + tests + docs only. NOT deployed (no infra creds were used).**
Open the PR, then a human runs the Railway deploy steps in section (f).

---

## (a) What was ported and where

The CTO's engine was copied **faithfully** (no logic gutted, both test files
intact) from the read-only source repo `amber-organization/togari-bma-dvlp`
(`connection_network/`) into a self-contained directory in this repo:

```
Newton/agent/connection-network/
├── a_foundation/        bigquery_setup.py, schema.sql   (dataset bootstrap)
├── b_identity/          resolver.py                     (name/pHash/match scoring)
├── c_threshold/         inclusion.py                    (AUTO_MERGE / REVIEW thresholds)
├── d_integrations/      adapters.py, base.py            (source adapters)
├── e_classifier/        classifier.py                   (personal/professional/mixed)
├── f_platforms/         adapters.py                     (platform adapters)
├── g_events/            pubsub.py                       (Pub/Sub ingestion)
├── h_security/          security.py                     (KMS-CMEK, tenant scoping)
├── i_api/               app.py, admin_cli.py            (FastAPI surface)  ← only edited file
├── j_observability/     observability.py                (Cloud Monitoring)
├── tests/               test_all.py, test_auth.py       (CTO test suites, unchanged)
├── docs/                developer_guide.md, tos_compliance_matrix.md
├── terraform/           main.tf
├── consumer/            network-proxy.js                ← NEW: Medha consumer surface
├── conftest.py          ← NEW: pytest import path + import-time env defaults
├── pytest.ini           ← NEW: asyncio_mode=auto, testpaths=tests
├── requirements.txt     (engine runtime deps, from source)
├── requirements-test.txt← NEW: test-only deps
└── .gitignore           ← NEW: excludes __pycache__/*.pyc
```

Only **one** file inside the copied engine was edited: `i_api/app.py`, to add an
**optional, flag-gated** Medha consumer-auth path (section (b)). Everything else
is verbatim. The engine's original Auth0 verification is fully preserved and is
the default; `tests/test_auth.py` (all Auth0 cases) still passes.

Node side: `Newton/agent/lib/server.js` got one import + one routing block.

PeopleRank / togari-search is untouched and out of scope.

---

## (b) How consumer auth works + which middleware

**One token, two data planes.** amber-ios sends its medha-id-issued **Privy JWT**
(the exact token medha-platform already verifies for `/api/ask/stream`). There is
no second auth system on this surface.

1. **Node consumer proxy** (`connection-network/consumer/network-proxy.js`)
   verifies the JWT using the **existing** `verifyPrivyJwt` / `extractPrivyToken`
   from `Newton/agent/lib/privy.js` — the same verifier used by the Tiwari proxy.
   It derives the caller's `did` (Privy DID) and scopes every response to it.
   No tenant identity is ever read from the request body or query.

2. **Pinecone plane (`POST /v1/network/search`)** runs **in-process**: the proxy
   calls `executeContactsSearchTool("search_contacts", …, { tenant: { privyDid: did } })`
   from `Newton/agent/lib/tools/contacts-search.js`. This reuses the existing
   unified-people-graph search against the caller's per-tenant Pinecone
   namespace. No new Pinecone wiring.

3. **BigQuery plane (`/check`, `/identities`, `/identities/{id}`, `/connections`)**
   is proxied server-to-server to the ported FastAPI engine. The Node proxy
   forwards the already-verified DID via headers:
   - `x-medha-proxy-secret: <MEDHA_NETWORK_SHARED_SECRET>` (shared secret)
   - `x-medha-tenant: <did>` and `x-medha-user: <did>`
   - `authorization: Bearer medha-proxy` (HTTPBearer requires the header present)

   The engine trusts this **only** when `MEDHA_AUTH_ENABLED=true`. In
   `i_api/app.py`, `_verify_medha_consumer(request)` constant-time-compares the
   shared secret (`hmac.compare_digest`) and returns
   `{user_id, tenant_id: did, role: "owner"}`. `get_current_user` keeps
   `credentials` as its FIRST positional parameter (so `test_auth.py`'s positional
   call still binds) and only consults the Medha path when a `request` is present
   and the flag is on. With the flag **off** (default), the original Auth0 RS256 /
   JWKS verification is the sole path — preserving the CTO's tests.

---

## (c) New endpoints + request/response shapes

All routes are under `/v1/network/*`, require `Authorization: Bearer <medha Privy JWT>`,
and are scoped to the caller's DID. Responses are JSON for the RN client.

### POST `/v1/network/search` — semantic (Pinecone)
Request:
```json
{ "query": "founders I met in NYC", "topK": 10, "source": "optional-filter" }
```
Response `200`:
```json
{ "ok": true, "query": "…", "count": 3, "matches": [ … ], "summary": "…" }
```
`400` if `query` missing/empty; `502` if the search backend is unavailable.

### GET `/v1/network/check?email=&handle=` — relational (BigQuery)
Response `200` (engine shape):
```json
{ "in_network": true, "platform": "…", "relationship_type": "professional" }
```

### GET `/v1/network/identities?…` — paginated, caller-scoped list (BigQuery)
### GET `/v1/network/identities/{id}` — single identity (BigQuery)
### GET `/v1/network/connections?…` — caller's connections (BigQuery)

Common error envelopes from the proxy:
- `401 { error: "missing_bearer_token" }` / `401 { error: "invalid_token" }`
- `403 { error: "token_missing_did" }`
- `503 { error: "network_engine_unconfigured" }` — `MEDHA_NETWORK_SHARED_SECRET` unset
- `502 { error: "network_engine_unreachable" }` — engine down/timeout (8s)
- `404 { error: "not_found", path }`

---

## (d) Ported-tests pass/fail

Run from `Newton/agent/connection-network/`:
```bash
pip install -r requirements.txt -r requirements-test.txt
GCP_PROJECT_ID=test-project PYTHONPATH="$PWD" python3 -m pytest -q
```
Result: **51 passed** (37 in `test_all.py` + 14 in `test_auth.py`), ~1.4s.
All GCP/network calls are mocked. The Auth0 suite passes unchanged — the
optional Medha-auth flag is off by default, so the engine's original behavior is
exercised by the tests.

`node --check` passes on both `consumer/network-proxy.js` and `lib/server.js`.

---

## (e) Required env vars + BigQuery setup + how the module starts

**Node service (medha-platform):**
| Var | Purpose | Default |
|---|---|---|
| `CONNECTION_NETWORK_API_URL` | URL of the FastAPI engine | `http://127.0.0.1:8080` |
| `MEDHA_NETWORK_SHARED_SECRET` | Shared secret the proxy presents to the engine | _(unset → `/check` etc. return 503)_ |

(Privy/medha-id auth vars are already configured for `/api/ask/stream`.)

**FastAPI engine (connection-network):**
| Var | Purpose |
|---|---|
| `GCP_PROJECT_ID` | BigQuery project (required at import) |
| `MEDHA_AUTH_ENABLED` | `true` to trust the Node proxy's forwarded DID |
| `MEDHA_NETWORK_SHARED_SECRET` | Must MATCH the Node value |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | Kept for the engine's original auth path |
| (KMS / Pub/Sub / monitoring vars per the engine README) | Production GCP wiring |

**BigQuery bootstrap (one-time, run by a human with GCP creds):**
```bash
cd Newton/agent/connection-network
GCP_PROJECT_ID=<your-project> python3 a_foundation/bigquery_setup.py
```
This calls `bootstrap_all()` → creates the `connection_graph` dataset + tables
from `a_foundation/schema.sql`.

**Starting the engine (alongside Node in the same container, or as a sibling):**
```bash
cd Newton/agent/connection-network
GCP_PROJECT_ID=<proj> MEDHA_AUTH_ENABLED=true \
  MEDHA_NETWORK_SHARED_SECRET=<secret> \
  python3 -m i_api.app          # uvicorn on 0.0.0.0:8080
```

---

## (f) Railway deploy steps (for the human — NOT done here)

> No deploy was performed; no infra creds were used. These are the steps.

1. **Merge the PR** to `main` (Railway auto-builds the `medha-platform` service).
2. Decide how the FastAPI engine runs:
   - **Same container:** add a process manager / start command that launches
     `python3 -m i_api.app` (uvicorn :8080) next to Node, and ensure Python 3.12
     + `pip install -r Newton/agent/connection-network/requirements.txt` happen at
     build. Leave `CONNECTION_NETWORK_API_URL` at the localhost default.
   - **Sibling Railway service:** deploy `connection-network/` as its own service;
     set `CONNECTION_NETWORK_API_URL` on the Node service to that internal URL.
3. **Set env vars** on the relevant service(s):
   - Node: `MEDHA_NETWORK_SHARED_SECRET=<generate-strong-secret>`
     (and `CONNECTION_NETWORK_API_URL` if using a sibling service).
   - Engine: `GCP_PROJECT_ID`, `MEDHA_AUTH_ENABLED=true`,
     `MEDHA_NETWORK_SHARED_SECRET=<same value>`, plus GCP service-account creds.
4. **Bootstrap BigQuery** once (section (e) command) against the prod project.
5. **Verify** with the curl smoke-tests in section (g) against
   `https://medha-platform-production.up.railway.app`.

---

## (g) Curl smoke-tests

Set a real medha-id Privy JWT (same token amber-ios uses):
```bash
TOKEN="<medha Privy JWT>"
BASE="https://medha-platform-production.up.railway.app"   # or http://localhost:PORT
```

**Semantic search (Pinecone, in-process — works without the FastAPI engine):**
```bash
curl -sS -X POST "$BASE/v1/network/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"founders I met in NYC","topK":5}'
```

**Network check (BigQuery — requires the engine + MEDHA_NETWORK_SHARED_SECRET):**
```bash
curl -sS "$BASE/v1/network/check?email=jane@example.com&handle=@jane" \
  -H "Authorization: Bearer $TOKEN"
```

Auth negative checks:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/v1/network/check"      # 401 missing_bearer_token
curl -sS -X POST "$BASE/v1/network/search" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'                            # 400 query is required
```

---

## (h) PR URL

https://github.com/amber-organization/medha-platform/pull/254

Branch: `feat/unifynetwork-connection-port`. See the PR description for the same
summary as above.

---
---

# PeopleRank — NLP people-search that ranks the caller's unified network

Second feature on the **same branch / same PR (#254)**. PeopleRank is
natural-language people-search that **ranks** the authenticated caller's
unified network (the same Medha + Pinecone "Connection Graph" the
`/v1/network/*` surface exposes) against a text query.

**Status: code + tests + docs only. NOT deployed.** Additive; the prior 51
connection-network tests stay green.

## What was ported and where

Source (READ-ONLY, CTO-owned, never pushed to):
`amber-organization/togari-search`. Its PeopleRank is a **pairwise
event-matching** engine (scores compatibility between *pairs* of attendees) on
a heavy `src/peoplerank/` stack (sklearn TF-IDF, OpenAI embeddings, event
`Attendee`/`Person` schemas). Our endpoint needs **query-ranking** of a single
caller's network, so the pure, reusable logic was ported and adapted —
**not** the pairwise pipeline, the embedding backends, or the
`/v1/match/community-event` grouping endpoint (all out of scope per the task).

```
Newton/agent/peoplerank/
├── ranking.py                       Python reference port (faithful pure logic)
├── tests/test_ranking.py           22 tests (pins the ported algorithm)
├── consumer/
│   ├── ranking.js                   in-process JS ranker (mirror of ranking.py)
│   ├── peoplerank-proxy.js          POST /v1/peoplerank/search consumer surface
│   └── __tests__/ranking.test.js    14 node:test tests (mirror of the .py tests)
└── .gitignore
```

**Ported faithfully** (pure, no LLM, no sklearn):
- The CTO's **confidence model** — `CONFIDENCE_WEIGHTS`
  (text 0.50 / structured 0.30 / graph 0.20), `CONFIDENCE_BANDS`
  (>0.70 high, 0.40–0.70 medium, <0.40 low), `compute_confidence`,
  `confidence_label` (same "name the weakest component" reason).
- The **rationale validators + scrubber** — `validate_rationale`,
  `scrub_ai_tells`, `BANNED_SUBSTRINGS`, `BANNED_PATTERNS` (em-dash ban, AI-tell
  phrases, hedge-word patterns) copied verbatim from `api/rationale.py`.
- `extract_signals` — same `dimension:value` / `confidence:band` shape, 6-cap.

**Adapted** (pairwise → query-relevance): the three confidence components are
derived for one candidate vs. the query (text completeness of the candidate's
Pinecone blob, structured coverage of its fields, graph signal from its
source/handle). The final score keeps the original's multiplicative spirit:
`score = (0.70 * pinecone_relevance + 0.30 * record_quality) * 100`.

**Rationale generation:** deterministic from the signals + score (no
per-request LLM call — fast, cheap, always populated), then run through the
ported `validate_rationale` / `scrub_ai_tells` gate. An LLM rationale could be
slotted behind the same validator later without changing the contract.

> Why a JS ranker AND a Python port? The request path stays Python-free (like
> `/v1/network/search`, which runs `search_contacts` in-process). `ranking.py`
> is the faithful reference with its own test suite; `ranking.js` is what runs
> live. The two test suites (22 py + 14 js) pin them in lockstep.

## Endpoint

### POST `/v1/peoplerank/search`
Auth: `Authorization: Bearer <medha Privy JWT>` — **identical** to
`/v1/network/*` (`verifyPrivyJwt`, caller-scoped to the resolved DID; tenant is
never read from body/query).

Request:
```json
{ "query": "founders in NYC fintech", "topK": 10, "source": "linkedin" }
```
Flow: verify JWT → derive DID → `executeContactsSearchTool("search_contacts",
…, {tenant:{privyDid:did}})` (same Pinecone path as `/v1/network/search`) →
`rankCandidates(query, matches)`.

Response `200`:
```json
{
  "ok": true,
  "query": "founders in NYC fintech",
  "count": 2,
  "results": [
    {
      "id": "id-or-handle-or-name",
      "name": "Jane Doe",
      "score": 78.4,
      "confidence": 0.83,
      "confidence_band": "high",
      "rationale": "Jane Doe surfaced from your linkedin for \"…\". Strong semantic match (82% relevance). …",
      "signals": ["relevance:0.82", "profile_depth:0.60", "graph:1.00", "source:linkedin", "confidence:high"],
      "source": "contacts/linkedin"
    }
  ]
}
```
Errors: `401 missing_bearer_token` / `401 invalid_token` /
`403 token_missing_did` / `400 query is required` / `502` if the contacts
backend is unavailable / `404 not_found`.

Wiring: one import + one routing block added to `Newton/agent/lib/server.js`,
immediately after the `/v1/network/*` block (same additive pattern).

## Test results

- **PeopleRank Python** (`Newton/agent/peoplerank/`):
  `python3 -m pytest tests/ -q` → **22 passed**.
- **PeopleRank JS**:
  `node --test Newton/agent/peoplerank/consumer/__tests__/ranking.test.js` →
  **14 passed**.
- **Prior connection-network suite still green:**
  `GCP_PROJECT_ID=test-project PYTHONPATH="$PWD" python3 -m pytest -q` (from
  `Newton/agent/connection-network/`) → **51 passed** (no regression).
- `node --check` OK on `ranking.js`, `peoplerank-proxy.js`, and `server.js`.

> togari-search shipped **no** unit tests for its scoring/rationale modules
> (only an HTML `api/test_page.py`), so the 22 + 14 tests here are new and pin
> the ported behavior (the CTO's weights/bands and the verbatim validators).

## Required env vars

None beyond what `/api/ask/stream` and `/v1/network/search` already use:
`AMBER_ID_API_URL` + `AMBER_ID_API_KEY` (for `search_contacts` → Pinecone) and
the existing Privy/medha-id auth config. No OpenAI/Anthropic key is required
(no embedding backend, no per-request LLM call).

## Curl smoke-test

```bash
TOKEN="<medha Privy JWT>"
BASE="https://medha-platform-production.up.railway.app"   # or http://localhost:PORT

curl -sS -X POST "$BASE/v1/peoplerank/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"founders in NYC fintech","topK":10}'

# Auth / validation negatives
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/v1/peoplerank/search"   # 401
curl -sS -X POST "$BASE/v1/peoplerank/search" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'                                     # 400 query is required
```
