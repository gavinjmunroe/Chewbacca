# Handling replies to cold email, the way Togari does it

Distilled from `bluemodernadvisory/togari-platform`: the BMA and Zeutara voice
prompts in `src/agents/replybot/client-config.ts`, `docs/ZEUTARA_REPLY_GUIDE.md`,
and `src/agents/smartlead-responder/auto-send.ts`. These rules were tuned on real replies between September and October 2026. Use them whenever Chewbacca classifies a reply, drafts a follow-up, or
decides whether anything may send without a person looking. When the live bot's rules change, resync this file from that repo.

## Direction of the conversation

We sent the cold email, they answered it, and the draft is our follow-up to
their answer. So never thank them for reaching out, never compliment "their"
subject line (any subject line in the thread is ours), and never write as if
they pitched us. This one rule fixed the inverted drafts of 2026-09-02.

## Three categories, pick exactly one

- positive: any forward motion. Wants the deck, a call, an intro, asked a real
  question, "keep me posted", or referred a colleague.
- negative: nothing for a person to do. Clear pass with no opening,
  unsubscribe, stop, hostile, bounce. No draft. Negative replies are discarded
  unseen, so use it only when there's truly nothing to do.
- needs_review: unsure, sensitive, or answering well needs facts you don't
  have. Torn between positive and negative means needs_review. Always write a
  draft for it, because a needs_review with no draft gets dropped.

## The edge cases, already decided

- "Send the deck": include the deck link only if it's in the client's facts,
  character for character. Otherwise say the sender will send it and offer a
  call. Never say it's attached.
- Round size, valuation, terms, traction: answer only from the client's facts;
  anything else is "I'll confirm" or a call. Never estimate.
- Proposes times: confirm one plainly and stop selling.
- "Talk to my colleague": thank them, ask for the intro. Don't draft to the
  colleague.
- "Too early, keep me posted": two sentences, positive.
- Passes on this one but wants other deals in a sector: needs_review, a
  relationship worth a person's look.
- Who are you, are you paid, are you a broker, licensing: needs_review. Never
  mention fees, compensation, success fees or carry. Don't answer licensing at
  all; offer a call.
- Warm-intro-only or "use our portal": needs_review, a person decides.
- NDA, exclusivity, data room: needs_review, the principal follows up.
- Conflict or competing portfolio company: thank them, don't argue.
- Out of office until a date: needs_review with a short note for after their
  return. A reply from anyone at a firm pauses the sequence for that firm, so
  dropping it means nobody ever follows up. Togari's autopilot sends it two
  business days after return, 14:00 UTC, inside 6 to 10am Pacific on weekdays.
- One word ("ok", "thanks"): needs_review, short and neutral.
- Death notices are never automated.

## How the draft sounds

- 3 to 6 sentences for investors, 3 to 8 for BMA's own outbound. Match their
  length and tone.
- Answer the question asked, or say plainly it'll be confirmed. If they want a
  next step, propose one concrete one.
- One idea per paragraph, blank line between them (Jonah's rule).
- Sign off with the bare first name on its own line. No "Best", "Thanks",
  "Cheers".
- No em or en dashes. Togari also strips them in code after drafting, because
  Maggie ruled they read as AI.
- No URLs written by the model. Code strips any the model wrote and injects
  the real link before the sign-off.
- No numbers about the company or round that aren't in the client's facts. No
  promised or implied returns. Never name an investor's portfolio company
  unless their reply named it.
- Banned: "strong fit", "great fit", "synergy", "leverage", "circle back",
  "touch base", "I hope this email finds you well", "reach out", "reaching
  out", "just wanted to", "quick question".
- Across many leads, never name or contrast individual outlets or firms in a
  template; it reads machine-generated (AIJ outreach, `client-config.ts`).
- LinkedIn profiles attached to a recruiting reply are past placements, never
  available candidates.

## When a reply may send with nobody looking

Togari's `autoSendable()` sends unreviewed only when every check passes:

- sentiment is interested or wants more info, and confidence is at or above
  the client's threshold (0.9 for Zeutara);
- the draft is 900 characters or less;
- the draft doesn't promise a file (attach, deck, one-pager, data room);
- no template gaps (brackets, TBD, XX);
- the reply carries no URL, email, phone number, money figure, percent or
  k/m/bn number, which stops an injected reply from steering the draft;
- lead id and campaign id are both present;
- the deterministic intent classifier agrees the reply is basic.

Anything else becomes a Slack card for a person. Chewbacca's own sends stay
behind the user's yes regardless; this list is the bar a fully automated
sender has to clear, and the minimum Chewbacca checks before even suggesting
"send as is".

## What the client sees

These came out of the Zeutara card work on 2026-10-09 and 10-10, after the
client read cards built the other way.

- Show the client only replies that need them. Unsubscribes, forwards and
  out-of-office notices get handled without a card.
- Good news handled automatically still gets one line in the client's channel:
  a referral forwarded, or a real person saying "later". An out-of-office never
  does. `gtme-reply ooo` tells the two apart.
- One primary button per card, plus one way out. A three-button card drew
  "WTF IS THIS SHIT???" from the client.
- Write the primary button for that card: it says send, names the company, and
  says upload when no file is on hand ("Upload and send the Acme deck"). Keep a
  fixed fallback label for when the generated one fails those checks. The way
  out is "Already sent".
- A deck request takes a PDF upload or a link, saved per company so the next
  ask for that company's deck is one tap.
- Clean lead names before they reach a card. A list feeder sent every name
  with a stray trailing "e" for three days ("Gary Zimmermane"), and the client
  read them. `gtme-reply name` strips it only when the email or the batch
  proves it was added, and `gtme-reply names` checks a whole batch.
- An assistant the client talks to only proposes. Every action is a card that
  shows the frozen plan: the exact thread, recipient, full email and link. It
  runs once, from that card, on an approver's tap. If the plan doesn't fit on
  the card, it's refused. Four security reviews broke every shortcut that let
  it act straight from chat or match a name loosely, so never build one that
  does.

## Mailboxes and plumbing

The reply goes out of the same mailbox the lead wrote to, through Clay's
"reply to lead in a campaign" action keyed on lead id plus campaign id. Form
fills have no campaign to reply into, so they need their own Clay table. Clay
webhook URLs are secrets. Slack sections over 3,000 characters are rejected,
so cards clip at 2,900. Full detail: [togari-platform.md](togari-platform.md).
