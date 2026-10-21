# Identity model

**Ownership root is `users.amber_id` (UUID).** Phone, Privy DID, and
`person_id` are resolution aliases, not storage keys for new data. New
people-tagged rows key on `(owner_id = amber_id, contact_id, created_at)`.

The people-data contract (tables, frozen HTTP shapes, who edits which files)
is `docs/PERSON-CONTRACT.md`. This file is the identity-shape + resolver
guide so secrets, tenants, and inbound iMessage attribution do not pick the
wrong human. Getting the fallback order wrong is the class of bug that caused
the "Maggie answered as Sagar" regression.

Both `medha-id/AGENTS.md` and `medha-platform/AGENTS.md` reference this doc;
do not duplicate the explanation elsewhere.

---

## How the pieces fit

| Layer | What it is | Where it lives |
|---|---|---|
| **Ownership root** | `amber_id` UUID | Cloud SQL `users.amber_id`. Every private row's `owner_id`. |
| **Session** | JWT | `medha-jwt` `sub` is still `person_id` this week; tokens **add** an `amber_id` claim. iOS sends Bearer access tokens only — never a client-supplied owner header. |
| **Portable identity proof** | Bubblegum cNFT leaf on shared `AMBER_MERKLE_TREE` | `users.cnft_asset_id` (nullable until async mint). Not the dataset. |
| **Relationship lens** | Contact edge | `contacts.owner_id → amber_id`. Notes about Karthik ≠ Karthik's account. |
| **Global person** | Verified human | Phase 2 `persons` table. Do not build it this week. |

Wallet + Merkle leaf = portable identity proof. `amber_id` = data ownership.
Contacts = private graph edges. JWT = session. Everything else is Postgres.

---

## The identity shapes (aliases of `amber_id`)

Three historical identifiers still appear on the wire and in amber-agent.
Resolve each to `amber_id` before writing people data. Do not mint a fourth.

### 1. `amber_id` — ownership root (use this)

Shape: UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

Owner: every Cloud SQL `users` row. Created on first OTP verify /
`resolveAmberIdByPhone`.

Authority: **primary key for private data.** Contacts, secrets v2 (after
migration), voice memos, sessions' owner, delete-account cascade.

Resolution:

- OTP verify already returns `amberId`.
- `GET /v1/me` must expose `amber_id` (see PERSON-CONTRACT).
- From a verified session: phone → `resolveAmberIdByPhone`, or Privy DID →
  `resolveAmberIdByPrivyDid`, or `did:amber:<uuid>` → the uuid itself
  (`src/db/store.js`, `src/lib/privy.js` `TenantIndex`).

When to use: every new endpoint that touches a tenant. If you only have a
phone, resolve first. If you only have a DID, resolve first. Do not store
new rows keyed only on DID or `person_id`.

### 2. Privy DID — legacy session + internal paths

Shape: `did:privy:cmewabcd1234efgh5678`

Owner: users who signed in via Privy (Google, Apple, email, embedded
wallet). Immutable for that account. OTP-only users often have **no** Privy
DID; those rows use a synthetic `did:amber:<amber_id>` in tenant envelopes.

Authority: **alias**, not the ownership root. Still the key on leftover
Firestore docs, Pinecone `tenant-<did>` namespaces, and
`/internal/users/:did/*` / `/v1/secrets/:did/*` until those migrate. Tenant
index maps DID → `amber_id`.

Resolution:

- Privy JWT (`requireAuth` branch 3): `request.privyUser.userId`.
- Phone: `/tenants/resolve?phone=<e164>` → tenant row (`privy_did` or
  `did:amber:<amber_id>`).
- Loop sender id: tenant `loop_sender_id` / `sender_id` via the same index.

When to use: existing DID-keyed routes and the agent secrets resolver
(below). **Not** as the PK for new tables. Do not drop Privy branch 3 this
week (iOS still has a gated JWT-only cutover).

### 3. `person_id` — OTP JWT subject (this week)

Shape: 32-char hex, first half of `sha256(E.164(phone))`.
Example: `9127baa7d40ad8de7f4b66bf3c4b3c2e`

Owner: OTP login. Stored on `users.person_id`. `medha-jwt` `sub` is this
value today so tokens line up with `medha_pdw.persons` and the agent's
person-resolver.

Authority: **stable alias** for OTP users. Secrets written by the dashboard
`/connect` OAuth path may still live under `secrets/{person_id}`. It is not
the ownership root and must not become one.

Resolution: `personIdFromHandle(phone)` — same hash the OTP issuer uses.

When to use: verifying medha JWTs; the secrets bridge below. New endpoints
authenticate the JWT, then resolve `amber_id`. Do **not** change JWT `sub`
to `amber_id` this week (PERSON-CONTRACT: additive claim only).

### 4. Synthetic expert DID — not a user

Shape: `did:expert:medha` (or any `did:expert:*`)

Owner: not a user. Public expert agent persona when the agent replies as
the product, not as a tenant.

Authority: NOT a user identity. Tenant row in amber-agent `lib/tenant.js`.
No per-user secrets. Org-level resources only.

When to use: never write user data here. New write paths reject expert DIDs.

---

## Fallback order in the agent's secret resolver

`medha-platform/Newton/agent/lib/secrets.js` implements
`getSecret(tenant, key, { fallbackEnv })` with this exact precedence. It is
still load-bearing while secrets bags are DID- and `person_id`-keyed. Do not
"simplify" it until bags live under `amber_id`.

1. **Cache hit on `(tenant.privyDid, key)`** — returns immediately.
2. **Bag fetch on `tenant.privyDid`** — `GET /v1/secrets/:did/:key` on
   medha-id with service auth.
3. **Identity bridge to `person_id`** — if (2) misses AND
   `tenantPersonId(tenant)` resolves (the tenant has a phone), retry the bag
   under `person_id`. This catches OTP-flow users whose tokens were written
   by the dashboard `/connect` page under the derived `person_id`.
4. **Env fallback** — if `fallbackEnv` is set AND both (2) and (3) missed,
   return `process.env[fallbackEnv]`.
5. **Cache** the value the caller will actually receive (including `null`)
   under `tenant.privyDid`.

Without (3), "what's on my calendar?" silently failed for every OTP-flow
user who connected Google via the frontend instead of Privy.

When secrets finish migrating to `owner_id = amber_id`, this bridge collapses
to a single lookup. Until then, keep it.

---

## Inbound contacts vs tenant owner

`/internal/users/:did/contacts/by-phone` resolves an **inbound sender**
against that tenant's address book. A 404 means unknown sender.

**Callers MUST NOT substitute the tenant owner's identity.** That substitution
is how Maggie's inbound iMessage was answered as Sagar. Tenant resolve
(`/tenants/resolve?phone=`) is for the *account holder*, never for the person
who just texted.

---

## How to NOT get this wrong

- **Always** persist new people data under `owner_id = amber_id`.
- **Always** treat tenant resolution as a join: phone or DID → `users` row →
  `amber_id`. Do not conflate "the phone Loop sent from" with "a user ID".
- **Never** synthesize a Privy DID from a phone number. The hash function is
  for `person_id`, not for DIDs.
- **Never** write user data to a synthetic expert DID.
- **Never** skip the `person_id` bridge when reading secrets in amber-agent
  until bags are `amber_id`-keyed.
- **Never** change JWT `sub` this week; add `amber_id` as a claim.
- **Never** take `amber_id` from an untrusted client header. Session →
  resolve → owner.
- **Never** use cNFT mint address as the OLTP primary key. It is a portable
  proof (`users.cnft_asset_id`), nullable until the mint worker succeeds.

---

## Where the logic actually lives

| Concern | File |
|---|---|
| `amber_id` resolve (phone / DID) | `medha-id/src/db/store.js` (`resolveAmberIdByPhone`, `resolveAmberIdByPrivyDid`) |
| Tenant index (phone / sender / DID / amber_id) | `medha-id/src/lib/privy.js` (`TenantIndex`, `rowToTenant`) |
| JWT issue / verify (`sub` = `person_id`) | `medha-id/src/lib/medha-jwt.js` |
| OTP verify returns `amberId` | `medha-id/src/routes/mobile-auth.js` |
| Refresh / sign-out | `medha-id/src/routes/auth-sessions.js`, `src/db/session-store.js` |
| `GET /v1/me` (must expose `amber_id`) | `medha-id/src/routes/profile.js` |
| Bubblegum mint | `medha-id/src/lib/solana.js`, `src/routes/identity.js` |
| Delete cascade on `amber_id` | `medha-id/src/db/purge.js` |
| `person_id` derivation | OTP issue path + `personIdFromHandle` |
| Secrets bridge DID + `person_id` | `medha-platform/Newton/agent/lib/secrets.js` (`getSecret`) |
| Synthetic expert tenant | `medha-platform/Newton/agent/lib/tenant.js` |
| People HTTP contract | `medha-id/docs/PERSON-CONTRACT.md` |

If you touch any of these files, re-read this doc and PERSON-CONTRACT first.
