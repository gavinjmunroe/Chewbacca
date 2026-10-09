---
name: project-togari-search-peoplerank-engine
description: "togari-search is the live PeopleRank engine for the Amber iOS middle tab, wired via medha-id flag"
metadata:
  node_type: memory
  type: project
  originSessionId: d618bbbf-6caf-4e79-9dfb-1c6be761b86a
---

As of 2026-06-03, togari-search powers the Amber iOS **middle (Amber) tab**'s query-driven PeopleRank.

- **togari-search** (repo `amber-organization/togari-search`, Railway project `togari` / service `togari-search`, https://togari-search-production.up.railway.app) is a FastAPI service "PeopleRank UC1". Two surfaces: `POST /v1/match/community-event` (Blind8 event matchmaking) and the new `POST /v1/me/people-rank` (PR #4) that ranks the caller's own contacts by semantic relevance using `src/peoplerank` embeddings + an Anthropic answer with inline `[[p:CONTACT_ID]]` citations. Auth = `Authorization: Bearer <BLIND8_API_KEY>`. Needs OPENAI_API_KEY (embeddings) + ANTHROPIC_API_KEY (answer/rationale) on Railway.
- **Wiring lives in medha-id, NOT medha-platform.** medha-platform's CLAUDE.md forbids wiring togari-search there. medha-id's CLAUDE.md defines `Amber ID = ... × PeopleRank × ...` = "Togari relationship-intelligence adapter". The adapter is `medha-id/src/enrichment/togari-search-rank.js`; the delegation is in `src/routes/me-people-rank.js` (query path only, flag-gated, fail-open to the local warmth+recency scorer). PR #157.
- **Activation:** env on Railway `medha-id` service, `PEOPLERANK_ENGINE=togari`, `TOGARI_SEARCH_URL`, `TOGARI_SEARCH_KEY` (the BLIND8 key). Unset `PEOPLERANK_ENGINE` to revert. BLIND8 key stays server-side, never in the IPA.
- **No iOS rebuild needed:** the existing TestFlight build already calls medha-id `/v1/me/people-rank` with the session token; the engine swap is invisible to the client.

Caveat: togari-search matchmaking/ranking scores on rich per-person text; bare synced phone contacts (name/company/title/city only) rank weakly without a query. Relevance shines on the query path. See [[project_amber_vision]] and [[project_togari_honest_state_2026_05_30]].
