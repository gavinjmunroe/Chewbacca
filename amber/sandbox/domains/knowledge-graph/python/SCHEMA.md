# Personal Knowledge Graph — Schema

> **Superseded in part by [README.md](README.md).** This document describes the original
> three-kind narrative/entity/edge schema, which is still accurate and still in use. The
> graph has since been consolidated into a people-first architecture across two
> namespaces with additional record kinds (`person`, `outreach_draft`, `policy`, plus
> migrated agent-memory kinds). Read README.md first for the current shape; read this for
> the detail of the three original kinds.

A two-layer knowledge graph of Sagar Tiwari and his father, Umesh Kumar Tiwari,
stored inside the existing Amber memory substrate rather than a separate index.

## Where it lives

| | |
|---|---|
| Index | `amber-people` (serverless, AWS `us-east-1`) |
| Host | `amber-people-ttzdjqw.svc.aped-4627-b74a.pinecone.io` |
| Namespace | `tenant-did-privy-cmo0ay9oy001u0cl7h1wb7thy` |
| Dimensions | 2560, cosine |
| Embedding model | `pplx-embed-v1-4b` via `https://api.perplexity.ai/v1/embeddings` |
| Encoding | `base64_int8`, decoded to float as `int8 / 127` |

The graph deliberately shares Sagar's live tenant namespace, so Medha retrieves
these records natively with no migration and no second vector space.

## Conventions inherited from `amber-id`

Mirrored from `amberintelligence/amber-id` — `src/lib/embeddings.js` and
`src/knowledge/pinecone-client.js`:

- **Record ID** — `sha256(JSON.stringify({did, person, kind, text, createdAt}))[:32]`.
  Byte-identical to `deriveId()`, so re-running a seed is idempotent rather than
  duplicative.
- **Required metadata** — `did`, `kind`, `source`, `created_at`, plus
  `ingested_at`, `text` (truncated to 4000 chars), `trust`, `visibility`,
  `instance_id`, `dimension`.
- **Namespace derivation** — `tenant-` + DID lowercased with `:` replaced by `-`.
- **Nested objects** are JSON-stringified before upsert; nulls are dropped.

All graph records carry `source: "knowledge-graph"` and
`client_id: "computer-kg"`, so they can be filtered, audited, or removed
independently of conversational memory.

## The three original record kinds

`kind` distinguishes the layers. Every record is also tagged with a
`health_dimension` consistent with the rest of the namespace (`emotional`,
`intellectual`, `social`, `spiritual`, `occupational`, `environmental`).

### `kind: "episode"` — narrative layer

A self-contained memory written as prose, because prose embeds better than
field soup.

| Metadata | Meaning |
|---|---|
| `graph_layer` | `"episode"` |
| `theme` | e.g. `departure`, `time_together` |
| `place` | entity id of the location |
| `era` | entity id of the era it belongs to |
| `people` | list of person entity ids |
| `confidence` | 0–1 |

### `kind: "entity"` — node layer

| Metadata | Meaning |
|---|---|
| `graph_layer` | `"entity"` |
| `entity_id` | stable id, `<type>:<slug>` |
| `node_type` | `person`, `place`, `era`, `value`, `work` |
| `canonical_name` | display name |
| `aliases` | alternate names |
| `needs_followup` | set when a fact is unconfirmed |

### `kind: "edge"` — relationship layer

| Metadata | Meaning |
|---|---|
| `graph_layer` | `"edge"` |
| `subject` | entity id |
| `predicate` | `child_of`, `parent_of`, `calls`, `born_in`, `moved_to`, `studied_in`, `emigrated_to`, `worked_as`, `has_trait`, `attended_with` |
| `object` | entity id |
| `confidence` | 0–1 |

The edge's `text` is a natural-language restatement of the triple, so edges are
semantically retrievable too — a query like "who is Sagar's father" hits the
edge directly.

## Seeded content — pass 01

27 records: 13 entities, 11 edges, 3 episodes.

- **People** — `person:sagar-tiwari` (root), `person:umesh-kumar-tiwari`,
  `person:sindhu` (relationship unconfirmed, `needs_followup: true`)
- **Places** — Shahpura MP, Mandla, Raipur, United States
- **Eras** — Mandla years (from age 13), emigration 1993, cybersecurity 2009
- **Traits** — speaks philosophically
- **Work** — IT career, cybersecurity career
- **Episodes** — leaving home at thirteen; first from the village; Sindhu's
  graduation

## Usage

```python
import amber_kg as k

k.upsert([{ "kind": "episode", "text": "...", "extra": {...} }])
k.query("what did dad believe about work", top_k=10,
        flt={"source": {"$eq": "knowledge-graph"}})
```

Requires credentials for `api.perplexity.ai` and the Pinecone data-plane host,
injected through the credential proxy — no keys in code or environment.

### Note on TLS

The credential proxy terminates TLS with its own CA while the CONNECT hop uses a
public CA, and Python 3.14 enables `VERIFY_X509_STRICT`, which rejects the
proxy-minted leaf certificates for missing an Authority Key Identifier.
`amber_kg.py` therefore verifies against certifi plus the proxy CA and clears
only that one flag.
