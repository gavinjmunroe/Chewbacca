# Rename dispatch: medha-id → amber-id

**Status:** SUPERSEDED — do not execute.

Canonical naming lives in [`ARCHITECTURE-NAMING.md`](ARCHITECTURE-NAMING.md).
Product repos stay `medha-*`; `amber-id` is a legacy/runtime alias for the
same identity service. Railway hostnames, JWT `iss`, and `AMBER_ID_*` env
vars are production contracts — dual-read only, no big-bang rename.

---

# (archived) Rename dispatch: medha-id → amber-id

**Owner:** Caleb + Karthik
**Status:** superseded (2026-08-03)
**Created:** 2026-05-27

## The intent (historical)

Karthik's framing at the time: medha-id becomes amber-id so any agent
(Medha, Togari, future Shortcuts-style agents) can consume the same bio +
secrets + Pinecone backend through a clean credentialed contract. The
generic name removes the "this is Medha's thing" coupling that the
current name implies.

**Current decision:** keep GitHub/product as `medha-id`; treat `amber-id`
as the internal alias. Do not rename the repo or Railway service for
branding cleanup.

This is a coordinated rename across every repo that talks to the
service. Bigger than a single PR — scope it as its own dispatch
(parallel-tab pattern, similar to MEDHA_PARALLEL_TABS_DISPATCH.md).

## What changes

| Layer                         | From                                          | To                                          |
| ----------------------------- | --------------------------------------------- | ------------------------------------------- |
| GitHub repo                   | `amber-organization/medha-id`                 | `amber-organization/amber-id`               |
| Railway service               | `medha-id`                                    | `amber-id`                                  |
| Production hostname           | `medha-id-production.up.railway.app`          | `amber-id-production.up.railway.app`        |
| Env var on every caller       | `MEDHA_ID_API_URL`, `MEDHA_ID_API_KEY`        | `AMBER_ID_API_URL`, `AMBER_ID_API_KEY`      |
| Env var on every callback URL | `MEDHA_FRONTEND_URL` references               | unchanged (frontend already standardized)   |
| Internal name in agent code   | `tenant.amberId` and existing `amber-id` text | unchanged — `amber-id` is the new canonical |

## Callers that need the env var rename

- `medha-platform` — every tool, every OAuth resolver, every cron
- `medha-frontend` — every `/api/medha-id/[...path]/route.ts` proxy
- `medha-analytics` — admin dashboard proxy routes
- `togari-platform` — talks to medha-id for PeopleRank
- `togari-search` — talks to medha-id for identity lookup
- `amber-chrome` — LinkedIn cookies sync (just shipped, points at host)

## Cutover ordering

Phase 1 — repo + service rename, both old + new URLs serving:

1. Rename Railway service `medha-id` → `amber-id` (keep both hostnames live for grace period).
2. Add CNAME `amber-id-production.up.railway.app` pointing at the same Railway service.
3. Rename GitHub repo `medha-id` → `amber-id` (GitHub auto-redirects clones for ~3 months).

Phase 2 — env var rename, dual-read, single-write:

4. For every caller above, accept BOTH `AMBER_ID_API_URL` and `MEDHA_ID_API_URL` (prefer the new name). Same for API_KEY.
5. Update Railway env on every caller to the new names while old ones still work.
6. Watch for one week. If no log hits on the old names, ship Phase 3.

Phase 3 — finalize:

7. Remove the old env-var fallback from every caller.
8. Remove the old hostname from Railway.
9. Delete this doc, write a one-line note in `medha-id` README that the service was renamed and link to the github redirect.

## Risk

- LinkedIn cookies + amber-chrome point at the current host — Phase 1 needs to land BEFORE the extension is heavily used, OR the extension's hostname configuration needs to be parameterized first.
- Togari-search has its own deploy cadence — the rename PR there is owned by that team's lead.

## When

Caleb / Karthik decision. Recommend: NOT this quarter unless there's a
specific reason. The current naming inconsistency is mild friction; the
rename is real cross-repo coordination. Stay focused on user-facing
wins; revisit when there's a natural lull.
