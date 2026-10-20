# Adding a client to the replybot

The playbook for putting a new client on the Perplexity reply loop. Work
through it in order:

```
Prospect replies → Clay table → POST /replies → Perplexity (client's seat,
client's guide) → POST /replies/result → Slack card → Send → Clay replies
from the same mailbox
```

**Reference implementation: Zeutara** (`zeutara` in
`src/agents/replybot/client-config.ts`, PR #52). Copy from it rather than from
older entries. Amber, BMA and Serif predate parts of this and carry history
you don't want.

---

## 0. Look before asking

Most answers already exist somewhere. Before asking anything, check:

- **Slack:** search the client's name. Find their channel with us, who the
  client-side people are (they show as external), the sending mailboxes, the
  sending tool, and launch status.
- **Meeting notes (Wispr Flow):** search the client's name. Look for what the
  outreach is for, the persona and sender rules, and the Perplexity seat
  arrangement.
- **Repo:** `grep -ri <client>`, and check the current registry.

## 1. Ask only what's left

Use one `AskUserQuestion` call, with up to 4 questions:

| Decision | Options | What it changes |
|---|---|---|
| Can Clay send replies back? | intake + send (default) / intake only / unknown | `sendMethods` and the Clay send table. "Intake only" needs a draft-only card mode, which doesn't exist yet. |
| Who can press Send? | anyone in the channel / named approvers / nobody (notify only) | `approvers` (Slack user ids from the card's workspace) |
| Where do cards live? | a channel in **our** workspace (Amber Intelligence), Slack Connect-shared / the **client's own** workspace | Own workspace means an install plus `slackTeamId` (§3) |
| Which Perplexity account pays? | the client's seat (default) / BMA's for now | `PERPLEXITY_ACCOUNT_<CLIENT>=bma` for the interim |

These are inputs to gather, not questions to put to the user as choices:
- client id (lowercase, `[a-z0-9_]`);
- display name;
- sender name and email (display only);
- sign-off name(s), and which mailbox maps to which name;
- timezone;
- what the outreach offers, and to whom;
- the list of offers if there are several (Zeutara has one per company).

## 2. Code: one PR

Branch `maggie/<client>-replybot` from `origin/main`.

### 2a. `src/agents/replybot/client-config.ts`

**Fallback voice prompt.** It's only used when a payload arrives without a
draft. Copy `ZEUTARA_VOICE_PROMPT`: keep the DIRECTION block and the
never-invent and no-URL rules, and swap in the persona.

**Entry:**

```ts
  acme: {
    clientId: 'acme',
    displayName: 'Acme',
    slackTeamId: 'T…',          // ONLY if cards live in the client's own workspace
    slackChannelId: 'C…',       // bot must be invited
    // Both explicit, not defaulted, so acme_test inherits them by spread.
    // The defaults key off the client id, so the clone would look up
    // ACME_TEST_REPLY_GUIDE_URL and a Perplexity account called acme_test.
    perplexityAccount: 'acme',
    replyGuideUrlEnv: 'ACME_REPLY_GUIDE_URL',
    sender: { name: '…', email: '…' },  // display/fallback only, Clay sends
    sendMethods: ['clay'],               // add 'gmail' only with domain-wide delegation
    clayReplyWebhookUrlEnv: 'REPLYBOT_ACME_CLAY_REPLY_URL',
    // No webhookSecretEnv: replies arrive only on POST /replies, so
    // /replybot/acme/webhook refuses everything. Nothing to set in Railway.
    approvalButtonsOnManualReview: true,
    // approvers: ['U…'],  // only if not everyone may send
    voice: {
      systemPrompt: ACME_VOICE_PROMPT,
      signoffName: '…',
      timezone: 'America/…',
      banEmDashes: true,
    },
  },
```

**Test clone**, after the existing `*_test` clones:

```ts
CLIENTS.acme_test = {
  ...CLIENTS.acme,
  clientId: 'acme_test',
  displayName: 'Acme (test)',
  slackTeamId: undefined,          // #test-channel is in OUR workspace
  slackChannelId: 'C0C14UKEEUR',   // #test-channel
  // channelOverrides: { reply: 'C0C14UKEEUR' },  // if the parent has overrides
};
```

### 2b. Tests

- Copy `src/agents/smartlead-responder/__tests__/zeutara-clay-reply-send.test.ts`
  to `<client>-clay-reply-send.test.ts` and swap the ids, URLs and fixture.
  - **Own-workspace client:** keep the installation fixture and the token
    assertions.
  - **Our-workspace client:** delete the fixture, and assert the card posts
    with `HOME_TOKEN`.
- Add the new ids to the `client with no webhook` case in
  `src/agents/replybot/__tests__/webhook.test.ts`.

### 2c. `.env.example`

Add the client's variables next to their neighbours:
- `REPLYBOT_<CLIENT>_CLAY_REPLY_URL=`
- `<CLIENT>_REPLY_GUIDE_URL=`
- `# PERPLEXITY_PROJECT_UUID_<CLIENT>=`

### 2d. `docs/<CLIENT>_REPLY_GUIDE.md`: the guide the AI reads

Start from the closer of the two existing guides:
- `docs/ZEUTARA_REPLY_GUIDE.md`, for fundraising or investor outreach, or any
  client with several offers;
- `docs/SERIF_REPLY_GUIDE.md`, for selling one product.

**Rewrite:**
- §1: what the outreach is.
- §1b: one block per offer, if there are several.
- §3: the decided edge cases for their world.
- §4: which mailbox signs as which name.
- §5: voice.

**Keep §2 and §7 as they are.** The code depends on them:
- `negative` is deleted and never shown to anyone.
- Every other category must carry a draft, or it's dropped.

So anything with an opening must be `needs_review`, never `negative`.

### 2e. Ship

1. Run `npm test` and `npm run typecheck`. Compare any failures against
   `origin/main`; only new ones matter.
2. Commit, push, and open the PR.
3. Give the user the §4 variables, filled in, and a link to §3.

## 3. Setup on the user's side

### Slack

**A. Our workspace (default).**
1. Create the channel in Amber Intelligence.
2. Slack Connect-share it with the client.
3. Run `/invite @Togari`.
4. Copy the channel ID from the bottom of the About tab into the registry.

**B. The client's own workspace.** See `docs/SLACK_EXTERNAL_WORKSPACE.md`.
1. Mint the install link and send it to their admin:

   ```bash
   npx tsx scripts/slack-install-link.ts --client=<id>
   ```

2. Their admin clicks Allow. The landing page shows `T…`.
3. Run `/invite @Togari` in their channel.
4. Put `slackTeamId` and `slackChannelId` in the registry.

If the user doesn't have the `T…`, it's stored as `slack-team:T…` in
`togari_core.tenant_secrets`. Read only `tenant_id` and `created_at`, never the
ciphertext. If `gcloud` auth has expired, query through
`@google-cloud/bigquery` with `GCP_CREDENTIALS_BASE64` from `.env`.

### Perplexity

1. Confirm the seat has Computer and credits. Serif runs at about 50 credits
   per reply.
2. Create a project. Its UUID goes in `PERPLEXITY_PROJECT_UUID_<ACCOUNT>`.
3. In **the project's** credential store, add:
   - host `togari-bma-prod.up.railway.app`;
   - a Bearer token, newly generated and appended to `REPLY_RESULT_TOKEN`.
4. Sign in on that seat:

   ```bash
   npx tsx scripts/perplexity-signin.ts --client=<id>
   ```

   Run it on the user's machine, with the browser logged in **as that
   seat**. The local `TENANT_SECRETS_MASTER_KEY` must equal Railway's.
5. The token lasts 30 days and has no refresh. The user needs a calendar
   reminder to sign in again.

### Guide

1. Fill in the placeholders, and have the client read it.
2. Paste it into a Google Doc and use **File → Share → Publish to web**.
3. Open the `/pub` URL in a private window. It must not ask for a login.

### Clay

- **Intake:** an HTTP API column posting to `/replies`. The spec is
  `docs/REPLY_QUEUE_CLAY_COLUMN.md`.
  - Use a new bearer token, appended to `REPLIES_INGEST_TOKEN`.
  - Start with `client_id: "<id>_test"`.
  - Condition: reply body not empty. Auto-retry on.
  - If the guide is per-offer, campaign names must contain the offer's name.
- **Send:** a webhook-source table whose URL goes in
  `REPLYBOT_<CLIENT>_CLAY_REPLY_URL`. It receives
  `{lead_id, campaign_id, email, subject, body, in_reply_to, client_id}` and
  runs the "reply to lead in campaign" action, keyed on `lead_id` +
  `campaign_id`.

### Test, then go live

1. **Smoke test.** curl `/replies` with `client_id: "<id>_test"` and fake ids.
   A card should reach #test-channel in 5 to 15 minutes. **Don't press Send.**
2. **End to end.** Use an inbox the user controls as a lead, reply from it,
   and press Send. Check that it arrives threaded, from the same mailbox.
3. **Go live.** Switch the column to `client_id: "<id>"`, then run the column
   on replies that arrived since launch. Dedup is by `row_id`.

`docs/ZEUTARA_REPLYBOT_SETUP.md` has every command written out for one client.

## 4. Variables

**Per client.** All go in Railway, on `togari-bma-prod`.

| Variable | Required | Value | Also goes in |
|---|---|---|---|
| `REPLYBOT_<CLIENT>_CLAY_REPLY_URL` | yes | The Clay send table's webhook URL. It is a secret. | (nowhere else) |
| `<CLIENT>_REPLY_GUIDE_URL` | yes | The guide's `/pub` URL | (nowhere else) |
| `PERPLEXITY_PROJECT_UUID_<ACCOUNT>` | yes | Project UUID. The account defaults to the client id. | (nowhere else) |
| `REPLIES_INGEST_TOKEN` | append | A new `openssl rand -hex 32`, as `old,new` | Clay intake column, `Authorization: Bearer` |
| `REPLY_RESULT_TOKEN` | append | A new `openssl rand -hex 32`, as `old,new` | Perplexity project credential |
| `PERPLEXITY_ACCOUNT_<CLIENT>` | no | e.g. `bma`, only to bill another account for now | |
| `REPLYBOT_<CLIENT>_CLAY_OUTREACH_URL` | no | Only for first-touch (form-fill) outreach | |
| `REPLYBOT_<CLIENT>_WEBHOOK_SECRET` | **don't create** | Reply-loop clients omit `webhookSecretEnv`. It's only for the legacy `/replybot/:id/webhook` path. | |

**Shared.** These are set once already. Verify them; don't recreate them.

| Variable | Must be |
|---|---|
| `REPLIES_FORCE_CLIENT_ID` | **unset.** If set, every card, and its Send, goes to that client. |
| `REPLY_SWEEP_ENABLED` | `true` |
| `PERPLEXITY_ALERT_SLACK_CHANNEL` | set |
| `TOGARI_PUBLIC_BASE_URL`, `TENANT_SECRETS_MASTER_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | set |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | set. Only needed for Slack option B, and also needed in local `.env`. |

## 5. Gotchas: each of these has bitten before

- **`REPLIES_FORCE_CLIENT_ID` left set** in Railway sends every card to that
  client. Send then goes through *that* client's Clay table.
- **Test clone inheritance.**
  - `perplexityAccount` and `replyGuideUrlEnv` must be explicit on the
    parent.
  - `channelOverrides` must be overridden on the clone. `serif_test` once
    posted into Serif's live channel.
  - `slackTeamId` must be cleared for #test-channel.
- **Bot not invited.**
  - In our workspace, the card fails quietly; check the logs.
  - In the client's workspace, an alert goes to
    `PERPLEXITY_ALERT_SLACK_CHANNEL`.
- **Callback credential in the wrong place**, meaning not in the project
  vault, or `PERPLEXITY_PROJECT_UUID_*` unset. Perplexity drafts, can't
  deliver, and the row sits on `dispatched`.
- **`REPLY_SWEEP_ENABLED` off.** Rows sit on `queued` forever, which looks
  like "Clay worked but no card".
- **Missing `lead_id` / `campaign_id`.** Send refuses, and there is no
  fallback.
- **Negatives are deleted.** A guide that calls a soft no "negative" loses
  that lead silently.
- **URLs in drafts.** The model invents them. Only links copied from the
  guide are allowed. Em dashes are stripped automatically when `banEmDashes`
  is set.
- **Gmail sending** needs the client's Workspace admin to grant domain-wide
  delegation. Prefer Clay.

## 6. A card didn't show up

```sql
SELECT row_id, client_id, state, attempts, category, LEFT(draft, 60) AS draft_head, updated_at
FROM `midyear-glazing-485303-u3.togari_data_lake.reply_items`
WHERE client_id LIKE '<id>%' ORDER BY updated_at DESC LIMIT 10;
```

| State | Means |
|---|---|
| no row | The Clay column didn't fire, or returned 4xx. Check its condition, token and `client_id`. |
| `queued` | The sweeper is off, the account is halted (see the alert channel, `/admin/status`), or the daily cap was hit. |
| `dispatching` for 15+ min | A stuck call. An alert has already fired. |
| `dispatched` | Perplexity can't deliver: credential or project UUID. Or it's slow; it gets chased at 15 min. |
| `done`, no card | The bot isn't in the channel, a wrong channel or team id, or no draft came back. |
| `failed` | Gave up. `scripts/requeue-failed-replies.ts` (dry run by default). |
