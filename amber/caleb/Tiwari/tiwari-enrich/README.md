# tiwari-enrich

**Primitive:** data enrichment (context building).

Given a known entity, pile on context. Today that context comes from the user's amber-id KB (their own notes, past iMessage conversations about the person, health observations). When `togari-enrich` ships on the BMA cadence, we add it as a submodule and blend in firmographic/enrichment data.

## API

```js
import { enrich } from "./index.js";

const result = await enrich({
  entity: { id: "p_01", name: "Dev Patel", email: "dev@example.com" },
  userCnft: "Gx7...4kD",           // optional — enables amber-id personal notes
  token: privyJwt,                  // required if userCnft is passed
  options: { topK: 8 },
});
```

## Status

| Source | Status |
|---|---|
| togari-enrich | ⏳ **not yet shipped** — awaiting BMA team |
| Newton ideas | 🪜 hooks in place; no ideas promoted yet |
| amber-id | ✅ active (personal notes + conversation memory) |

Until togari-enrich lands, results return `source: "amber-id"` when personal context is found, or `source: "empty"` when there's nothing yet. This is intentional — we never fake enrichment.

## Envelope

```js
{
  ok: true,
  source: "amber-id" | "blended" | "empty",
  personalized: boolean,
  results: [{
    entity: { id, name, email, ... },
    facts: [{ source, kind, text, created_at, score }, ...]
  }],
  citations: [...],
  tookMs: 88,
  warnings: ["togari_enrich_not_yet_shipped", ...]
}
```

## What lands next

1. BMA team ships `togari-enrich` with `POST /enrich` → Crustdata-style firmographic/role/company enrichment.
2. We add `vendor/togari/` submodule + `src/togari-adapter.js` here.
3. Blender merges togari facts with amber-id facts, citing both.
4. No API change for consumers.
