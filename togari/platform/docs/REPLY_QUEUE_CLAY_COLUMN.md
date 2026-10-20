# Reply queue — Clay HTTP API column spec (step 03)

The intake leg of the Perplexity Computer MCP reply loop. Clay posts each
inbound cold-email reply into Togari's queue; Togari dispatches it to Perplexity
and Perplexity posts the finished draft back.

```
Prospect replies
  → Clay inbound source webhook → Clay table
  → Clay HTTP API enrichment column        ← this doc
  → POST /replies  (Togari, Railway)       → reply_items, state 'queued'
  → Togari dispatches to Perplexity Computer MCP  (step 06)
  → Perplexity POSTs the draft back               (step 04)
  → Slack approval card
```

**This replaces the Perplexity chat-completions column** in
`docs/SERIF_CLAY_BUILD.md` section 3, not adds to it. In the old design Clay
called Perplexity itself and got a draft back in the same request. Here Clay's
only job is to hand Togari the reply — the drafting is asynchronous and Togari
owns it. Running both means every reply gets drafted and billed twice.

## The column

**Type:** HTTP API
**Method:** `POST`
**URL:** `https://togari-bma-prod.up.railway.app/replies`

Headers:

| Key | Value |
|---|---|
| `Authorization` | `Bearer <REPLIES_INGEST_TOKEN>` |
| `Content-Type` | `application/json` |

The token is in the local `.env` and must also be set in Railway on
`togari-bma-prod` before the column works against prod. It is comma-separated
on our side, so rotating is: add the new token in Railway, redeploy, swap this
header, drop the old one.

## Body

```json
{
  "row_id":         "/Row ID",
  "client_id":      "serif",
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
  "lead_company":   "/Company Name"
}
```

Column names are placeholders — swap in whatever yours are actually called.
Older Clay tables use `{{snake_case}}` tokens instead of `/Column Name`; either
works, they are the same thing.

| Field | Needed? | What breaks without it |
|---|---|---|
| `row_id` | **required** | 400, nothing saved. This is the dedup key — see below. |
| `body` | **required** | 400, nothing saved. An empty string counts as missing; there is nothing for the AI to read. |
| `client_id` | **required** | Which client this reply belongs to. It decides the Slack channel, the voice, the Perplexity account billed, and the mailbox any answer leaves from — so it is never inferred. Each client's own column hardcodes its own value (`serif`, `amber`, …). A reply with none is refused unless `REPLIES_DEFAULT_CLIENT_ID` is set, and an unknown value is refused outright rather than misattributed. |
| `campaign` | recommended | Campaign-specific handling and the Slack card's context line. |
| `thread_id` | recommended | The prospect's `Message-ID`. Without it the approved reply starts a new thread instead of threading under theirs. |
| `sender_account` | recommended | Which of our ~30 mailboxes they replied to. Carries the persona (Arham / Whitney / Rafiq) and decides which mailbox the approved reply leaves from. |
| `from`, `subject` | recommended | Shown on the card and in the prompt. |
| `lead_id` + `campaign_id` | **required in practice** | Clay's "reply to lead in a campaign" action is keyed on the pair, so they are what makes the approved reply send from the campaign's own mailbox. The card still posts without them, but Send **refuses** rather than quietly answering from the wrong address. They are not in the plan's section 6 payload — Serif's send path needs them, so they ride on the row from here to the card. |
| `lead_name`, `lead_title`, `lead_company` | recommended | The Slack card's Name / Title / Company line reads "Unknown", and Perplexity drafts without knowing who it is writing to. `lead_name` is the full name as one string. Smartlead's reply webhook rarely carries title or company, so these usually come from a lookup column. |
| `received_at` | optional | ISO 8601. An unparseable value lands as NULL rather than failing the insert. |

Extra fields are ignored, so mapping more of your table than this is harmless.

## row_id is the one to get right

Everything about duplicate protection rests on it. Use **Clay's own row
identifier** — type `/` in the body editor and pick the row/record id field.
Not the date, not a counter, not a formula you compose. It has to be the same
value every time that row is sent, because that is what makes the second send a
no-op instead of a second Slack card and a second paid Perplexity run.

If your table has no addressable row id, the prospect's `Message-ID` is the
next best key: unique per reply and stable across re-runs. Do not fall back to
anything time-based.

## Two settings that are not optional

1. **Condition — only run when there is actually a reply.** Clay lets you put a
   condition on a column; use one (reply body is not empty). Without it the
   column fires on every row in the table.
2. **Auto-retry — on.** Retries are safe here by construction: a repeat POST of
   the same `row_id` changes nothing and returns 200.

## Check it works

Run the column on one row that has a real reply, then **run it again on that
same row**. The second run is the important one — it tests our duplicate
protection, not Clay.

| | First run | Second run |
|---|---|---|
| HTTP | `201` | `200` |
| Response | `{"duplicate": false, "state": "queued", ...}` | `{"duplicate": true, ...}` |
| `reply_items` | one new row, `state = 'queued'`, email text in `body` | still exactly one row, unchanged |

```sql
SELECT row_id, state, attempts, LEFT(body, 80) AS body_head, created_at, updated_at
FROM `midyear-glazing-485303-u3.togari_data_lake.reply_items`
ORDER BY created_at DESC
LIMIT 5;
```

If the second call errors, or creates a second row, fix that before step 04.
Things get sent twice in this system regularly and that is normal, not a bug.

Or test it without Clay at all:

```bash
curl -sS -X POST https://togari-bma-prod.up.railway.app/replies \
  -H "Authorization: Bearer $REPLIES_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"row_id":"smoke_test_1","campaign":"smoke","thread_id":"<msg-1@test>","from":"someone@prospect.com","sender_account":"rafiq@serif-outreach.com","subject":"Re: quick question","body":"Interesting, can you send pricing?","received_at":"2026-09-11T02:14:02Z"}'
```

Run it twice; expect `201` then `200`.

## Adding another client

Copy this column into that client's Clay table and change two things: the
`client_id` value, and the bearer token if they get their own. Everything else
— the Perplexity account billed, the Slack channel, the voice, the guide the AI
reads — follows from `client_id` through the replybot registry, so there is no
second place to configure and no shared default that could send one client's
prospect into another client's channel.

## The other half: where the draft comes back

Nothing to build in Clay for this, but worth knowing the shape. When Perplexity
finishes, it POSTs to `POST /replies/result` with `Authorization: Bearer
<REPLY_RESULT_TOKEN>` (a different token from the one above — set it in
Perplexity's credential settings at step 10, never in the message text):

```json
{
  "row_id":      "clay_row_8f3a91",
  "category":    "needs_review",
  "confidence":  0.71,
  "draft":       "Happy to help. Pricing depends on seat count...",
  "reasoning":   "Asks about pricing but also mentions a competitor.",
  "session_ref": "pplx_cmp_2f81"
}
```

Togari reads the email back off the `reply_items` row, posts one Slack card, and
moves the row to `done`. A repeat of the same `row_id` returns 200 and posts
nothing. `draft` is absent when the category is `negative`, which is the
documented shape — that card posts for a human look with no Send buttons.
