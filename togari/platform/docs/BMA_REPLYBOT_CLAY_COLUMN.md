# BMA replybot — Clay HTTP API column spec

BMA's cold-email replies reach the replybot from Clay, not from Smartlead's
native webhook. Chain:

```
Smartlead reply
  → Clay inbound source webhook
    (the BMA inbound webhook URL; it's a secret, read it from the Clay source)
  → Clay table
  → Clay HTTP API enrichment column  ← this doc
  → POST /replybot/{clientId}/webhook   (Togari, Railway)
  → Claude drafts in the persona's voice → Slack approval card → Gmail send
```

That `api.clay.com` URL is the **inbound** leg (data going _into_ Clay). It is
not configured anywhere in this repo — only our own endpoint goes in the Clay
column below.

## Two columns, one per persona

| Persona             | Column POSTs to                                                 | `X-Replybot-Key` value from     |
| ------------------- | --------------------------------------------------------------- | ------------------------------- |
| Sagar (Amber brand) | `https://togari-bma-prod.up.railway.app/replybot/amber/webhook` | `REPLYBOT_AMBER_WEBHOOK_SECRET` |
| Maggie (BMA)        | `https://togari-bma-prod.up.railway.app/replybot/bma/webhook`   | `REPLYBOT_BMA_WEBHOOK_SECRET`   |

`bma` used to mean Sagar and now means Maggie. Slack cards minted before
2026-09-02 carry `clientId: "bma"` meaning _Sagar_, so card payloads now carry
a `cv` schema version and `resolveReplybotClientFromCard()` reads any
unversioned card under the old meaning. Nothing to do in Clay about it — just
don't assume an old card in Slack means what its clientId says.

**Method:** `POST`
**Headers:** `Content-Type: application/json`, `X-Replybot-Key: <secret>`

Replies flow both ways: Clay POSTs the inbound reply here, and on approval
Togari POSTs back to Clay so the send comes from the campaign mailbox (see
"The other direction" below).

## Body

Same shape for both columns — only the URL and key differ.

```json
{
  "to_email": "{{email}}",
  "to_name": "{{first_name}} {{last_name}}",
  "company_name": "{{company}}",
  "lead_title": "{{title}}",
  "campaign_name": "{{campaign_name}}",
  "subject": "{{reply_subject}}",
  "text": "{{reply_body}}",
  "message_id": "{{message_id}}",
  "original_outbound": "{{sent_email_body}}",
  "from_email": "{{sending_mailbox}}",
  "time_replied": "{{replied_at}}"
}
```

| Field                                   | Needed?                  | What breaks without it                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `to_email`                              | **required**             | Nobody to send to. The card still posts, but Send fails.                                                                                                                                                                                                                                                                                                                                                                                   |
| `text`                                  | **required**             | The reply body. Claude drafts against `(empty)`.                                                                                                                                                                                                                                                                                                                                                                                           |
| `campaign_name`                         | **required in practice** | `resolveStrategy` matches `"job posting"` as a case-insensitive substring of this. Without it, job-posting replies lose the LinkedIn placement profiles and the SWE/BizOps track buttons.                                                                                                                                                                                                                                                  |
| `message_id`                            | strongly recommended     | The prospect's `Message-ID`. Drives `In-Reply-To`/`References`, so without it the approved reply starts a new thread instead of threading under theirs.                                                                                                                                                                                                                                                                                    |
| `original_outbound`                     | **strongly recommended** | The outbound we sent them. There is no `SMARTLEAD_API_KEY` any more — BMA runs through Clay only — so the payload is the _only_ source of this. Without it the prompt says `(Original outbound email not available.)` and Claude drafts against a one-sided conversation. Aliases: `outbound_body`, `outbound_email`, `original_email`, `sent_message` (string or `{text}`), `sent_body`. Each such draft also logs a warning.             |
| `campaign_id` + `lead_id`               | **required**             | Clay's "reply to lead in a campaign" action is keyed on this pair, so they are what makes the reply send from the campaign mailbox. They must survive from here through the Slack card to the click. A card missing either **cannot be sent at all** — the send refuses rather than quietly falling back to Gmail and answering from the wrong mailbox. (They were briefly optional, when they only fed the retired Smartlead API lookup.) |
| `subject`                               | recommended              | Shown on the card and in the prompt.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `to_name`, `company_name`, `lead_title` | recommended              | Personalization; each degrades to `Unknown`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `from_email`, `time_replied`            | optional                 | `from_email` is normalized but unused downstream; timestamp defaults to now.                                                                                                                                                                                                                                                                                                                                                               |

Nested shapes work too — `lead: { email, first_name, last_name, company_name,
title }` and `reply_message: { text, message_id }` — as do the aliases in
`normalizePayload` (`sl_lead_email`, `lead_email`, `preview_text`,
`email_body`, `reply_text`, `body`, `email_subject`, `campaignId`, …).

### Job-posting campaigns

Both personas run the `job_posting_placement` strategy, so a `campaign_name`
containing "job posting" gets the LinkedIn placement profiles appended and,
when the role is ambiguous, SWE/BizOps track buttons instead of a draft.
Clicking a track re-drafts from the conversation carried **on the card** —
another reason `text` and `original_outbound` need to be in the body.

## Two fields to deliberately NOT send

- **No `category` / `lead_category` / `reply_category`.** Out-of-office,
  unsubscribe and do-not-contact are dropped silently by `SKIP_CATEGORIES`,
  and the manual-review categories (Not Interested, Wrong Person, …)
  short-circuit the Claude call entirely — the card posts with no draft, and a
  no-draft card falls back to the "Open in Smartlead" link, which is dead for
  Clay payloads. Send every reply with no category and let Claude classify.
- **No `event_type`.** `form_fill`, `linkedin_interaction` / `post_interaction`
  and `article_outreach` each divert to a first-touch outreach path. Replies
  must leave it unset.

## The other direction: approved replies go back to Clay

Pressing **Send** on a card no longer sends over Gmail. Togari POSTs the
approved reply to Clay, and Clay's "reply to lead in a campaign" action sends
it from the campaign's own sending mailbox — so the reply comes from whichever
inbox the prospect actually wrote to, threaded natively, under the right
persona. We never touch the mailbox and no domain-wide delegation is involved.

Both personas point at one Clay webhook today, held in
`REPLYBOT_AMBER_CLAY_REPLY_URL` and `REPLYBOT_BMA_CLAY_REPLY_URL` (same value
in both; separate vars so the tables can be split later without a code
change). The URL is itself the secret, so it lives only in the environment.

What Togari POSTs, on Send:

```json
{
  "lead_id": 5150,
  "campaign_id": 311,
  "email": "hiring@acme.com",
  "subject": "Re: your open roles",
  "body": "Happy to help.\n\nSagar",
  "in_reply_to": "<abc@mail.acme.com>",
  "client_id": "amber"
}
```

`client_id` is `amber` (Sagar) or `bma` (Maggie) — the one field that tells a
shared Clay table which persona approved the reply. `lead_id` and
`campaign_id` are echoed straight back from the inbound payload, which is why
they are required above. `body` is the final text: edits made in the Slack
modal and, on job-posting campaigns, the injected placement profiles are
already in it.

The Save-as-Gmail-Draft button is deliberately hidden on these cards. It would
file the draft into sagar@ or maggie@, which is not the mailbox the reply
leaves from, so nobody would ever look at it.

## Response codes

The endpoint returns `200` as soon as the key is verified and processes
asynchronously, so Clay sees `200` even if drafting later fails — those
failures land in the Railway logs, not in Clay. `401` = bad or missing
`X-Replybot-Key`; `404` = unknown clientId in the path; `410` = the client is
retired (HHH).

An **unset** secret in Railway means "skip auth (dev mode)" — an open
endpoint, not a closed one. Set both secrets before deploying.
