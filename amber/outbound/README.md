# Amber outbound

Answer to Sagar's 9/17 ask: three email sequences for three ICPs in his voice, a
strategy for getting them out the door, and the Clay workbook they run in.

Built on Sagar's own six-variable framework from the Blue Modern outbound review,
because the point is that anyone on the team can rebuild a campaign from the same
six answers inside 24 hours.

---

## The six variables, answered once

Three internal, three external. The internal ones are fixed across all three
campaigns. The external ones are what change per ICP.

### Internal

**Persona.** Sagar. Every one of the ten Amber inboxes sends as him, not as a
team or a brand. The authority claim in his own words: four years building GTM
engines for warm-relationship businesses, an official Clay partnership and the
Clay LA lead, McKinsey before that, Stanford GSB now. That stack is what makes
the finding in email one credible instead of cute.

**Pricing.** $1,000 for the warm intelligence engagement on the two B2B
campaigns. Consumer pricing on campaign three is unset and is Sagar's call, see
the open questions at the bottom.

**Packaging.** What the $1,000 buys, fixed so it can be sold the same way twice:

- 45 minutes, they install it on their own machine on a screenshare. Data never
  leaves their laptop.
- Imports run live: texts, contacts, LinkedIn export.
- A written audit: who they have gone quiet on, who reached out first and never
  got an answer, who changed jobs, who is geographically near them, who sits in
  their group chats and has never been messaged one to one, and an honest list of
  what it could not answer yet.
- A 30 minute follow-up a week later.

### External

| | Campaign 1 | Campaign 2 | Campaign 3 |
|---|---|---|---|
| Shape | B2B | B2B | Consumer |
| Product sold | local Chewbacca | local Chewbacca | hosted Amber, on a phone |
| Accounts | US funds, fund I to III, sub $100M, closed in the last 12 months | Founder-led advisory, agency, search and boutique consulting firms, 5 to 50 people | Organizers of recurring in-person gatherings: run clubs, supper clubs, retreats, small groups |
| Targets | General, Managing and Founding Partners only | The founder, plus whoever owns BD | The one person running the group |
| Signal | A close is announced, or a new partner joins | They post a BD, partnerships or account executive role | They announce a new season, series or next event |
| Channel | Amber inboxes, corporate email | Amber inboxes, corporate email | Amber inboxes, personal email, needs enrichment |

Campaign 2 is the one that fits Sagar's own written carve-out most exactly: a
founder-led services shop is a warm-relationship business, where the game is
retention, referral and the second call, and none of that is a volume problem.

**Campaign 3 is a different product, not just a different audience.** Chewbacca
answers at your desk after the fact. Hosted Amber answers on your phone in the
moment, while you are standing in front of the person. C3 targets only people who
fail the first test: their relationship work happens in a room, away from a
computer, so local software is useless to them. Anyone who can wait until they
are back at a laptop belongs in C1 or C2.

---

## Strategy: how this gets out the door

### The signal is the message

Not ICP build and copy as two jobs. One account list per campaign, and every
send is triggered by something that just happened to that account. A fund that
closed last week and a fund that closed eleven months ago get different email
one, off the same list.

### The warm filter, which is the Amber dogfood

Sagar asked for a column in each Clay experiment that pulls his warm
relationships out and surfaces personalization through Amber. That column already
exists and it is the reason this is worth doing under the Amber name at all.

The local store holds **3,349 people, 2,241 of them carrying a LinkedIn URL**,
with 9,658 observations and 3,762 logged interactions behind them. The LinkedIn
URL is the join key. The table is built and exports clean at **2,241 rows, 1,299
tagged as already known**. Any Clay account list gets matched against it, and
every row comes back tagged:

- **Known.** Already talked to them. They never enter the sequence. They get a
  text from Sagar or Caleb, with the last thing actually discussed attached.
- **Second degree.** A specific mutual exists and gets named in email one.
- **Cold.** Runs the sequence as written.

Two things fall out of that. The suppression list stops the campaign from cold
emailing 1,299 people who are already known, which is the single most expensive
mistake available here. And the second-degree tag is the personalization,
produced from data nobody else sending to that list has.

One correction on the ask, because it matters for what gets built. This table is
Caleb's store, so today it filters Caleb's relationships, not Sagar's. Same
column, different data. Sagar's version comes from running the install once on
his own machine, which is the same 45 minutes campaigns 1 and 2 are selling. So
the first engagement is his, and its output is the column he asked for.

### The ramp, so the inboxes survive

Sagar's number is 200 a day across ten Amber inboxes. That is 20 per inbox per
day, which is a safe steady state for an aged inbox and roughly four times over
the line for a new one. New domains are sent at 5 to 15 per inbox per day for the
first thirty days, and a volume spike is the most common single cause of a domain
getting flagged.

So the same 200 ceiling, reached on a ramp instead of on day one:

| | Per inbox per day | Total per day |
|---|---|---|
| Week 1 | 5 | 50 |
| Week 2 | 8 | 80 |
| Week 3 | 12 | 120 |
| Week 4 | 16 | 160 |
| Week 5 on | 20 | 200 |

Non-negotiables before the first send: SPF, DKIM and DMARC on every Amber domain,
one-click unsubscribe, and never double a day's volume against the day before.

### What runs forever

The ask was something that is always running, and there is no reason for it not
to be. So: one account list per campaign, built once. Signals re-scan it on a
schedule. A target leaves the list only on a reply or a do-not-contact. Nothing
gets rebuilt, the signals just keep firing against the same accounts.

### Sequence shape

Four touches over twelve days, every one under ninety words.

1. **Day 0.** The trigger, and one true thing about them.
2. **Day 3.** The mechanism, in one paragraph.
3. **Day 8.** An asset, either the demo video or a sample audit.
4. **Day 12.** Permission to close the file.

---

## The first four weeks

- **Week 1.** Domains authenticated and warming. Three account lists built in
  Clay. Warm filter joined against all three. Sending at 50 a day.
- **Week 2.** First replies read, subject lines are the only thing changed. 80 a
  day.
- **Week 3.** Whichever campaign has the best reply rate gets a second signal
  added. 120 a day.
- **Week 4.** First paid engagements. 160 a day, 200 from week five.

Honest ceiling on delivery: Caleb is carrying 18 units, so two engagements a week
is the real cap while he runs them himself. Whether that stays true is the
scaling question in the open items below.

---

## Files

- [CAMPAIGNS.md](CAMPAIGNS.md) - all three specs side by side
- [clay/WORKBOOK.md](clay/WORKBOOK.md)

## Open, and not guessed at

1. **Consumer pricing on campaign 3.** Unset. Sagar's call.
1. **Is hosted Amber reachable from a phone yet?** C3 promises it and cannot
   send before it is real. C1 and C2 sell local Chewbacca and do not depend on
   it, so they can launch first either way. One question for Karthik.
2. **Are the ten Amber domains already sending?** If they have history, the ramp
   collapses to a week. If they are new, it is five weeks. Changes the whole
   first month.
3. **Delivery at scale.** Caleb runs every engagement himself at two a week, or
   TTS people get trained on the install and he only writes the audits. Capped
   revenue against something that scales, and it should get decided before the
   packaging is built around one answer.

Numbers in this repo come from the local store and from Sagar's own messages.
Anything unsourced is marked and left unsourced rather than filled in.

All glory to God! ✝️❤️
