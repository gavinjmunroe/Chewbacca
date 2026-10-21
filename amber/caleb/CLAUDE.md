# CLAUDE.md — medha-platform

The conversational + autonomous agent backing Medha (the multi-sender personal
assistant that texts Caleb as "Camber" and Sagar as "Samber"). The GitHub repo
is `amber-organization/medha-platform`; the Railway service that runs this code
is named `medha-platform` and its public hostname is
`medha-platform-production.up.railway.app`. Loop webhooks and the iOS client are
bound to this hostname, so renames need a coordinated redeploy + webhook cutover.

This repo hosts the Node.js agent, its tool surface, the transport layer, and
the scheduled jobs. Secret material and identity live in the sibling
`medha-id` service (still internally branded `amber-id` in its codebase);
long-term knowledge lives per-tenant in GitHub-backed context wikis.

The current core architecture — the app people can actually use — is
three pieces:

- **`medha-id`** — the one shared backend: Privy auth, per-user profiles,
  per-user knowledge graphs, per-user Pinecone namespaces, per-user secret
  bags. Every Medha tenant is a record inside this one service.
- **`medha-platform`** (this repo) — the iMessage / SMS agent interface
  in front of medha-id.
- **`amber-ios-dev`** — the SwiftUI client interface in front of medha-id.

Camber (Caleb) and Samber (Sagar) are iMessage agents / profiles
authenticated as their respective users through the one shared amber-id,
not separate amber-id deployments.

Togari services (`togari-search`, `togari-stitch`, `togari-schedule`) are
**future / shared B2B capabilities** that may be called from this surface
later for heavy lifting outside the conversational loop. They are **not**
on the current core app path and should not be reimplemented or rewired
as part of work in this repo. See
[`docs/AMBER-TOGARI-BOUNDARY.md`](docs/AMBER-TOGARI-BOUNDARY.md) for the
clean break between Amber's consumer scope and Togari, and
[`docs/ARCHITECTURE-NAMING.md`](docs/ARCHITECTURE-NAMING.md) for the
repo-vs-service precedence, tenant routing, and Togari posture.

Always read this file first, then `AGENTS.md`, then `DESIGN.md` for any UI
surface, then the relevant module README before making changes.

---

## Stack

- Runtime: Node.js 20+, Express, ESM modules
- Inference: Anthropic Claude Sonnet 4.6 (primary), OpenAI/Groq fallbacks
- Transport: Loop Message (iMessage), Twilio (SMS fallback)
- Identity/secrets: `amber-id` service (Privy + Firestore AES-256-GCM bag)
- Long-term memory: Pinecone (via amber-id `/knowledge/query-as`)
- Per-tenant context wiki: GitHub repo + `lib/context-repo.js` (Karpathy LLM-wiki pattern)
- Hosting: Railway (amber + amber-id services)

---

## Six-dimension ontology

Every durable signal Amber captures is tagged with one of six health dimensions.
Three masculine (structural / outward): **financial, intellectual, social**.
Three feminine (vital / inward): **spiritual, emotional, physical**. This
ontology is load-bearing — tools, ingest pipelines, calendar sub-calendars,
and wiki dimension pages all key off these exact six strings.

Never add a seventh dimension without updating:

- `lib/amber-id-ingest.js` (healthDimension field)
- `lib/context-repo.js` scaffolding
- The per-tenant GCal calendar provisioner
- Every context-repo `wiki/dimensions/*.md`

---

## Per-tenant isolation

Every send, read, write, and tool call must be scoped to a resolved `tenant`
object (Privy DID + phone + loopSenderId + contextRepo). If you get into a
code path without a tenant, fail closed — do not fall back to env vars for
per-user state. The only exceptions are org-level infrastructure
(Perplexity inference, Loop org-level auth, Railway deploy keys).

Secret lookup: `getSecret(tenant, "KEY_NAME", { fallbackEnv: "KEY_NAME" })`.
Fallback env is only for migration windows — remove the fallback once all
tenants have the secret populated.

---

## Repository layout

```
Newton/agent/
├── agent.js              # main message-handling loop (tool calling)
├── server.js             # HTTP server + Loop/Twilio webhooks
├── lib/
│   ├── transport.js      # Loop/Twilio send, tapback, typing, status
│   ├── secrets.js        # per-tenant secret client (amber-id /v1/secrets)
│   ├── context-repo.js   # per-tenant GitHub wiki (Karpathy pattern)
│   ├── amber-id-ingest.js# writes to Pinecone via amber-id
│   ├── context.js        # reads from Pinecone via amber-id
│   ├── tenant.js         # tenant resolution (sender_id → tenant object)
│   ├── tools/            # Claude tool implementations
│   └── tiwari/           # togari-context wrappers (Perplexity, search, viz)
```

---

## Required reading order

For every task in medha-platform:

1. `CLAUDE.md` (this file)
2. `AGENTS.md` — product scope, code hygiene, engineering guardrails
3. `DESIGN.md` — only when touching any UI surface
4. The relevant `lib/**/README.md` if one exists
5. The corresponding test file before modifying production code

If your change affects tenant isolation, secrets, or the six-dimension
ontology, also read `lib/secrets.js`, `lib/tenant.js`, and
`lib/amber-id-ingest.js` in full before editing.

---

## Skill routing (when an operator / Claude Code runs tasks here)

- "Is this worth building?" / brainstorming → office-hours skill
- Bug, 500, "why broken" → investigate skill
- Ship / push / deploy / PR → ship skill
- QA, test the site → qa skill
- Code review, check diff → review skill
- Update docs after shipping → document-release skill
- Design system, brand → design-consultation skill
- Visual audit / polish → design-review skill
- Architecture review → plan-eng-review skill
- Checkpoint / resume → checkpoint skill
- Code quality / health → health skill

---

## Integration contract with medha-id

medha-platform **reads** from medha-id:

- `GET /tenants/resolve?sender_id=<loop_sender_uuid>` → tenant object
- `GET /v1/secrets/:did` → full decrypted bag
- `GET /v1/secrets/:did/:key` → single secret
- `POST /knowledge/query-as` → Pinecone recall (per-tenant namespace)

medha-platform **writes** to medha-id:

- `POST /ingest/:pipe` (pipe ∈ {agent, health, checkin, relationship}) with
  `x-amber-phone` header and `{ items: [{ text, healthDimension, ... }] }`

Everything else (context-repo, calendar, tools) is called directly from
medha-platform using per-tenant secrets fetched via `getSecret()`.

---

## Deployment

- Railway project `amber` (`758c0c59-8ac7-4cbd-9b29-f67075de8e72`)
- Production env `cb5c9100-076e-4879-a160-368fd7862417`
- Service `medha-platform` (formerly `amber-agent` — same service ID
  `02c57c5e-4bde-4dda-9977-ecd18d222e54`, just renamed in the Railway dashboard).
- `git push origin main` triggers Railway build; health check at
  `https://medha-platform-production.up.railway.app/health`.
- Push with the git identity configured globally
  (user.name=calebnewtonusc, user.email=228436507+calebnewtonusc@users.noreply.github.com).

---

## Read `AGENTS.md` next.
