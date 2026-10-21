# AGENTS.md — amber-agent

## Project

amber-agent is the conversational + proactive assistant that sends and
receives messages on behalf of humans. Each tenant (currently: Caleb,
Sagar) has a dedicated Loop sender ("Camber" for Caleb, "Samber" for
Sagar) and their own isolated identity, secrets, calendars, and context
wiki. The agent is the execution layer — it calls tools, writes to
per-tenant stores, and produces responses. amber-id is the identity
layer — it owns DIDs, secrets, Pinecone namespaces, and tenant metadata.

---

## Current scope

### In scope (active development)

- Multi-sender Loop transport with tenant resolution from `sender_id`
- Per-tenant secret-backed third-party API calls (GitHub, Composio,
  Todoist, ElevenLabs, Clay — each keyed by Privy DID)
- Per-tenant GitHub context wikis (`lib/context-repo.js`,
  Karpathy LLM-wiki pattern, six-dimension ontology)
- Native Google Calendar client with six dimension sub-calendars
  (financial / intellectual / social / spiritual / emotional / physical)
- Morning emotional + evening social/physical check-in scheduler (per tenant)
- Peer calendar grants (dimension-scoped, freebusy-only, expiring)
- Togari tool surface (search via Exa, enrichment via Crust,
  opportunity via togari-clay)
- Beads CLI integration (per-tenant Dolt-backed task graph, replacing Todoist)
- Native trip planner (`Newton/agent/lib/tools/travel.js`, JSON-backed
  in the per-tenant context repo) replacing the former TREK MCP client.
  The original Trek source is vendored at `Newton/trek/` for archive /
  reference only — it is **not** wired into the agent runtime.
- Native clients for Gmail, Slack, Notion, Linear, LinkedIn, YouTube,
  Vercel, Drive, Docs, Sheets (replacing Composio entirely)

### Out of scope

- Composio (being removed — do not add new Composio-backed tools)
- Supabase (all data goes to amber-id Firestore or per-tenant GitHub)
- Per-tenant env vars on the Railway service (every per-user key must
  live in amber-id's secrets bag, keyed by DID)
- Generic LLM chat without a resolved tenant — there is no "dev" tenant
- Multi-user admin UI — operators use the CLI and Railway dashboard

---

## Stack (authoritative)

- Node.js 20+, ESM, Express
- Anthropic SDK (Claude Sonnet 4.6), with tool calling as the primary loop
- Pinecone (via amber-id) for long-term memory
- Firestore (via amber-id) for tenant metadata + secret bag
- Loop Message for iMessage, Twilio for SMS fallback
- Railway for hosting (two services: amber-agent, amber-id)
- GitHub as the persistence layer for context wikis

Do not introduce Next.js, Vercel, Supabase, or any Python services inside
this repo. amber-id is a separate service with its own stack.

---

## Code hygiene (enforced)

These limits apply to all JS/TS source files (excludes .md, generated
artifacts, config, migrations):

- **File max: 800 lines** — if approaching 600, start looking for splits
- **Function max: 100 lines** — if larger, extract helpers
- **Nesting depth: max 3 levels** — use early returns / guard clauses
- **Function parameters: max 4** — beyond that, use an options object
- **Test files**: up to 1,000 lines
- **One export-default per file for components or singletons** — multiple
  named exports are fine for utility modules

If you're fighting these limits, it's a design signal — rethink the
abstraction, don't just split arbitrarily.

---

## Per-tenant correctness rules

These are the rules that prevent cross-tenant data leaks. Failing any of
these is a showstopper bug.

1. **Never send a message without `opts.tenant.loopSenderId`.** The
   transport layer will throw; do not work around it.
2. **Never read/write a context repo without resolving `tenant.contextRepo`.**
   Fall back to `AMBER_DEFAULT_CONTEXT_REPO` only in local dev.
3. **Never call a third-party API with an env-var API key when that key
   has been migrated to the secrets store.** Use
   `getSecret(tenant, "KEY")` and let it fall back to env only during
   a migration window.
4. **Never write to Pinecone or Firestore without passing the tenant DID
   or phone through amber-id.** amber-id is the only writer; agent is
   a client.
5. **Never log a raw secret or PAT.** If you need to debug, log length
   or a hash prefix.

---

## Engineering guidance

- Prefer staged pipelines over giant single-shot LLM calls. Ingest →
  classify → update-page → log is the canonical shape.
- Keep raw sources immutable. The context wiki has `raw/` (immutable) and
  `wiki/` (LLM-rewritten). Never mutate `raw/` after ingest.
- Use `capabilities.registerCapability(namespace, description)` at tool
  module load time so the agent can introspect what it can do.
- Every tool implementation must accept a `tenant` parameter (either as
  the first arg of a helper or via `ctx.tenant` on the Claude tool
  handler). No implicit "current user" state.
- Favor portable deployment — the repo should be runnable locally with
  only env vars, no Railway-specific magic.
- When adding scheduled jobs, key them by `tenant.privyDid` and store
  their definitions in `lib/proactive.js` (not a separate cron service).

---

## Release readiness

Before pushing to `main`:

1. `node --check` passes on every changed `.js` file
2. All touched files respect the code-hygiene limits
3. No raw secrets in the diff (`git diff | grep -Ei '(sk-|pk_|AIza|ghp_|github_pat)'`)
4. If schema/secrets/ontology changed, update `CLAUDE.md` and this file
5. Tag a Railway deploy by merging to `main` — CI-less direct deploy

---

## Read `DESIGN.md` next if you are about to touch any UI surface.
