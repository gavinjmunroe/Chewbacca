# Extraction guide — medha-sandbox → medha-platform

This sandbox exists so experiments can mature **outside** the agent monorepo,
then land in `medha-platform` as small, tested packages.

## When to extract

Extract when **all** are true:

1. Domain has a clear package boundary (library or service adapter).
2. Offline tests / eval harness pass without requiring production secrets.
3. Contract with the consumer is documented (API schema, protocol, or types).
4. You know the **destination path** in medha-platform (or a dedicated
   `amber-organization/<name>` repo if it should stay independent).

Do **not** extract: demos, waitlist landings, one-off marketing pages, checked-in
binaries, or unvalidated algorithm knobs.

## Extraction checklist

```text
[ ] Identify package root (e.g. domains/peoplerank/src/peoplerank)
[ ] Confirm tests: ./scripts/smoke.sh and domain-local suite
[ ] Freeze public surface (types / OpenAPI / protocol)
[ ] Copy or subtree into medha-platform destination
[ ] Wire CI in destination; do not rely on this sandbox's scripts alone
[ ] Record extraction in docs/PROVENANCE.md (date, SHA, destination)
[ ] Leave a stub README in the sandbox domain pointing at the new home
    (optional: delete domain only after destination is healthy)
```

## Recommended extract targets

### 1. PeopleRank library (highest priority)

| From | To (suggested) |
| ---- | -------------- |
| `domains/peoplerank/src/peoplerank/` | medha-platform package or `togari-search` algorithm module |
| `domains/peoplerank/api/schemas.py` + response-shape tests | shared mobile/API contract |
| `domains/peoplerank/docs/PEOPLERANK_V2_DESIGN.md` | design canon alongside impl |

Keep FastAPI `api/main.py` deployable here until production owns the route.
DNC sync scripts stay ops-adjacent — promote only with BigQuery ownership clear.

### 2. Messages2Kit

| From | To |
| ---- | -- |
| `domains/messaging/messages2kit/` (entire SPM package) | ClearOut / native messaging package in platform or dedicated repo |

Consumer contract: `MessagesProvider` in `Sources/Messages2Kit/Models.swift`.
Ship mock provider with the library so UI can develop without FDA.

### 3. amber-core slices

| From | To |
| ---- | -- |
| `ventures/core/amber-core/packages/shared-types` | platform shared types |
| `packages/people-graph` | platform people search (align with peoplerank later) |
| `packages/memory-engine` | agent memory ingestion |

Fix before extract: `agent_suggestions` table missing from schema.sql; empty
`packages/prompts`; storage package unused by API.

### 4. Tizzy (selective)

| From | To |
| ---- | -- |
| Conversation / coaching TypeScript types + taxonomy | platform health/coaching schemas |
| BLE + SessionRecorder + SQLite sync queue | wearable client SDK seed |
| Web demo | stay in sandbox / Vercel — not platform |

## Anti-patterns

- Dumping an entire domain tree into medha-platform (recreates the 2026-05
  ventures bloat that caused the original extraction).
- Extracting Electron Messages2 as the long-term product surface — keep Kit.
- Promoting FiduciaryOS / EGATS / Marrow into the agent monorepo — they belong
  in dedicated product repos if revived.
- Changing algorithm weights in production without sandbox eval artifacts.

## Smoke before every extract PR

```bash
./scripts/smoke.sh
./scripts/provenance-check.sh
```
