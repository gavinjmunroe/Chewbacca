# Operating Engine Handoff

How amber-agent coordinates iMessage learning, daily health check-ins,
Togari Platform activation, and the Perplexity API as the business
engine — written so anyone (Caleb, Sagar, Karthik, or a future operator)
can pick up the running system without a conversation.

This document is normative. If something here disagrees with code, the
code is the bug. If something here disagrees with `AGENTS.md` or
`docs/PERPLEXITY-AMBER.md`, those documents win and this one should be
updated.

---

## 1. The four parts of the engine

| Part | What it is | Repo |
|---|---|---|
| **Amber** | "Perplexity for People." The product. The health network for the people you love. | (the brand, not a repo) |
| **amber-agent** | Loop/iMessage transport + scheduler + tool orchestration. The execution layer that sends, receives, and decides. | `amber-organization/amber-agent` (this repo) |
| **amber-id** | The private passport. DIDs, Privy auth, secrets bag, Pinecone namespaces, Firestore tenant metadata. The only writer to long-term memory. | `amber-organization/amber-id` |
| **Togari Platform** | The GCP warehouse complement. Enterprise-grade primitives (PeopleRank, Opportunity, Enrich) and the structured data plane that complements Pinecone. | `amber-organization/togari-*`, vendored under `Tiwari/` |

**Perplexity API + Computer** is the *business engine*. Every reasoning
step that needs the world's knowledge — research, retrieval-augmented
answers, citation-grounded synthesis — calls Perplexity. Every step that
needs to act on a desktop or take a long-running computer-using action
goes through Computer. amber-agent is what brokers between iMessage on
one side and Perplexity/Computer on the other; it is the conversational
front door, not the brain.

The two-hemisphere doctrine in `docs/PERPLEXITY-AMBER.md` is the
philosophical layer. This document is the operational layer that sits
under it.

---

## 2. How the parts coordinate

```
                         ┌──────────────────────────┐
                         │   Caleb / Sagar / peer   │
                         │      (iMessage / SMS)    │
                         └─────────────┬────────────┘
                                       │  Loop webhook
                                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                          amber-agent                         │
   │                                                              │
   │   resolveTenantStrict ── proactive scheduler ── tool loop    │
   │            │                    │                  │          │
   │            ▼                    ▼                  ▼          │
   │      tenant DID         send-checkin.js     Anthropic SDK     │
   │                                                              │
   └─────────┬──────────────────────┬─────────────────┬───────────┘
             │                      │                 │
             ▼                      ▼                 ▼
       ┌──────────┐           ┌────────────┐    ┌────────────────┐
       │ amber-id │           │  Perplexity │    │ Togari (GCP +   │
       │ Pinecone │           │  API +      │    │ vendored repos) │
       │ Firestore│           │  Computer   │    │                 │
       │ secrets  │           └────────────┘    └────────────────┘
       └──────────┘
```

- **Inbound**: every Loop/Twilio webhook is resolved to a tenant via
  the verified `sender` UUID through amber-id (`lib/server.js` →
  `lib/tenant.js#resolveTenantStrict`). Body-claimed identity is
  rejected. There is no "dev" tenant.
- **Learning**: each turn — both the inbound user message and the
  outbound assistant reply — is ingested once via
  `ingestConversation(text, reply, …)` (`agent.js:1690`) into
  amber-id. amber-id writes to the tenant's `cnft:<mint>` Pinecone
  namespace through `POST /ingest/imessage` (the contract added in
  amber-id PR #22) with idempotent dedupe keys.
- **Check-ins**: the proactive scheduler (`agent.js:1883`,
  `startCheckinScheduler(() => listActiveTenants(...))`) fires every
  configured cadence and sends through the canonical
  `Newton/agent/scripts/send-checkin.js`. Every send writes an outbox
  record at `vision/outbox/<YYYY-MM-DD>/<message_id>.json` — absence
  from the outbox means the cron lied about success.
- **Reasoning**: tool calls fan out from a single Claude tool loop.
  Knowledge questions hit the Perplexity API. Long-running
  computer-using tasks hit Computer. People/relationship questions
  hit the Togari tools (`Newton/agent/lib/tools/togari.js`) which
  are read-only by default and gated by
  `lib/togari-access-policy.js` for any enterprise mutation.
- **Activation**: only amber-agent (the iMessage surface) can
  *activate* Togari enterprise — submit a lead, create a person.
  iOS may consume read primitives only. This is the contract codified
  by PR #37.

---

## 3. Ownership

The work splits cleanly along three lanes. Treat these as durable —
do not cross-cut without a written handoff.

| Lane | Owner | Surface | Touches |
|---|---|---|---|
| **Togari Platform / GCP warehouse** | **Karthik** | `amber-organization/togari-peoplerank`, `togari-opportunity`, `togari-healthcare`; GCP project, BigQuery / Cloud Storage, Firestore plumbing on the warehouse side. | Vendor SHAs that land here as submodule bumps under `Tiwari/`. Karthik never edits `Newton/` or `Tiwari/tiwari-training/` from the platform side; warehouse changes flow in via `amber-togari-sync`. |
| **iOS lock-in** | **Sagar** | `amber-ios-dev` (SwiftUI client), TestFlight, App Store, on-device experience. Drives what "Amber on the phone" feels like for the user we are locking in. | Consumes amber-agent's `lib/tiwari-proxy.js` read surface; cannot reach activation paths. |
| **The bridge** | **amber-agent** (Caleb + Sagar both contribute, Caleb is primary maintainer) | Loop/iMessage transport, scheduler, Anthropic tool loop, Perplexity/Computer brokerage, the policy gate that decides which tenant's call lights up which Togari surface. | Everything in this repo. The bridge is what makes Karthik's warehouse and Sagar's iOS feel like one product. |

The bridge is the load-bearing piece. If amber-agent breaks, neither
hemisphere reaches the user. Karthik's work and Sagar's work are
parallel; amber-agent is serial in front of both.

---

## 4. Merge & deploy order

There is one ordered chain to ship the operating engine end-to-end.
Out-of-order merges do not break safety (each PR is fail-closed on its
own), but they will leave gaps where amber-agent writes to a surface
amber-id has not yet exposed, or where tenant register preference does
not yet feed the policy gate.

**Order:**

1. **amber-id `#22` — `feat(ingest): structured iMessage/SMS interaction contract`**
   - Lands the `POST /ingest/imessage`, `/knowledge/imessage/recent`,
     `/knowledge/imessage/search` endpoints in amber-id.
   - Must merge **first**. amber-agent's iMessage learning path
     depends on this contract.
   - Deploy amber-id (Railway service `amber-id`) before continuing.
2. **amber-agent `#36` — `feat(prompts): tenant-configurable MOTHER/SISTER/WIFE register baseline`**
   - Adds `lib/register-preference.js` and wires the override into the
     three prompt sites. No production env touched. Optional
     `LOOP_REGISTER_OVERRIDE` env or per-tenant
     `onboardingProfile.preferredRegister`.
   - Merge **second**. Pure prompt-layer change; safe to deploy on
     its own but logically belongs before the policy gate so Camber
     and Samber are speaking in the right register when the gate
     starts rejecting cross-tenant activation.
3. **amber-agent `#37` — `feat(togari): codify amber-agent as the only enterprise activation surface`**
   - Adds `lib/togari-access-policy.js`, gates the mutating tool
     subset, documents the rule in
     `docs/TOGARI-ACCESS-POLICY.md`.
   - Merge **third**. Fail-closed; Loop path defaults to
     `loopVerified=true` so today's behavior is preserved. iOS
     activation paths start returning structured denials.

Railway redeploys are direct merges to `main` on each repo. There is
no CI gate. After the third merge, run the smoke test in §5.

**Do not push to `main` directly.** Each step is a PR. The branch
this document ships on is `docs/operating-engine-handoff` and is
docs-only.

---

## 5. Smoke test — Samber/Camber iMessage → Pinecone learning + check-ins

After the chain in §4 lands, run this end-to-end. It exercises both
tenants, the new ingest contract, the scheduler, and the policy gate.

### 5.1 Prerequisites

- Railway env on `amber-agent` and `amber-id` reflects the merged
  builds.
- `LOOP_API_KEY`, `LOOP_SECRET_KEY`, `AMBER_ID_API_URL`,
  `AMBER_ID_API_KEY`, `PERPLEXITY_API_KEY` populated.
- Local checkout of `amber-agent` on `main` post-merge.

### 5.2 iMessage → Pinecone learning (both tenants)

For each tenant in `[caleb, sagar]`:

1. **Send** a real iMessage to the tenant's Loop sender (Camber for
   Caleb, Samber for Sagar) from a known test phone — content like
   `"smoke test: log this into pinecone for <date>"`.
2. **Inbound resolves**: tail Railway logs for amber-agent and
   confirm `resolveTenantStrict` returned the expected DID
   (`did:privy:caleb…` or `did:privy:sagar…`). No "default" or
   fallback tenant.
3. **Learning ingests**: confirm a single
   `ingestConversation(...)` call per turn. In amber-id logs, look
   for `POST /ingest/imessage` returning `{ upserted: 1, duplicates: 0 }`
   on first send and `{ upserted: 0, duplicates: 1 }` on a second
   identical send (idempotency check).
4. **Pinecone reads back**: from the local checkout, call
   ```
   curl -sS -X POST "$AMBER_ID_API_URL/knowledge/imessage/search" \
     -H "x-api-key: $AMBER_ID_API_KEY" \
     -H "x-amber-phone: $TENANT_PHONE" \
     -H "content-type: application/json" \
     -d '{"query":"smoke test","top_k":3}'
   ```
   Expect at least one hit with `metadata.source = "imessage"` and
   `metadata.kind = "imessage_interaction"`. Confirm the namespace
   reported is `cnft:<mint>` for that tenant — never the other
   tenant's mint.
5. **Cross-tenant isolation**: repeat the search for tenant A using
   tenant B's phone header. Expect `403 principal_mismatch` or an
   empty result set — never a leak.

### 5.3 Health check-in delivery (both tenants)

1. **Force a send** through the canonical path:
   ```
   node Newton/agent/scripts/send-checkin.js \
     --to caleb --dimension emotional --kind morning --dry-run=false
   node Newton/agent/scripts/send-checkin.js \
     --to sagar --dimension emotional --kind morning --dry-run=false
   ```
   (Sagar may still be Phase 0 / inbox-only depending on phone wiring;
   if so, expect an inbox record rather than a Loop send.)
2. **Verify outbox**: each send must produce
   `vision/outbox/<YYYY-MM-DD>/<message_id>.json`. Empty outbox =
   the cron lied; fix the send path, not the symptom.
3. **Tracer check**:
   ```
   node Newton/agent/scripts/trace-checkins.js --to caleb --days 1
   node Newton/agent/scripts/trace-checkins.js --to sagar --days 1
   ```
   Each should show one row per dimension with `status = sent` and a
   non-empty `message_id`.
4. **Voice spot-check**: open the rendered text. It must respect the
   tenant's `preferredRegister` from PR #36 and contain none of the
   forbidden tokens (em dashes, emojis, AI disclosures).

### 5.4 Togari activation gate (PR #37)

1. **Allowed path**: from the Loop tool loop, invoke
   `togari_submit_lead` for the resolved tenant. Expect success.
2. **Denied path**: from the iOS proxy surface
   (`lib/tiwari-proxy.js`), attempt `togari_submit_lead`. Expect a
   structured denial — no enterprise mutation reaches Togari.
3. **Cross-tenant**: assert that an activation initiated under
   Camber does not light up Samber's enterprise namespace. The
   policy is keyed off the resolved tenant; the test in
   `lib/__tests__/togari-access-policy.test.mjs` covers this, but
   re-confirm in production logs.

If any of 5.2–5.4 fails, **roll back the most recent merge** and file
the failure in an issue against the responsible repo. Do not patch
forward in main.

---

## 6. Boundaries (what this handoff does NOT change)

- **`amber-togari-sync` is respected.** This document does not bump
  any submodule pin under `Tiwari/`. Drift checks remain Karthik's
  lane; freshness is enforced by `Tiwari/TOGARI-SYNC.md`.
- **Tiwari source is not touched** unless a code-level change is
  unavoidable, which it is not for this handoff. This PR is
  docs-only.
- **No production env changes.** No new secrets, no rotated keys, no
  Railway service edits. The merge order in §4 is the only deploy
  action, and each merged PR carries its own (already documented)
  env footprint.
- **Composio stays out.** Per `AGENTS.md`, Composio is being
  removed; this handoff does not reintroduce it.
- **Scheduler topology is unchanged.** §5.3 invokes the existing
  canonical path; we do not add a new send route.

---

## 7. Where to look next

- `AGENTS.md` — per-tenant correctness rules, code hygiene limits.
- `docs/PERPLEXITY-AMBER.md` — the two-hemisphere doctrine.
- `docs/CHECKIN-PRODUCT.md` — how the daily check-ins are composed.
- `docs/SCHEDULED-AGENTS.md` — the cadence table for product- and
  build-track agents.
- `docs/TOGARI-ACCESS-POLICY.md` (lands with PR #37) — the long-form
  rule for who may activate Togari enterprise.
- `Tiwari/TOGARI-SYNC.md` — submodule freshness rules.
- `Newton/agent/scripts/send-checkin.js` — canonical send path.
- `Newton/agent/scripts/trace-checkins.js` — delivery audit tracer.

All glory to God.
