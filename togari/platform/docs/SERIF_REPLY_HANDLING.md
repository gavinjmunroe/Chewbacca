# Serif Health — how Arham and Whitney answer replies

**Audience:** Arham and Whitney.
**Short version:** Slack shows you every reply worth answering, with a draft
already written. Read it, fix it if it needs fixing, hit Send. The reply goes
out from the same mailbox and under the same name the prospect wrote to. You
never log in to an email account for any of this.

## Why it works this way

Serif's cold email goes out from about **30 mailboxes** provisioned through
Smartsenders on separate sending domains, under three names: **Arham**,
**Whitney**, and **Rafiq**. The spread is what keeps cold volume away from
`serifhealth.com`'s reputation. It also means there's no single inbox to sit in
— a reply lands in whichever of the 30 mailboxes sent to it.

So the flow inverts. The bot watches all of them, Slack becomes the one inbox
you open, and when you approve a reply it goes back out through Clay from the
original mailbox. From the prospect's side nothing looks unusual: same address,
same name, same thread.

## The daily flow

1. **Slack is the queue.** Every reply worth answering posts as a card in the
   Serif channel, showing the prospect's message and a drafted response. Website
   form-fills post to the same channel; the card layout tells them apart.
   - *Send-ready card* — the prospect is interested or asking questions.
   - *Manual review card* — a no, or something the model couldn't place. Worth
     a glance; a soft no is often worth a human reply.
   - Out-of-office replies never post. That's intentional.
2. **Read the draft properly.** Perplexity wrote it and nobody has checked it.
   The card says who it will go out as — check that line.
3. **Send it.**
   - **Send as-is** — posts a confirmation in the thread, then Confirm & Send.
   - **Edit & Send** — opens the draft in a box, rewrite it, send.

   Anyone in the channel can click these. There's no approver list, so neither
   of you is ever blocked waiting on the other — and a stray click sends a real
   email.
4. **Claim it in the thread** so you don't both answer the same person.

## Who takes what

Every card shows the mailbox the reply came into, on the `Campaign:` line as
`Replied to:`. That line is the assignment.

- **Arham mailbox** → Arham.
- **Whitney mailbox** → Whitney.
- **Rafiq mailbox** → either of you. Claim it in the thread first.

Rafiq is a real person here and the outbound genuinely goes out from him, but
he isn't answering any of it. That's fine and needs no explaining to the
prospect: the reply still leaves from Rafiq's mailbox signed *Rafiq*, because
that's who they've been corresponding with. **Leave the signoff alone.** You're
approving on his behalf, not taking the thread over under your own name.

Whoever picks up a thread owns it through to the meeting or the dead end.

## What happens after you hit Send

Clay sends the reply from the original mailbox, threaded under the prospect's
message. Their next reply comes back into that same mailbox, through the same
pipeline, and posts to Slack as a new card. So the whole conversation stays in
Slack rather than scattering into inboxes none of you watch.

If a thread reaches the point where it should move to your real address — a
call is booked, it's a live opportunity — say so in the reply ("moving us to my
main address") and carry on from your own `@serifhealth.com` inbox. After that
the bot is out of it.

## No links in drafts

Drafts contain no URLs, including the demo Calendly link. If a thread is ready
to book a time, paste the right link in yourself when you edit the draft. This
is deliberate: a model asked to write a URL invents a plausible one that goes
nowhere.

## When something looks wrong

If a draft says something inaccurate about Serif's data or pricing, don't just
fix it in the email and move on — flag it to Maggie. The prompt that produced it
will produce it again on the next twenty replies. Same for a reply categorized
badly, or a prospect who reached Slack who shouldn't have.

If **Send fails**, the card will say so. The usual cause is a reply that reached
us without its Clay lead and campaign ids, which are what Clay needs to send
from the right mailbox. It fails rather than quietly sending from somewhere
else. Tell Maggie; don't retry.
