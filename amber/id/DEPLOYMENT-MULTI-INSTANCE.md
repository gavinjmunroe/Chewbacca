# amber-id deployment isolation + service-to-service attribution

amber-id is a **shared, multi-tenant backend service**. Every Amber user is a
tenant inside the *same* amber-id deployment — keyed by their Privy DID, with
their own cNFT, their own Pinecone namespace, their own Firestore documents,
and their own secrets bag. There is **no per-person amber-id** and no
per-product amber-id: amber-imessage and amber-ios-dev (and any future Amber
client) all hit the same shared deployment, and Caleb, Sagar, and every other
Amber user are tenants in that one service.

This document covers two unrelated, optional concerns that share env-var
plumbing in `src/lib/instance.js`:

1. **Service-to-service caller attribution** — labelling which upstream
   product (amber-imessage, amber-ios-dev, amber-agent, …) made an
   API-key-authenticated request, so audit logs and Pinecone metadata can
   distinguish writes from different services.
2. **Environment isolation for staging / preview / experiments** — when you
   need to run an extra deployment of amber-id (e.g. a `staging` build, a
   per-PR preview, or an integration sandbox) against the *same* Pinecone
   index or GCP project as production without colliding on collection or
   namespace names.

Neither concern creates a per-user or per-product backend. Every env var
below is optional and defaults to a no-op — production today runs with all
of them unset.

---

## What amber-id is today

```
        Privy login (iOS / web / iMessage)
                 │
                 ▼
        ┌───────────────────────┐
        │      amber-id         │
        │   (multi-tenant)      │
        │                       │
        │  per-tenant state:    │
        │   - users/{DID}       │
        │   - secrets/{DID}     │
        │   - tenant-<did>     │
        │       (Pinecone ns)   │
        │   - private graph     │
        └───────────────────────┘
                 ▲
       ┌─────────┴──────────┐
       │                    │
amber-imessage         amber-ios-dev
(SMS/iMessage agent)   (iOS app)
```

- **One amber-id, many clients.** amber-imessage handles the SMS / iMessage
  agent surface; amber-ios-dev is the iOS app. Both authenticate end users
  with Privy and call the *same* amber-id deployment.
- **Per-user isolation comes from DIDs, not deployments.** Privy login
  produces a DID. The DID gets a cNFT (`cnftMint`). The mint scopes a
  Pinecone namespace `tenant-<did>` and Firestore `users/{DID}`,
  `secrets/{DID}`. That is the complete per-user partition — no extra
  deployment knobs are involved or needed.
- **End users always authenticate with a Privy JWT.** API keys are only
  for service-to-service calls (e.g. amber-agent writing on behalf of a
  user it has resolved by phone).

---

## Caller attribution: named API keys + `x-amber-client`

`AMBER_ID_API_KEY` (single legacy key) and the new `AMBER_ID_API_KEYS` (list
of named keys) both authenticate **service-to-service** callers — never end
users. End users always authenticate with a Privy JWT.

| Caller (example)                         | Auth                                            |
| ---------------------------------------- | ----------------------------------------------- |
| amber-imessage backend → amber-id        | `AMBER_ID_API_KEYS` entry `amber-imessage`      |
| amber-agent → amber-id (write on behalf) | `AMBER_ID_API_KEYS` entry `amber-agent`         |
| amber-ios-dev (end user)                 | Privy Bearer token (no API key involved)        |

Every API-key-authenticated request stamps `clientId` on its audit-log line
and on Pinecone vector metadata (`client_id`). When a single key is shared
across a service and a sub-component, the caller can override the
key-derived name with the `x-amber-client: …` header.

This is purely an audit / attribution feature. It does not partition data
by caller, does not change which tenant the request operates on, and does
not imply any per-caller backend.

---

## Environment isolation: when you'd actually use the prefixes

`AMBER_INSTANCE_ID`, `FIRESTORE_COLLECTION_PREFIX`, and
`PINECONE_NAMESPACE_PREFIX` exist for one reason: to let you stand up a
**non-production** amber-id deployment alongside production without
forking infrastructure.

Legitimate uses:

- A `staging` deployment that shares the production Pinecone index but
  writes to `staging:tenant-<did>` namespaces and `staging_users` /
  `staging_secrets` Firestore collections, so staging traffic never
  touches production data.
- A per-PR preview deployment that uses a short prefix derived from the PR
  number for the same reason.
- A throwaway integration sandbox.

Production runs unprefixed — `AMBER_INSTANCE_ID=default`, both prefixes
empty — and that is the only deployment real users hit.

**Never use these prefixes to carve out a person or a product.** If two
real users need to live in different environments, that is a tenant-modelling
problem (DID + cNFT + namespace handle it already), not a deployment
problem. If two products (say amber-imessage and amber-ios-dev) need
separate audit trails, that is what named API keys + `x-amber-client` are
for.

| Env var                       | Purpose                                                                              | Default       |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `AMBER_INSTANCE_ID`           | Logical name of this deployment; stamped on audit + Pinecone metadata for debugging. | `default`     |
| `FIRESTORE_COLLECTION_PREFIX` | Prefix on root Firestore collections (`users`, `secrets`, `agent_data`, `agent_log`, `amber_otp`). | (empty) |
| `PINECONE_NAMESPACE_PREFIX`   | Prefix on Pinecone namespaces (`tenant-<did>`).                                       | (empty)       |
| `AMBER_ID_API_KEY`            | Legacy single server-to-server key. Still works.                                     | —             |
| `AMBER_ID_API_KEYS`           | Multiple named caller keys. JSON or `name:key,name:key`.                             | (empty)       |

---

## Future: optional shared corpora (not active infrastructure)

Down the road, Amber may layer **shared, curated corpora** on top of the
per-user knowledge graph — for example, a Togari-style relationship corpus
or a Rytual-style guides corpus. These are **not** part of the current
amber-id architecture and are not deployed today; they are mentioned here
only so the seams in this PR are not later mistaken for the wrong thing.

If and when those corpora exist, the model would be:

1. The corpus is its **own service** with its own data, owners, and
   infrastructure — *not* a deployment of amber-id.
2. Users would access slices of the corpus through **per-user, per-scope
   permission grants** that the corpus owner controls.
3. The corpus service would call amber-id with its own entry in
   `AMBER_ID_API_KEYS` so audit lines tag the traffic — exactly the same
   attribution path amber-imessage and amber-agent use today.

That is the only role caller attribution would play in a future shared-corpus
relationship. Nothing in this PR depends on those corpora existing, and
nothing about them justifies forking amber-id per user or per product.

---

## Migration notes

- All env vars default to "off", so existing tenants on the production
  amber-id are unaffected. `AMBER_INSTANCE_ID` defaults to `"default"`,
  collection / namespace prefixes default to empty.
- Pinecone vectors written from this deploy carry `instance_id` and
  `client_id` metadata. Reads ignore those fields, so they cannot break
  existing queries.
- `clientId` is `null` for legacy writes that arrive with the
  single-key `AMBER_ID_API_KEY`. Adding the same key as a named entry in
  `AMBER_ID_API_KEYS` (e.g. `{"name":"amber-agent","key":"<same>"}`) will
  start stamping client attribution without rotating the key.

## Verification checklist

1. `GET /status` — confirms Privy + Firestore connectivity.
2. Send a test ingest with `x-api-key` and `x-amber-client: smoke-test`.
   Inspect Railway logs for an `audit` line carrying `instanceId` and
   `clientId="smoke-test"`.
3. Pinecone: query the user namespace (prefixed if applicable) and
   confirm metadata contains `instance_id` and `client_id`.
