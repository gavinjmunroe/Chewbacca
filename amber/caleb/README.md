# amber-imessage

Amber is the health network for the people you love. One agent, one voice,
six dimensions of health (Spiritual, Emotional, Physical, Intellectual,
Social, Financial), always on.

This monorepo is the backend that powers the iMessage / SMS surface. The
GitHub repository is `amber-organization/amber-imessage`; the Railway
service that runs this code is named `amber-agent` and serves the
production hostname Loop and the iOS client are bound to. **Do not rename
the Railway service or its public hostname** — doing so breaks Loop
webhook delivery and iOS attachment URLs. See
[`docs/ARCHITECTURE-NAMING.md`](docs/ARCHITECTURE-NAMING.md) for the
repo-vs-service precedence and tenant routing rules.

It is built by [Caleb Newton](https://github.com/calebnewtonusc) and
[Sagar Tiwari](https://github.com/karthikBMA), deployed to
[amber-caleb-production.up.railway.app](https://amber-caleb-production.up.railway.app)
(legacy hostname, preserved for client compatibility).

Sibling repos: [amber-id](https://github.com/amber-organization/amber-id)
(identity, Pinecone knowledge, Solana cNFTs),
[amber-ios-dev](https://github.com/amber-organization/amber-ios-dev) (the
SwiftUI client), and the Togari primitives under
[amber-organization](https://github.com/amber-organization) that
`Tiwari/` vendors.

## The operating posture: always-on scheduled agents

Amber is not a product you open. It is a set of agents that run on a
schedule, whether you asked them to or not. Two founders. Two tracks.
Both running 24/7.

**Product track** (what touches Caleb and Sagar as users):

- Daily iMessage check-ins across the six dimensions, personalized to
  voice and register. See [`docs/CHECKIN-PRODUCT.md`](docs/CHECKIN-PRODUCT.md).
- Weekly Sunday reflection. Long-horizon, spiritual, voice-memo friendly.
- Vision synthesis every night, organizing the week's inbox into the
  six dimensions. See [`vision/README.md`](vision/README.md).
- All check-ins route through one canonical script:
  [`Newton/agent/scripts/send-checkin.js`](Newton/agent/scripts/send-checkin.js).
  Every send writes an audit record to `vision/outbox/<date>/<msg-id>.json`.
  The tracer
  ([`Newton/agent/scripts/trace-checkins.js`](Newton/agent/scripts/trace-checkins.js))
  reads that outbox to verify delivery. Absence from outbox means a
  scheduled agent claimed success without actually invoking the send
  path. That is always a bug.

**Build track** (what makes the product better without bothering anyone):

- Nightly Sagar-mirror training for each Tiwari primitive
  (peoplerank, opportunity, enrich).
- Nightly Caleb-mirror training for each Tiwari primitive, seeded with
  Caleb as the abstract-visionary base case.
- Weekly world-level training that opens a draft PR with the new state
  JSON and hyperparameter deltas. See
  [`docs/TRAINING-LOOPS.md`](docs/TRAINING-LOOPS.md).
- Daily Togari drift check across the three vendored Togari repos.
  Surfaces one line per drifted repo and escalates; does nothing when
  steady.

Both tracks coexist in this repo. Neither ever edits the other's
territory. Product crons never edit `Tiwari/tiwari-training/`. Training
crons never send user-facing messages.

## Structure

```
amber-agent/
├── Newton/                    # Workshop. Everything new lands here first.
│   ├── agent/                 # The iMessage/SMS agent on Railway
│   │   ├── agent.js           # Orchestrator
│   │   ├── lib/               # 30+ modules (ai, router, health, safety, transport, ...)
│   │   ├── dashboard/         # Next.js 16 web dashboard (Vercel)
│   │   ├── scripts/
│   │   │   ├── send-checkin.js      # Canonical scheduled-send path
│   │   │   └── trace-checkins.js    # Delivery audit tracer
│   │   ├── intake-screening/        # Medical intake (stub)
│   │   ├── provider-matching/       # Clinical matching (stub)
│   │   ├── prior-auth/              # Payer APIs (stub)
│   │   ├── customer-service/        # 24/7 support (stub)
│   │   └── ad-creative/             # Growth (stub)
│   ├── infrastructure/        # Partner adapters: OpenLoop, Truepill, DoseSpot, Candid
│   ├── platform/              # Next.js shells: landing, intake, provider, admin
│   ├── ventures/              # Vendored third-party substrate Amber builds on
│   │   └── bitchat/           # Bluetooth mesh fallback (safety-substrate)
│   └── (no docs/ here - docs live at repo root)
│
├── Tiwari/                    # Production-promoted services with Togari vendored
│   ├── tiwari-peoplerank/     # Relationship graph + ranking
│   │   └── vendor/togari/     # amber-organization/togari-peoplerank (submodule)
│   ├── tiwari-opportunity/    # Channel gating + billing
│   │   └── vendor/togari/     # amber-organization/togari-opportunity (submodule)
│   ├── tiwari-enrich/         # Healthcare enrichment
│   │   └── vendor/togari-healthcare/   # amber-organization/togari-healthcare (submodule)
│   ├── tiwari-training/       # The build-track training crons write here
│   ├── shared/amber-id-client/
│   ├── papers/                # Model write-ups
│   ├── TOGARI-SYNC.md         # Rules for keeping submodules fresh
│   └── YOGA-MODEL.md          # Health-dimensions model
│
├── docs/                      # Doctrine. Treated as source, not commentary.
│   ├── AMBER-VOICE.md         # The three-register voice doctrine
│   ├── CHECKIN-PRODUCT.md     # How scheduled check-ins are composed
│   ├── PERPLEXITY-AMBER.md    # Two-hemisphere architecture
│   ├── PLATFORM-INTENTIONALITY.md
│   ├── TRAINING-LOOPS.md      # World / sagar-mirror / caleb-mirror tracks
│   └── WARRIOR-OPERATING-MODEL.md
│
├── vision/                    # Founding memory, not product docs
│   ├── seeds/                 # First-draft ideas
│   ├── inbox/                 # Unprocessed captures + check-in markdown
│   ├── outbox/                # Loop send audit records (gitignored)
│   └── synthesis/             # Weekly synthesis by dimension
│
├── Perplexity/                # Build docs + second-brain
├── skills/                    # Agent skill definitions
├── railway.toml               # Deploys Newton/agent/agent.js
└── package.json
```

## Newton → Tiwari pipeline

Newton is the workshop. Tiwari is what ships.

Every service starts in `Newton/`. Only once it has been security-reviewed,
tested, and has its three adapters in place (Togari, Newton, amber-id) does
it graduate to `Tiwari/`. The graduation pattern is enforced by the
[`amber-togari-sync`](https://github.com/amber-organization) skill and
documented in [`Tiwari/TOGARI-SYNC.md`](Tiwari/TOGARI-SYNC.md).

## Live deployments

| Service                | Source                                                               | URL                                                                                    |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Agent (iMessage + SMS) | `Newton/agent/agent.js`                                              | [amber-caleb-production.up.railway.app](https://amber-caleb-production.up.railway.app) |
| Dashboard              | `Newton/agent/dashboard/`                                            | Vercel                                                                                 |
| Identity               | [amber-id](https://github.com/amber-organization/amber-id)           | amber-id-production.up.railway.app                                                     |
| iOS client             | [amber-ios-dev](https://github.com/amber-organization/amber-ios-dev) | App Store + TestFlight                                                                 |

## Quick start

```bash
npm run install:agent         # install agent deps
npm start                     # run the agent locally
```

Environment variables the live service needs, at minimum:
`LOOP_API_KEY`, `LOOP_SECRET_KEY`, `LOOP_SENDER_ID`, `CALEB_PHONE`,
`PERPLEXITY_API_KEY`, `COMPOSIO_API_KEY`, `TODOIST_API_KEY`,
`AMBER_ID_API_URL`, `AMBER_ID_API_KEY`.

Optional voice / audio hosting (flaw #42):

- `MEDHA_PUBLIC_AUDIO_BASE_URL`: explicit base URL for the `/audio/<id>.mp3`
  endpoint, e.g. `https://medha.example.com`. Preferred. When set, this is
  used verbatim and no Railway domain is ever assumed.
- `PUBLIC_BASE_URL`: legacy fallback if the above is unset.
- `RAILWAY_PUBLIC_DOMAIN`: auto-injected by Railway. Used as a last resort.

Per-tenant voice override (flaw #44): set `ELEVENLABS_VOICE_ID` in the
tenant's secret bag (via amber-id) to override the org-level voice for
that tenant only. Falls back to the env var of the same name, then to
ElevenLabs' default Rachel voice.

Local fallback secrets file (outside the repo, never committed):
`/home/user/workspace/amber/.secrets/loop.env`.

## Verify a day's check-ins landed

```bash
node Newton/agent/scripts/trace-checkins.js --to caleb --days 7
```

Columns: stamp · to · kind · dimension · status · message_id · text
preview. An empty table after a cron fired means the cron did not use
the canonical path. Fix the cron, not the symptom.

## The rules

1. Never reveal the agent is an AI. Ever.
2. Never edit `Newton/agent/agent.js` from Tiwari code or training
   crons. Mount new behavior through new files.
3. Never send user-facing messages from training crons.
4. Training never reimplements what Togari already ships. Vendor the
   primitive. See [`Tiwari/TOGARI-SYNC.md`](Tiwari/TOGARI-SYNC.md).
5. The voice is not negotiable. Three registers (mother when hurting,
   sister when building, wife by default / spiritual / long-horizon).
   See [`docs/AMBER-VOICE.md`](docs/AMBER-VOICE.md). No em dashes, no
   emojis, no filler endings.
6. Secrets come from Railway env, with the local `.secrets/loop.env`
   as sandbox fallback. Never in code.
7. SSRI intake only. No controlled substances without clinical sign-off.

## Dedup + togari-search agent integration

As of WS-10 of the Medha Dedup parallel build, the agent has two new pieces wired into the request pipeline (mirrored across `Newton/agent/` and `Tiwari/agent/`):

- **`tools/togari-search.js`** — thin HTTP client to the existing togari-search PeopleRank API. NOT a re-port of PeopleRank logic. The tool exposes `togariSearch({ query, ownerDid })` so the agent can answer "who do I know at X" in a thread without leaving Amber's voice. Endpoint + auth header are configured via `TOGARI_SEARCH_URL` and `TOGARI_SEARCH_SERVICE_KEY` env vars.
- **`middleware/auth-bounce.js`** — generic intent-blocker. When the agent is about to use a tool that needs a service the tenant hasn't connected (Google Calendar, LinkedIn, Apple Contacts, etc.), the middleware calls `POST https://medha-id-production.up.railway.app/api/v1/magic-link/issue`, posts the returned URL back into the user's iMessage thread, and short-circuits the tool. After the user clicks through the medha-frontend auth flow and the service is linked, the original message can be re-run successfully.

The matcher API in medha-id is a separate concern from togari-search and is NOT called from this agent yet — the dedup HTTP API exists for Clay column callers, not the iMessage surface.

See `medha-id/docs/MEDHA_DEDUP_PARALLEL_BUILD.md` for the full build plan and WS-10 acceptance criteria.
