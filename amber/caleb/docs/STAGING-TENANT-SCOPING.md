# Staging tenant scoping (MEDHA_TEST_MODE)

**Owner:** Caleb
**Status:** scoping (P3-H from MEDHA_INFRA_PUNCH_LIST)
**Created:** 2026-05-27

## The problem

Caleb's tenant is currently the only real data in the system. Every
self-test (Tab 3's `track_relationship` for Carlo, the personal-life
journal entries, the pipeline investor records) writes to his
production Firestore. We've been lucky no destructive test has nuked
real data — but "lucky" is not a strategy.

We need a way to run risky tests against synthetic state without
touching Caleb's actual graph.

## Proposed shape

Seed a parallel tenant:

- `tenantDid = "did:test:medha-staging"`
- `phoneNumber = "+15555550199"` (Twilio test number range, will never collide)
- `loopSenderPhone = same` (never actually used since Loop doesn't route to this)
- `expertMode = true` so tools are armed without ceremony
- Owns its own Pinecone namespace `tenant-did-test-medha-staging`
- Owns its own Firestore subtree under `users/did:test:medha-staging/`
- Has its own secrets bag (test API keys for connected platforms — Caleb provisions)

Wire a `MEDHA_TEST_MODE` env on agent calls:

- When request header `x-medha-test-mode: 1` is set on a webhook OR
  the env var is true (dev environment), every write goes to the
  staging tenant regardless of the inbound sender.
- Reads still go to the resolved tenant (so test prompts can verify
  expected output by querying the staging tenant directly).

## Where the test-mode switch lives

| Module                               | Behavior under test mode                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `lib/tenant.js resolveTenant`        | If test mode is set, ALWAYS return the staging tenant regardless of sender |
| `lib/secrets.js getSecret/setSecret` | Already keyed on tenant.did → automatically routes to staging bag          |
| `lib/amber-id-ingest.js`             | Already keyed on tenant.did → automatically routes to staging namespace    |
| `lib/transport.js sendMessage`       | Drops the outbound entirely (no Loop send, no Slack send) — log only       |
| `lib/tools/* handlers`               | No change needed — they read from ctx.tenant which is now staging          |

The send-drop is critical: a test prompt that says "send Maggie a vcard" should not actually text Maggie.

## What needs to happen to ship this

1. Add `did:test:medha-staging` synthetic tenant builder to `lib/tenant.js` (mirroring buildMedhaExpertTenant pattern).
2. Add `MEDHA_TEST_MODE` env check + `x-medha-test-mode` header check at the top of `resolveTenant`.
3. Add a kill-switch in `transport.js sendMessage` that returns a fake-success without actually sending when test mode is on.
4. Seed the staging tenant's Firestore row + Pinecone namespace via a one-shot script in `medha-id/scripts/seed-staging-tenant.js`.
5. Write a top-level `npm run test:e2e` that fires curl payloads against the medha-platform webhook with the test-mode header.

## What NOT to do

- Don't ship test mode that ONLY routes some writes. Half-test-mode is worse than no test mode because data leaks into real tenants on the unrouted paths.
- Don't ship without the transport.sendMessage kill-switch. Otherwise a test will text real people.
- Don't reuse Caleb's Pinecone namespace for staging. Vector pollution is hard to clean up.

## Until shipped

If you need to run a risky test against Caleb's tenant:

1. Take a Firestore export of `users/did:privy:cmew...` first.
2. Run the test.
3. If you wrote bad data, restore from the export.
4. If you wrote bad vectors, the pinecone-backfill.js script can replay from Firestore.

That's the operational fallback. It's slow and manual; this scoping doc is the replacement.

## Cost

- Pinecone: one extra namespace, $0 incremental (free under usage tiers).
- Firestore: one extra user doc + subtree, sub-cent per day at test volume.
- Loop / Twilio: $0 since send is dropped under test mode.

Total: noise floor. Just needs the engineering time to wire.
