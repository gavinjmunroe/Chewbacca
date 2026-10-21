# tiwari-peoplerank

**Primitive:** list building (search / discovery).

Amber's wrapper around `togari-peoplerank`, Newton experimental ideas, and the caller's `amber-id` private KB — braided into a single `listBuild()` call.

## API

```js
import { listBuild } from "./index.js";

const result = await listBuild({
  query: "SF-based founders I've already met who are building in healthcare",
  filters: { city: "San Francisco", tags: ["founder", "healthcare"] },
  userCnft: "Gx7...4kD",          // optional — enables amber-id injection
  token: privyJwt,                 // required if userCnft is passed
  options: { topK: 20, includeNewton: true },
});
```

## Response envelope

```js
{
  ok: true,
  source: "blended" | "togari" | "togari+newton" | "amber-id" | "newton" | "empty",
  personalized: boolean,              // true iff amber-id contributed rows
  results: [{
    id, name, score, source,
    breakdown: { togari, amberId, newtonBoost },
    reasons: ["recent_bidirectional_comm:+0.15", ...],
    meta: { email, company, title, city, ... },
    personalEvidence: [{ id, snippet, kind, created_at, score }, ...]
  }],
  citations: [...],                    // inline citations for amber-id evidence
  tookMs: 412,
  warnings: ["togari_unavailable: ..."]
}
```

## The recipe

1. **togari base** (`src/togari-adapter.js`) — calls `POST /search` on the deployed `togari-peoplerank` (SHA pinned in `vendor/togari/`). If upstream is down or the endpoint isn't implemented yet, we continue with an empty base.
2. **Newton boosts** (`src/newton-adapter.js`) — dynamically imports `Newton/agent/lib/contacts.js` and `Newton/agent/lib/health.js` to re-rank based on relationship strength and 6-dimension health affinity. Soft-fails if Newton deps aren't installed.
3. **amber-id injection** (`../shared/amber-id-client/`) — if `userCnft` + `token` are present, queries the user's private Pinecone namespace for matching people. These results can surface even when togari doesn't know the person.
4. **Blend** (`src/blend.js`) — normalizes each score stream to [0,1] and computes `final = 0.55*togari + 0.25*amberId + 0.20*newton_boost_cap`.

## Newton ideas currently promoted

| File | What it adds |
|---|---|
| `Newton/agent/lib/contacts.js::getRelationshipStrength` | Boost for people with recent bidirectional communication |
| `Newton/agent/lib/health.js::dimensionAffinity` | Boost when the query tone matches a person's strong health dimension |

Remove an idea from production: delete the import in `src/newton-adapter.js`. No other change needed.

## Togari vendor

- **Repo:** `amber-organization/togari-peoplerank`
- **Pinned SHA:** `062eafd10d98ecc2933fee8f737af284eeca062e` (April 17, 2026)
- **Bump procedure:** see `Tiwari/README.md` → "Togari sync discipline"

The submodule lives in `vendor/togari/`. We read the source for review but do NOT import it at runtime — upstream runs as its own HTTP service.

## Env

```
# togari upstream
TOGARI_PEOPLERANK_URL=https://togari-amber-production.up.railway.app
TOGARI_PEOPLERANK_API_KEY=
TOGARI_PEOPLERANK_TIMEOUT_MS=4000

# amber-id (used when caller passes userCnft + token)
AMBER_ID_BASE_URL=https://amber-id-production.up.railway.app
AMBER_ID_TIMEOUT_MS=8000
```
