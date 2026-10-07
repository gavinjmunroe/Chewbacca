# First B2B cohort

Decided by Gavin and Caleb on the call of 2026-10-06, to take to the Karthik
check-in on Friday 2026-10-09. The prices are proposals until that call.

## Who

Non-technical companies whose people do outbound under one ops lead. One account
gets three seats, sales, recruiting and ops, and the COO or owner is the buyer.
Chewbacca is installed on their Macs, and the tools are bundled in our price.

What the first client has to prove, in the team's words: we impress someone in a
corporate setting with easy automation in one place, Chewbacca drives software
like Clay that they have never used, and the company's whole connected app stack
sits in one place, which saves them time and money.

## Wave 1: three industries

| # | Business | Size | Sales seat | Recruiting seat | Ops seat | Door |
|---|---|---|---|---|---|---|
| 1 | Staffing and recruiting firms | 10 to 200 | BD reps winning client companies | Recruiters sourcing candidates | Ops lead over the desk | Warm |
| 2 | Venture studios and accelerators | 5 to 50 | Customer outbound per portfolio company | Hiring for portfolio companies | Platform or ops lead | Warm, and the current studio client is the case |
| 3 | Commercial real estate brokerages | 10 to 150 | Brokers prospecting owners and tenants | Recruiting brokers | Office manager or COO | Cold only |

The test is written down before the first send, so the result decides:

- 25 sends per industry per week, for two weeks: 150 in all.
- The winner books the most discovery calls per 50 sends. A tie goes to
  staffing, where all three seats are native and the door is warm.
- 50 sends per arm only separates big gaps. Close results fall to the tiebreak.
- An industry with zero positive replies after 50 sends is replaced from the
  bench: executive search, franchise development, freight brokerages,
  commercial insurance, event companies, manufacturers' rep firms, boutique
  consulting.
- Warm intros go out before the first cold send.
- Commercial real estate is the weakest on data. Run 50 rows through Clay before
  the first send to check owner contacts are there.

Every first reply asks two questions: are your people on Macs, and what do you
pay for software per seat today?

## Mac first

The plan is to get it working perfectly on Mac and invest in Windows later. A
company whose three seats aren't on Macs goes on a Windows waitlist, not into a
pilot. The waitlist count is what tells us when Windows is worth building.

**The installer gates revenue.** Nobody is signed until it installs cold on
their Mac. Caleb has an Apple Developer account. What's missing is a Developer
ID certificate on the build machine and notarization; the only signing identity
on Gavin's Mac as of 2026-10-06 is "Chewbacca Local Signing" (see
[EVERY-MAC.md](EVERY-MAC.md)). Delivery is a link plus a code, then they open
Claude, and the link must not be shareable. The test that
counts is someone outside the team installing it cold with nobody helping.
Outbound and discovery calls start anyway, because calls aren't contracts.

## The offer

> 30 days, three of your people (sales, recruiting, ops). Chewbacca goes on their
> Macs and runs the tools you already pay for, plus Clay, which none of you has to
> learn. Every Friday you get the hours it saved each seat, and which software
> spend it can replace.

- Price anchor from the 2026-10-06 call: **$7,500 to $10K install, then $2,500
  to $3K a month**, tools included. To be checked with Jake before the first
  quote. (The earlier $2,500 pilot and $2,000 a month proposal is superseded.)
- The written offer is made per prospect once they reply; outbound says what we
  can do. It has to give value even if they use none of Clay, HubSpot,
  Salesforce, Pipedrive or HeyReach.
- HeyReach is optional and only with the client's written ok, because LinkedIn's
  user agreement forbids automation and their accounts carry the risk.
- Never free.

## What it costs us and what the market pays (checked 2026-10-06)

| Tool | Price |
| --- | --- |
| Clay Launch | $185/mo ($167 annual), 2,500 data credits, no CRM sync |
| Clay Growth | $495/mo ($446 annual), CRM sync. Unlimited seats on every plan |
| HubSpot Sales Hub | Starter $20/seat, Pro $100/seat plus $1,500 onboarding |
| Salesforce | Starter $25/user, Sales Cloud from $195/user |
| Pipedrive | $24 to $99/seat monthly |
| HeyReach | $79 per LinkedIn sender |
| Claude Team | $25 standard, $125 premium per seat monthly |

A bundled 3-seat account costs about $260 to $1,020 a month, depending on the
Claude plan and whether they need a CRM. Chewbacca driving the CRM directly keeps
a client on Clay Launch instead of Growth.

| Market | Price |
| --- | --- |
| GTM engineering agencies, median (survey of 228 practitioners, 2026) | $5K to $8K/mo |
| Clay builds only | $2K to $5K/mo |
| In-house GTM engineer, fully loaded | about $9.4K to $15K/mo |
| AI automation agencies, small business (weak sources) | $1,500 to $5,000 setup, $500 to $1,500/mo |
| Per-seat AI tools buyers know | $20 to $25 a seat, premium $100 to $125 |

Open: which Claude plan one Chewbacca seat needs, which is the biggest swing in
our cost.

Sources: clay.com/pricing, cleanlist.ai (Clay's 2026-03-11 change),
heyreach.io/pricing, hubspot.com/pricing/sales, salesforce.com/sales/pricing,
automationatlas.io (Pipedrive), gtmepulse.com/careers/agency-pricing,
formanorden.com/blog/gtm-engineering-cost, taskip.net, learnforge.dev, eesel.ai.

## The bones, the only build work until Thanksgiving

| Bone | Done when |
| --- | --- |
| Installer | Installs cold on a stranger's Mac, notarized |
| Clay operator | A client campaign runs without anyone driving Clay by hand, with the credit guard on ([CLAY-MASTERY.md](CLAY-MASTERY.md)) |
| Campaign procedure | Same steps for every seat: brief, list, qualify, enrich, draft, approve, send, sort replies |
| Approval gate | Nothing sends without a human press |
| Run log | Minutes, credits, errors and fixes per campaign. This is what the cohort teaches the product |
| Client report | One page every Friday: hours saved per seat, software it can replace |
| Deliverability | Bounce check before every batch, warmed inboxes only |

Frozen until the Thanksgiving gate: HUD motion and glass, the keyboard, group
cards, the Ghost-comparison film, wearables, the VS Code surfaces.

## Timeline

| Dates | What happens | Exit |
| --- | --- | --- |
| Oct 6 to 8 | Warm names listed, Clay lists for the three industries, the one-page offer, Apple Developer account opened | Lists and offer ready |
| Fri Oct 9 | Karthik check-in | Installer owner and date; inboxes; signer |
| Oct 12 to 23 | Warm texts, then two cold batches per industry | Calls booked per industry |
| Tue Oct 20 | Gate | Winning industry named. A pilot signs once the installer passes |
| Oct 26 to Nov 20 | Pilot 1, then pilots 2 and 3 in the winning industry, never more than 3 | Friday reports, run log filled |
| Thu Nov 26 | Thanksgiving gate | Paid and renewing? Hours saved per seat? Minutes per campaign down by half? |

## Expansion: build by role, sell by industry, grow by seat

1. Land: one account, three seats, one industry.
2. Expand inside: more seats, and learn their sixth app live in week 3 to prove
   "any software they already use."
3. Repeat the industry: 3 to 5 accounts. Each role's steps become a role pack.
4. Next industry, from the bench, already measured by the outbound test. The
   role packs carry over because a recruiter does the same work everywhere.
5. Younger, technical businesses such as social media marketing agencies.
6. Windows, when the waitlist says so.
7. The consumer funnel, on the same installer and onboarding.

Anything that only works for one industry goes on the freeze list.

## Friday questions for Karthik

1. Who owns the installer, and by what date does it install cold?
2. Is a three-arm outbound test fine under the one-group rule, given only one industry gets delivered?
3. Which inboxes and which domain does our own outbound send from?
4. Does client data on their Mac stay there, or go to Amber's data room?
5. Who signs and invoices, and is the split in writing before the first invoice?
6. Does the bundled price leave the right margin over the tools?
7. What name does outbound use for the product?
8. Where is the non-technical onboarding demo?

## Update from the Gavin and Caleb call, 2026-10-06 (evening)

Decided:

- 100% B2B contracts first. No consumer building until contracts are in.
- Wave 1 is staffing and recruiting, venture studios and accelerators, and
  commercial real estate. Recruiting is the strongest buyer.
- Any company size, as long as they aren't very technical.
- Installed on their Mac only, never run from ours. High touch: on call daily
  for the first two weeks, in person for big installs.
- Clients bring their own Claude subscription; onboarding already has that step.
- HeyReach optional, only if the client agrees to HeyReach's terms.
- Older businesses first, social media agencies after.
- Sunday night sync plans Monday to Friday.
- Sending capacity: 200 emails a day through Clay.

Not now: the glass IDE and agent sessions, native meeting capture, the consumer
USC loop, an online personal agent.

### Next five weeks (owners proposed, confirmed at the Sunday sync)

| Date | What | Owner |
| --- | --- | --- |
| Thu Oct 8 | Clay table for recruiting outbound leads, first emails; Gavin leaves for Utah | Caleb, Karthik |
| Fri Oct 9 | Karthik sync: table review, installer plan, pricing check | Caleb, Gavin |
| Sun Oct 11 | First Sunday sync; Semyon gets his tasks | Gavin, Caleb |
| Oct 12 to 16 | Cold sends start inside the 200 a day cap; Developer ID and notarization; recruiting HUD past the skeleton; Semyon's cold install test | Caleb, Gavin, Semyon |
| Tue Oct 20 | Gate: which industry books calls. A pilot signs only after a cold install passes | Gavin, Caleb |
| Oct 19 to 30 | Discovery calls, first proposal, in-person install | Gavin, Caleb |
| Nov 2 to 13 | Pilot 1 live, daily check-ins | all three |
| Thu Nov 26 | Thanksgiving gate | Gavin, Caleb |

### Who owns what

Gavin and Caleb lead together and either can task Semyon.

| Person | Owns |
| --- | --- |
| Gavin | Recruiting HUD (a working skeleton by Sun Oct 11), discovery calls, in-person installs. Working from Utah Oct 8 to 22, can fly out |
| Caleb | The Clay table for recruiting outbound leads and the email stack, with Karthik; daily sends up to 200 a day; Developer ID and notarization; the drag-into-Settings onboarding bubble |
| Semyon | Onboarding until a stranger installs it cold with nobody helping; reliability, backend efficiency, the graph-engineering gates and benchmarks, the data path |

Later, not cut: Windows, JevBacca, the keyboard, group cards, wearables.
Separate sites per industry are probably not happening.
Pricing is set by Gavin and Caleb; a check with Jake is optional.

### Open, for Gavin and Caleb to decide

1. Is the price a $7,500 or $10K install with $2,500 or $3K a month, or per seat with every new hire as a new seat?
2. Do we send 25 per industry per week, or use the full 200 a day, and what warm-to-cold mix?
3. Do we rename before the first send or after the first contract, and is it one brand or one site per industry?
4. In the first pilot, does Chewbacca drive the Clay UI with guide bubbles, or use the Clay API behind the HUD?
5. Which three things does a recruiter see in the first five minutes?
6. Is a texting layer an upsell later, or out?
7. How do we stop a client from sharing the download link?
8. What counts as working after the two weeks, so the retainer starts?
9. What can consumer prep include before contracts, without building?
10. What time is the Sunday sync, and is Saturday off or optional?
