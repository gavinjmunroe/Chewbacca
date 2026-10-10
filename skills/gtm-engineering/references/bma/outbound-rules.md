# Outbound rules: volume, copy, calls, briefs and onboarding

Synced from togari-platform 0b7d51d and togari-sandbox adace00.

The hard limits and review gates for cold outbound. Apply them when planning a
campaign, writing or reviewing copy, building a call script, preparing a
meeting, or onboarding a new client. Reply handling lives in
[reply-handling.md](reply-handling.md); scoring and the signal HOLD rule live in
[scoring.md](scoring.md).

## Send volume and warmup

| Rule                                   | Value                                         |
| -------------------------------------- | --------------------------------------------- |
| Cold emails per inbox per day          | 40 max                                        |
| Cold emails per sending domain per day | 200 max                                       |
| Send days                              | Tuesday, Wednesday, Thursday                  |
| Never send                             | Friday, Saturday, Sunday, Monday              |
| Send window                            | 8 to 11am in the recipient's timezone         |
| Minimum warmup before full volume      | 4 weeks                                       |
| Warmup ramp, sends per inbox per day   | week 1: 5, week 2: 10, week 3: 20, week 4: 40 |

- Send from domains separate from the company's primary domain, so a
  deliverability hit never lands on the main brand.
- Automated reply follow-ups use their own window: weekdays, 6 to 10am Pacific.
- These are house defaults. Check them against the cold-email playbook numbers
  in team memory before promising a client a volume.

## Channel character limits

| Channel        | Hard max                           | Working rule                                                                                                      |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Cold email     | 900 characters, 40 a day per inbox | Under 150 words ideal, under 90 for a first touch. No images (deliverability risk).                               |
| Warm email     | 2,000 characters                   | Can run longer than cold, still one CTA.                                                                          |
| LinkedIn DM    | 8,000 characters                   | Keep cold outreach under 300 characters. Longer means fewer replies.                                              |
| LinkedIn post  | 3,000 characters                   | Only the first 210 show before "see more"; the hook must land there. Max 5 hashtags, 10 mentions, 20 media items. |
| Instagram post | 2,200 characters                   | First 125 show before the fold. Max 30 hashtags, ideally in the first comment. 10 media items.                    |
| Instagram DM   | 1,000 characters                   |                                                                                                                   |
| X post         | 280 characters per post            | Max 3 hashtags, 4 media items, no native carousel.                                                                |
| iMessage       | 20,000 characters                  | No real limit; keep it to texting length.                                                                         |

## Compliance

- Every cold email carries a plain-text unsubscribe option and a physical
  address in the footer (CAN-SPAM).
- "Remove me" or "not interested" means remove immediately. No follow-up, ever.
- Source lead data from compliant vendors (Clay, Apollo, Sales Navigator). No
  scraped personal data without a consent basis.
- In healthcare work, never send patient data (PHI) in any email. Sell market
  intelligence, and keep that line visible.
- Check the do-not-contact list before every send, keyed on email, domain and
  record id.

## Persona-matched cold email

Write each email for one named persona with a hard word cap. The caps are
enforced, not suggested. The pattern from a healthcare data campaign:

| Persona                                             | Word cap | Tone                                                                      | Subject formula                                    | Example subject                                                   |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| VP of revenue operations (250 to 2,000 staff)       | 120      | Peer to peer, direct, short. One thing we noticed, one artifact, one CTA. | [specific thing we noticed] + [direct implication] | "Your Epic integration rollout, and the targeting gap it creates" |
| Head of strategy (500 to 5,000 staff)               | 150      | Strategic, slightly longer, shows real homework on their position.        | [market move they're about to make] + [data angle] | "The Medicare Advantage whitespace in your Q3 expansion targets"  |
| CCO at a seed to Series A startup (30 to 200 staff) | 90       | Extremely short, direct, confident.                                       | [specific segment] + [specific shortcut]           | "5 behavioral health payers worth calling this week"              |

Body structures, one line each:

- **Ops persona:** the specific thing we noticed (the signal, personalised);
  what it implies for their data problem; what we do in one sentence; the
  specific artifact offer; a soft CTA such as "Worth a quick look?"
- **Strategy persona:** acknowledge the strategic move they signalled publicly;
  connect it to the data question they're probably asking; what we can answer
  about that question; the artifact (a market map for their expansion
  segment); a soft CTA.
- **Startup persona:** we built something for your segment; what it is in one
  sentence; why it matters to them, with one data point; "Want it?", literally
  that short.

For each persona also write down its pain, its fear, what a win looks like, and
the signal that moves it. Match the sender to the persona: the founder for
strategy buyers, the practitioner for operators.

**Offers are artifacts, never meetings.** A top-5 target list, a market map,
or a competitive-signals brief. The email offers the thing; the meeting comes
after they want it.

## Absolute prohibitions in cold email

Any of these fails the email:

- No list of our features.
- No ask for a 30-minute call in the first email.
- No generic opener about ourselves.
- No fear-based language, and no urgency that isn't real.
- No more than one CTA.
- Don't start with "I" (applies to posts too).
- Count the words. Over the cap, cut what isn't pulling weight.

**The banned-phrase blacklist** (quoted data, matched case-insensitively):

- "I hope this email finds you well"
- "We work with companies like yours"
- "synergy", "synergies"
- "leverage" (as a verb)
- "ecosystem" (without specifics)
- "exciting" (describing our own work)
- "I wanted to reach out"
- "Just following up"
- "Quick question"
- "Do you have 15 minutes"
- "I'd love to pick your brain"

**Fear-based phrases** that fail any channel: "you're falling behind", "your
competitors are", "don't miss out", "last chance", "urgent", "act now",
"limited time".

Reply drafts carry their own banned list in
[reply-handling.md](reply-handling.md).

## The 7-point review before an email is approved

A human (or a gate) answers each one yes before the email is scheduled:

1. Does the first line reference something specific about this company?
2. Is the signal specific and recent? (Score 6 or higher, see
   [scoring.md](scoring.md).)
3. Does it sound like the named sender actually wrote it?
4. Is the offer a specific artifact, not a vague meeting ask?
5. Is it within the persona's word cap?
6. Does it ask for one thing and only one thing?
7. Is there nothing in it that would make a reasonable person feel
   manipulated?

Draft states: drafted, approved, revision needed (with notes), scheduled,
sent. Track a campaign id and an A/B/C variant label on every draft.

## Cold-call scripts

Rules for a cold-call script, in priority order:

1. Warm and brief, with real cadence and contractions. Never aggressive or
   salesy. None of: "synergy", "leverage", "circle back", "touch base", "I
   hope this finds you well".
2. The opener runs about 8 seconds spoken, roughly 25 words. It names the firm,
   names the why-now tied to a real signal, and earns the next 30 seconds.
   Never open with "How are you doing today". With no signal, anchor on fit.
3. Three to five open qualifying questions specific to the buyer's context.
4. Four to six objection handlers: acknowledge, redirect to value, never argue.
   Always cover "not interested", "we already have a buyer" (or vendor),
   "send me an email", and "where did you get my number".
5. The meeting ask is for **15 minutes**, with specific day and time framing.
   Never "a quick chat".
6. Close by thanking them by first name and confirming the next step.

Three call types change the framing: a cold intro (they don't know us), a
follow-up after unanswered outreach (reference the prior note briefly), and
discovery (they agreed to meet, go deeper on fit).

## Pre-meeting brief

Deliver it 24 hours before the meeting. It should read like you've known the
prospect for weeks: a human picture, not a CRM dump. Eleven sections, in order:

1. **Who they are.** Three or four sentences, as if introducing them to a
   friend. What they care about, what drives them, their situation right now,
   anything personal they've shared.
2. **Why we're in this room.** The exact why-now signal that triggered
   outreach, in plain English, one paragraph.
3. **What's been said.** The whole thread: what we sent, what they said, the
   tone, what interested them, what they doubted.
4. **What they care most about.** The one thing that matters most to this
   person in this meeting. What they want out of it, not what we want to say.
5. **The one goal.** One specific, measurable sentence. Never "explore
   synergies" or "build relationship". Example shape: confirm whether their VP
   of Sales would value a live demo of the list we built for their segment, and
   get a commitment on who else joins the next call.
6. **Data to reference.** The most relevant asset, how to introduce it
   naturally, and what to show if they ask.
7. **The proof point to lead with**, and how to tell it in 90 seconds.
8. **Likely questions.** At least three, with specific answers. The third is a
   skeptical or objection question.
9. **Role briefings.** For each person attending: your job is X, watch for Y,
   if Z happens do W.
10. **What success looks like when we hang up.** Best, good and acceptable,
    each specific and measurable.
11. **Partnership flag.** Yes or no, with the angle if yes.

## Onboarding a new client

**Look before you ask.** Most answers already exist. Before asking the client
or the team anything, search:

- Slack, for the client's name: their shared channel, who their people are
  (external members), the sending mailboxes, the sending tool, launch status.
- Meeting notes and transcripts, for the client's name: what the outreach is
  for, persona and sender rules, who pays for which tool seat.
- The repo or config, for any existing entry.

**Then ask at most 4 questions, in one batch**, and only for what's still
unknown. The usual four:

| Decision                                | Options                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Can the sending tool send replies back? | intake and send (default), intake only, unknown                                  |
| Who can press Send?                     | anyone in the channel, named approvers, nobody (notify only)                     |
| Where do approval cards live?           | a channel in our workspace shared with the client, or the client's own workspace |
| Whose account pays for the AI drafting? | the client's seat (default), ours for now                                        |

Gather these as inputs, not as questions: client id, display name, sender name
and mailbox, sign-off names and which mailbox maps to which, timezone, what the
outreach offers and to whom, and the list of offers if there are several.

**Every new client gets a reply guide** the drafting model reads: what the
outreach is, one block per offer, the decided edge cases for their world, which
mailbox signs as which name, and voice. Never label a soft no "negative" in the
guide: negatives are discarded unseen, so anything with an opening must go to
review.

**Go-live order:** smoke-test with a test client id (don't press Send), then an
end-to-end test from an inbox you control (check it threads from the same
mailbox), then switch to the live id and re-run on replies that arrived since
launch.

## Coded once versus configured per client

Code the engine and the verbs once; each client's nouns are data rows. A new
client should be set up by writing rows, never by shipping a deploy.

**The three-question test** when unsure:

1. If every client would want it, code it; if only this one would, configure
   it.
2. If getting it wrong for one client could break another, code it, because
   it's shared safety like do-not-contact enforcement; otherwise configure it.
3. If it's a noun this client tracks, configure it; if it's a verb that acts on
   things, code it.

- **Coded once:** ingestion, AI structuring of raw input into entities, the
  shared entities (contacts, companies, deals, activities), Clay both ways,
  do-not-contact enforcement, pipeline mechanics, the custom-field engine, the
  provisioning engine, tenancy and audit.
- **Configured per client:** pipelines and their stages, the data points they
  track (an agency tracks outlet, journalist, angle, embargo date; a PE client
  tracks EBITDA, sector, thesis fit), which features they use, their own
  do-not-contact list, their own tool accounts and keys.
- If onboarding a client needs new code, the engine is missing an abstraction.
  Fix the engine, don't fork it.
- Only the points where a client actually touches the system get an interface:
  onboarding, do-not-contact submission, approving outbound, uploading data,
  and seeing their status. Sourcing, scoring, outreach and meeting capture stay
  internal.
