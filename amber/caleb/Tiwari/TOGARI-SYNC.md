# Togari Sync Discipline

One rule: **Tiwari never invents what Togari already ships.** If a Togari
surface exists for a primitive, Tiwari calls it over HTTP rather than
reimplementing it.

## Current Togari surface (post-2026-04-27 consolidation)

The previously-separate Togari repos (`togari-peoplerank`,
`togari-opportunity`, `togari-healthcare`) were consolidated into a single
canonical repo:

| Surface | Repo | Tiwari primitive | Deployed at |
|---|---|---|---|
| PeopleRank | `amber-organization/togari-platform` | `Tiwari/tiwari-peoplerank` | `https://togari-amber-production.up.railway.app` |
| Opportunity | `amber-organization/togari-platform` | `Tiwari/tiwari-opportunity` | `https://togari-clay-production.up.railway.app` |
| Healthcare enrich | `amber-organization/togari-platform` | `Tiwari/tiwari-enrich` | (TBD — surface in togari-platform/src/agents/healthcare/) |
| BMA prod | `amber-organization/togari-bma-prod` | (future) campaign infra | TBD |

`togari-platform` is the single Cloud Run TypeScript service and library that
houses all primitives. It ships on its own cadence under Karthik's GCP
handoff (see [docs/KARTHIK_GCP_HANDOFF.md](https://github.com/amber-organization/togari-platform/blob/main/docs/KARTHIK_GCP_HANDOFF.md)).

## How sync works now

Tiwari adapters (`src/togari-adapter.js` in each primitive) call deployed
Togari surfaces over HTTPS. No source-level vendoring is required for
runtime; the previous `vendor/togari` submodules were a read-only audit
trail and have been removed because their URLs 404'd after consolidation.

Three checks remain:

1. **Daily drift check (cron)** — Computer compares the latest
   `togari-platform` `main` SHA against the deployed Railway revision; if
   ahead, Computer opens (or comments on) a tracking issue with the diff
   summary. No auto-deploy.
2. **Pre-merge sync check (PR gate)** — every Tiwari PR must declare in its
   body whether it relied on a Togari endpoint that is not yet deployed. If
   yes, the PR must wait for the togari-platform deploy.
3. **Adapter contract test** — every Tiwari primitive's
   `src/togari-adapter.js` must have a matching test that hits the deployed
   service's `/health` endpoint and asserts the contract surface.

## When Togari ships a new endpoint

1. Confirm the endpoint exists on `togari-amber-production.up.railway.app` or
   `togari-clay-production.up.railway.app`.
2. Decide which Tiwari primitive consumes it.
3. Add an adapter method in that primitive's `src/togari-adapter.js`.
4. Register in this file's table.
5. Update `Tiwari/tiwari-<name>/src/blend.js` so the blend() weights can
   include it.

## When to re-add a vendored submodule

Only when `togari-platform` exposes a stable subpath that genuinely needs
to be source-pinned for a Tiwari primitive (e.g. shared TypeScript types
imported at build time). Until then, the vendor/ directories contain only a
README explaining the contract.

## Rejected patterns

- ❌ Reimplementing PeopleRank scoring logic inside `tiwari-peoplerank/src/`.
  All scoring stays in `togari-platform`. Tiwari only blends.
- ❌ Direct DB reads from amber-id Pinecone bypassing the adapter — every
  Togari call must go through `src/togari-adapter.js`.
- ❌ Vendoring TypeScript source from `togari-platform` and shimming it into
  Newton's JS runtime. The deployed service is the contract.
