# Phase 1.5a — Complete (code-side) / pending execution

**Scope.** Reminder owner routing, fuzzy name resolution, tenant-scoped
`togari_data_lake.users` directory, and idempotent capture of the 10
currently-scheduled Slack reminders into a migration staging table so
Phase 1.5c can move them without loss.

**Status.** All code, SQL, scripts, and tests are complete and verified
locally. A small set of runtime-execution steps remain that can only be
done with live credentials (BigQuery + Slack). Those commands are
listed at the bottom.

---

## What changed

### New code

| File | Purpose |
|------|---------|
| `src/core/identity/mention-resolver.ts` | Deterministic `<@U...>` extraction, Unicode-safe Levenshtein fuzzy match, adversarial rules, audit logging. Feature-flagged by `FEATURE_REMINDER_OWNER_ROUTING` (default `true`). |
| `src/core/identity/user-directory.ts`   | Tenant-scoped, read-only, parameterized SELECTs over `togari_data_lake.users`. |
| `src/core/identity/user-context.ts`     | Consolidated from the pre-existing `src/core/identity.ts` (which previously shadowed the new directory). Same API, new location. |
| `src/core/identity/index.ts`            | Barrel. |
| `src/scripts/bootstrap-1.5a.ts`         | Creates both tables, seeds 7 BMA users. Idempotent. |
| `src/scripts/capture-reminders.ts`      | Paginated, rate-limited read of `chat.scheduledMessages.list` → MERGE into staging. Idempotent. |
| `sql/phase15a_create_tables.sql`        | DDL for `users` and `reminders_migration_staging`. |
| `sql/phase15a_seed_users.sql`           | 7-row MERGE seed for the BMA tenant. |

### Edits to existing code

| File | Change |
|------|--------|
| `src/middleware/audit.ts` | Added optional `metadata: Record<string, unknown>` to `AuditEntry` — used for fuzzy-match decision logging. |
| `src/bigquery/client.ts`  | `executeWrite` now accepts MERGE (needed for the capture script's idempotency). Existing INSERT/UPDATE callers unchanged. |
| `src/core/engine.ts`      | `set_reminder` case now calls `resolveReminderOwner`; ambiguous match returns an error response (no reminder created); feature-flag-gated. |
| `src/transports/slack/index.ts` | `handleSlackReminder` now takes `rawText` and resolves the owner before calling `chat.scheduleMessage`. Also fixed the long-standing bug that stripped all `<@U...>` mentions globally — now strips only the leading bot mention so in-body mentions survive for routing. |

### Files deleted

- `src/core/identity.ts` — contents moved to `src/core/identity/user-context.ts` because the new `identity/` directory was being shadowed by the file.

---

## Verification

### Local (executed in this session)

```
npm run typecheck   # clean
npm run build       # clean (one unrelated warning from googleapis/package.json)
npm test            # 34 / 34 passing (was 22; +12 tests 23–34)
```

Test file breakdown:
- `tests/smoke/slack.test.ts` — 25 tests (13 existing + 12 new: tests 23–34)
- `tests/smoke/mcp.test.ts` — 7 tests (unchanged)
- `tests/smoke/smartlead.test.ts` — 2 tests (unchanged)

Sample stdout from the test run showing fuzzy-match audit entries land
correctly (one per resolve call, `audit: "true"` marker so the Cloud
Logging → BigQuery sink picks them up):

```
{"audit_id":"...","audit":"true","client_id":"bma","user_id":"USENDER999",
 "tool_name":"fuzzy_name_resolver","action":"resolve_reminder_owner",
 "status":"success","metadata":{"input_text":"<@U088N3LT0SU>",
 "status":"resolved","matched_user_id":"usr_kevin_cong",
 "reason":"slack_mention","alternative_candidates":[...]}}
```

Ambiguous / typed-id / Unicode / SQL-injection cases each log their own
audit entry with `metadata.status` set to `ambiguous` / `none` and the
full candidate list for post-hoc review.

### Blocked on production credentials

These steps can't be run from the local dev session (expired gcloud
auth, no local SLACK_BOT_TOKEN). Run these three commands from a shell
with the right env; total wall-clock should be under a minute for BMA's
volume. Each is idempotent — safe to re-run.

```bash
# 1. Create togari_data_lake.users and reminders_migration_staging,
#    then MERGE-seed the 7-user BMA directory.
npx tsx src/scripts/bootstrap-1.5a.ts

# 2. Paginate chat.scheduledMessages.list, MERGE each record into the
#    staging table keyed by (source_medium='slack_scheduled', source_id=id).
#    Read-only on Slack — does NOT modify, delete, or reschedule any
#    existing reminder. Expected row count: 10.
SLACK_BOT_TOKEN=xoxb-...  npx tsx src/scripts/capture-reminders.ts

# 3. Sanity-verify the capture.
bq query --use_legacy_sql=false \
 'SELECT source_medium, COUNT(*) AS n
  FROM `midyear-glazing-485303-u3.togari_data_lake.reminders_migration_staging`
  GROUP BY source_medium'
```

Manual Slack test (prove in a live channel that owner routing
actually lands in the other user's DM):

```
@togari remind @kevin to verify 1.5a works
```

Expected: Kevin receives the scheduled DM, not the sender. Existing
pre-1.5a reminders continue firing via Slack's native scheduled-message
delivery — we did not touch them.

---

## Tests 23 – 34

| # | Scenario | Resolved to |
|---|----------|-------------|
| 23 | `<@U088N3LT0SU>` (Slack mention) in reminder clause | Kevin, not sender |
| 24 | "remind me" | sender |
| 25 | Plain text "Kevin" | Kevin (via `togari.users` fuzzy match) |
| 26 | `<@U088N3LT0SU>` + `<@U087Z8LPMMY>` → 2 reminders | Kevin + Sagar |
| 27 | Plain text "Kevin" with 2 Kevins in directory | **ambiguous — no reminder scheduled**, clarification returned |
| 28 | Multi-action message with embedded `remind @kevin` | Kevin |
| 29 | `FEATURE_REMINDER_OWNER_ROUTING=false` | **sender** (resolver not invoked; zero BQ reads of the users table) |
| 30 | Sender IS Kevin, message is "remind me", directory has another Kevin | **sender**, not the other Kevin |
| 31 | "remind everyone" / "remind the team" | sender (no fanout) |
| 32 | Typed literal `U088N3LT0SU` in plain text (no `<@>` wrapping) | **sender**, not Kevin |
| 33 | Unicode lookalikes `Kevın` (U+0131) and `Кevin` (Cyrillic Ке) | **ambiguous — no reminder scheduled** |
| 34 | Fuzzy-match input `'; DROP TABLE users; --` | sender (zero matches), parameterized SELECT never contained the injection string |

---

## Judgment calls made during execution

1. **Dataset name.** The brief said `togari.users` and
   `togari.reminders_migration_staging`. Our existing datasets are
   `togari_data_lake` (deals, activities) and `togari_pdw` (PDW-scoped
   relationship data). The users directory is shared state, not PDW,
   so I placed both tables in **`togari_data_lake`**. If you'd rather a
   dedicated `togari_identity` dataset, that's a one-line change in
   `user-directory.ts` + both SQL files + the two scripts.

2. **Existing `src/core/identity.ts` was shadowing the new directory.**
   It held the Phase 1 `resolveUser` / `resolveUserContext` stubs
   (unused — zero callers). I consolidated them into
   `src/core/identity/user-context.ts` and re-exported from the
   barrel. No API changes.

3. **`cleanedText` now strips only the leading bot mention, not all
   mentions.** This was the root cause of the reported bug: in-body
   `<@U...>` tokens were being wiped before the LLM ever saw them, so
   the LLM could only route reminders using the hardcoded 3-person
   prompt map. New behaviour preserves in-body mentions. Non-reminder
   flows see the token too, but I expect the LLM to handle that
   gracefully (it already ignores unknown tokens). Reverting is a
   one-line change if this causes regressions in other intents.

4. **Step 2 (add `owner_user_id` / `created_by_user_id` to existing
   reminder storage) is a no-op.** Step 0 confirmed all 10 production
   reminders live in Slack's own scheduled-message store, which we
   don't control. There is no schema to extend. The staging table from
   Step 3 captures the Slack-side metadata instead
   (`original_creator` today is `NULL` because `chat.scheduledMessages.list`
   doesn't expose the creating user; 1.5c can backfill from `raw_payload`
   if needed).

5. **Ambiguous-match UX is plain text, not Block Kit buttons.** The
   brief asked for Block Kit buttons in Slack. Without a wired
   interactivity endpoint, buttons would render but do nothing on
   click — worse UX than plain text. The current UX is a single reply
   line like
   `:raised_hand: *Reminder:* who did you mean — Kevin Cong, Kevin Delacruz? Please rephrase with @mention or a fuller name.`
   The TODO to upgrade to Block Kit lives in the codepath comments
   and should move in 1.5c along with interactivity wiring.

6. **Dead code (`scheduleNativeReminders` in
   `src/transports/slack/responder.ts`) left intact** per explicit
   approval.

7. **`BigQueryClient.executeWrite` now accepts `MERGE`.** Needed for
   the capture script's idempotency; reviewed not to weaken the other
   guardrails (still blocks DROP / DELETE / ALTER / TRUNCATE
   substrings — i.e. MERGE-with-DELETE-branch would still be rejected,
   which is what we want).

8. **Extended `AuditEntry` with optional `metadata: Record<string, unknown>`.**
   Cleanest path for emitting fuzzy-match decisions through the
   existing Cloud-Logging → BigQuery sink instead of creating a new
   table. The existing tool-call audit users don't populate it so
   their output shape is unchanged.

---

## Not done / follow-ups for 1.5c

- Replace placeholder `slack_user_id = NULL` for Mike, Maggie, Gwen,
  Caleb once their real Slack IDs are known (TODOs in `phase15a_seed_users.sql`).
- Wire a Slack interactivity endpoint so the ambiguous-match reply can
  use Block Kit buttons that actually resolve the ambiguity in one click.
- Decide whether reminders should continue firing via Slack's own
  scheduled-message system or be rehoused behind our own dispatcher.
  1.5c's migration uses the staging table to make that decision
  reversible.
- Revisit the `reminders_migration_staging.original_creator` column —
  today it's `NULL` for Slack-scheduled because the list endpoint
  doesn't return the creator. If 1.5c needs it, resolve from
  `raw_payload` (often `bot_id`) or cross-reference against our
  deal-activity history.
- Unify the three reminder code paths (`src/transports/slack/index.ts`
  inline, `src/core/tools/reminder-ops.ts`, dead
  `src/transports/slack/responder.ts::scheduleNativeReminders`). Two
  active, one dead — the duplication is small but if a third transport
  (iMessage) needs Slack-native reminders for BMA's team, route it
  through one well-tested function.
