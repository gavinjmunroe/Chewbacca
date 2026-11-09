---
name: medha-production-urls
description: "Production Railway URLs for the three Medha services. There are THREE, not two; do not conflate medha-platform (agent) with medha-id (identity/OAuth). The cookies endpoint and all /v1/oauth/* routes live on medha-id."
metadata:
  node_type: memory
  type: reference
  originSessionId: fde318b6-7115-4e5f-9a44-e39961dba494
---

**Correction 2026-09-04.** `amber-mcp` (formerly `medha-platform`) no longer
exists on GitHub, so one of the three services below has no repo behind it any
more. The URLs may still resolve; the source does not. See
[[reference_amber_org_restructure_2026_08_31]].


Three separate services, three separate Railway URLs:

- **medha-frontend** (Next.js dashboard, repo `amber-organization/medha-frontend`):
  `https://medha-frontend-production-5f4f.up.railway.app/`
- **medha-id** (identity backend, OAuth, cookies, secrets bag, repo `amber-organization/medha-id`):
  `https://medha-id-production.up.railway.app/`
  Verified live 2026-05-27: `POST /v1/oauth/linkedin/cookies` returns 401 with `code: "missing_token"` for unauthed requests. No `/health` endpoint (404).
- **medha-platform** (agent service, iMessage / Loop transport):
  `https://medha-platform-production.up.railway.app/`
  Has a rich `/health` (transport, processCount, cache, platforms). Any unmatched path returns "Amber Agent Running" with 200, this is the agent's catch-all, not medha-id.

**Mistake that already happened once:** Caleb verbally said "medha-platform is the backend" so the amber-chrome extension was first wired to medha-platform. The endpoint POST returned 200 with "Amber Agent Running" instead of 401, because the agent's catch-all swallows everything. Always verify with an unauthed POST to the endpoint you actually want, a 401 with a real error code proves the route is wired; a 200 with generic body means you're talking to the wrong service.

For any OAuth, identity, secrets-bag, cookies, or `/v1/me/*` work → medha-id.
For any iMessage, Loop, agent-loop work → medha-platform.
Related: [[reference_medha_id_storage]] (Firestore-only persistence), [[project_amber_vision]].

## From the index

The agent's repo is now gone.
