# Second Brain — Entry Point

This project is the front door to Sagar Tiwari's personal knowledge graph. Everything
lives in one Pinecone index, `amber-people`, in **two namespaces split on a trust
boundary** — private truth, and cleared-to-share.

| | Namespace | Vectors | What it is |
|---|---|---|---|
| Private | `tenant-did-privy-cmo0ay9oy001u0cl7h1wb7thy` | 17,949 | Source of truth. Everything. |
| Share | `share-did-privy-cmo0ay9oy001u0cl7h1wb7thy` | 950 | Only what has been explicitly cleared. |

Index: `amber-people` · 2560-dim · cosine · dense · serverless AWS us-east-1
Host: `https://amber-people-ttzdjqw.svc.aped-4627-b74a.pinecone.io`
Embeddings: `pplx-embed-v1-4b`, `base64_int8`, decoded as `int8 / 127`

## People-first, by design

The organizing unit is a **person**, not a document or a data source. Every fact hangs
off a person node, so there is one place to look up anyone and one query surface for the
whole brain. Namespaces are hard partitions in Pinecone — a query can only see one at a
time — so the private side is deliberately kept as a single namespace rather than split
by record type. Filtering is done with metadata, which is cheap and composable.

## What is in the private namespace

| Kind | Count | Description |
|---|---|---|
| `person` | 7,228 | One node per human. Identity, work, education, circles, events, investor tier, relationship score, and the six health-dimension assessments folded into the text. |
| `edge` | 7,475 | Typed relationships: `attended`, `works_at`, `studied_at`, `in_circle`, plus the family and biography edges. |
| `entity` | 264 | Hubs worth traversing: 18 Partiful events, 62 orgs, 130 schools, 54 circles. |
| `outreach_draft` | 949 | Pre-written messages, one per person who has one. |
| `episode` / `conversation` / `auto_fact` / `message` / `inferred_signal` / `auto_preference` / `context` / `observation` | 2,033 | Narrative and agent memory, migrated from the old cNFT namespace with vectors reused, so semantics are unchanged. |

### Identity resolution

People were unified across four sources — the Clay relationships export, Apple
contacts, an Apple VCF re-import, and Google contacts. Resolution order is **E.164 phone
→ lowercased email → normalized name**. `personId` is the E.164 phone when one exists,
which is what the existing agent memory already used as `person_id`, so 1,140 migrated
memory records linked straight onto person nodes.

The four sources held 4,457 contact records that collapsed to 2,252 unique names, of
which 2,242 were already in the export — only 10 people existed solely in contacts. The
union is **7,228 unique humans**.

## Useful metadata filters

- `kind` — as in the table above
- `person_entity_id` — e.g. `person:helene-servillon`, joins memories to people
- `investor_tier` — `T1` 39, `T2` 145, `T3` 753, `T4` 6,281
- `stage_2_score` — relationship strength, median 65, 705 people at 80+
- `health_dimension` — `spiritual`, `emotional`, `physical`, `social`, `intellectual`, `financial`
- `circles`, `events`, `org`, `school`, `contact_sources`
- `data_quality` — `sparse` on 34 name-only contacts, `suspect` on 5 export artifacts
  (`Amber`, `Partiful`, `clay`, `Meet`, `Say` are app names, not people). Exclude these
  for clean results.
- `shareable` — gate for promotion to the share layer

## The share layer

`share-did-privy-cmo0ay9oy001u0cl7h1wb7thy` is where content goes that is meant for
other people, or for outward-facing agents to read. It is governed by a `kind: policy`
record stored in the namespace itself, and the rules are:

1. **Nothing lands here automatically.** Promotion is a deliberate, one-directional copy.
2. **Vectors are reused, never recomputed**, so a promoted record means exactly what the
   private one means.
3. **Never promote** a third party's private life, a relationship score or its rationale,
   a health assessment, a phone number, or an email address. These fields are stripped on
   promotion.
4. **Never promote content owned by someone else.** The 50 records ingested from Caleb
   Newton's context repo are marked `origin_owner: caleb-newton` and permanently blocked.

Seeded with the 949 outreach drafts, which are already written to be sent to people, with
scores and contact details stripped.

## Working with it

`amber_kg.py` is the client. It reproduces amber-id's contract exactly — the same record
ID derivation (`sha256` of a canonical JSON of `did`, `person`, `kind`, `text`,
`createdAt`, truncated to 32 chars), the same required metadata, the same namespace
naming. Records written here are readable by the Amber app and vice versa.

```python
import amber_kg as k
k.query("health tech investors I should talk to about Amber",
        flt={"kind": {"$eq": "person"}, "investor_tier": {"$in": ["T1", "T2"]}})
```

Scripts, in order of the pipeline: `build_people.py` builds records from the sources,
`upload.py` embeds and upserts them resumably, `migrate_memory.py` moves memory across
without re-embedding, `verify.py` checks coverage and retrieval, `finalize.py` flags data
quality and seeds the share layer.

## Known issue: the cNFT namespace will come back

`src/knowledge/pinecone-client.js` in `amberintelligence/amber-id` instantiates both a
cNFT-keyed and a DID-keyed client. The old `cnft:did:privy:...` namespace was deleted
here, but the app will recreate and refill it on the next write. Retiring the cNFT client
in that repo is the durable fix.

## Open threads

- `person:sindhu` — relationship to Sagar still unconfirmed
- Umesh's birth year still missing
- Unasked: the phrase he said often, his philosophy of work, what leaving Shahpura at 13 cost him
