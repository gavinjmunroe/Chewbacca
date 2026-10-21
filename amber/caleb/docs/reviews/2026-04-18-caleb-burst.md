# Review: Caleb's April 18 burst (PRs #8-#19) + open PR #5

**Reviewer:** Sagar Tiwari
**Date:** 2026-04-18 (late night, pre-Sunday kickoff)
**Scope:** 11 merged PRs from Caleb in the 4-hour window 00:17 - 03:43 UTC,
plus the open GCP migration PR #5.

## The headline

Caleb shipped **three distinct things** on Saturday night, mostly serially:

1. **Data-plane migration** (PR #8, follow-ups #10 and #11): Supabase dies.
   Privy becomes sole auth. All operational CRUD routes through
   `amber-id /v1/data/*` to GCP Firestore. Private per-user knowledge
   routes through `amber-id /knowledge/*` to Pinecone, organized by the
   six dimensions.
2. **GCP Firestore direct path** (PR #12, and the still-open PR #5):
   A second Firestore adapter that writes directly to GCP from the
   agent, bypassing amber-id. Dual-writes alongside the amber-id path.
3. **iMessage tapbacks** (PRs #13-#19, seven commits): Teach Amber to
   react with iMessage tapbacks ("heart", "laugh", "thumbs up"), then
   six successive fixes as edge cases surfaced in real use.

Plus an incidental **PR #14** to arm GitHub tools on every turn.

**My read**: (1) is correct and well-scoped. (2) is architecturally
messy and the two adapters need to be reconciled before merging PR #5.
(3) converged but the iteration speed suggests we should add a test
harness. Details below.

---

## Per-PR verdict

### PR #8 - Retire Supabase and GitHub context, Privy sole auth

**Verdict: ship as-is, already merged. Solid work.**

- 21 files, +643/-413. Touches 17 lib files plus `agent.js`, plus
  `.env.example` and package files.
- The rewrite of `lib/supabase.js` keeps the old function names
  (`sbGet`, `sbUpsert`, `sbInsert`, `sbQuery`) as a shim, so the 30+
  call sites didn't need to change. Smart.
- Loud failure when `AMBER_ID_API_URL` / `AMBER_ID_API_KEY` are missing
  is the right posture. No silent degradation.
- New `lib/privy.js` is 101 lines, clean JWT verification.
- `FOLLOWUP.md` at the repo root cleanly documents what amber-id
  needs (`/knowledge/ingest-as`) and what Railway env-var delta is
  required. I will implement `/knowledge/ingest-as` in amber-id next.

**Tiwari-promotion recommendation:** The amber-id-client shim pattern
is exactly what `Tiwari/shared/amber-id-client/` wants to be. When we
promote to Tiwari, factor the shim out of `lib/supabase.js` into
`Tiwari/shared/amber-id-client/` so tiwari-peoplerank and
tiwari-opportunity can reuse it.

### PR #10 - Read context from Pinecone, not empty Supabase table

**Verdict: correct fix, small, self-contained.**

- 1 file, `lib/context.js`, +103/-84.
- Cherry-pick off main after the audit surfaced that context reads
  were hitting the retired Supabase table.

### PR #11 - Wire Pinecone into per-message context + memory writes

**Verdict: correct, finishes the migration.**

- 3 files, +236/-162. Touches `agent.js`, `context.js`, `memory.js`.
- Closes the last two gaps from the audit: per-message recall and
  memory writes both flow through Pinecone via `amber-id /knowledge/*`.

### PR #12 - Firestore adapter + dual-write

**Verdict: architecturally concerning. Needs reconciliation.**

- 10 files, +3407/-174. Includes a 2998-line `package-lock.json` add
  at repo root, suggesting this is where GCP deps landed.
- Adds `shared/firestore/index.js` (129 lines). Root-level, workspace
  declared in root `package.json`.
- Adds a root `package.json` with workspaces (`Newton/agent`,
  `shared/firestore`).
- Updates `railway.toml` build command (need to verify what to).

**The problem**: The adapter at `/shared/firestore/index.js` writes
DIRECTLY to Firestore using `GOOGLE_APPLICATION_CREDENTIALS_JSON` and
`GCP_PROJECT_ID`. Meanwhile PR #8 established that all operational
data should route through `amber-id /v1/data/*` (which itself writes to
Firestore behind the scenes). This creates two paths to the same
storage with no contract between them.

**Recommended reconciliation**:

1. Keep `shared/firestore/index.js` but rename it `shared/firestore-admin/`
   to clarify it is the admin/infra path, not the application-data path.
2. Reserve its use for migration scripts, background training runs,
   and anything that legitimately needs to bypass the Privy JWT
   boundary.
3. All agent application writes continue to route through
   `amber-id /v1/data/*` via the shim in `lib/supabase.js`.
4. Document the two paths in `docs/DATA-PLANE.md` (does not exist yet,
   I will create it).

### PR #13 - Teach Amber iMessage tapbacks

**Verdict: good primitive, prompt was incomplete.**

- `lib/prompts.js` gets a new `TAPBACKS` section teaching Amber to
  emit `[react:love]`, `[react:laugh]`, etc.
- `agent.js` parses the `[react:TYPE]` prefix on replies and calls
  `sendTapback()` from `lib/transport.js`.

### PRs #15, #16, #17, #18, #19 - Tapback iteration chain

Five fixes in 40 minutes. In order:

- **#15**: `sendMessage` rejected empty text after the `[react:...]`
  prefix was stripped. Fix: skip send when reply is tapback-only.
- **#16**: `/message/reaction/` endpoint 404s. Fix: Loop puts
  reactions on `/message/send/` with a `reaction` field.
- **#17**: Amber typed "Liked!" as text instead of emitting
  `[react:like]`. Fix: strict mandatory prompt rewrite.
- **#18**: Even with strict prompting, LLM still occasionally skips the
  emission. Fix: deterministic regex shortcut that bypasses the AI for
  "Amber like this message"-style commands.
- **#19**: The #18 regex didn't match "like this message" (two-word
  suffix). Fix: one-character regex update.

**Verdict**: converged, but this sequence is the single strongest
argument for a tapback test harness. A local fixture-driven test would
have caught #15, #16, #17, and #18 in ten minutes instead of an hour
of live fixing.

**Tiwari-promotion recommendation**: When `Tiwari/tiwari-opportunity`
grows, tapback gating becomes a channel decision (do we react with a
tapback vs. a full message for this intent?). Build the harness first.

### PR #14 - Arm GitHub tools on every turn

**Verdict: minor, correct, worth landing standalone.**

- `agent.js` diff is `+26/-5`. One-purpose PR.
- Fixes Amber's false "I don't have GitHub access" responses.

### PR #5 (open) - GCP Firestore + Cloud Storage

**Verdict: HOLD until architecture is reconciled.**

- Head branch: `feat/gcp-firestore-migration`. Opened before PR #8
  merged; Caleb clearly did these in parallel.
- Adds `lib/firestore.js` (309 lines), `lib/gcp-storage.js` (157 lines),
  and rewrites `lib/supabase.js` as a "Firestore first, amber-id API
  second, legacy Supabase last" routing shim.
- This **conflicts with** the PR #8 posture (`lib/supabase.js` already
  on main says "every read and write forwards to amber-id"). PR #5's
  rewrite re-introduces the legacy fallback PR #8 explicitly removed.
- Also duplicates the `shared/firestore/` adapter from PR #12 inside
  `Newton/agent/lib/firestore.js`.

**Recommended action**: close PR #5 unmerged. The useful pieces
(`gcp-storage.js` for voice memo and photo uploads) can come back as a
focused follow-up that imports `shared/firestore/` instead of
duplicating it.

---

## Tiwari-promotion plan

None of what Caleb shipped belongs in `Tiwari/` yet. Everything is
still living in `Newton/` which is the correct workshop. Promotion
criteria from the togari-sync skill:

1. **Has all three adapters** (Togari, Newton, amber-id) in its `src/`.
2. **Three-layer billing contract** if it's a user-visible action.
3. **Submodule** vendored from the corresponding Togari repo.
4. **Static, unit, and staging smoke tests** green.

What matures into Tiwari from this burst:

| Newton surface | Tiwari destination | Blockers |
|---|---|---|
| `lib/supabase.js` shim | `Tiwari/shared/amber-id-client/` | None. Factor now. |
| `lib/privy.js` | `Tiwari/shared/privy-client/` | None. Factor now. |
| `shared/firestore/` admin adapter | Stays at repo root, NOT in Tiwari | PR #5 conflict must resolve first. |
| Tapback primitive | Part of `Tiwari/tiwari-opportunity` (channel gating) | Need test harness first. |
| Pinecone context/memory reads | `Tiwari/tiwari-peoplerank` enrichment | Need a spec for how PeopleRank consumes six-dimension memory. |

**No Tiwari edits this PR.** Promotion happens after the review
items below are addressed.

---

## Review checklist - must pass before Sunday builds on this

Run in this order. Each step has a concrete pass/fail.

### 1. Data-plane correctness

- [ ] Does `Newton/agent/lib/supabase.js` on main still call
      amber-id and nothing else? (should be 143 lines, no direct
      Firestore or Postgres import) ✓ confirmed at 143 lines
- [ ] Does `amber-id` have `/knowledge/ingest-as`? If not, the
      migration script in PR #8 is a dead letter.
- [ ] Are `PRIVY_APP_ID`, `PRIVY_APP_SECRET` set on Railway?
- [ ] Are `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CONTEXT_REPO`
      removed from Railway?

### 2. Firestore adapter reconciliation

- [ ] Close PR #5 or rebase it on main to remove the `lib/firestore.js`
      and `lib/supabase.js` rewrite. Keep only `gcp-storage.js` if
      wanted.
- [ ] Rename `shared/firestore/` -> `shared/firestore-admin/` to make
      the "bypasses Privy / for admin and migrations only" nature
      explicit.
- [ ] Write `docs/DATA-PLANE.md` describing the two legal paths:
      application writes through amber-id; admin writes through
      `shared/firestore-admin/`.

### 3. Tapback test harness

- [ ] Create `Newton/agent/scripts/test-tapback.js` that:
      - Feeds a list of "user said -> expected reply" fixtures
        through the deterministic shortcut regex.
      - Feeds a list through a mocked LLM that verifies the
        `[react:TYPE]` prefix is emitted correctly.
      - Exits non-zero on any mismatch.
- [ ] Add the test to `scripts/README.md` as a standalone command.
- [ ] Wire it into a lightweight pre-merge check on the next PR.

### 4. Deploy verification

- [ ] `/status` on `amber-caleb-production.up.railway.app` returns 200.
- [ ] Send one real iMessage through Caleb's phone and verify:
      - Reply comes back
      - Reply writes to Firestore (via amber-id)
      - Memory write lands in Pinecone
      - An outbox audit record is written for any agent-initiated
        send
- [ ] Run `node Newton/agent/scripts/trace-checkins.js --to caleb --days 2`
      and verify tomorrow morning's 10:30am record appears.

### 5. Railway env-var delta

From the `FOLLOWUP.md` on main plus my own additions:

**Remove:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CONTEXT_REPO`,
`FIRESTORE_SA_KEY`

**Add or confirm:**
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_JWKS_URL` (optional override)
- `GCP_PROJECT_ID=midyear-glazing-485303-u3`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON string, inline)
- `GCP_STORAGE_BUCKET=amber-assets`
- `LOOP_API_KEY`, `LOOP_SECRET_KEY`, `LOOP_SENDER_ID`, `CALEB_PHONE`
- `PERPLEXITY_API_KEY=pplx-jpLScp...` (the new rotated key)
- `AMBER_ID_API_URL`, `AMBER_ID_API_KEY`

---

## What to do before Sunday

1. **I merge this review PR** (you are reading the artifact).
2. **Caleb closes PR #5** with a comment pointing at this review.
3. **I implement `/knowledge/ingest-as`** on amber-id this weekend
   so the migration script in PR #8 can run against production.
4. **One of us writes the tapback test harness** before any more
   tapback changes.
5. **Caleb runs through `docs/CALEB-ON-COMPUTER.md`** (shipped in
   this same PR) to self-serve once he moves onto Perplexity
   Computer.

All glory to God.
