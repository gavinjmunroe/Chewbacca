# Secrets v1 vs v2 decision

**Owner:** Caleb
**Status:** decision needed
**Created:** 2026-05-27
**Punch list ref:** P1-D

## The situation

medha-id ships two parallel implementations of the per-tenant secrets bag:

| Path                 | Encryption           | Firestore doc                              | Callers today                                                                            |
| -------------------- | -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `/v1/secrets/:did/*` | AES-256-GCM (legacy) | `secrets/{did}`                            | every medha-platform tool, every medha-frontend OAuth callback, every internal cron call |
| `/v2/secrets/:did/*` | KEK-based (newer)    | a separate `secrets_v2/{did}` (or similar) | unclear — believed to be zero production callers, but not verified                       |

PR #108 closed a 404-bug on v1's missing `PUT /v1/secrets/:did/:key` so the agent stopped hitting 404 on every OAuth-refresh cache write. After that, v1 has full coverage for the operations the agent and frontend perform: bulk read, key list, single read, single write (PUT), bulk write (PUT), single delete, bulk delete.

So the question isn't "does v1 work" — it does. The question is "do we keep v2 around as a parallel system or commit to v1."

## Risk of running both

- Two encryption schemes means a future Caleb (or Claude) reads from one and writes to the other and silently drops data.
- Two Firestore docs per tenant means rotation in one place doesn't rotate the other.
- Backup + restore (P2-C) needs to know about both collections.
- New per-tenant secret keys (LinkedIn cookies just shipped via PR #111/#113) get written via v1; if a downstream consumer reads v2 it sees nothing.

## Recommendation

**Drop v2. Stay on v1.**

Reasons:

1. v1 is the de-facto standard already. Every caller listed in this repo's grep — every agent tool, every OAuth callback, every internal cron — uses `/v1/secrets/*`.
2. v2 has no known production consumer. If it has one we don't know about, dropping it surfaces that consumer immediately as a clear error rather than letting it silently diverge.
3. The KEK-based encryption scheme can be applied to v1 as a transparent upgrade later (decrypt with old key, re-encrypt with KEK, write back) without changing the API surface.
4. Two APIs for the same job is exactly the bug magnet the punch list warned about.

## Next step

This is a Caleb call. If he agrees:

1. Add a deprecation warning header to every v2 response (`x-medha-deprecated: v2-secrets`).
2. Wait one week, watch logs for v2 hits.
3. If zero hits, remove v2 routes + Firestore collection.
4. If non-zero hits, find the caller and migrate it to v1 first.

If Caleb wants to keep v2:

1. Document which consumer needs v2 + why.
2. Either migrate v1 callers to v2 (big lift) OR document the parallel-bag invariant explicitly so future code doesn't silently bridge them.

## Until decided

New code writes through v1. Don't introduce new v2 consumers.
