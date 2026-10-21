# The three campaigns

Each one is a machine: a list query, a trigger that fires, and a small set of
merge fields. Nothing is hand-picked. Every row that satisfies the query and has
a fresh trigger sends automatically.

---

## Side by side

The three are not three audiences for the same email. They are three different
questions, which is why they need three lists.

| | **C1** | **C2** | **C3** |
|---|---|---|---|
| Who | Partners at brand-new funds | Founders of services firms, 5-50 | People who run recurring in-person gatherings |
| Shape | B2B | B2B | Consumer |
| **Fires on** | fund close announced | they post a BD or partnerships role | they announce a season, series or next event |
| **The question it sells** | "which founders I met have since raised" | "who went quiet" | "who is this, right now, in front of me" |
| Direction | forward, deal flow | backward, recover revenue | live, mid-event |
| Merge fields | 4 | 3 | 3 |
| Email enrichment | corporate, cheap | corporate, cheap | **personal, costs credits** |
| Product | local Chewbacca | local Chewbacca | **hosted Amber, phone** |
| Share of 200/day | 80 | 80 | 40 |

If an email from one campaign could be pasted into another, it is written wrong.

### Said out loud

**C1.** General and Managing Partners at sub-$100M funds that just announced a
close, because raising the fund is exactly what filled their phone with founders,
and the day it closes those founders stop being people they pitched and start
being deal flow, and every close gets announced publicly so there are hundreds
of them a year.

**C2.** Founders of services firms between 5 and 50 people that just posted a
business development role, because hiring for BD is the moment they find out the
pipeline was never a pipeline, it was their own memory, and now somebody else is
supposed to run it, and every firm posts that role publicly the moment they are
ready to spend.

**C3.** People who run recurring in-person gatherings, run clubs and supper clubs
and retreats and church groups, because they meet a room full of new faces every
single week and they are on their phone the whole time and never at a laptop, so
local software is useless to them and it has to be hosted, and there is basically
an endless supply because every one of these groups has exactly one person doing
this job.

The repeatability is the same in all three: **the trigger is public, so the list
refills itself.**

---

## C1: partners at brand-new funds

```
LIST      Clay > Find People
          title contains  GP | General Partner | Managing Partner | Founding Partner
          at companies where industry = venture capital, headcount 1-20
          exclude titles  Associate | Principal | Analyst | Platform
CUT       associates feel it daily and cannot spend

FIRES ON  fund close announced, < 90 days old
          source: SEC Form D + fund announcement feeds, re-scanned weekly

MERGE     {fund}  {fund_size}  {month}  {prior_firm}
          all four are free off the announcement. no enrichment cost.

VOLUME    80 of the 200/day
```

**Email 1**

> **Subject:** {prior_firm}, {fund} fund I, one question
>
> hey {first_name},
>
> saw {fund} closed {fund_size} in {month}. first fund out of the gate after
> {prior_firm}.
>
> here's the question I'd want answered in your seat: of every founder you met
> while raising, which ones have since raised themselves? that's your best deal
> flow and it's sitting in your phone in a format nobody can query.
>
> spent four years building GTM engines for warm-relationship businesses. built
> the thing that answers it. runs on your laptop, reads your own messages, no
> server and no account on our side.
>
> 20 minutes?
>
> Sagar

---

## C2: founders of services firms

The shape Sagar's own doctrine calls a warm-relationship business, where the
game is retention, referral and the second call.

```
LIST      Clay > Find Companies
          industry  management consulting | marketing & advertising |
                    staffing & recruiting | business consulting
          headcount 5-50, US
          then Find People, title contains Founder | CEO | Managing Partner
          plus whoever holds a BD title at the same company

FIRES ON  they post a role matching
          business development | partnerships | account executive | BD
          source: their own careers page + job boards, re-scanned weekly

MERGE     {company}  {role_title}  {role_posted_date}
          {role_title} is copied verbatim from their post. that verbatim copy
          is most of the personalization.

VOLUME    80 of the 200/day
```

**Email 1**

> **Subject:** the {role_title} hire and the handoff
>
> hey {first_name},
>
> saw {company} is hiring a {role_title}.
>
> every founder-led firm hits the same wall there. the pipeline was never a
> pipeline, it was your memory, and now someone else is supposed to run it. the
> CRM doesn't help, it has stage names in it, not the reason a client came back.
>
> the specific thing I'd hand you first: every client and referral source you
> were close to a year ago and haven't spoken to since, ranked by how warm it
> used to be. for a firm your size that list is usually where the next two
> engagements are.
>
> 20 minutes?
>
> Sagar

---

## C3: people who run recurring in-person gatherings

The consumer one, and the only campaign selling **hosted** Amber rather than
local Chewbacca. That is the whole reason it is a separate ICP.

**The split that defines it:** Chewbacca answers at your desk, after the fact.
Hosted Amber answers on your phone, in the moment, while you are standing in
front of the person. Anyone who can wait until they are back at a laptop is a
Chewbacca user and does not belong in this campaign.

```
LIST      Clay > Find People
          organizer | host | founder | lead  of
          run club | supper club | meetup | retreat | small group |
          community | chapter
          headcount 1-5, the group has exactly one person doing this

FIRES ON  they announce a new season, series, or the next event
          source: Luma, Partiful, Meetup, Eventbrite, their own IG

MERGE     {group_name}  {next_date}  {cadence}

COST      personal email enrichment required, same as before. runs at the
          lower daily volume for that reason.

VOLUME    40 of the 200/day
```

**Email 1**

> **Subject:** {group_name}, and the part nobody can keep up with
>
> hey {first_name},
>
> saw {group_name} is running again {next_date}.
>
> the thing about hosting anything {cadence} is that the work is remembering
> people, and you are doing it in the one place where you cannot look anything
> up. you are standing there, someone walks over, and you have met them twice
> and have nothing.
>
> building Amber for exactly that. it is your own people, on your phone, that
> you can ask in a sentence. not a CRM, it does not measure pipeline stages, it
> just tells you who this is and what you talked about last time.
>
> want early access?
>
> Sagar

### Open, and not guessed at

Hosted access is what this campaign promises, so it cannot launch before that
surface is real on a phone. **Confirm with Karthik before this one sends.** C1
and C2 sell local Chewbacca and have no such dependency, so they can start
without it.

## Follow-ups, identical shape across all three

| Day | What it is | Rule |
|---|---|---|
| 0 | the trigger + the question | under 90 words |
| 3 | the mechanism, one paragraph | installs locally, no server, ask it in a sentence |
| 8 | the 70 second clip | `clay-workaround.mp4`, no new argument |
| 12 | permission to close the file | no new offer |

A row exits on a reply or on do-not-contact. Nothing else removes it. The
signals keep re-scanning the same list, which is what makes it always running
instead of a send.

## The privacy claim, and what it is allowed to say

**Do not write "nothing uploads" or "your data never leaves your machine."**
Chewbacca's own `docs/PRIVACY.md` says nothing is encrypted at rest, and that
when you ask about your texts, the relevant texts are in the request to the
model. There is no local-model path and no redaction layer yet.

What the copy may claim, all of it true today:

- No server, no account, no telemetry. Nothing reaches us.
- It reads your own message history on your own machine rather than asking you
  to upload it to a vendor.
- You choose what gets indexed, and you can skip the message index entirely.

A fund partner or anyone with a security team will push on exactly this, so the
weaker true claim is the only one worth making. Revisit when the local-model
path exists, which Karthik has already named as a requirement.

## The rule that keeps 200/day from reading as spam

**No row sends without `signal_evidence` populated.** If the trigger cannot be
pointed at with a URL and a date, the row waits. That single constraint is what
separates this from blasting a list, and it is why the merge fields are all free
off the trigger itself rather than bought.
