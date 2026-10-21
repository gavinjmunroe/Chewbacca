# Domain map

How the folded sandboxes relate, and what each is for.

## Platform spine (extract-facing)

```
                    ┌─────────────────────────────────────┐
                    │           medha-platform            │
                    │   (production / agent monorepo)     │
                    └─────────────────▲───────────────────┘
                                      │ extract after proof
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
   domains/peoplerank          domains/messaging           ventures/core
   ranking + matching          iMessage R/W kit            amber-core
   DNC / contact spine                │                    people-graph
          │                           │
          │                    domains/clearout
          │                    AI inbox / triage / draft
          └─────────────┬─────────────┴───────────────────────────┘
                        │
                 warm-network thesis
            (who to reach / how to message)
```

## `domains/peoplerank`

**Job:** Score and rank people for Amber / Togari surfaces.

| Surface | Endpoint / entry | Question |
| ------- | ---------------- | -------- |
| Amber middle tab | `POST /v1/me/people-rank` | Who in *my* network should I reach out to? |
| UC1 dinners | `POST /v1/match/community-event` | Mutual pairs (2 partners each) |
| UC3 seating | same + `grouping` | Leader-anchored groups |

**Reusable core:** `src/peoplerank/` (Person model, embeddings, pairwise score).
**Service glue:** `api/` FastAPI. **Ops side:** Node MCP + BigQuery DNC + Clay sync.

**Upstream production target:** `togari-search` (Karthik) / medha-id contact spine.
**Do not extract:** Railway deploy fluff, result text dumps, MCP Gmail OAuth until needed.

## `domains/messaging`

Two complementary implementations of the same problem (local macOS iMessage):

| Subdir | Stack | Role |
| ------ | ----- | ---- |
| `messages2/` | Electron + React + better-sqlite3 + imessage-kit | Frozen **reference UI** + battle-tested chat.db SQL |
| `messages2kit/` | Swift 6 SPM + GRDB + Contacts.framework | **Extractable** `MessagesProvider` for ClearOut / native |

Shared DNA: Mac Absolute Time, reaction type maps (2000–2005 / 3000–3005),
attributedBody decode, AppleScript send, Full Disk Access + Automation TCC.

**Extract kit first.** Port SQL lessons from Electron only when Kit lags.

## `domains/clearout`

**Job:** AI communication command center — connect channels, triage, draft,
voice-clear, approve-before-send.

| Layer | Status |
| ----- | ------ |
| Landing + waitlist | Done |
| Supabase auth + schema | Done (Gmail/Slack/iMessage channel types) |
| Gmail OAuth sync + Claude triage/draft | Working MVP |
| Slack OAuth | Connect only (no message sync) |
| iMessage | Schema + UI stub; provider = `domains/messaging/messages2kit` |
| Deploy | Vercel — root `domains/clearout/web` |

Restored from deleted archive (`social/clearout@04d361b`). No standalone
GitHub remote. See `docs/DEPLOY.md`.

## `domains/tizzy`

**Job:** Always-wearable autism conversation coach (product sandbox).

| Layer | Status |
| ----- | ------ |
| Product / legal / hardware docs | Strong — company OS |
| Next.js iPhone demo + Claude coach | Strong demo surface |
| Expo mobile (BLE, SessionRecorder, SQLite sync) | Scaffold — incomplete wiring |
| Cloud API / firmware | Spec only |

**Extract selectively:** conversation schema, coaching taxonomy, haptic language,
BLE/recording client patterns, demoData generator. Not the IPA / EAS secrets.

## `ventures/` (Amber archive)

Historical six-dimension experiments lifted from medha-platform. Not a monorepo.

| Path | Substance |
| ---- | --------- |
| `core/amber-core` | Express API + worker; people, memories, action items, Loop Message webhook; Claude memory + people-graph search |
| `emotional/story` | Verified-human campus social demo |
| `financial/fiduciaryos` | Largest venture — wealth/tax advisor (Python ML + Next + Plaid) |
| `financial/homemap` | Static concept page |
| `physical/*` | Astro Overnight, bea90skid, tally waitlists |
| `social/egats` | Creative talent hiring + culture social (Supabase) |
| `social/marrow` | Club recruiting OS snapshot (canonical elsewhere) |
| `spiritual/babel-translate` | Waitlist landing |
| `voice/amber-phone-call-ref` | Twilio ↔ ElevenLabs adapter |

**Cross-links that matter for Medha:**
- amber-core people-graph ↔ peoplerank (same warm-network thesis; different stacks)
- FiduciaryOS `amber.ts` signals → external Amber API (not local amber-core)
- Story README already linked Tizzy as related

## Intentionally separate

- **medha-platform** stays outside this workspace — we prepare extractable
  packages toward it; we do not dump whole domains back into the agent tree.
