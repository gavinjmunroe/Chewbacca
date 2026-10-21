# Togari Enterprise Access Policy

This document captures who is allowed to activate Togari enterprise (the BMA
warehouse / opportunity sequencer / lead intake), why, and where the gate
lives in code. It complements `Tiwari/YOGA-MODEL.md` ("Who calls what") and
`Tiwari/TOGARI-SYNC.md` ("Tiwari never reimplements Togari").

## TL;DR

| Surface | Can activate Togari enterprise? | Can read PeopleRank / Enrich / Opportunity? |
|---|---|---|
| iMessage / Loop (concierge, `Newton/agent/agent.js`) | **Yes** — only after Loop signature verification + tenant resolution + `amber_imsg` entitlement | Yes (any tenant entitlement) |
| iOS / iPadOS / macOS / visionOS (`Newton/agent/lib/tiwari-proxy.js`) | **No.** iOS can never be the activation channel. | Yes, on user-dataset relationships allowed by the entitlement bag |
| Scheduled jobs (`lib/proactive-runner.js`) | Only on behalf of an already-entitled tenant (cannot upgrade) | Yes, scoped to that tenant |
| Admin CLI / direct ssh | Only against an already-entitled tenant (cannot upgrade) | Yes |
| Anything else | **No** — fail closed |

## The rule

> amber-agent (specifically the iMessage/Loop concierge) is the only Amber
> surface allowed to **activate** Togari enterprise. amber-id stays the
> private passport. Togari stays warehouse / API complement.

Activation means flipping a tenant into the enterprise tier — running lead
intake, creating CRM records, attaching campaigns, opening enterprise data
paths. Reading PeopleRank / Enrich / Opportunity for a tenant who already
owns the entitlement is allowed from any properly-authenticated surface
that can prove the user owns the underlying dataset relationship.

## Why iMessage/Loop

1. The iMessage path is the only channel where amber-agent has end-to-end
   identity proof: Loop's signed webhook → tenant resolution via amber-id
   (`/tenants/resolve?sender_id=...`) → tenant carries `amber_imsg`
   entitlement. There is no place for an attacker (or an iOS bug, or a
   spoofed JWT) to inject identity claims that the gate would accept.
2. The iMessage tier is already paywalled in `YOGA-MODEL.md` (`amber_imsg`
   is the top SKU). Activation eligibility lines up with it naturally.
3. Caleb (Camber) and Sagar (Samber) are each the operator-of-record for
   their own enterprise tenancy. Forcing activation through their concierge
   makes the audit trail trivial: every activation is a real iMessage in a
   real Loop thread on a real phone they own.

## Why not iOS

- iOS authenticates with a Privy JWT; while we trust it for read access, an
  iOS client can't attest to the underlying SIM/iMessage identity. Letting
  iOS activate would create a divergent identity proof path that we'd have
  to keep aligned with the iMessage gate forever.
- amber-id is the passport, not the gate. amber-id mints cNFTs and
  entitlement bags — it doesn't decide which channel can run upgrades.
- iOS surfaces (AskAmberBar, etc.) are designed around "zero secrets in
  Swift" and "go through amber-agent." Keeping enterprise activation off
  iOS preserves that line.

## Tenant separation: Camber vs Samber

Camber (Caleb) and Samber (Sagar) are separate tenants:

| | Camber | Samber |
|---|---|---|
| Loop sender ID | their own | their own |
| amber-id Privy DID | `did:privy:caleb` (separate) | `did:privy:sagar` (separate) |
| Phone | +1 555-010-0002 | +1 555-010-0004 |
| Pinecone namespace | per-tenant via amber-id | per-tenant via amber-id |
| Context wiki repo | per-tenant | per-tenant |

The activation gate is keyed off the resolved tenant (its `privyDid`), not
off env vars or org-level state. Activation on Camber never grants
activation to Samber and vice versa. See
`Newton/agent/lib/__tests__/togari-access-policy.test.mjs` for the
explicit test.

## Where the gate lives

- **Policy module**: `Newton/agent/lib/togari-access-policy.js`
  - `evaluateActivation({ source, tenant, loopVerified })` → `{allowed, reason, source}`
  - `assertActivationAllowed(...)` → throws on denial with `err.code`
  - `tenantHasEnterpriseEntitlement(tenant)` → boolean
  - `iosAllowedReadPrimitives(tenant)` → Set of read primitive names
- **Enforcement**:
  - `Newton/agent/lib/tools/togari.js` gates the enterprise-mutating
    tool subset (`togari_submit_lead`, `togari_create_person`).
  - `Newton/agent/lib/tiwari-proxy.js` deliberately exposes no
    activation route; its docstring documents the rule.
- **Tests**: `Newton/agent/lib/__tests__/togari-access-policy.test.mjs`
  (12 cases — Loop verified, Loop unverified, iOS proxy, scheduled
  jobs, Camber/Samber isolation, etc.)

## Tiwari sync hard checks (run before touching Tiwari)

Per `Tiwari/TOGARI-SYNC.md`, three checks gate any change to a Tiwari
primitive:

1. **Daily drift check** — submodule pin vs Togari `main`. If the pin is
   stale, a tracking issue should already exist.
2. **Pre-merge sync check** — does the PR rely on Togari features newer
   than the pinned submodule? If yes, bump the pin in the same PR.
3. **Manual bump** — `make sync-togari` runs the bumps + tests in order.

This PR does not touch Tiwari sources, vendor pins, or adapters; the
existing pins and `Tiwari/README.md` "Newton ideas in production" notes
stand. The submodules listed in `git submodule status`:

| Path | Pinned SHA |
|---|---|
| `Tiwari/tiwari-peoplerank/vendor/togari` | `062eafd…` |
| `Tiwari/tiwari-opportunity/vendor/togari` | `1c22264…` |
| `Tiwari/tiwari-enrich/vendor/togari-healthcare` | `8ede817…` |

## Adding a new activation channel (future)

Don't, unless:

1. The channel can produce a verifiable identity proof at least as strong
   as a Loop-signed webhook from a known sender UUID.
2. You have an audit trail that ties the activation to a real human.
3. The new source is added to `ACTIVATION_SOURCES` in
   `togari-access-policy.js` and to the test matrix.
4. This document is updated.
