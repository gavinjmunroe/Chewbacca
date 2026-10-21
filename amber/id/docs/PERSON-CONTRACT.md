# Person architecture contract

**Status:** draft for freeze Friday 22 Aug 2026. After freeze: additive fields
only; no path renames; no response-field deletions.

**Owners:** Karthik (`kd/*`) implements the backend. Co-founder / Sagar (`cf/*`)
implements iOS UI against this document. Canonical copy lives in **medha-id**.
The pin in `amber-ios/docs/PERSON-CONTRACT.md` updates only on freeze or an
explicit delta both developers agree to.

Sagar’s operating brief for the other editor (branch topology `sagar-main`):
`docs/SAGAR-MAIN.md` in both repos. Git topology in that file wins over §8
below (`sagar-main` is the integration subbranch; `cf/*` PRs target it).

**One-liner:** Wallet + Merkle leaf = portable identity proof. `amber_id` = data
ownership. Contacts = private graph edges. JWT = session. Everything else is
Postgres.

This is the isolation wall. Karthik never opens `apps/mobile` for this work.
Sagar never opens `medha-id/src` for this work. New client calls wait until the
route exists on `medha-id` `main` (grep `src/routes/` to confirm).

---

## 1. Three layers

```
persons (global, Phase 2 — not this week)
  person_id · verified_at · display_name · canonical_phone

users / account
  amber_id UUID PK          ← OWNERSHIP ROOT
  privy_did · person_id · phone
  wallet_pubkey · cnft_asset_id · merkle_tree · metadata_uri

contacts (relationship lens)
  contact_id · owner_id → users.amber_id
  linked_amber_id · person_id (nullable, Phase 2)
  display_name · phone · notes · rank signals

sub-entities (ALL tagged owner_id + contact_id)
  voice_memos · experiences · reminders · vectors · shares · feedback
  every row keyed on (owner_id, contact_id, created_at)
```

**Invariant:** your notes about a person are not that person's account. A
contact row is a private edge. `linked_amber_id` is set only when the contact
*is* an Amber user. Unknown inbound sender → 404; callers MUST NOT substitute
the tenant owner (this is the path that prevented "Maggie answered as Sagar").

On-chain (Solana Bubblegum, shared `AMBER_MERKLE_TREE`): one compressed NFT
leaf per account at signup, async, `users.cnft_asset_id` **nullable**. Postgres
is the dataset. JWT proves session access. Wallet proves identity ownership
only.

---

## 2. What already exists (do not rebuild)

Cloud SQL `users.amber_id` is already the PK. `contacts.owner_id` already
points at it. `contact_facts`, `contact_embedding`, `contact_identity_keys`,
`contact_favorites` are already `(owner_id, contact_id)`.

| Surface | Today | This-week delta |
|---|---|---|
| `POST /v1/auth/otp/verify` | Returns `token`, `refreshToken`, `amberId`, `isNewUser` | Add optional `cnft_asset_id` (null until mint worker lands) |
| `GET /v1/me` | Profile + `did` + `phoneNumber` + `loopSenderId` | **Add** `amber_id`, `cnft_asset_id`, `verification_status` |
| `POST /v1/me/contacts/:id/voice-note` | JSON `{ audio, mimeType, durationMs }` → transcript stuffed into `contacts.notes` | **Alias** `…/voice_notes`. Persist a `voice_memos` row. Keep the hyphen path. |
| `GET /v1/me/contacts/:id/profile` | Signal timeline stub (added / last contacted / birthday) | Leave in place. New `/timeline` is the product feed. |
| `POST /v1/auth/invalidate` | `{ ok: true }` | Unchanged |
| `POST /v1/account/delete` | `{ confirm: true }` → purge on `amber_id` | Cascade must include new `voice_memos` |
| Today-feed audio | `note_audio` + GCS signed URLs (`/v1/me/notes/:id/audio*`) | **Out of this contract.** Do not reuse for contact-scoped memos this week. |

JWT `sub` stays `person_id`. Access tokens **add** an `amber_id` claim; do not
swap `sub`. iOS keeps sending `Authorization: Bearer <access>` — never a
client-supplied `amber_id` header.

---

## 3. Table sketch (Karthik — new migration files only)

Schema changes live in **new files** under `medha-id/db/migrations/`. That
directory is shared: propose and ask before writing. Do not edit
`src/db/schema.js` as if it were live Cloud SQL — it is stale.

### `users` columns to add (all nullable)

```
wallet_pubkey     TEXT
cnft_asset_id     TEXT      -- Merkle leaf pointer; null until async mint
merkle_tree       TEXT      -- shared AMBER_MERKLE_TREE address
metadata_uri      TEXT
metadata_hash     TEXT      -- sha256(name || phone || verification_level)
```

### `voice_memos` (new)

```
id            UUID PK
owner_id      UUID NOT NULL  → users.amber_id
contact_id    BIGINT NOT NULL → contacts.id
transcript    TEXT
structured    TEXT           -- ranking-relevant summary (existing Gemini field)
audio_uri     TEXT NULLABLE  -- null this week (base64 in request, not stored)
source_type   TEXT           -- voice | imessage | share | manual
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

`persons` global table and `contacts.person_id` FK are **Phase 2**.

---

## 4. Frozen endpoints

Additive-only after 22 Aug. Errors use existing `{ error, message? }` shapes.

### `POST /v1/auth/otp/verify`

Already exists (`src/routes/mobile-auth.js`).

Request: `{ phone, code }`

Response (additive):

```
{
  token: string,              // 15-min access JWT
  refreshToken: string,       // opaque, keychain only
  expiresIn: number,
  amberId: string,            // uuid — ALREADY returned
  isNewUser: boolean,
  cnft_asset_id: string | null
}
```

Errors: `invalid_phone` 400, `expired` 410, verify-fail 401,
`account_unavailable` 503.

### `GET /v1/me`

Already exists (`src/routes/profile.js`). Keep every current field. Add:

```
{
  ...existingProfile,
  did: string,                // session subject (person_id or Privy DID) — keep
  phoneNumber: string | null,
  loopSenderId: string | null,
  amber_id: string,           // NEW — uuid ownership root
  cnft_asset_id: string | null,
  verification_status: "unverified" | "pending" | "verified"
}
```

`verification_status` is `"unverified"` until gov-ID. Do not delete `did`.

### `GET /v1/me/contacts/:id/timeline?cursor=&limit=`

**New file** `src/routes/contact-timeline.js`. Do not grow `profile.js`.

- Auth: `requireAuth`. Owner from session → `amber_id` (phone resolve is fine
  this week; do not take owner from the URL).
- Pagination: **cursor** (iOS preference). `limit` default 30, max 100.
- 404 `contact_not_found` if the contact is not this owner's.
- Response:

```
{
  items: [
    {
      id: string,
      kind: "voice" | "note" | "reminder" | "fact",
      created_at: string,          // ISO-8601 UTC
      contact_id: string,
      text: string | null,         // transcript or note body
      structured: string | null,
      reminder_id: string | null
    }
  ],
  cursor: string | null            // null = end
}
```

Compose from `voice_memos` + contact notes/facts + owner reminders tagged to
this `contact_id`. Newest first.

### `POST /v1/me/contacts/:id/voice_notes`

Alias of existing `POST /v1/me/contacts/:contactId/voice-note`
(`src/routes/voice-notes.js`). Same JSON body this week:

```
{ audio: string, mimeType?: string, durationMs?: number }
```

Keep the hyphenated path. Do **not** switch iOS to multipart until a written
decision covers storage provider / region / retention / encryption / max clip
length. Today-feed GCS (`note_audio`) is a different object (conversation-scoped
network notes) — do not overload it.

Response (additive `voice_memo` so iOS can optimistic-reconcile):

```
{
  ok: true,
  transcript: string,
  structured: string,
  contact: object,             // existing
  voice_memo: {
    id: string,
    owner_id: string,
    contact_id: string,
    created_at: string
  }
}
```

Errors unchanged: `bad_request` 400, `user_not_found` 404, `not_found` 404,
`transcription_unavailable` 502, `transcription_failed` 502, `save_failed` 500.

### `POST /v1/auth/invalidate`

Bearer. `{ ok: true }`. Unchanged (`src/routes/auth-sessions.js`).

### `POST /v1/account/delete`

`{ confirm: true }`. Purge cascades on `amber_id`, including `voice_memos` and
`device_sessions`. Unchanged request shape.

---

## 5. File ownership — this overhaul

Lanes follow the two-developer protocol (section 8). File lists below are the
person-architecture subset. If a file you need is in someone else's open PR:
stop.

### Karthik — backend (medha-id)

Direct:

- new `db/migrations/` files (ask first — shared dir)
- `src/db/store.js` — `resolveAmberIdBy*`, user upsert
- `src/db/purge.js` — delete cascade
- `src/lib/medha-jwt.js` — **add** `amber_id` claim; do not change `sub`
- `src/lib/privy.js` — attach `amber_id` on the request; **do not drop** Privy
  branch 3 this week
- `src/routes/mobile-auth.js` — optional `cnft_asset_id` on verify; enqueue
  async mint
- `src/routes/auth-sessions.js` + `src/db/session-store.js` — keep as-is unless
  the new claim requires a one-line pass-through
- `src/lib/solana.js` + `src/routes/identity.js` — mint worker; persist cNFT
  columns on Cloud SQL (`firestore.js` read-fallback only)
- **new** `src/routes/contact-timeline.js`
- `src/routes/voice-notes.js` — alias + `voice_memos` persist
- `src/routes/profile.js` — `GET /v1/me` additive fields **only**

Docs Karthik owns after freeze: this file.

### Co-founder / Sagar — iOS (`amber-ios/apps/mobile`)

Direct, and safe to start against mocked `/timeline` until the route is on
`main`:

- `app/(gated)/person/[id].tsx` — extract `PersonTimeline`; do not grow the
  2.3k-line file. **Unclaimed in AGENTS.md today — treat as co-founder for this
  sprint.**
- `components/pages/ProfilePage.tsx` — identity card stub (`amber_id`,
  verification, copyable `cnft_asset_id`)
- `components/VoiceNoteRecorder.tsx` — optimistic timeline row, reconcile on 200
- `lib/api.ts` — additive `Me` fields only (`amberId`, `cnftAssetId`,
  `verificationStatus`)
- empty / error / toast polish on screens already in this lane
- `components/pages/HomePage.tsx`, `ContactsPage.tsx`, `HomeVoiceCapture.tsx` —
  already co-founder owned; do not restyle via a different design system

**Do not edit (Karthik owns):** `lib/medhaId.ts`, `lib/auth.ts`,
`lib/sessionRefresh.ts`, `lib/secureStorage.ts`, `app.json`, `eas.json`,
`apps/mobile/ios/`, root lockfiles.

Keychain `amber_id` therefore lands in **Karthik's iOS files**
(`secureStorage.ts` + `auth.ts`): persist it next to the JWT when verify / 
`GET /v1/me` returns it. API calls stay Bearer JWT.

### Handshake (propose, then one owner edits)

- `src/routes/profile.js` — `GET /v1/me` additive fields (Karthik)
- `src/routes/mobile-auth.js` — verify extras (Karthik)
- `src/routes/voice-notes.js` — alias (Karthik)
- `apps/mobile/lib/api.ts` — type extras (Sagar)
- `apps/mobile/lib/peoplerank.ts` — do not change `[[p:CONTACT_ID]]` id type

### Peripheral — do not touch this week unless a query breaks

medha-id: `me-people-rank.js`, `people-rank-*`, `enrichment/*`, `internal.js`
(keep 404 ≠ tenant owner), Pinecone clients, secrets, circles, wall, shares,
questions, chat, conversations, `tenants.js` resolve shape, `dedup/**`.

Co-founder iMessage/Photon lane (also do not mix into this overhaul):
`ingest-imessage.js`, `photon-webhook.js`, `imessage.js`, `photon-sender.js`,
`loop-sender.js`, `loop-opt-in.js`, `agents.js`, `medha-agent-client.js`.

amber-ios leave-alone: `legacy-ios/`, `packages/amberkit/`, `services/app/`
(abandoned second backend). `connect/`, `intros.tsx`, `u/[amberId].tsx`,
`CirclesGrid.tsx` look unused and are **intentional**.

amber-agent: not in this workspace. Do not change `/tenants/resolve`.

---

## 6. Non-goals this week

- Global `persons` table / gov-ID vendor (Persona/Veriff)
- JWT `sub` rewrite from `person_id` → `amber_id`
- Dropping Privy `requireAuth` branch 3 (audit Chunk 3)
- Pinecone teardown / Firestore bulk migrate / Solana retirement (audit Chunks
  5–6). This contract **keeps** Bubblegum as a nullable identity proof.
- Renaming `/voice-note` or switching it to multipart
- WhatsApp
- cNFT retirement / re-key
- Dark-mode as a theme-system rewrite (`theme` / `classical` / `organic` is an
  unresolved decision — ask before styling new UI)
- Calling a new backend route from iOS before it exists on `medha-id` `main`

---

## 7. Open questions (both developers)

1. Shared vs per-user Merkle tree — leaning shared (`AMBER_MERKLE_TREE`).
2. Timeline pagination — **cursor** (iOS). Confirm.
3. Delete-account: hard delete vs tombstone + 30-day purge.
4. Sentry DSN + staging env vars for the EAS `stanford` profile.
5. Assign `apps/mobile/app/(gated)/person/[id].tsx` in root AGENTS ownership
   (proposed: co-founder).
6. Contact-scoped `voice_memos.audio_uri`: reuse Today-feed GCS (`note_audio`)
   or a separate bucket? No audio-blob work starts until this is a written
   decision in `wiki/decisions/`. Transcript-only rows are in scope.

Decisions land in `medha-id/wiki/decisions/NNN-title.md` and need both
developers before implementation.

---

## 8. Parallel-dev protocol (both repos)

Karthik: `kd/*` branches. Co-founder: `cf/*` branches. One feature per branch.
Open a **draft PR before writing code** so the other developer can see the file
claim. Rebase onto `origin/main` every session; never merge `main` into a
branch. Force-push only with `--force-with-lease` on your own branch.

Before editing: `git fetch origin` + `gh pr list --state open` +
`gh pr diff <n> --name-only`. If the file is in the other person's PR, stop.

Conflicts: enable `rerere`. Lockfiles and `apps/mobile/ios` → take `origin/main`
and regenerate if this branch intentionally changed deps. Never resolve a
conflict by deleting the other person's code. If the conflict is in a file you
do not own, stop.

Verify: `amber-ios` → `cd apps/mobile && npx tsc --noEmit && npm run lint`.
`medha-id` → `npm test` (baseline 666 pass / 28 fail — do not chase zero).
`git diff --stat` must only list files this task meant to change.

Never: repo-wide formatters, drive-by lockfile regenerations, secrets in
commits, deleting "dead" files, client calls to routes that are not on `main`.

Commit subject: `Area: what changed`. No AI trailers. Author squash-merges
their own PR after approval.

---

## 9. Week split

1. **This document** — both implement against it immediately.
2. **Karthik:** migration + `GET /v1/me` extras + `/timeline` + `voice_memos`
   persist + async mint (nullable) + Keychain persist of `amber_id` in
   `secureStorage.ts` / `auth.ts`. Staging smoke.
3. **Sagar:** identity card stub, `PersonTimeline` UI with optimistic rows
   (mock until `/timeline` is on `main`), TestFlight polish. Build number is
   107 today; Stanford target is 110+.
4. **Freeze 22 Aug:** no signature changes; bugfixes only behind this contract.
