# Tiwari — Amber's integration layer

> Sagar's karma + bhakti yoga: devotional, creative integration of Newton's genius and Togari's stability into the Amber product.

See `YOGA-MODEL.md` in this folder for the full philosophical and architectural contract.

## Three primitives

| Folder | Primitive | Product meaning | Togari equivalent |
|---|---|---|---|
| `tiwari-peoplerank/` | **list building** | Search — *find who* | `togari-peoplerank` |
| `tiwari-enrich/` | **data enrichment** | Context — *know them deeper* | `togari-enrich` (future) |
| `tiwari-opportunity/` | **sequencing** | Delivery — *right info, right moment* | `togari-opportunity` (future) |

Shared infra:

| Folder | Purpose |
|---|---|
| `shared/amber-id-client/` | Typed HTTP client for the sibling `amber-id` repo (`amber-organization/amber-id`). Every Tiwari service can import this to blend in the caller's private cNFT-gated KB. |

## What each tiwari-* service does

Every service does exactly three things, in this order:

1. **Vendor togari** — `vendor/togari/` is a git submodule pinned to a known-good SHA of the matching `togari-*` repo. Stable B2B code, studied like jnana yoga.
2. **Blend Newton** — import experimental ideas from `../../Newton/` that Sagar has chosen to promote. The wrapper is where production-hardening happens (timeouts, retries, auth).
3. **Inject amber-id context** — when a request carries a `userCnft`, query the user's private KB via `shared/amber-id-client` and blend those facts into the result. This is the unique sauce that Togari alone cannot replicate.

## Service contract (all tiwari-* export the same shape)

```js
// tiwari-peoplerank
export async function listBuild({ query, filters, userCnft, options })

// tiwari-enrich
export async function enrich({ entity, userCnft, options })

// tiwari-opportunity
export async function sequence({ trigger, userCnft, options })
```

Every return value is wrapped in a standard envelope:

```js
{
  ok: true,
  source: "togari" | "newton" | "amber-id" | "blended",
  results: [...],
  personalized: boolean,   // true iff amber-id context was blended in
  tookMs: number,
  warnings: [...],
  citations: [...]
}
```

## Who calls Tiwari

- **amber-agent** is the HTTP gateway. iOS / iPadOS / macOS / visionOS never reach Tiwari directly; they hit amber-agent endpoints, which call these in-process ES modules.
- **amber-agent's Newton orchestrator** (`Newton/agent/agent.js`) calls Tiwari via tool use when Claude decides an iMessage needs one of the primitives.
- **Nothing else.** If you find yourself wanting to call Tiwari from a new edge, route it through amber-agent first.

## Togari sync discipline

Each `tiwari-*/vendor/togari/` is a git submodule pinned to a specific SHA.

```bash
# Bump the pin for tiwari-peoplerank when the BMA team tags a togari-peoplerank release.
cd Tiwari/tiwari-peoplerank/vendor/togari
git fetch origin
git checkout <new-sha-or-tag>
cd ../../../..
git add Tiwari/tiwari-peoplerank/vendor/togari
git commit -m "chore(tiwari-peoplerank): bump togari pin to <sha>"
```

Never auto-bump; every pin is an intentional act.

## Directory

```
Tiwari/
├── README.md                          # this file
├── YOGA-MODEL.md                      # the philosophy
├── shared/
│   └── amber-id-client/              # HTTP client for amber-id repo
│       ├── index.js                  # ask(), ingest(), mint(), verify()
│       └── README.md
├── tiwari-peoplerank/                 # list building
│   ├── index.js                      # listBuild({...})
│   ├── src/                          # wrapper logic, blending
│   ├── vendor/togari/                # git submodule → togari-peoplerank
│   └── README.md
├── tiwari-enrich/                     # data enrichment
│   ├── index.js                      # enrich({...})
│   ├── src/
│   └── README.md                     # awaits togari-enrich upstream
└── tiwari-opportunity/                # sequencing
    ├── index.js                      # sequence({...})
    ├── src/
    └── README.md                     # awaits togari-opportunity upstream
```

## Billing gate reminder

The **iMessage/SMS agent** (`Newton/agent/agent.js`) is a paid capability enforced at the amber-agent HTTP layer, not inside Tiwari. Tiwari services themselves are free to call; they become paid only when bundled with the iMessage concierge or consumed above free-tier quota.
