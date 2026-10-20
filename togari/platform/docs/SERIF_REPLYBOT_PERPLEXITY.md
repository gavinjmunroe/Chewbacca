# Serif — Perplexity setup for cold-email reply drafting

**For:** Arham.
**What you're setting up:** the piece that reads each cold-email reply, decides
whether it's positive, and writes the draft response. That's it. Everything
around it — the mailboxes, Slack, and actually sending the reply — is already
wired and needs nothing from you.

When you're done, replies show up in Slack with a draft ready to approve, and
the approved reply goes back out from the same mailbox the prospect wrote to.

## This runs by itself. You are not in the loop.

Worth saying plainly, because the curl at the bottom can give the wrong
impression: **nobody types anything per reply.**

Clay already collects every reply across Serif's sending inboxes. When a reply
lands, Clay calls the Perplexity API automatically with your prompt, takes the
answer, and moves on. That happens per reply, around the clock, with no human
and nothing running on your side.

We're deliberately *not* using Perplexity's agent product for this. An agent
would have to watch the mailboxes and run on its own schedule; the API is
simpler and fires exactly when Clay has a reply to hand it. So there's no agent
to build, no workspace to keep open, and nothing to babysit.

What you're delivering is a **prompt and an API key**. Once they're in, you're
done, and you never touch this again:

1. A **Perplexity API key**.
2. Confirmation of the **model name** you want used.
3. The **final prompt**, if you change it from the one below.

## 1. Get an API key

In your Perplexity account, go to **Settings → API**, add billing, and generate
a key. Pro includes a small monthly API credit; past that it's usage-based, and
it bills to whatever card is on that account. This is the intended outcome —
the drafting spend sits with Serif rather than with us.

Copy the key somewhere safe and send it over separately, not in a doc or a
shared channel.

## 2. Confirm the model

Perplexity's chat-completions API is OpenAI-compatible. As of writing the
relevant models are `sonar` (fast, cheap) and `sonar-pro` (stronger reasoning,
more expensive). Check what's actually listed in your account, since the lineup
changes, and tell us which one you want.

For this job `sonar` is usually enough — the input is one email thread and the
output is a short reply. `sonar-pro` is worth it if you want the draft to lean
on Perplexity's search, e.g. referencing something current about the prospect's
health system or payer.

## 3. The request Clay will make (automatically)

This is what fires per reply, built and sent by Clay. You don't configure it,
host it, or trigger it. It's here only so you can see exactly what your prompt
will be handed at runtime.

```
POST https://api.perplexity.ai/chat/completions
Authorization: Bearer <your Perplexity API key>
Content-Type: application/json
```

```json
{
  "model": "sonar",
  "temperature": 0.4,
  "messages": [
    { "role": "system", "content": "<the system prompt in section 4>" },
    { "role": "user", "content": "Persona: Rafiq\nProspect: Dana Reyes, CFO at Example Health\nSubject: Re: payer rate data\n\n--- What we sent them ---\nHi Dana, we give health systems the negotiated rate data behind price transparency...\n\n--- Their reply ---\nInteresting, can you send pricing?" }
  ]
}
```

The reply comes back in `choices[0].message.content` as a JSON string, which
Clay parses into columns.

## 4. The system prompt

This is the part that's yours to get right. To be clear about where it ends up:
**you don't paste this into Perplexity anywhere.** It's sent as the `system`
message in the request above, on every single reply, and we put it there. Your
job is to tell us the wording you want.

It's the current drafting prompt, so the voice stays continuous with what's
already gone out. `{{PERSONA}}` is filled in automatically per reply — see
below.

> You are drafting an email reply on behalf of {{PERSONA}} at Serif Health.
> {{PERSONA}} is warm, direct, and writes like a person — not like AI. Read like
> a note from a colleague, not a template. Contractions are fine and encouraged
> (I'm, we're, they've).
>
> You will be given the original outbound we sent, the inbound reply from the
> lead, and context about the campaign. Draft a reply that directly addresses
> what the lead said, references the original outbound naturally, and moves the
> conversation forward.
>
> Rules:
> - 3-8 sentences. Never longer.
> - Match the lead's tone. If they're casual, be casual. If formal, stay professional.
> - If they asked a question, answer it specifically.
> - If they're interested, propose a concrete next step (a time to talk, a specific resource).
> - If they're not interested, thank them briefly and leave the door open without pushing.
> - Never repeat the original outbound's language verbatim.
> - Do not include any URL, link, or calendar booking link.
> - Never use em dashes or en dashes. Use a comma, a period, or parentheses.
> - Sign off as '{{PERSONA}}' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just the name.
> - Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,'
>   'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,'
>   'just wanted to,' 'quick question.'
>
> Return only JSON, no prose around it:
> {"sentiment": "positive|neutral|negative|ooo", "draft_subject": "...", "draft_body": "...", "reason": "one line on why you categorized it that way"}

### Personas — the one thing to get right

Serif's outbound runs under three names: **Arham**, **Whitney**, and **Rafiq**.
The prospect has been corresponding with one of them, and the reply goes back
out of that same mailbox, so it has to carry that same name.

`{{PERSONA}}` is not something anyone types. Every one of the ~30 sending
mailboxes belongs to one of the three names, so we read the name off the mailbox
the reply came into and substitute it before the request goes out. A reply into a
Rafiq mailbox gets a draft signed *Rafiq*, automatically.

Getting this wrong is the most jarring thing that can happen to a prospect here:
they wrote to one person and a different name answers. So if you rewrite the
prompt, keep `{{PERSONA}}` exactly as written wherever the name should appear —
don't hardcode your own name in it.

### Categories

`sentiment` decides what happens next, so it matters more than the prose:

| Value | What happens |
|---|---|
| `positive` | Draft posts to Slack, ready to approve and send |
| `neutral` | Same — treated as "wants more info" |
| `negative` | Posts to Slack for a human look, nothing auto-sends |
| `ooo` | Dropped. Never reaches anyone |

Out-of-office, unsubscribes, and do-not-contact should come back as `ooo` or
`negative` — don't write drafts for them.

### Two rules worth repeating

1. **No em dashes.** One em dash makes a whole email read as AI-written. It's in
   the prompt, but models slip, so it's worth checking your test outputs.
2. **No links, including Calendly.** A model asked to write a URL invents a
   plausible one that goes nowhere. Whoever approves the reply pastes a real
   link in if the thread needs one.

## 5. Sanity-check your prompt once, then forget it

This curl is a **one-off, for you, while you're tuning the wording**. It is not
part of the live flow and nobody runs it again once the prompt is settled.

```bash
curl -sS https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer <your key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar",
    "temperature": 0.4,
    "messages": [
      { "role": "system", "content": "<paste the system prompt, with {{PERSONA}} replaced by Rafiq>" },
      { "role": "user", "content": "Persona: Rafiq\nProspect: Dana Reyes, CFO at Example Health\nSubject: Re: payer rate data\n\n--- What we sent them ---\nHi Dana, we give health systems the negotiated rate data behind price transparency and where they are underpaid.\n\n--- Their reply ---\nInteresting, can you send pricing?" }
    ]
  }'
```

You're looking for clean JSON with `"sentiment": "positive"`, a draft of three
to eight sentences signed *Rafiq*, no links, and no em dashes. Run it a few
times with different replies — a flat no, a "wrong person," an out-of-office —
and check the categories come back sensibly.

Once it reads the way you want, send over the key, the model name, and the final
prompt if you changed it.
