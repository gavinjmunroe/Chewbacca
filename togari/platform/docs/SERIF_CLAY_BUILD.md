# Serif replybot — the Clay build

Internal. This is the whole build, and it's all in Clay. Arham's only
deliverable is a Perplexity API key.

Order matters: you can't write the request in step 3 until the persona column
in step 2 exists.

## What you're connecting

```
reply lands in the Clay table (already wired)
  → [2] persona column        derive Arham / Whitney / Rafiq from the mailbox
  → [3] HTTP API column       call Perplexity, get back a JSON string
  → [4] HTTP API column       POST that to the replybot
      → Slack card → Arham or Whitney approves
        → replybot POSTs back to Clay [5]
          → [6] reply to lead in a campaign  sends it
```

Steps 3 and 4 are HTTP API columns on the reply table. Steps 5 and 6 are a
second table that our POST writes into.

## 1. Before you start

- **Perplexity API key** from Arham, and the model he settled on (`sonar`
  unless he says otherwise).
- **`REPLYBOT_SERIF_WEBHOOK_SECRET`** — the existing value in Railway, for the
  `X-Replybot-Key` header in step 4.
- **`REPLYBOT_SERIF_CLAY_REPLY_URL`** — set in Railway to the reply webhook
  URL. Already in the local `.env`; confirm it's in Railway too or step 5 fails.
- Confirm the reply table has columns for **lead id** and **campaign id**.
  Everything downstream depends on them and nothing else will substitute.

## 2. Persona column

Add a formula column, `Persona`. It turns the sending mailbox into the name the
prospect has been corresponding with.

Match on the mailbox rather than splitting the local part — local parts vary
(`rafiq`, `rafiq.k`, `r.ahmed`) and a split would silently produce a wrong
signoff:

```
if   lower(Sending Mailbox) contains "rafiq"    then "Rafiq"
elif lower(Sending Mailbox) contains "whitney"  then "Whitney"
else "Arham"
```

Clay's formula editor previews live rows — check all three names appear across
the ~30 mailboxes before moving on. If any mailbox uses a local part that
matches none of these, add a branch; the `else` silently makes it Arham.

## 3. HTTP API column — call Perplexity

Name it `Draft Reply`.

```
POST https://api.perplexity.ai/chat/completions
```

Headers:

| Key | Value |
|---|---|
| `Authorization` | `Bearer <Arham's Perplexity key>` |
| `Content-Type` | `application/json` |

Body — `/Column` marks where you insert a Clay column:

```json
{
  "model": "sonar",
  "temperature": 0.4,
  "messages": [
    {
      "role": "system",
      "content": "You are drafting an email reply on behalf of /Persona at Serif Health. /Persona is warm, direct, and writes like a person, not like AI. Read like a note from a colleague, not a template. Contractions are fine and encouraged (I'm, we're, they've).\n\nYou will be given the original outbound we sent and the inbound reply from the lead. Draft a reply that directly addresses what the lead said, references the original outbound naturally, and moves the conversation forward.\n\nRules:\n- 3-8 sentences. Never longer.\n- Match the lead's tone. If they're casual, be casual. If formal, stay professional.\n- If they asked a question, answer it specifically.\n- If they're interested, propose a concrete next step.\n- If they're not interested, thank them briefly and leave the door open without pushing.\n- Never repeat the original outbound's language verbatim.\n- Do not include any URL, link, or calendar booking link.\n- Never use em dashes or en dashes. Use a comma, a period, or parentheses.\n- Sign off as '/Persona' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just the name.\n- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'\n\nReturn only JSON, no prose around it: {\"sentiment\": \"positive|neutral|negative|ooo\", \"draft_subject\": \"...\", \"draft_body\": \"...\", \"reason\": \"one line on why\"}"
    },
    {
      "role": "user",
      "content": "Persona: /Persona\nProspect: /First Name /Last Name, /Title at /Company\nSubject: /Reply Subject\n\n--- What we sent them ---\n/Sent Email Body\n\n--- Their reply ---\n/Reply Body"
    }
  ]
}
```

**This is where the prompt lives.** Not in Perplexity's app — it's the `system`
message in this request body, sent fresh on every row.

### Where the persona goes

Inside the `content` strings, as inline text. It is not a separate field, and
there is no persona parameter — the name is just part of the sentence.

In Clay you don't type `/Persona` literally. Type `/` in the body editor and a
column picker opens; choose `Persona` and Clay inserts a token. It appears
**four times**, three in the system message and once in the user message:

| Where | The text | Becomes |
|---|---|---|
| system | `on behalf of /Persona at Serif Health` | `on behalf of Rafiq at Serif Health` |
| system | `/Persona is warm, direct` | `Rafiq is warm, direct` |
| system | `Sign off as '/Persona' on its own line` | `Sign off as 'Rafiq' on its own line` |
| user | `Persona: /Persona` | `Persona: Rafiq` |

The last one matters even though the system message already names the persona:
it puts the name in the same message as the reply being answered, which is
where models look hardest.

So for a reply that came into `rafiq@serif-outreach.com`, the system message
Perplexity actually receives opens:

> You are drafting an email reply on behalf of Rafiq at Serif Health. Rafiq is
> warm, direct, and writes like a person, not like AI.

and a reply into a Whitney mailbox says Whitney instead, on the same row-by-row
basis. Nothing is hardcoded and nobody picks it per reply.

Column names above are placeholders; swap in whatever yours are actually called.

Run it on one row and check the response contains `choices[0].message.content`.

## 4. HTTP API column — POST to the replybot

This column may already exist. If so, add the fields below rather than making a
second one.

```
POST https://togari-bma-prod.up.railway.app/replybot/serif/webhook
```

Headers:

| Key | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Replybot-Key` | `<REPLYBOT_SERIF_WEBHOOK_SECRET>` |

Body:

```json
{
  "to_email":          "/Email",
  "to_name":           "/First Name /Last Name",
  "company_name":      "/Company",
  "lead_title":        "/Title",
  "campaign_name":     "/Campaign Name",
  "subject":           "/Reply Subject",
  "text":              "/Reply Body",
  "original_outbound": "/Sent Email Body",
  "message_id":        "/Message ID",
  "from_email":        "/Sending Mailbox",
  "lead_id":           "/Lead ID",
  "campaign_id":       "/Campaign ID",
  "draft_json":        "/Draft Reply.choices[0].message.content"
}
```

`draft_json` is the whole point: pass Perplexity's raw output string straight
through and the replybot parses it. **Don't build formula columns to split out
sentiment and draft_body** — it handles code fences and stray preamble, and if
the JSON is ever unparseable it says so in the logs rather than posting a blank
draft.

`lead_id` and `campaign_id` are the ones to get right. Without them the Slack
card still posts but Send fails, deliberately, rather than sending from the
wrong mailbox.

Expect `{"status":"ok"}` and a card in the Serif channel within a few seconds.

## 5. The table our reply POSTs into

When someone approves in Slack, we POST to
`REPLYBOT_SERIF_CLAY_REPLY_URL`, which is a Clay source webhook, so each
approved reply arrives as a **row in a table**. Send one test approval so Clay
creates the columns:

| Field | What it is |
|---|---|
| `lead_id` | keys the reply-to-lead action |
| `campaign_id` | keys the reply-to-lead action |
| `email` | the prospect |
| `subject` | subject as approved |
| `body` | the reply as approved, including any edits |
| `in_reply_to` | prospect's Message-ID, for threading |
| `client_id` | always `serif` |

## 6. Reply to lead in a campaign

On that second table, add the **reply to lead in a campaign** column. Point its
lead id at `lead_id` and campaign id at `campaign_id`, and the message body at
`body`.

This is what makes the whole persona problem go away: it sends from the
campaign's own mailbox, so a reply into Rafiq's inbox goes back out of Rafiq's
inbox signed *Rafiq*.

**If this column wants different field names than the seven above**, tell me and
I'll change what we POST — `sendViaClay` in
`src/agents/smartlead-responder/slack-actions.ts` is the only place it's built.

## 7. Test before real replies flow

Use a prospect address you control, because approving in Slack sends for real.

1. Drop a test row into the reply table with a real-looking reply, a lead id,
   and a campaign id.
2. Check `Persona` resolved to the right name.
3. Check `Draft Reply` came back with clean JSON, no links, no em dashes.
4. Check the Slack card posted, and that `Replied to:` shows the test mailbox.
5. Approve it. Confirm a row appears in the second table and the reply actually
   arrives from the sending mailbox, not from `@serifhealth.com`.

Step 5 is the one worth doing carefully — everything before it is visible in
Clay, and it's the only part that touches a real prospect.
