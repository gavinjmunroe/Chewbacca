# The Amber Yoga Model

**Author:** Sagar Tiwari
**Drafted with:** Perplexity Computer
**Last updated:** April 17, 2026

This document is the philosophical and architectural contract that governs how code flows between Newton, Togari, Tiwari, and amber-id in the Amber (Perplexity for People) ecosystem.

---

## The four actors

### Newton — *Raja Yoga* (the wild mind)
`Newton/` in this repo. Caleb's unrestrained experimental surface. Ideas are born here with full creative freedom: novel agents, odd tools, untested abstractions. Newton is pre-production by design. Nothing in Newton is a contract.

### Togari — *Jnana Yoga* (studied, stable knowledge)
Separate repos under `amber-organization/togari-*`. Stewarded by the Blue Modern Advisory team on a B2B cadence for their paying clients. Each togari-* repo is a disciplined, versioned, stable source of truth for one primitive:

| Repo | Primitive | Status |
|---|---|---|
| `togari-peoplerank` | **list building** (search / discovery) | exists, public |
| `togari-enrich` | **data enrichment** (context on a known entity) | not yet created |
| `togari-opportunity` | **sequencing** (right info, right moment) | not yet created |

Togari evolves at its own pace for its own audience. Amber does not block on togari; Amber imports from it.

### Tiwari — *Karma + Bhakti Yoga* (devotional creative expression)
`Tiwari/` in this repo. Sagar's Amber-specific integration layer. Each tiwari service mirrors a togari primitive and does three things the upstream togari cannot:

1. **House a stable clone of the togari equivalent** (git submodule pinned to a known-good SHA — `vendor/togari/`).
2. **Add "bells and whistles" from Newton** — experimental ideas Sagar chooses to promote from Caleb's lab, adapted for the Amber product.
3. **Inject amber-id context** — personal, cNFT-authenticated knowledge that togari alone cannot see because it doesn't have access to the user's decentralized KB.

| Folder | Primitive | Mirrors |
|---|---|---|
| `Tiwari/tiwari-peoplerank/` | list building | `togari-peoplerank` |
| `Tiwari/tiwari-enrich/` | data enrichment | `togari-enrich` (future) |
| `Tiwari/tiwari-opportunity/` | sequencing | `togari-opportunity` (future) |
| `Tiwari/shared/amber-id-client/` | HTTP client for amber-id | — |

### amber-id — the soul
Separate repo: `amber-organization/amber-id`. Each user's private, decentralized knowledge base, gated by their Solana cNFT. This is the unique IP that Togari alone cannot replicate because togari is B2B and has no access to individual users' personal data. amber-id is the reason Amber is "Perplexity for People" and not "Perplexity for a Company's Contacts."

---

## The loop

```
    ┌──────────────┐         promote      ┌──────────────┐
    │    NEWTON    │ ───── bells/whistles ─▶│    TIWARI    │
    │  (wild mind) │         when ready    │  (devotion)  │
    └──────────────┘                        └──────────────┘
                                               ▲        ▲
                                               │        │
                     pinned SHA, periodic bump │        │ gate
                                               │        │
                     ┌─────────────────────────┘        │
                     │                                  │
              ┌──────────────┐              ┌──────────────────┐
              │    TOGARI    │              │     AMBER-ID     │
              │ (knowledge)  │              │ (personal soul)  │
              │ B2B cadence  │              │ user-gated KB    │
              └──────────────┘              └──────────────────┘
```

Newton presses crazy ideas forward. Togari holds the ground truth on B2B cadence. Amber-id holds the soul-data per user. Tiwari braids all three into Amber's product surface.

---

## Service contract (every tiwari-* exports this shape)

```js
// Tiwari/tiwari-peoplerank/index.js
export async function listBuild({ query, filters, userCnft, options }) { ... }

// Tiwari/tiwari-enrich/index.js
export async function enrich({ entity, userCnft, options }) { ... }

// Tiwari/tiwari-opportunity/index.js
export async function sequence({ trigger, userCnft, options }) { ... }
```

**`userCnft` is the amber-id gate.** Present → the service blends personal KB context. Absent → the service falls back to pure togari output. This lets Tiwari services work both inside Amber (personalized) and outside Amber (for internal ops that don't have a user scope).

Each service returns a consistent envelope:

```ts
{
  ok: boolean,
  source: "togari" | "tiwari" | "newton" | "amber-id" | "blended",
  results: T[],
  personalized: boolean,   // true iff amber-id context was blended in
  tookMs: number,
  warnings?: string[],
  citations?: Citation[],
}
```

---

## Who calls what

```
iOS / iPadOS / macOS / visionOS
        │
        │  (zero secrets on the client)
        ▼
   amber-agent           ──────►   Tiwari services
   (Railway, paid)                  (in-process, HTTP-less)
        │                                │
        │                                ├──►  Togari (submodule, pinned)
        │                                ├──►  Newton (lib imports)
        │                                └──►  amber-id (HTTP, JWT+cNFT)
        │
        └──►  amber-id directly for onboarding/mint and /ask proxied via agent
```

Rules:

1. **iOS never calls Tiwari or Togari directly.** Everything goes through amber-agent. Preserves "zero API keys in Swift."
2. **iOS calls amber-id directly only for onboarding + Privy token exchange.** The cNFT mint flow needs the user's Solana wallet signature, which is easier direct. Runtime `/knowledge/query` and `/ask` go through amber-agent so agent can blend Tiwari context.
3. **amber-agent owns billing gates.** The iMessage agent is a paid capability; amber-agent checks entitlements before routing messages. Lives in this repo, works for any paid interface (iOS, iPadOS, macOS, visionOS).
4. **iMessage/Loop is the only channel that can ACTIVATE Togari enterprise.** iOS clients may consume PeopleRank / Opportunity / Enrich on user-dataset relationships, but cannot flip a tenant into enterprise. See [`docs/TOGARI-ACCESS-POLICY.md`](../docs/TOGARI-ACCESS-POLICY.md) and the helper at `Newton/agent/lib/togari-access-policy.js`.
4. **Tiwari services are in-process modules inside amber-agent** — they don't need their own HTTP server. They're ES modules that amber-agent imports and exposes via its own HTTP routes.

---

## Newton → Tiwari promotion

When Sagar wants a Newton idea in Tiwari:

1. The Newton file stays where it is (no deletion, no move).
2. Tiwari imports it explicitly: `import { foo } from "../../Newton/agent/lib/..."`.
3. Tiwari wraps it with the service contract shape + amber-id blending + production hardening (retries, timeouts, auth).
4. A note goes in `Tiwari/tiwari-<primitive>/README.md` under "Newton ideas in production" with the file path and date promoted.

No ceremony beyond that. The Tiwari wrapper is the production contract; the Newton file is the creative source.

---

## Togari sync discipline

Each `Tiwari/tiwari-*/vendor/togari/` is a git submodule pinned to a specific SHA of the matching togari-* repo. Sagar bumps the pin when:

- A togari release is tagged by the BMA team.
- The Tiwari wrapper's tests pass against the new pin.
- Amber's production is ready to consume the new behavior.

`make sync-togari` (top-level convenience target) runs the bumps and tests in order. Never auto-bump; every pin is an intentional act.

---

## Billing gates (production reality)

Three capability tiers, enforced in amber-agent:

| Tier | Includes | Gate lives |
|---|---|---|
| **Free** | amber-id mint, read own profile, 25 `/ask` queries/month | `Newton/agent/lib/permissions.js` |
| **Amber Plus** | Unlimited `/ask`, all Tiwari primitives, full `/knowledge/ingest` | amber-agent `/billing/entitlements` |
| **Amber iMessage** | iMessage/SMS agent (Loop Message + Twilio) — the 24/7 concierge | agent.js router checks entitlement before responding to inbound |

The iMessage agent is specifically paywalled because it has real cost (Loop, Twilio, model calls on every inbound). It's available on every interface (iOS, iPadOS, macOS, visionOS) once a user pays — the entitlement lives on the user, not the device.

---

## Why this works

- **Newton stays free to be crazy** because nothing depends on it directly; Tiwari reaches in and lifts what's ready.
- **Togari stays free to serve B2B** on its own cadence because Tiwari owns the sync pin; Amber never blocks Blue Modern Advisory.
- **Tiwari is where I (Sagar) put my hands** — it's the only place I intentionally codify "how should Amber feel?" by braiding the three sources.
- **amber-id keeps users sovereign** — their knowledge is theirs, mintable and deletable, never co-mingled with any company's B2B data.
