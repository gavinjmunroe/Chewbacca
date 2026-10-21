# ARCHITECTURE-NAMING.md

Canonical map for the three Medha repos, the `amber-*` legacy aliases, and
what you may safely rename vs what is a live production contract.

---

## Three-repo operating model

| Repo | Role | Who touches it | Holds |
| ---- | ---- | -------------- | ----- |
| [`medha-sandbox`](https://github.com/amber-organization/medha-sandbox) | Creative lab | You (Sagar) freely | Experiments, domain prototypes, eval harnesses |
| [`medha-platform`](https://github.com/amber-organization/medha-platform) | Production agent + solid content surface | You, after proof | Agent tools, transport, context wikis, graduated packages |
| [`medha-id`](https://github.com/amber-organization/medha-id) | Identity / secrets / knowledge mecca | **Karthik only** | Tenants, secrets bag, auth JWT, contacts, ingest/query APIs |

Flow:

```
sandbox (try) → prove with tests/eval → extract into platform (ship)
                                              │
                                              ▼
                                    call medha-id contract
                                    (do not fork identity)
```

**Rule for you:** invent in sandbox, harden in platform, consume medha-id
as a black-box API. Do not open medha-id PRs for product ideas — file a
contract request for Karthik if an endpoint is missing.

---

## Name reconciliation: `medha-id` ↔ `amber-id`

These names refer to the **same service**. Prefer **`medha-*` in speech and
new docs**. Leave **`amber-*` in runtime** until a coordinated cutover.

| Layer | Canonical (prefer) | Legacy / still live | Mutable without coordination? |
| ----- | ------------------ | ------------------- | ----------------------------- |
| GitHub repo | `amber-organization/medha-id` | often called `amber-id` in older docs | repo already medha-id |
| Local folder | `medha-id` | — | yes |
| npm `package.json` name | still `"amber-id"` inside the repo | — | **no** (Karthik) |
| Railway service | `medha-id` / historically `amber-id` | both hostnames appear in docs | **no** |
| Public host | `medha-id-production.up.railway.app` | `amber-id-production.up.railway.app` | **no** |
| Caller env URL | `MEDHA_ID_URL` (alias) | `AMBER_ID_API_URL` (live on Railway) | dual-read only |
| Caller env key | `MEDHA_ID_API_KEY` (alias) | `AMBER_ID_API_KEY` (live on Railway) | dual-read only |
| JWT issuer (native Amber) | — | `iss: "amber-id"` in `amber-jwt.js` | **no** |
| JWT issuer (Medha dashboard) | `iss: "medha-id"` in `medha-jwt.js` | — | **no** |
| DB primary key field | `amber_id` uuid | — | **no** (schema) |
| User-facing brand | **Amber** (agent) / **Medha** (product) | Camber / Samber = per-tenant agent personas | n/a |

### Platform dual-read (already shipped)

In `Newton/agent/lib/constants.js`:

- `AMBER_ID_API_URL` / `AMBER_ID_API_KEY` — primary Railway contract today
- `MEDHA_ID_URL` / `MEDHA_ID_API_KEY` — preferred aliases; fall back to `AMBER_ID_*`

**Do not remove the `AMBER_ID_*` fallbacks.** That would break production.
**Do not rename Railway hostnames or JWT `iss` values in a cleanup PR.**

The older [`RENAME-DISPATCH-AMBER-ID.md`](RENAME-DISPATCH-AMBER-ID.md)
(medha-id → amber-id) is **superseded** by this doc: product repos stay
`medha-*`; `amber-id` remains an internal/runtime alias, not a rename target.

---

## Platform vs id vs sandbox (what lives where)

| Kind of work | Put it in |
| ------------ | --------- |
| Wild idea / prototype / algorithm knob / demo UI | `medha-sandbox/domains/…` |
| Proven library / agent tool / content pipeline | `medha-platform` (extract per sandbox `docs/EXTRACTION.md`) |
| Durable content (wiki pages, dimension notes, trip JSON) | per-tenant context repo via platform `lib/context-repo.js` |
| Identity, secrets, contacts, Pinecone/BQ knowledge, OTP/JWT | **medha-id only** (Karthik) |
| New OAuth callback host / tenant schema / secrets encryption | **medha-id only** |

Platform **reads/writes** medha-id through the consumer contract; it does
not reimplement identity stores.

### Consumer contract (platform → medha-id)

Reads:

- `GET /tenants/resolve?sender_id=…` / `?phone=…`
- `GET /v1/secrets/:did` and `/:key`
- `POST /knowledge/query-as`

Writes:

- `POST /ingest/:pipe` (`agent` \| `health` \| `checkin` \| `relationship`)
  with `x-amber-phone` (header name is legacy; leave it)

Auth between services: `X-API-Key: <AMBER_ID_API_KEY>` (or `MEDHA_ID_API_KEY`).

---

## Repo vs Railway precedence (platform)

| Layer | Name | Mutable? |
| ----- | ---- | -------- |
| GitHub repo | `amber-organization/medha-platform` | yes (already renamed) |
| Railway service | `medha-platform` (service id historically `amber-agent`) | **no without webhook cutover** |
| Public hostname | `medha-platform-production.up.railway.app` | **no without client cutover** |

GitHub names can clarify; Railway hostnames and Loop/iOS webhook targets
are production contracts. Same rule as medha-id.

---

## Togari posture (unchanged)

`togari-search` / `togari-stitch` / `togari-schedule` are future / shared
B2B — not the core Medha app path. Do not reimplement them inside
platform. See [`AMBER-TOGARI-BOUNDARY.md`](AMBER-TOGARI-BOUNDARY.md).

---

## See also

- Sandbox extraction: `medha-sandbox/docs/EXTRACTION.md`
- Sandbox domain map: `medha-sandbox/docs/DOMAIN_MAP.md`
- Platform CLAUDE.md / AGENTS.md — per-tenant correctness
- medha-id `docs/AUDIT-legacy-removal.md` — Karthik's stack migration (do not drive from platform)
