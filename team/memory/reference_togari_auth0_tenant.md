---
name: Togari Auth0 tenant
description: Correct Auth0 tenant for all Togari repos is the dev-* one, not bluemodern; stale references exist in code that need correcting before Auth0 re-integration
type: reference
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

The correct Auth0 tenant for all Togari work is:

```
dev-4prs757badfajpi5.us.auth0.com
```

NOT `bluemodern.us.auth0.com`. Karthik first answered `bluemodern.us.auth0.com` in the May 2026 sync, then corrected himself: "WAS WRONG ON NUMBER 1, IT IS dev-4prs757badfajpi5.us.auth0.com".

**Current state (May 10, 2026):**

- Auth0 is temporarily disabled in the `togari-platform` flow to reduce friction during testing
- Karthik is evaluating Auth0 + Privy combo (only if not over-engineered)
- Re-integration planned Monday/Tuesday after Karthik's calls with the Auth0 team and GCP
- Migration to a production tenant is on the calendar but not yet done, for now everything stays on the dev tenant

**Tenant-slug cleanup (resolved May 11, 2026):** the 4 real `bluemodern.us.auth0.com` references all replaced with `dev-4prs757badfajpi5.us.auth0.com`:

- `togari-bma-dvlp@2b60526` covers `src/middleware/auth.ts` (env default), `src/services/oauth.ts` (fallback URL), `src/__tests__/auth.test.ts` (JWT issuer fixture)
- `togari-frontend@bfe6ca5` covers `src/app/admin/page.tsx` (admin UI value)
- The 5th reference Caleb flagged at `togari-bma-dvlp/src/middleware/auth.ts:96` turned out not to exist, that line is blank/comment, the only real stale string in that file was on line 100
- `togari-platform` has zero Auth0 tenant references (matches Karthik's note that Auth0 is disabled in that repo's flow)

**Still open after cleanup (flagged for follow-up, not yet fixed):**

- `togari-bma-dvlp/src/services/oauth.ts:9,120` and `src/__tests__/auth.test.ts:197,200` still hardcode the audience identifier `https://mcp.bluemodern.ai` and the claim namespace `https://mcp.bluemodern.ai/client_id`. If the production Auth0 API identifier is now `https://api.togari.app` (a comment in `src/middleware/auth.ts` uses that as the example), these are similarly stale.
- `src/middleware/auth.ts:99` and `src/services/oauth.ts:5` both still carry a `TODO(karthik): ... the dev-4prs757... slug suggests a dev tenant is in use somewhere` comment. After this cleanup that TODO is misleading, `dev-4prs757...` IS the correct tenant. Safe to delete once whoever owns those files confirms.
