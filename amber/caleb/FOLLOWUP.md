# GCP + Pinecone + Privy Migration — Follow-up

This branch (`feat/gcp-pinecone-privy`) finishes amber-agent's side of the
data-plane migration. Supabase is removed. GitHub context repos are
retired. Privy is the single auth authority. Everything tenant-scoped
flows through amber-id — operational CRUD to GCP Firestore, private
per-user knowledge to Pinecone organized by the six dimensions.

What's in this PR is the agent half. The remaining work lives outside
this repo and is tracked below.

---

## Required on amber-id (Sagar)

The agent assumes these endpoints exist. Some are live; any missing
ones block the migration from going fully green.

1. **Operational CRUD** (already live, used by the shim in `lib/supabase.js`):
   - `POST /v1/data/:table/get`
   - `POST /v1/data/:table/upsert`
   - `POST /v1/data/:table/insert`
   - `POST /v1/data/:table/query`
   - Each takes `{ tenant_did, filter, row?, limit?, order? }` and
     routes to GCP Firestore collections keyed on `tenant_did`.
   - Tables used by the agent today: `tenants`, `contacts`,
     `conversations`, `interactions`, `user_sessions`, `health_profiles`,
     `health_checkins`, `memories` (transitional, moving to Pinecone),
     `group_memories`, `context_files` (transitional), `trips`,
     `group_tasks`, `retreat_config`, `retreat_responses`, `number_pool`.

2. **Private knowledge** (already live per amber-id-client):
   - `POST /knowledge/ingest` — Privy JWT scoped, writes to caller's Pinecone namespace
   - `POST /knowledge/query`
   - `POST /knowledge/forget`
   - `GET  /knowledge/stats`
   - `POST /ask`

3. **NEW: admin ingest** (required by the migration script):
   - `POST /knowledge/ingest-as` — `x-api-key` auth, body `{ target_did, items[] }`.
     Needed so one-time migration jobs (this PR's
     `scripts/migrate-github-context-to-amber-id.js`, future device
     rotations, support tools) can write into any user's namespace
     without impersonating them via Privy.
   - Same item shape as `/knowledge/ingest` with a mandatory
     `healthDimension` field so the six-namespace organization stays
     clean.

4. **Pinecone namespace structure** confirm or change:
   - The agent assumes per-user Pinecone namespaces keyed by the user's
     cNFT asset id, with `healthDimension` as an item-level filter.
     If the chosen structure is instead six namespaces per user
     (one per dimension), the `ingest-as` API stays the same but the
     client needs a minor filter tweak. Confirm before Sagar merges.

---

## Required on Railway (Caleb)

Env-var delta for the `amber-agent` service on the `amber` Railway
project. Apply these before merging the PR so the deploy stays green.

### Remove

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `CONTEXT_REPO`

### Add

- `PRIVY_APP_ID` — from Privy dashboard
- `PRIVY_APP_SECRET` — from Privy dashboard
- `PRIVY_JWKS_URL` — optional override; defaults to the standard Privy URL

### Keep (already set)

- `AMBER_ID_API_URL`
- `AMBER_ID_API_KEY`
- `GITHUB_TOKEN` — still needed for the GitHub tool (reads arbitrary
  repos on demand), NOT for context fallback

Run:

```bash
railway service amber-agent
railway variables --set "PRIVY_APP_ID=..." --set "PRIVY_APP_SECRET=..."
railway variables --unset SUPABASE_URL SUPABASE_SERVICE_KEY CONTEXT_REPO
```

---

## Migration run order (Caleb, one-time)

1. Confirm amber-id has `/knowledge/ingest-as` deployed.
2. Obtain your Privy DID from the amber-id `tenants` table or amber-id `/identity/me` response.
3. Run the migration script from a machine with `GITHUB_TOKEN` and
   `AMBER_ID_API_KEY` in the environment:
   ```bash
   GITHUB_TOKEN=$GH_TOKEN \
   AMBER_ID_API_URL=https://amber-id-production.up.railway.app \
   AMBER_ID_API_KEY=$AMBER_ID_KEY \
   TARGET_DID=did:privy:xxxxx \
   DRY_RUN=1 \
   node Newton/agent/scripts/migrate-github-context-to-amber-id.js
   ```
4. Review the dry-run output.
5. Re-run without `DRY_RUN=1`.
6. Verify ingestion: `curl -s $AMBER_ID_API_URL/knowledge/stats` with a
   user Privy JWT should show the new vector count.

---

## GitHub repo retirement

`calebnewtonusc/caleb-context` has already been archived (read-only,
history preserved) as part of this PR. `calebnewtonusc/amber-knowledge-base`
was referenced in old READMEs but was never created, so nothing to archive
there.

If you ever need to unarchive during the migration run (to re-read files),
use `gh api -X PATCH repos/calebnewtonusc/caleb-context -f archived=false`.

---

## Known gaps left open

- **Agent-as-delegate flow** (original question 2). Right now the agent
  authenticates to amber-id with `AMBER_ID_API_KEY` (service auth) and
  passes `tenant_did` explicitly in every body. That works for
  operational CRUD. For `/knowledge/*` reads/writes on a user's behalf
  when no device JWT is present (scheduled check-ins, reflection cycles,
  background memory writes), we need the `ingest-as`/`query-as`/`forget-as`
  admin mirror. Tracking here until Sagar lands them.
- **memory.js** still imports the operational `sbUpsert/sbQuery` for
  writes. Once `ingest-as` ships, swap `saveMemory` to call
  `/knowledge/ingest-as` with the six-dimension tagging, and
  `searchMemories` to call `/knowledge/query-as`. Embeddings can stop
  being computed client-side at that point; amber-id owns them.
- **Dashboard** (`Newton/agent/dashboard/`) still has its own
  `lib/supabase.ts`. That's a separate Next.js app with its own
  deployment on Vercel. Separate PR, not part of this one.
- **Ventures workshop** (`Newton/ventures/**/*`) has multiple Supabase
  references. Those are unrelated side projects and are out of scope.
