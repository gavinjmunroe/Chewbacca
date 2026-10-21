# domains/knowledge-graph

Amber's knowledge graph. Sandbox-owned, extracted from `amber-id` per
[`MIGRATION_PLAN.md`](../../../projects/amber/MIGRATION_PLAN.md) Phase 2.
`amber-id` calls this service over HTTP with an HMAC-signed request.

## Wire shape — HTTP service

```
amber-id  ──HMAC-signed HTTPS──▶  domains/knowledge-graph (Fastify, PORT 8081)
                                          │
                                          ├─▶ Pinecone amber-people
                                          │     tenant-<did>  (private truth)
                                          │     share-<did>   (cleared-to-share)
                                          │
                                          └─▶ Perplexity pplx-embed-v1-4b
```

- HMAC signature: `X-KG-Signature: sha256=hex(hmac(KG_SERVICE_SECRET, timestamp + "\n" + method + "\n" + path + "\n" + body))`, plus `X-KG-Timestamp: <unix seconds>`. Service rejects timestamps older than 5 min.
- All routes except `/healthz` are HMAC-gated.
- `KG_SERVICE_AUTH_MODE=disabled` bypasses signature verification for local dev; never flip in prod.

## Routes

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | — | 200 + service metadata (index name, embedding model, dims) |
| POST | `/upsert` | `{did, kind, records: [{person, text, createdAt, metadata}]}` | Embed each record and write to `tenant-<did>`. The service derives the vector id and the embedding. |
| POST | `/query` | `{did, queryText, topK?, filter?, scope?, weights?, kind?}` | Top-K semantic search. `scope='private'` (default) reads `tenant-<did>`; `scope='shared'` reads `share-<did>`. Optional `weights` enables dimension-weighted rescoring. |
| POST | `/clear` | `{did, ids, cleared_scope}` | Clearance projection — refetch vectors from `tenant-<did>`, strip sensitive metadata (`stage_2_score`, six-dim scores, phone, email, raw payloads), stamp `origin_owner` / `owner_did` / `cleared_scope` / `cleared_at`, upsert to `share-<did>` under the same id. Idempotent. |
| POST | `/unshare` | `{did, ids}` | Reverse of `/clear`. Removes shared copies. Private truth untouched. |
| POST | `/forget` | `{did, ids?, all?}` | Delete from `tenant-<did>`. In private scope (the default) also removes the same ids from `share-<did>` so `/forget` cannot leave dangling projections. |

## Namespace model

```
tenant-<did lowercased, ':' → '-'>   private truth, owner-only reads
share-<did lowercased, ':' → '-'>    cleared-to-share, cross-tenant readable
```

See [`../../docs/references/pinecone-namespace-map.md`](../../../projects/amber/references/pinecone-namespace-map.md) for the live snapshot.

## Layout

```
domains/knowledge-graph/
├── service/
│   ├── server.js            — Fastify entrypoint (PORT, /healthz, HMAC hook)
│   ├── routes/              — one route file per capability
│   │   ├── upsert.js
│   │   ├── query.js
│   │   ├── clear.js
│   │   └── forget.js
│   └── lib/
│       ├── pinecone.js      — sandbox-owned client, namespace-visibility surface
│       ├── embed.js         — Perplexity pplx-embed-v1-4b wrapper
│       ├── deriveId.js      — sha256(json({did,person,kind,text,createdAt}))[:32]
│       ├── auth.js          — HMAC verify + signRequest helpers
│       ├── contact-edge.js  — pure helpers for contact-edges-index
│       ├── events.js        — pure helpers for events-index
│       ├── people-rank-score.js
│       ├── relationship-score.js
│       └── name-boundary.js
├── writers/                 — the 12 kind-specific writers ported from amber-id
│   ├── author-voice-index.js
│   ├── contact-edges-index.js
│   ├── contacts-index.js
│   ├── content-seed-index.js
│   ├── events-index.js
│   ├── forget-and-snapshot.js
│   ├── highlight-preference.js
│   ├── partnerships-index.js
│   ├── people-rank-index.js
│   ├── personal-life-index.js
│   ├── pipelines-index.js
│   ├── relationship-snapshot-index.js
│   └── *.test.js            — ported node:test suites
├── python/                  — Sagar's Python toolkit
│   ├── amber_kg.py
│   ├── build_people.py
│   ├── migrate_memory.py
│   ├── upload.py
│   ├── verify.py
│   ├── seed_01.py
│   ├── finalize.py
│   ├── README.md
│   └── SCHEMA.md
├── package.json
├── .env.example
├── .provenance.json
└── README.md
```

## deriveId contract

```
sha256(JSON.stringify({did, person, kind, text, createdAt}))[:32]
```

`service/lib/deriveId.js` is **byte-identical** with what the Python
toolkit and every existing seed rely on. Do not "improve" it — a reordering
of the JSON keys, a switch to canonical JSON, or a change of digest
encoding would treat every re-run as new records and duplicate the
`amber-people` index.

## Env vars

See `.env.example`. Minimum for production:

- `PINECONE_API_KEY`, `PINECONE_INDEX=amber-people`
- `PERPLEXITY_API_KEY`
- `KG_SERVICE_SECRET` (shared with amber-id)
- `PORT`, `HOST`

## Deploy

Railway. Root dir: `domains/knowledge-graph/`. Start: `npm start`. Health check: `GET /healthz`.

## Tests

```bash
cd domains/knowledge-graph
npm install
npm test
```

The `node:test` suites cover the pure helpers and the graceful-degradation
paths in the writers (no Pinecone / no Perplexity keys → empty results).
Integration tests against the live Pinecone index live in `python/verify.py`.

## Provenance

Ported from `amber-id@9af33e058a59f0e2ced5aaf5bd2e00ee33db8c4c` (PR #186 head),
plus the namespace-visibility surface from `amber-id` PR #187. See `.provenance.json`.
