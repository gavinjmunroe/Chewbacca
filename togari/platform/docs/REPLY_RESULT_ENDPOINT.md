# Step 04 — where finished drafts already land

The plan says: find the endpoint Togari already has for finished drafts, don't
build a second one. This is that search, written down.

**Short version:** the Slack-posting machinery exists and must be reused. The
HTTP route in front of it cannot take Perplexity's callback as-is, because it is
an *email-in* endpoint and the callback is *verdict-in*. What's missing is a
thin adapter, not a second Slack implementation.

## (a) What posts into Slack

`src/agents/smartlead-responder/index.ts` — `processSmartleadWebhook()` is the
single entry point. It classifies (or accepts an upstream draft), then routes on
`sentiment` at index.ts:671:

| sentiment | goes to |
|---|---|
| `interested`, `wants_more_info` | `postSendReadyToSlack` — card with Send/Edit |
| `not_interested` | `postManualReviewToSlack` |
| `out_of_office` | dropped, no card |
| anything else (`other`) | `postManualReviewToSlack` — the safe default |

Serif has `approvalButtonsOnManualReview: true`, so a manual-review card still
carries approval buttons.

## (b) + (c) The routes in front of it

Two, both raw-body webhooks, both taking a whole inbound email:

| | `POST /replybot/:clientId/webhook` | `POST /smartlead/webhook` |
|---|---|---|
| URL | `https://togari-bma-prod.up.railway.app/replybot/serif/webhook` | `…/smartlead/webhook` |
| Auth | `X-Replybot-Key: <REPLYBOT_SERIF_WEBHOOK_SECRET>` (Serif is `static-key`), or Smartlead HMAC | Smartlead HMAC (`X-Smartlead-Signature`) |
| Body | the full reply: `to_email`, `text`, `campaign_name`, `message_id`, `lead_id`, `campaign_id`, `from_email`, `original_outbound`, optional `draft_json` / `draft_body` | same |
| Status | current Serif path | legacy BMA path |

Both reply `200 {"status":"ok"}` *before* processing, then work asynchronously —
so the HTTP status tells you nothing about whether a card appeared.

## (d) Can it carry category, confidence, draft, reasoning?

Partly, and the field names matter more than expected. `upstreamDraftedReply()`
(index.ts:500) reads these names:

| Plan's field | Read by Togari? | Under what name |
|---|---|---|
| `reasoning` | **yes** | `reason` or `reasoning` |
| `draft` | **no** | wants `draft_body`, `email_body` or `drafted_reply` |
| `category` | **no** | wants `sentiment` or `category_label` |
| `confidence` | **no** | nothing reads it anywhere |

The two misses are worse than they look. A payload whose draft text is under
`draft` leaves `draftBody` empty, `upstreamDraftedReply()` returns `null`, and
the handler **falls through to drafting with Claude** — silently paying for and
posting a draft the plan meant Perplexity to write. A `category` Togari can't
read becomes sentiment `other`, which lands on manual review.

**The cheap fix is in step 11, not here.** We write the instructions Perplexity
follows, so tell it to send `sentiment`, `draft_body` and `reason` — names this
endpoint already speaks — and nothing in Togari changes, which is what the plan
asks for. The category vocabulary already maps: `positive` → `interested`,
`negative` → `not_interested`, and `needs_review` falls to `other` → manual
review, which is the right destination.

`confidence` is the one field with genuinely nowhere to go. It belongs on the
`reply_items` row rather than in the Slack path.

## The blocker: the callback has no email in it

Perplexity sends `row_id`, `category`, `confidence`, `draft`, `reasoning`,
`session_ref` — and nothing else. `processSmartleadWebhook` needs the prospect's
address, the reply text, the campaign, and `lead_id` + `campaign_id`, or the
card is unsendable (`sendViaClay` refuses without the id pair,
slack-actions.ts:270).

That context lives in the `reply_items` row keyed by `row_id`. So the missing
piece is an adapter that loads the row, merges the verdict, and calls the
**existing** `processSmartleadWebhook` — one Slack implementation, one card.
Having Perplexity echo the whole email back instead would bloat the prompt and
let the model mangle the ids.

## (e) Idempotency: there is none today

Nothing in the replybot path dedupes. Post the same result twice and you get two
Slack cards. The plan's fix is the right one: before creating the card, check
whether that `row_id` already reached `done`, and if so ignore it and reply 200.
`reply_items.state` is what makes that possible — this is the reason the table
has a state column at all.

## What was built

`POST /replies/result` (`src/routes/replies.ts`) — a thin adapter, not a second
Slack path:

1. auth: `Bearer <REPLY_RESULT_TOKEN>`, separate from the Clay intake token so
   the two callers rotate independently;
2. loads the `reply_items` row by `row_id`; 404 if unknown;
3. **claims** the row with a compare-and-set (`SET state='done' … WHERE state !=
   'done'`), saving category/confidence/draft/reasoning/session_ref;
4. if the claim matched nothing the row was already done — returns 200,
   `duplicate: true`, and posts nothing;
5. otherwise calls the existing `processSmartleadWebhook` with the stored email,
   using **its** field names (`sentiment`, `draft_body`, `reason`).

Migration `0034` adds `lead_id`, `campaign_id` and `session_ref` to the table,
and the Clay intake column now sends the first two.

### Two decisions worth knowing

**The claim happens before the Slack post, not after.** If the post then fails,
the cost is a row marked `done` with no card — loud in the logs, fixable by
hand. Claiming afterwards would instead risk two cards, and a duplicate card
means a duplicate reply to a real prospect once someone clicks Send. Note that
`processSmartleadWebhook` swallows its own errors, so such a failure does not
surface as a 500 — it only appears in that function's logs.

**One additive line changed in the responder.** `upstreamDraftedReply()`
returned `null` when there was no draft text, which would make a deliberately
draft-less `negative` verdict fall through and pay Claude to write a reply to
someone who just said no. It now honours a verdict carrying
`upstream_classified_only: true`. Opt-in, so every existing caller is unaffected
— the existing responder tests still pass unchanged.


## Step 10: the credential Perplexity needs (measured)

The first live dispatch reached Perplexity, classified correctly, and then
stopped dead:

> Checked for a stored Togari credential via `list_credentials` — returned
> empty. Called `request_credential` to open the secure form for a Bearer token
> on host `togari-bma-prod.up.railway.app` — the request was denied by the user
> (no HTTP call was ever made).

Two things follow.

**The credential must be saved in Perplexity's own credential store, for the
project rather than a session.** Host `togari-bma-prod.up.railway.app`, a Bearer
token whose value is `REPLY_RESULT_TOKEN`. Without it the task completes its
thinking and then cannot deliver, and the row sits on `dispatched` looking like
a timeout.

**Never rely on the in-session credential prompt.** Nothing is watching these
sessions, so `request_credential` is denied and the task blocks. The task
message now tells Perplexity to use the saved credential and explicitly not to
open a request form.

The token never goes in the message text — Perplexity keeps a readable record
of everything a session does.

### The real result shape

A completed call came back as `{thread_id, event, text}` — **no `task_state`,
no `pending_input`**, with `event: "complete"`. The plan's documented shape is a
superset, so step 07 must read `event` too and treat a missing `task_state` as
normal rather than unrecognised.
