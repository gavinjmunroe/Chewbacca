# Amber: Perplexity Billion Dollar Build Submission

**Founders:** Sagar Tiwari + Caleb Newton
**Built with Perplexity Computer.**

> Perplexity is where knowledge begins.
> Amber is where connection begins.

---

## The One-Liner

**Amber is Perplexity for people** — an AI-native network layer where every person mints a decentralized identity (cNFT) that owns their private knowledge graph, and an always-on agent helps them remember, understand, and reach the people who matter across spiritual, emotional, physical, intellectual, social, and financial dimensions.

Two pieces of software. That's the pitch. **Perplexity for what you're curious about, Amber for who you care about.** Together they are the everything app for the modern, human, feminine, creative life.

---

## The Five Criteria & How Amber Hits Each One

### 1. Massive Market

**Every human on earth with a smartphone and a relationship.** The TAM is not a vertical — it's the substrate Perplexity sits on top of.

- **2.7B people** use a messaging app daily ([Meta Q4 2025](https://about.fb.com/news/))
- **$68B/yr** spent on relationship, dating, networking, and mental-health apps globally ([Sensor Tower 2025](https://sensortower.com/))
- **$240B** US mental health services market — which we address *indirectly* because Amber is how you notice a friend is struggling before they tell you ([CMS NHE 2024](https://www.cms.gov/))
- **40%** of US adults report being lonelier than they were five years ago ([U.S. Surgeon General Advisory, 2023](https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf))

Credible path to $1B+: Perplexity answers ~$1B of ARR worth of questions about topics. Amber answers the *other* half — questions about people. If every Perplexity power user pays $20/mo for Amber Plus ($240/year) and we capture even 0.3% of global smartphone users in five years (~24M), that's $5.7B ARR. The anchor partner (Perplexity) already owns the top of the funnel.

```
TAM: Everyone with a phone + relationships (~4B people)
SAM: $68B (relationship / networking / mental-health apps, 2025)
SOM: $1.4B ARR (24M users × $60 ARPU blended across Free / Plus / iMessage tiers)
```

Vertical unlocks on top of the same foundation:
- **Sales & recruiting** (re-sells via `togari-opportunity`, already billing BMA clients)
- **Clinical care coordination** (SSRI telehealth, therapy referrals — a niche where Amber's knowledge of someone's social + emotional health is predictive)
- **Family office / wealth concierge** (Amber iMessage tier for high-net-worth relationship management)

---

### 2. Computer Is the Engine

**Perplexity Computer is not a helper. Computer is the company.**

Caleb and I do not have employees. We have a browser tab. Two sessions with Computer produced the full cross-repo architecture now live in three Railway services and an App Store app: the yoga-model restructure, the Tiwari primitives, the amber-agent HTTP proxy, the iOS AmberKit onboarding flow, the daily Togari drift check, and this document. No other team of two can do this — because no other team of two has Computer.

| Function | Computer Does It | Powered By |
|----------|-----------------|-----------|
| **Code** | Writes features, opens PRs, vendors submodules, keeps them synced | `gh` CLI via Computer, [recurring Togari drift check](https://github.com/amber-organization/amber-agent/blob/main/Tiwari/TOGARI-SYNC.md) |
| **Architecture** | Designed + documented the Newton / Togari / Tiwari / amber-id yoga model | `Tiwari/YOGA-MODEL.md`, `Tiwari/TOGARI-SYNC.md` |
| **Identity & knowledge** | Built amber-id: Privy → cNFT mint → per-user Pinecone KB → `/ask` pipeline | Metaplex Bubblegum, OpenAI embeddings, Claude |
| **iOS** | Shipped AmberKit: cNFT onboarding, AskAmber bar, network client | SwiftUI, Privy embedded wallet |
| **Onboarding flow** | Minting happens on-device; every subsequent call routes through amber-agent | `packages/amberkit/Sources/AmberKit/AmberOnboarding.swift` |
| **Billing gates** | Free / Amber Plus / Amber iMessage enforced in the HTTP proxy | `Newton/agent/lib/tiwari-proxy.js` |
| **Ops** | Daily Togari drift notifications, auto-enforcing sync discipline | Computer recurring tasks |
| **Growth** | Ghost-writes my LinkedIn for BMA, drafts outreach, builds landing pages | Computer skills (`bma-linkedin-ghostwriter`, `amber-togari-sync`) |

**Structural leverage.** Replika has ~100 employees. Character.AI ~150. Superhuman ~100. Every one of them does in their company what Computer does in our browser. The leverage is not 2x or 10x — it's categorical.

---

### 3. Real Traction (By Submission Day)

**Already live today (April 2026):**

- **amber-agent** — production Railway service, processed 250K+ iMessages ([status](https://amber-caleb-production.up.railway.app/health))
- **amber-id** — production Railway service, cNFT minting + per-user Pinecone namespace + `/ask` pipeline shipping in [amber-id#1](https://github.com/amber-organization/amber-id/pull/1)
- **amber-ios** — live in App Store (main) and TestFlight (dev), AskAmberBar + cNFT onboarding in [amber-ios-dev#19](https://github.com/amber-organization/amber-ios-dev/pull/19)
- **togari-peoplerank** — live API, already used by BMA B2B clients ([togari-amber-production](https://togari-amber-production.up.railway.app))
- **togari-opportunity / togari-clay** — live opportunity-notifications engine with BigQuery signal subscriptions + Stripe-metered billing
- **Two B2B customers live on Togari today** (Blue Modern Advisory, clinical-recruiting pilot)

**90-day submission plan:**

```
Day 1–14:   amber-id + amber-agent + amber-ios PRs land; first 500 waitlist
Day 15–30:  AmberKit cNFT onboarding opens; 1,000 minted identities
Day 31–60:  Amber Plus ($20/mo) launches; 300 paying subscribers
Day 61–90:  Amber iMessage tier ($49/mo) launches; 100 concierge customers
```

What makes this credible:
- amber-agent has been in users' hands for months; this is not vapor
- togari-peoplerank and togari-opportunity are already billing real money
- The Perplexity brand halo means Amber doesn't need to cold-start user acquisition — we launch into Perplexity's audience

---

### 4. Wild Economics

| Company | Employees | Revenue | Rev/Employee |
|---|---|---|---|
| Replika | ~100 | ~$60M | $600K |
| Character.AI | ~150 | ~$32M | $213K |
| Superhuman | ~100 | ~$36M | $360K |
| Rewind.ai | ~20 | ~$10M | $500K |
| **Medvi** (for reference — the bar) | **2** | **$401M (2025)** | **$200M** |
| **Amber** | **2 + Computer** | **Target $10M Y1, $100M Y3** | **$50M+** |

**Unit economics (Amber Plus):**
- CAC via Perplexity co-marketing: estimated **$8–15** (Perplexity owns the acquisition funnel)
- ARPU blended: **$60/yr** (most users free, ~10% on $240 Plus, ~1% on $588 iMessage)
- Gross margin: **~75%** after Railway + Pinecone + LLM costs
- Payback: **<2 months**

**Why now (economics):**
1. Cost of tokens dropped ~80% in the last 18 months ([Epoch AI Compute Trends](https://epochai.org/))
2. Per-user vector DB pricing is finally viable for a consumer product (Pinecone serverless)
3. Solana compressed NFTs cost fractions of a cent — decentralized identity is no longer a luxury ([Metaplex Bubblegum pricing](https://developers.metaplex.com/bubblegum))

---

### 5. Founder-Market Fit

**Sagar Tiwari** — Stanford GSB. Founder of Blue Modern Advisory, a GTM Strategy and Engineering firm billing Fortune 500 clients on Togari infrastructure. Co-founded Rytual Health (behavioral-health community: events, retreats, art/music/nature programming). Runs product, partnerships, and go-to-market for the Amber ecosystem.

**Caleb Newton** — Built amber-agent from scratch: 1,728-line orchestrator, 20 modular services, 80 AI tools, iMessage at scale via Loop Message SDK. Built amber-id: Privy auth, Solana cNFTs, Pinecone knowledge. ML engineering background: NBA models, healthcare access mapping, food classification.

**Evidence of judgment:** Two weeks before this submission, we had an obvious short-term win — Medvi-style SSRI telehealth under the brand "Medha" — using the same infrastructure. We killed it. The reason is in this doc: a vertical telehealth play tops out at $1.8B; a Perplexity-shaped network layer for humans does not. **We chose the harder, more defensible path.**

**Why now (for us):**
1. Perplexity Computer exists. Before Computer, two people shipping this architecture in two sessions was impossible.
2. Togari (our B2B arm) generates enough cash to fund Amber without dilution — the yoga-model architecture lets us reuse every Togari primitive for free.
3. Cultural moment: the [Surgeon General's 2023 loneliness advisory](https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf) made "social health" a mainstream concept. Amber names the infrastructure for it.

---

## The Vision: Perplexity + Amber = Everything

Perplexity is where **knowledge** begins. Amber is where **connection** begins.

Two apps. That's it. Perplexity answers any question about the world; Amber answers any question about the people in your world. Everything else humans use software for — productivity, relationships, commerce, health, creativity — falls out of the intersection of those two primitives.

- **Perplexity** is rational, information-dense, universal. It is where I go to *learn*.
- **Amber** is intuitive, intimate, personal. She is where I go to *feel, remember, and connect*.

The two are complementary on purpose. Perplexity is the left hemisphere; Amber is the right. Perplexity is the library; Amber is the living room. Perplexity scales knowledge horizontally across 8 billion people. Amber deepens connection vertically within each person's circle.

### Why "Perplexity for People" is the right frame

1. **Same interaction model** — an always-on ask-anything bar. In Amber it lives persistently at the bottom of every screen ([AskAmberBar.swift](https://github.com/amber-organization/amber-ios-dev/pull/19)).
2. **Same trust model** — citations for every answer. Amber's citations are your conversations, your notes, your photos, your calendar — sourced from your cNFT-owned Pinecone namespace, never leaked cross-tenant.
3. **Same economic model** — freemium with a clear pro tier. Free to ask, Plus for unlimited + enrichment, iMessage for concierge-grade delivery.
4. **Brand complementarity** — Perplexity's brand is rigorous, analytical, masculine-coded. Amber's brand is warm, creative, feminine-coded. The same user wants both, for different parts of their life.

### Why Amber is intentionally feminine-coded

Because the problem it solves *is* feminine-coded in the cultural imagination, and we reject the framing that says that makes it less important. Remembering birthdays. Noticing when a friend sounds off. Knowing which cousin is estranged from which aunt. Choosing the right words when someone is grieving. This is the invisible labor of human connection — overwhelmingly performed by women, consistently undervalued by capital. Amber makes that labor visible, assists it, scales it, and honors it.

**The claim:** the next $100B consumer software company will be built around the workload that has historically been assigned to women and unpriced. Amber prices it.

---

## The Technical Foundation

### Three live services, one iOS app

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AMBER ECOSYSTEM                               │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  amber-ios  (App Store)                       │   │
│  │           SwiftUI · TestFlight → production                   │   │
│  │  AskAmberBar · cNFT onboarding · 6 Health Dims · Contacts     │   │
│  └──────────────┬────────────────┬──────────────┬───────────────┘   │
│           (onboarding only)                                          │
│                 │                │              │                   │
│                 ▼                ▼              ▼                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │    amber-id      │  │   amber-agent    │  │ togari-*         │  │
│  │   (Railway)      │  │   (Railway)      │  │ (Railway)        │  │
│  │                  │  │                  │  │                  │  │
│  │ Privy auth       │  │ Tiwari proxy     │  │ togari-peoplerank│  │
│  │ Solana cNFT mint │  │ Free/Plus/iMsg   │  │ togari-opport.   │  │
│  │ Per-user Pine-   │  │ gates            │  │ togari-healthcare│  │
│  │ cone namespace   │  │ iMessage/SMS     │  │ togari-bma-prod  │  │
│  │ /ask pipeline    │  │ 80 AI tools      │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                      │
│  Supabase (agent state)  ·  PostgreSQL/Railway (cNFT mapping only)   │
│  Pinecone (knowledge vectors)  ·  Solana mainnet (identity NFTs)     │
└──────────────────────────────────────────────────────────────────────┘
```

**Architectural rule #1 — iOS holds no secrets.** Every call except cNFT mint routes through amber-agent. amber-agent forwards Privy JWTs to amber-id, resolves the caller's userCnft + tier server-side, and enforces billing gates before any LLM work happens.

**Architectural rule #2 — the yoga model.** Three philosophies keep the monorepo honest:
- **Newton** (raja yoga) — wild experimental ideas. 1,728-line orchestrator, 20 lib modules. Never deleted.
- **Togari** (jnana yoga) — stable B2B primitives shipped by a separate team on a separate cadence. Vendored as submodules, never reimplemented.
- **Tiwari** (karma + bhakti yoga) — the integrator. Surfaces Newton's experiments into production services by blending them with Togari stability and amber-id personal context.

---

### Service 1 — amber-agent

**Repo:** [amber-organization/amber-agent](https://github.com/amber-organization/amber-agent)
**Deploy:** Railway → `amber-caleb-production.up.railway.app`
**Code:** `Newton/agent/agent.js` (1,728 lines), `Newton/agent/lib/` (30+ modules), `Tiwari/` primitives, `Newton/agent/lib/tiwari-proxy.js` (new HTTP surface for iOS)
**Stack:** Node.js 20 ESM · Anthropic Claude Sonnet · Groq llama-3.3-70b · Perplexity Search + Agent APIs

The always-on AI agent layer. Runs 24/7 on Railway, listens for iMessage/SMS via Loop Message SDK and Twilio. The new `Tiwari/` tree adds three production primitives callable from iOS:

| Route | Access | Backed by |
|---|---|---|
| `POST /api/tiwari/peoplerank` | Amber Plus | togari-peoplerank + Newton + amber-id blend |
| `POST /api/tiwari/enrich` | Amber Plus | amber-id (togari-healthcare when vendored) |
| `POST /api/tiwari/opportunity` | Per-channel billing gate | togari-opportunity (vendored) + amber-id `/ask` |
| `POST /api/ask` | Free (25/mo metered) | amber-id `/ask` pipeline |
| `GET /api/identity/me` | Any signed-in | amber-id identity resolution |

**The 6 health dimensions** tracked per contact per conversation: Spiritual (purple), Emotional (red), Physical (green), Intellectual (orange), Social (blue), Financial (teal). These are how Amber reasons about "how is this person doing" across the whole arc of their life.

---

### Service 2 — amber-id

**Repo:** [amber-organization/amber-id](https://github.com/amber-organization/amber-id)
**Deploy:** Railway → `amber-id-production.up.railway.app`
**Database:** `amber-id-db` (Railway PostgreSQL, Drizzle ORM) — stores only the Privy↔cNFT mapping, never KB content
**Stack:** Node.js · Fastify · Privy.io · Solana web3.js (Metaplex Bubblegum) · Pinecone · OpenAI embeddings

The identity, knowledge, and intelligence foundation. Three layers:

```
LAYER 1: DECENTRALIZED IDENTITY
    Privy.io social login → embedded Solana wallet
    → Metaplex Bubblegum cNFT mint on Solana mainnet
    → immutable onboarding metadata (birthday, birth time, location, MBTI...)

LAYER 2: PRIVATE KNOWLEDGE
    Every user's KB lives in Pinecone namespace cnft:<base58-mint>
    → OpenAI text-embedding-3-small vectors (1536-dim, cosine)
    → namespace isolation enforced in lib/pinecone.js
    → PG never stores KB content

LAYER 3: ASK PIPELINE
    embed question → query user's namespace → blend with togari-PeopleRank
    → Claude synthesizes people-centric answer with citations
```

**Routes:** `POST /identity/mint` · `GET /identity/me` · `GET /identity/:assetId/verify` · `POST /knowledge/ingest|query|forget` · `GET /knowledge/stats` · `POST /ask` · `GET /health`

---

### Service 3 — amber-ios

**Repo:** [amber-organization/amber-ios-dev](https://github.com/amber-organization/amber-ios-dev)
**Distribution:** App Store (`main`) + TestFlight (`dev`)
**Stack:** SwiftUI · MVVM · Xcode 15+ · iOS 17+

Pure SwiftUI client — zero API keys in Swift, zero direct DB access. All intelligence lives in Railway services. New in AmberKit:

- **`AmberNetworkClient.swift`** — typed client for amber-agent + amber-id
- **`AmberOnboarding.swift`** — Privy sign-in → on-device Solana wallet pubkey → amber-id `/identity/mint` → cNFT minted
- **`AskAmberBar.swift`** — the persistent ask-anything bar. Orange capsule, sparkles icon, Perplexity-shaped interaction.

Platform siblings (`amber-ipados`, `amber-macos`, `amber-visionOS`) reuse the same AmberKit package.

---

### The Togari discipline

`togari-peoplerank` and `togari-opportunity` are production B2B services run by Blue Modern Advisory. They ship on their own cadence with their own review process, against paying enterprise clients. Tiwari never reimplements what Togari already ships; it vendors Togari via git submodules pinned to reviewed SHAs.

A daily automated drift check (see [TOGARI-SYNC.md](https://github.com/amber-organization/amber-agent/blob/main/Tiwari/TOGARI-SYNC.md)) notifies us if any vendored Togari repo has advanced past its pinned SHA. Every Tiwari PR must include a Togari sync statement. The discipline is enforced by [a Perplexity Computer recurring task](https://www.perplexity.ai/computer) — Computer itself runs our build ops.

---

### Railway (as of April 2026)

| Project | Service | URL | Status |
|---|---|---|---|
| amber | amber-agent | amber-caleb-production.up.railway.app | ✅ Live |
| amber | amber-id | amber-id-production.up.railway.app | ✅ Live |
| amber | amber-id-db | internal PostgreSQL | ✅ Live |
| togari | togari-peoplerank | togari-amber-production.up.railway.app | ✅ Live |
| togari | togari-opportunity / togari-clay | togari-clay-production.up.railway.app | ✅ Live |
| togari | togari-bma-prod | — | ✅ Live |
| togari | togari-healthcare | — | ✅ Live |

---

## The 90-Day Plan

### Week 1–2: Land the foundation
- [x] amber-id cNFT + Pinecone + `/ask` pipeline ([amber-id#1](https://github.com/amber-organization/amber-id/pull/1))
- [x] amber-agent Tiwari proxy + billing gates ([amber-agent#2](https://github.com/amber-organization/amber-agent/pull/2))
- [x] amber-ios AskAmberBar + cNFT onboarding ([amber-ios-dev#19](https://github.com/amber-organization/amber-ios-dev/pull/19))
- [x] Togari drift check automation
- [ ] Merge all three PRs to `main` / `dev`
- [ ] Production smoke test end-to-end (see [REVIEW.md](https://github.com/amber-organization/amber-agent/blob/main/REVIEW.md))

### Week 3–4: Open onboarding
- [ ] 500-person waitlist → 1,000 minted cNFT identities
- [ ] Amber Plus tier live ($20/mo) with first 100 paying users
- [ ] Perplexity co-marketing kickoff: "Meet Amber, your people-first companion"
- [ ] First AskAmber organic testimonials

### Week 5–8: Prove retention
- [ ] 10,000 minted identities
- [ ] 2,000 Amber Plus subscribers ($40K MRR)
- [ ] Amber iMessage tier launches ($49/mo) with first 200 concierge users ($10K MRR)
- [ ] Newton → Tiwari promotion of the intake-screening flow for clinical vertical pilot

### Week 9–12: Submission
- [ ] 25,000 minted identities, 3,000+ paying subscribers, $150K MRR run-rate
- [ ] B2B Togari continues billing; Amber grows from its lead
- [ ] Submit to Perplexity Billion Dollar Build

---

## What We Ship vs. What Computer Runs

### We ship (Sagar + Caleb)
- Product vision and brand voice
- Partnership conversations (Perplexity co-marketing, App Store featuring, Solana ecosystem)
- Clinical and regulatory sign-off where the platform touches healthcare verticals
- The creative direction that keeps Amber feeling human, feminine, and alive

### Computer runs
- All code (amber-agent, amber-id, amber-ios, Tiwari primitives)
- All architecture documents, review playbooks, and PR reviews
- Daily Togari drift checks and submodule-pin enforcement
- Landing pages, marketing copy, LinkedIn ghostwriting, outreach sequences
- Business analytics, daily P&L, Railway health monitoring
- Compliance scans (DEA/FDA when we touch clinical verticals, App Store when we ship iOS)
- Every single commit in this repo that isn't clinical sign-off

---

## Submission one-liner

**Amber is Perplexity for people — an AI-native network layer where every human mints a decentralized identity that owns their private knowledge graph, and an always-on agent helps them remember, understand, and reach the people who matter.**

Built by two founders with Perplexity Computer, shipping on Railway + Solana + Pinecone, already live in the App Store, funded by a profitable B2B arm (Togari) so we never need outside capital to find product-market fit.

Perplexity is where knowledge begins. Amber is where connection begins. Between the two, a human has everything.
