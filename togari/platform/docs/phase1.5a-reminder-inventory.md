# Phase 1.5a — Reminder Inventory (Step 0)

**Purpose.** Before touching any reminder code, enumerate every path that
creates a reminder and every medium in which reminders are stored, so
that 1.5a's capture step can reach all of them and 1.5c's migration can
be complete.

**Status.** Discovery only. No code changes. No reads or writes against
external systems. Counts marked `TBD` need to be pulled by the user —
see *Outstanding verification* at the bottom.

---

## Short answer

Every reminder in production today lives in **exactly one** storage
medium: **Slack's own scheduled-message system**, persisted inside
Slack via `chat.scheduleMessage`. Our service is stateless w.r.t.
reminders — we hand Slack a `(channel, text, post_at)` tuple, receive
back a `scheduled_message_id`, log it to stdout, and forget it.

There is:
- **No** BigQuery table for reminders.
- **No** Cloud Tasks queue.
- **No** Cloud Scheduler job.
- **No** `node-cron` / `cron.schedule` in the repo (not even a dev
  dependency — grep of `package.json` confirms).
- **No** `setTimeout`-based reminder dispatch. The only `setInterval`
  in `src/` is `src/server.ts:451`, which is the 15-minute inbox poll
  (`AUTO_POLL=true`). Unrelated to reminders.
- **No** persistence of the returned `scheduled_message_id`. It is
  console-logged (`src/transports/slack/responder.ts:282`,
  `scheduledMessageId: data.scheduled_message_id` in the logger.info
  call) but never written to BQ, Redis, or disk.

This is a good result for the migration: there is only one place to
look. It is also a fragile result: once we schedule via Slack, we have
no handle on it from our side. A reminder we can't enumerate, we can't
migrate.

---

## Code paths that create reminders

Three code paths exist. Only one is live for Slack traffic. Two are
effectively dead for Slack but may be used by non-Slack transports or
are leftover from Phase 1.

### 1. ACTIVE (Slack): `handleSlackReminder`

- **File:** `src/transports/slack/index.ts:234-297`
- **Called from:** `src/transports/slack/index.ts:315-318`
  (`processSingleAction` dispatch on `parsed.intent === 'set_reminder'`)
- **Mechanism:** Inline `fetch('https://slack.com/api/chat.scheduleMessage', …)`.
  Does NOT try `reminders.add` first.
- **Target channel:** `reminderTarget` (falls back to `slackUser` —
  **this is the bug the user flagged.** `slackUser` is the sender, not
  the `@mentioned` user).
- **Storage:** Slack-native (scheduled message lives in Slack).
- **Persistence of Slack's returned `scheduled_message_id`:** None.
- **Entry point:** Slack `app_mention` / DM events → intent router →
  action processor → here.

### 2. `setReminder` (core/engine path, non-Slack platforms)

- **File:** `src/core/tools/reminder-ops.ts:94-152`
- **Called from:** `src/core/engine.ts:243` inside
  `case 'set_reminder'`.
- **Mechanism:** If `platform === 'slack'` → `setSlackReminder`
  (`reminders.add` → fallback to `chat.scheduleMessage`). Otherwise
  returns a descriptive string for the caller to handle.
- **Who calls engine for Slack?** No one. Slack bypasses the engine for
  `set_reminder` (path #1 above handles Slack directly). The engine's
  `set_reminder` case is exercised by the API transport / MCP transport
  if they surface this intent.
- **Storage:** Slack-native for Slack; nothing for other platforms
  (the core version just returns a string — no actual scheduling).
- **Implication for 1.5a:** This path sends reminders through a
  *different* function than the Slack transport uses, so any fix has to
  be applied in both places (or the two paths unified).

### 3. DEAD: `scheduleNativeReminders`

- **File:** `src/transports/slack/responder.ts:304-351`
- **Called from:** Nowhere.
  `grep -rn "scheduleNativeReminders" src/` → one match (the
  definition).
- **Status:** Exported but no importer. Looks like a Phase 1 leftover
  that was superseded by the inline path in
  `transports/slack/index.ts`.
- **Implication for 1.5a:** Can be removed in a follow-up. For now,
  leave it — deletion is out of scope and the fuzzy-match adversarial
  test surface is smaller if we don't change unrelated code.

**Takeaway.** The parser change in Step 1 and the delivery change in
Step 4 must apply to paths **#1 and #2**. Path #3 can be ignored (but I
will add a FIXME comment in 1.5a since it's sitting in the Slack
transport next to the live code).

---

## Storage media inventory

Only one. Listed in the schema 1.5a Step 3 requires the staging table
to recognise, with the other options marked `n/a — path does not exist`
for completeness:

| source_medium       | Exists? | Notes                                          |
|---------------------|---------|------------------------------------------------|
| `slack_scheduled`   | Yes     | All production reminders. Enumerable via `chat.scheduledMessages.list`. |
| `bigquery`          | No      | No reminders-table in `togari_data_lake` or `togari_pdw` (grep + sql/). |
| `node_cron`         | No      | `node-cron` not in `package.json` deps.        |
| `cloud_tasks`       | No      | No `@google-cloud/tasks` import; no queue code.|
| `cloud_scheduler`   | No      | No scheduler job definitions in repo.          |
| `setTimeout`        | No      | Only `setTimeout`s are rate-limiter sleep + Smartlead fetch timeout + email-engine delay. |
| `setInterval`       | No (for reminders) | `src/server.ts:451` is inbox auto-poll, not reminders. |
| `redis`             | No      | `ioredis` is in deps but grep shows no reminder keys. |
| `other`             | —       | Reserved for the 1.5a staging schema.          |

---

## Firing mechanism

Slack fires reminders itself. Once `chat.scheduleMessage` returns `ok:
true`, the scheduled message sits in Slack's own queue keyed by
`scheduled_message_id`. Our service does nothing at fire time — no
webhook, no callback, no BQ write, no audit. The DM / channel message
simply appears at `post_at`.

**Consequences for 1.5a:**

- The "existing reminders continue firing via existing mechanisms"
  guarantee in the brief is free: we don't touch Slack's scheduled
  messages, and Slack continues to fire them. The capture step (Step
  3) is pure read-only enumeration.
- Because we don't persist `scheduled_message_id` today, **capture in
  Step 3 is the first time these reminders become visible to our
  system**. If 1.5c wants to migrate ownership or fire via a new
  system, it will need these IDs. Step 3 must record them.
- `chat.scheduledMessages.list` has a 30-day horizon forward-looking
  (per Slack docs) — any reminder scheduled more than 30 days out
  *should* still list, but worth confirming at capture time.

---

## Ownership fields today

- Every reminder today has `targetUserId` set from
  `parsed.reminderTarget || slackUser` (`src/transports/slack/index.ts:250-254`
  and `src/core/engine.ts:236`). Because the parser does not pull
  mentions out of the reminder clause, `reminderTarget` is almost
  always `undefined`, so `targetUserId` falls through to the sender.
- There is **no** separate `created_by` field in either path. The
  identity of the creator is captured only in Slack's scheduled message
  metadata (the bot is the author; the human originator is not
  recorded anywhere on our side).
- `intent-router.ts:119-122` hardcodes a 3-person mapping:
  Kevin → `U088N3LT0SU`, Karthik → `U08L8PFMWBE`,
  Sagar → `U087Z8LPMMY`. That's the closest thing to a team directory
  we have today. Step 1's `togari.users` seed should treat this as
  authoritative for those three IDs.

---

## Audit logging infrastructure (for Step 1 fuzzy-match logging)

We already have one. `src/middleware/audit.ts` exposes `logAudit` /
`createAuditEntry`, which write structured JSON to stdout with an
`audit: "true"` marker. Per the comment at
`src/middleware/audit.ts:2-5`, Cloud Logging has a sink that routes
those to BigQuery. `src/bigquery/client.ts:78` also exposes a direct
`writeAuditLog(dataset, table, row)` for synchronous writes.

**Step 1 plan:** reuse the stdout path. It's already plumbed through to
BQ, so fuzzy-match decisions will land in the same place as existing
tool-call audit entries. No new table needed unless we want structured
fuzzy-match fields separate from the generic `AuditEntry` shape —
open question for you to weigh in on.

---

## Outstanding verification (cannot be done from this session)

gcloud auth is expired (`bq ls`, `gcloud tasks queues list`,
`gcloud scheduler jobs list` all failed with "Reauthentication failed.
cannot prompt during non-interactive execution"). And there's no local
`.env` file, so I can't hit Slack's API directly either.

Before Step 1, please run these and paste the results (or re-auth and
tell me to run them):

```bash
# Should confirm no reminder-related tables.
gcloud auth login
bq ls togari_data_lake | grep -i reminder
bq ls togari_pdw        | grep -i reminder

# Should confirm no Cloud Tasks / Scheduler.
gcloud tasks queues list --project=midyear-glazing-485303-u3
gcloud scheduler jobs list --project=midyear-glazing-485303-u3

# Counts the actual number of scheduled messages the bot has outstanding.
# This is the number Step 3 must capture. Replace $SLACK_BOT_TOKEN.
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/chat.scheduledMessages.list \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("count:", len(d.get("scheduled_messages",[])), "| next_cursor:", d.get("response_metadata",{}).get("next_cursor",""))'
```

If the Slack count is 0 or single-digit, Step 3's capture is trivial
and low-risk. If it's hundreds, we need to paginate carefully and the
idempotency UPSERT in the capture script matters a lot.

---

## Summary for decision

- **One medium** (Slack-native). The migration surface is smaller than
  feared.
- **Two live code paths** that schedule reminders (`slack/index.ts`
  inline + `core/tools/reminder-ops.ts`). Both need the owner-routing
  fix. One dead path (`slack/responder.ts::scheduleNativeReminders`)
  can be ignored for now.
- **Zero persistence** of `scheduled_message_id` today — Step 3's
  capture is the first time these become visible to our system.
- **No cron / queue / scheduler infrastructure** in the repo. If 1.5c
  wants to fire reminders from our side (rather than relying on
  Slack), that's new infrastructure, not a rewire of existing infra.
- **Blocked on user** for the three verification commands above before
  proceeding to Step 1.
