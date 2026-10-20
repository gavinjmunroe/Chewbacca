# Zeutara replybot — setup

The same reply loop Serif runs, pointed at Zeutara:

```
Investor replies to one of Jonah's mailboxes
  → Clay Sequencer → Zeutara replies table in Clay
  → HTTP API column  POST /replies   (client_id "zeutara")
  → Togari queues it, sweeper dispatches it to Zeutara's Perplexity seat
  → Perplexity reads ZEUTARA_REPLY_GUIDE_URL, classifies, drafts
  → Perplexity POSTs the verdict to /replies/result
  → card in Zeutara's own Slack     (negatives are discarded, never carded)
  → anyone in the channel presses Send
  → Togari POSTs to REPLYBOT_ZEUTARA_CLAY_REPLY_URL
  → Clay replies in-thread from the same Jonah mailbox the investor wrote to
```

What is in code: the `zeutara` and `zeutara_test` entries in
`src/agents/replybot/client-config.ts`. Everything below is setup outside the
repo, in order. Steps 1 to 5 can run in parallel; 6 and 7 need them done.

---

## 1. Slack

Cards post into **#zeutara-cold-replies**, a private channel Maggie made in
our workspace (channel `C0C7RGTR7J8`), with our bot token, next to
#zeutara-amber. Jonah reaches it over Slack
Connect. Moved there 2026-10-07 at Caleb's request; before that they posted in
Zeutara's own workspace (team `T0C08A77X2T`, #zeutara-opportunities
`C0C71CF6Y2G`), and that install is still there.

1. `/invite @Togari` in #zeutara-cold-replies. It's private, so Togari can't
   join on its own. Without the invite, cards fail with `not_in_channel`, and the alert lands in `PERPLEXITY_ALERT_SLACK_CHANNEL`.
2. Share #zeutara-cold-replies with Jonah over Slack Connect. Only he can press the
   buttons on a Zeutara card (`approvers` in `client-config.ts`).
3. `zeutara_test` posts to **our** #test-channel with **our** token. The bot is
   already in that channel.

If cards ever move back to Zeutara's workspace, only reply cards work there.
@Togari mentions, reminders and the like are ignored there by design.

## 2. Perplexity (Zeutara's seat)

Use the seat on the Zeutara email that Jonah handed over.

1. **Confirm it has Computer and credits.** Serif runs at about 50 credits per
   reply, more when a slow task gets chased.
2. **Create a project**, e.g. "Togari replies", and copy its UUID from the
   project URL → `PERPLEXITY_PROJECT_UUID_ZEUTARA`.
3. **Save the callback credential in that project's credential store** (not a
   session; see `docs/REPLY_RESULT_ENDPOINT.md` step 10):
   - Host: `togari-bma-prod.up.railway.app`
   - Type: Bearer token
   - Value: a new token, `openssl rand -hex 32`. It gets appended to
     `REPLY_RESULT_TOKEN` in step 5, so it can be revoked without touching
     Serif's.

   If this is missing, Perplexity does the work and then can't deliver it.
   The row sits on `dispatched` and looks like a timeout.
4. **Sign Togari in, from your machine.** Your local `TENANT_SECRETS_MASTER_KEY`
   must match Railway's.

   ```bash
   npx tsx scripts/perplexity-signin.ts --client=zeutara
   ```

   Sign in as **the Zeutara seat** in the browser window it opens, not your
   BMA login. The account name defaults to `zeutara`. Don't set
   `PERPLEXITY_ACCOUNT_ZEUTARA`.
5. **Set a calendar reminder to re-run that sign-in every ~4 weeks.**
   Perplexity issues a 30-day token with no refresh token. Togari alerts in
   `PERPLEXITY_ALERT_SLACK_CHANNEL` before it expires. If the token lapses,
   Zeutara replies queue up and Serif keeps going.

## 3. The guide

1. Fill in every _(fill in)_ in `docs/ZEUTARA_REPLY_GUIDE.md`:
   - **1b**: one block per company, from Jonah's one-pagers. Only put a
     **raise** figure or a **deck link** in if Jonah has okayed it in
     writing. The AI treats this section as everything it knows.
   - **6**: real reply examples, once there are some. You can go live without
     them.
2. **Get Jonah to read it.** Drafts go out under his name to investors. He has
   asked to agree on things before execution.
3. Paste it into a Google Doc and use **File → Share → Publish to web**, the
   same as Serif. Open the `/pub` URL in a private window: if it asks for a
   login, Perplexity can't read it either. That URL →
   `ZEUTARA_REPLY_GUIDE_URL`.

When a company is added or drops out (as MortgageFi did), edit its block in the
Doc. Published Docs update in place, so no deploy is needed.

## 4. Clay

### 4a. Intake: the reply column

In the Clay table that receives Sequencer replies, add an **HTTP API**
column. This is the same spec as `docs/REPLY_QUEUE_CLAY_COLUMN.md`.

- `POST https://togari-bma-prod.up.railway.app/replies`
- `Authorization: Bearer <token>`, using a **new** token appended to
  `REPLIES_INGEST_TOKEN` (step 5). This column lives in Zeutara's Clay
  workspace, so it shouldn't share Serif's token.
- **Condition:** reply body is not empty. **Auto-retry:** on. Retries are safe.

```json
{
  "row_id":         "/Row ID",
  "client_id":      "zeutara_test",
  "campaign":       "/Campaign Name",
  "thread_id":      "/Message ID",
  "from":           "/Email",
  "sender_account": "/Sending Mailbox",
  "subject":        "/Reply Subject",
  "body":           "/Reply Body",
  "received_at":    "/Replied At",
  "lead_id":        "/Lead ID",
  "campaign_id":    "/Campaign ID",
  "lead_name":      "/Full Name",
  "lead_title":     "/Title",
  "lead_company":   "/Firm Name"
}
```

`client_id` stays **`zeutara_test`** until step 7.

Three fields matter more here than for Serif:

| Field | Why |
|---|---|
| `campaign` | **The campaign name must contain the company name** (Ivy, Vertocol, Qube, Goldie's). The guide picks the company's facts by it. A campaign named "Investors A" makes every draft generic. |
| `lead_id` + `campaign_id` | Send replies into the Sequencer thread by these two keys. Without them, Send refuses, and Zeutara has no Gmail fallback. |
| `sender_account` | Which of Jonah's mailboxes was written to. Clay must reply from that same mailbox. |

### 4b. Send: the reply action

Create a webhook-source table in Zeutara's Clay. Its webhook URL →
`REPLYBOT_ZEUTARA_CLAY_REPLY_URL`. The URL is the credential, so it goes in
Railway only.

On Send, Togari POSTs:

```json
{
  "lead_id": 7001,
  "campaign_id": 42,
  "email": "partner@fund.vc",
  "subject": "Re: Question",
  "body": "…the approved reply…",
  "in_reply_to": "<message-id>",
  "client_id": "zeutara"
}
```

Map `lead_id` + `campaign_id` into Sequencer's "reply to lead in campaign"
action, the same as Serif's send table. Check that the reply threads under the
investor's message and leaves from the original mailbox.

## 5. Railway (`togari-bma-prod`)

**Set:**

| Variable | Value |
|---|---|
| `REPLYBOT_ZEUTARA_CLAY_REPLY_URL` | webhook URL from 4b |
| `ZEUTARA_REPLY_GUIDE_URL` | the `/pub` URL from step 3 |
| `PERPLEXITY_PROJECT_UUID_ZEUTARA` | project UUID from step 2 |
| `REPLIES_INGEST_TOKEN` | append the token from 4a: `old,new` |
| `REPLY_RESULT_TOKEN` | append the token from step 2: `old,new` |

No webhook secret: Zeutara has no `/replybot/zeutara/webhook`, since replies
come in on `/replies`, so there's nothing to set. If you already set
`REPLYBOT_ZEUTARA_WEBHOOK_SECRET`, it's unused and you can delete it.

**Check:**

| Variable | Must be |
|---|---|
| `REPLIES_FORCE_CLIENT_ID` | **unset.** Your local `.env` has `serif_test`. If Railway does too, every Zeutara card becomes a Serif test card, and pressing Send hands the reply to **Serif's** Clay table. |
| `REPLY_SWEEP_ENABLED` | `true`. Off means replies queue and nothing ever dispatches them. |
| `PERPLEXITY_ALERT_SLACK_CHANNEL` | set. This is where the "sign in again" alert goes. |

## 6. Test on `zeutara_test`

Cards go to #test-channel and say "Zeutara (test)". **Send is real**: it goes
out through Clay as Jonah.

1. **Plumbing only, no Clay.** The fake ids mean you must not press Send on
   this card:

   ```bash
   curl -sS -X POST https://togari-bma-prod.up.railway.app/replies \
     -H "Authorization: Bearer $ZEUTARA_INGEST_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"row_id":"zeutara_smoke_1","client_id":"zeutara_test","campaign":"Vertocol - Seed","thread_id":"<smoke-1@test>","from":"you@yourdomain.com","sender_account":"jonah@zeutaraventures.com","subject":"Re: Question","body":"Interesting. Can you send the deck and tell me who is leading the round?","lead_name":"Test Investor","lead_title":"Partner","lead_company":"Test Fund"}'
   ```

   Expect `201`, then a card in #test-channel within about 5 to 15 minutes
   (one sweep plus the Perplexity run). Read the draft:
   - signed Jonah;
   - no em dashes;
   - **does not name a lead investor or a number** that isn't in 1b.
2. **End to end.** Add an inbox you control as a lead in one campaign. Reply
   to Jonah's email from it, let it flow through the Clay column, and press
   **Send** on the card. Confirm three things: it arrives threaded, from the
   same Jonah mailbox, and the row leaves `reply_items`:

   ```sql
   SELECT row_id, client_id, state, category, LEFT(draft, 80) AS draft_head, updated_at
   FROM `midyear-glazing-485303-u3.togari_data_lake.reply_items`
   WHERE client_id LIKE 'zeutara%'
   ORDER BY updated_at DESC LIMIT 10;
   ```

## 7. Go live

1. Change the Clay column's `client_id` from `zeutara_test` to **`zeutara`**.
2. Run the column on the replies already in the table since launch
   (2026-10-05). Dedup is by `row_id`, so re-running a row is a no-op.
3. Post the note below in #zeutara-amber.

> Replies are now live in our replies channel. Any investor reply worth answering posts there with a suggested response already drafted in Jonah's voice. Clear passes and unsubscribes are filtered out.
>
> Each card shows the investor's message, their firm, and which of Jonah's inboxes they wrote to. **Send as-is** sends the draft. **Edit & Send** lets you change it first. Either way it goes out from that same inbox, threaded under their email, so it looks exactly like Jonah replying.
>
> Anyone in the channel can press Send, so please claim a card in its thread before you answer it, so two people don't reply to the same investor. Drafts never include figures about a raise that aren't in the approved one-pagers. If an investor asks for terms, the draft says Jonah will confirm them.

## Running it

- **Re-sign Perplexity monthly** (step 2.4). This is the only recurring chore.
- **Spend cap:** `PERPLEXITY_DAILY_CALL_CAP` (default 200) applies per account
  per UTC day, so Zeutara's cap is separate from Serif's.
- **New company:** add its block to the guide Doc, and make sure its campaign
  names contain its name. No deploy is needed.
- **Nothing showing up:** follow the row in `reply_items`.
  - `queued` means the sweeper isn't running or the account is halted. Check
    `/admin/status` and the alert channel.
  - `dispatched` with no card usually means the project credential (step 2.3)
    or the guide URL.
  - `done` with no card means the bot isn't in the channel, or Perplexity
    returned no draft.
