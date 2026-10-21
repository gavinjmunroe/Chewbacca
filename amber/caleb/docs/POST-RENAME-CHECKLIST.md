# POST-RENAME-CHECKLIST.md

GitHub renamed `amber-organization/amber-agent` →
`amber-organization/amber-imessage`. The Railway service, hostnames,
and webhook URLs are unchanged. This checklist is what to verify after
merging the naming-alignment PR.

Tick each item; do not skip the live-traffic checks just because the
local checks passed. The live system uses the actual Railway hostname
and Loop webhook bindings, which are not exercised by static checks.

The current core app path is `amber-id` (shared backend) ↔
`amber-imessage` (this repo, iMessage interface) ↔ `amber-ios-dev`
(SwiftUI interface). Togari-related checks are kept at the bottom under
"out of scope" and are sanity-only — do not block merge on them.

## Static / local

- [ ] `node --check` passes on every changed `.js` file
- [ ] `npm install` at repo root resolves without warnings about the
      package name change (`amber-imessage`)
- [ ] `git grep -n "amber-caleb-agent"` returns no hits in committed
      files (except in archived review docs under `docs/reviews/` and
      historical Perplexity build notes, which are dated artifacts)
- [ ] `git grep -n "amber-agent-monorepo"` returns no hits (root
      package was renamed to `amber-imessage`)
- [ ] `railway.toml` still names the service `amber-agent` and points
      at `node Newton/agent/agent.js`

## Repo metadata

- [ ] GitHub repo description on `amber-organization/amber-imessage`
      mentions iMessage surface and links to amber-id
- [ ] Default branch is still `main`
- [ ] Any GitHub Actions / external integrations referencing the old
      repo URL have been updated by GitHub's automatic redirect, OR
      explicitly repointed at the new URL
- [ ] Submodule URLs in `.gitmodules` still resolve (they point at
      `amber-organization/togari-*`, which were not renamed in this PR)

## Railway

- [ ] Railway project `amber` (`758c0c59-...`) still has the
      `amber-agent` service deploying on push to `main`
- [ ] No env-var key references the old repo name (env vars are bound
      to the service, not the repo)
- [ ] Build log shows `npm install` resolving package
      `amber-imessage` at root and `amber-agent` in
      `Newton/agent/`

## Live traffic — must verify after deploy

- [ ] `GET https://amber-caleb-production.up.railway.app/status` returns
      200 within 30s of deploy
- [ ] Send one inbound iMessage to Camber → expect a reply within
      normal latency. Confirms Loop webhook still routes to the
      Railway service.
- [ ] Send one inbound iMessage to Samber → expect a reply. Confirms
      Sagar's tenant resolves correctly in the shared amber-id.
- [ ] Trigger one voice reply (user sends a voice memo) → confirm the
      attachment URL the iOS client receives is reachable. This
      exercises the runtime hostname fallback in
      `Newton/agent/agent.js`.
- [ ] `node Newton/agent/scripts/trace-checkins.js --to caleb --days 1`
      shows the most recent scheduled check-in landed via the canonical
      send path (audit record present in `vision/outbox/`).

## Tenant routing sanity

There is one shared amber-id service. Camber and Samber are iMessage
agents / profiles authenticated as Caleb and Sagar through that service —
not separate amber-id deployments. amber-ios-dev authenticates against
the same amber-id.

- [ ] Camber inbound resolves to Caleb's tenant in the shared amber-id
      and reads/writes through the standard `/v1/secrets` and
      `/knowledge/query-as` endpoints
- [ ] Samber inbound resolves to Sagar's tenant in the shared amber-id;
      knowledge recall returns Sagar's namespace
- [ ] A consumer tenant onboarded after the rename can resolve via
      `GET /tenants/resolve?sender_id=...` against the shared amber-id
      and exchange one round trip

## Togari / B2B (out of scope for this PR — sanity only, do not block on these)

Togari services are positioned as future / shared B2B capabilities and
are not on the current core app path. The checks below are best-effort
sanity only.

- [ ] No B2B traffic is routed through amber-imessage (it remains the
      consumer iMessage surface only)
- [ ] Tiwari submodules at `Tiwari/tiwari-*/vendor/togari*/` still
      point at the same SHAs as before this PR (no submodule churn)

## Rollback

If a check fails:

1. Do **not** rename anything else.
2. Revert the naming PR — the GitHub redirect from the old name keeps
   working independently.
3. Re-run live-traffic checks.
4. File a follow-up describing which check failed and the specific
   client (Loop, iOS, cron) that surfaced it.
