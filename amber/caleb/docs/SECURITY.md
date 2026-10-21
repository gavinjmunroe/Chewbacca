# SECURITY.md

The security posture of the Medha system as of 2026-05-19, plus the
deferred items we're explicitly aware of and the order to fix them.

## What's in place

### Webhook auth

- `medha-imessage` `/webhook`: production gate is intentionally OPEN
  (per Caleb's call 2026-05-18). The real defense is `resolveTenantStrict`
  downstream — any inbound whose Loop `sender` UUID doesn't map to a
  known amber-id tenant gets dropped before the agent runs.
- Tightening: set any of `WEBHOOK_SECRET`, `LOOP_WEBHOOK_SECRET`, or
  `TWILIO_AUTH_TOKEN` env vars and the strict signature/secret check
  re-engages automatically — no code change needed.

### Admin endpoints

- `/admin/send-voice`, `/admin/send-message`, `/admin/say-as-user` all
  gated by `ADMIN_TOKEN`.
- `/admin/say-as-user` trusts `payload.from` after the token check.
  This means an operator with the token can post as any user. **Mitigated
  by**: medha-id's `/v1/say-to-medha` verifies the dashboard JWT and
  signs the envelope server-side before calling `/admin/say-as-user` —
  the SECURED entrypoint for dashboard callers is the medha-id route,
  not the admin route directly.

### Dashboard auth (medha-id + medha-trip-planning)

- Phone + 6-digit OTP delivered via Medha herself.
- `MEDHA_JWT_SECRET` (HS256, shared between medha-id signer and
  dashboard verifier). 30-day expiry.
- Cookie is `HttpOnly + Secure + SameSite=Lax + Path=/`.

### Service-to-service

- medha-imessage → medha-id: `X-API-Key: <AMBER_ID_API_KEY>` for most
  endpoints. Per-tenant secrets stay encrypted server-side; medha-id
  is the only service with the master AES key.
- medha-id → medha-imessage: `X-Admin-Token: <ADMIN_TOKEN>` for the
  admin routes (OTP send, say-as-user signing).

### BigQuery / GCP

- Service account `medha-agent@midyear-glazing-485303-u3.iam.gserviceaccount.com`
  has WRITER on the four `medha_*` datasets ONLY. No project-wide IAM.
- Key shipped as `GOOGLE_APPLICATION_CREDENTIALS_JSON` (raw JSON env)
  to avoid touching disk in the Railway container.

### Suppressions / opt-in

- Cross-group STOP propagation enforced at `dm_each_in_group` fan-out
  time (in-memory list — see deferred items below).
- Per-group opt-in tracked in `groupMem.optInStatus`.

## Deferred items (explicitly known, ordered by impact)

### High impact, low effort

1. **Per-operator admin tokens** — currently `ADMIN_TOKEN` is one shared
   secret. Move to `ADMIN_TOKENS=name1:secret1,name2:secret2` and stamp
   `request.operator` so audit logs can attribute. (~30 min)
2. **`/admin/*` endpoint shape consistency** — different routes use
   different error envelopes. Standardize to `{ ok: false, error,
request_id }`. (~30 min)
3. **System-wide OTP rate limit** — currently per-phone cooldown only.
   Add a global counter: > 50 failed verifies in 60 min → return 503
   from the verify endpoint. Defends against credential-stuffing across
   many phones. (~20 min)
4. **CORS hardening** — wide-open in dev mode. Add explicit `NODE_ENV`
   guard so dev never accidentally ships. (~10 min)

### Medium impact, medium effort

5. **JWT rotation window** — HS256 today with one secret. Add
   `MEDHA_JWT_SECRET_PREVIOUS` so a rotation can roll over a 24-48h
   window with no logout storm. (~1h)
6. **JWT revocation** — no current `/v1/auth/invalidate` endpoint.
   Add one that pushes the JTI to a revocation set; verify path checks
   the set. Sign-out from medha-trip-planning needs this to work
   properly (currently the cookie is cleared but the token is still
   valid for 30 days). (~2h)
7. **Persistent cross-group suppressions** — `lib/suppressions.js` is
   in-memory; restart loses every STOP. Move to `medha_pdw.suppressions`
   table + medha-id `/v1/suppressions` endpoints. (~3h — Agent 1 of the
   100-flaw batch is on this)

### High impact, high effort

8. **Loop webhook signature verification** — `/webhook` gate is OPEN.
   Loop sends NO signature on outbound webhooks per current config.
   Real fix: add `?secret=<value>` to the Loop webhook URL in Loop's
   dashboard + set `WEBHOOK_SECRET` env to match. Requires Caleb to
   update the Loop dashboard. Until then, anyone who knows the
   `medha-imessage` URL can post fake inbounds. The tenant resolver
   downstream is the only defense.
9. **Workload Identity Federation for GCP** — SA key sits in env as
   raw JSON. WIF would eliminate the long-lived key entirely. ~1 day
   of GCP-side config + code change.
10. **CSRF protection on dashboard writes** — dashboard `/api/auth/*`
    POSTs use httpOnly cookies but don't include a CSRF token. When
    Phase 7 write surfaces land (itinerary edit, Tell Medha), CSRF
    becomes load-bearing.

### Aspirational

11. **Sentry / error aggregation** — errors go to Railway logs + nowhere
    else. Add Sentry SDK + DSN env var. Cheap, just hasn't been done.
12. **Request ID propagation** — no `x-request-id` threaded across the
    three services. Hard to debug a multi-hop failure.

## Incidents to learn from (running log)

- **2026-05-18 — Voice clipping.** First production voice note from
  Medha cut off the opening syllables. Root cause: iMessage's voice-note
  player skips first ~150ms when there's no leading silence. Fixed by
  prepending "..." pause to the TTS input.
- **2026-05-18 — Stale ADMIN_TOKEN.** Test message went out to Caleb
  ("should be rejected") because `--skip-deploys` left the container on
  the OLD env after the token rotation. Lesson: token rotation tests
  must use a KNOWN-INVALID value, never the actual prior secret.
- **2026-05-18 — Webhook gate open after PR.** Strict auth gate
  ("no-auth-configured-prod") was rejecting every Loop webhook because
  no `WEBHOOK_SECRET` was set. Caleb chose to open the gate (decision
  on file in `lib/webhook-auth.js`). Tenant resolver is the real defense.
- **2026-05-19 — Silent stale-container deploy.** PR #109 merged but
  Railway's `npm ci` failed because `package-lock.json` lacked the
  `@google-cloud/bigquery` entries added to `package.json`. Railway
  marked the deploy FAILED but kept serving the prior container, so
  `/status` returned 200 and the new code never ran. Lesson: any
  package.json change must be paired with a fresh `npm install` +
  committed `package-lock.json` BEFORE pushing. Smoke-test must
  include checking the `commitHash` on the running container against
  the latest main, not just HTTP 200 on a health endpoint.

All glory to God! ✝️❤️
