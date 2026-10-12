# Sagar's rules

Sagar Tiwari runs outbound at Blue Modern Advisory and is the GTM engineer this
kit measures itself against. This page holds every rule of his found on disk
and in Slack as of 2026-10-11, each with his words and where he said them.

They are rules for all outbound, for every client this kit runs: Firm
Foundation, Chewbacca's own, a solo founder with one Gmail, an agency client in
Clay. Several were stated during the Zeutara engagement, and that engagement
is cited as the evidence (the "Question" subject it shipped, the double emails
it nearly sent), never as the scope.

The rules that can be read off the data run as code, in two places that share
one function (`sagar_email` in `tools/gtme_grade.py`):

- **A Clay campaign**: `gtme-grade`, gates 1 and 2, each line cited
  `[Sagar <date> <source>]`.
- **The own-inbox path**: `chewbacca gtme copy` refuses to save, and
  `chewbacca gtme batch` refuses to build, a first email that fails his review.
  The sender name, company and offer come from the client's plan (`gtme
sender --company`, the plan's offer) and `~/.chewbacca/gtm/clients.json`
  (`sender_company`, `principal`), never from a name written into the code.

The rest need judgement and live here, so the next campaign is built the way he
would build it before anything is graded.

## Sources

- **Transcript**: "Outbound change management review", Sagar teaching Maggie
  Chen and Mike the six-variable framework, in a file dated 2026-03-19 that
  sits privately at `~/Downloads/Docs/Outbound change management review.md`.
- **Zeutara rulings**: `~/code/work/zeutara-gtme/DECISIONS.json`, entries
  where `who` names Sagar (private client repo).
- **Slack**: the Amber workspace, `from:@sagar`, read 2026-10-11.
- **Copy method**: Sagar to Caleb, 2026-09-21, recorded in Caleb's private notes.

## Checked in code

| Rule                                                                                                                                      | His words                                                                                                                                                                                                                          | Source                                                                                                                          | Where it runs                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The subject stacks the offer's concrete nouns. A generic word ("Question", "Quick question", "Hi", "Intro") or a single word fails.       | "the subject line can be like private equity, experienced data engineer reaching out to share some info about Structify... Clay, private equity, Structify. That sticks out to me in the subject line. It also is just more real." | Transcript, 2026-03-19. Zeutara subjects re-cut from "Question" to stacked nouns ("Chicago dating app pre-seed") on 2026-10-11. | gate 2, `subject_problem`                                                                      |
| The subject is about the offer.                                                                                                           | Same quote: the nouns are what is being sold.                                                                                                                                                                                      | Transcript                                                                                                                      | gate 2: FAIL against `--offer`, WARN against the body when no offer is given                   |
| Email 1 names what is sold in concrete nouns.                                                                                             | "It's impossible to sell consulting services outbound without anything specific because no one will trust you."                                                                                                                    | Transcript                                                                                                                      | gate 2, `--offer`; NOT CHECKED without it                                                      |
| Email 1 says who it is from: the person and the company.                                                                                  | "My biggest point of feedback for Kevin is, like, way too vague, both in terms of who we're targeting and in terms of who the message is coming from."                                                                             | Transcript                                                                                                                      | gate 2: `--sender-name`, `--sender-company`, or `--client` (principal, sender_company or name) |
| Abstract offer words get named things instead.                                                                                            | Same Kevin quote. Also, on generic copy for Maple: "let's gear it more towards this instead of the generic messaging we've been sending."                                                                                          | Transcript; Slack maple-smartlead 2025-04-01                                                                                    | gate 2, WARN on solutions, services, offerings, consulting and the like                        |
| Signals lead messaging. A list with no signal or segment field plus an email 1 with no per-lead line is a list plus copy, not a campaign. | "You should not look at ICP builds and messaging and ICP builds and copy as two distinct things. Instead, you should look at signals leading messaging."                                                                           | Transcript                                                                                                                      | gate 2, WARN; NOT CHECKED with no leads and no `--signal`                                      |
| People the sender already knows get a personal text, not a cold email. Every list carries a relationship column.                          | "you know these 26 people directly. There's no need for you to send an email. You should just personally text them. Or you're a second degree connection away or you're a third degree connection away."                           | Transcript; his 2026-09-17 ask for "a column in every Clay experiment that filters out" his warm relationships                  | gate 1: FAIL on rows marked known/1st/direct, WARN with no column                              |
| Nobody is emailed twice; every lead carries a last-sent date.                                                                             | Ruling `no-double-email`: "Last-sent date on every lead so refills never email someone twice."                                                                                                                                     | Zeutara DECISIONS, 2026-10-06                                                                                                   | gate 1: FAIL on a filled last-sent column                                                      |
| Dedupe at the company level.                                                                                                              | "Yes, we should be deduping at the company level."                                                                                                                                                                                 | Slack maple-smartlead, 2025-03-05                                                                                               | gate 1, WARN on two leads at one domain (GEX allows 3, so this warns rather than fails)        |
| Strongest fits first, weaker fits after, order never cut.                                                                                 | Ruling `strongest-first`: "Send the strongest fits first in each wave, then fill with weaker fits. Order, never cut."                                                                                                              | Zeutara DECISIONS, 2026-10-04                                                                                                   | gate 1, WARN when one start mixes tiers                                                        |
| Each offer launches 2 variants of 3 messages.                                                                                             | "Each offer should have 2 variants of 3 messages each launched on Monday."                                                                                                                                                         | Slack zeutara-amber, 2026-10-04                                                                                                 | gate 2, WARN on any other shape                                                                |

## Judgement, not data

**Six variables make every campaign.** "These six variables make every sort of
go-to-market campaign." Internal and mostly fixed: persona (whose voice, why
anyone should care about that person, how they establish authority), pricing,
packaging. External, changing per campaign: accounts, signal/messaging,
channel. His goal: "we know the exact six questions to ask, we are able to
basically interview them once and then make outbound campaigns for them
forever." (Transcript.) Build anything for him on these six, in this order.

**The persona is the sender's real story.** "everyone kind of learning their
story and being a little bit more tactical on their story." His rewrite for
Mike opened on a fact only Mike could claim: "I am actually the head data
engineer at Blue Modern Advisory and I've worked with some pretty powerful AI
tools and deployed them at private equity companies." (Transcript.)

**Write the founder's story plainly, then iterate.** "I went through nine
versions of copy... got to a point where I was able to deduce that just writing
really human messaging was gonna work and so I wrote like a small email I was
talking about how he was a Columbia dropout who had parents with the Chinese
restaurant and he was trying to help people like his parents and it worked."
(To Caleb, 2026-09-21.) One story per company reaches every lead with no
per-lead spend. The quote proves the method on one client; it does not say the
audience was investors.

**Casual beats contrived.** "There is no worry about our outbound being ai slop
because the messaging you're sending is very casual, resonant, and basically
the opposite of contrived." (Slack serifhealth-cold-replies, 2026-06-04.) The
recipient read in gate 3 is where this gets judged.

**Accounts are one preset TAM list, researched once, reused by every
campaign.** "accounts are usually preset by the product we're selling... when
we make a workbook starting with a TAM account list and then making a bunch of
things flow from that TAM account list. Signals that lead to specific people,
that lead to specific emails... You can do a ton of those off of the same
account list." The list "should be deeply researched and understood and serve
as a base for experimentation." (Transcript.) Never rebuild the account list
per campaign; add a signal campaign on top of it.

**Name the workbook for the account universe.** "If I don't understand the
reason that this universe of accounts exists, then everything else is
useless... no one can understand what it is and therefore it'll never be used
again." His example name: "Los Angeles companies that are highly regulated
(PE, health care, solar)", reused for his March, April and June events.
(Transcript.)

**Filter the ICP by relationship, personal behavior and external data.** His
three filtering columns: relationship to the sender, personal user behaviors,
external data points, scored in that spirit until "that leads to a very tight
list." (Transcript.) Only the relationship column is checked in code.

**More signals, same targets.** "if we come up with more signals, and the
signals run through the same targets and all those targets get added to
different signal based campaigns as needed, then that's actually more likely to
get a response. And the only time we take them off the list is if they've
already responded... or they said do not contact, in which case they get added
to the block list." (Transcript.)

**Lookalikes are the strongest list.** "targeting lookalikes is probably the
most effective way to do outbound actually." (Slack ext-oshi-clay, 2026-09-02.)

**Don't get the emails burned.** "it's not fully automated and fully scaled,
so we need to make it very tight and not spammy. Don't get my emails fucking
burned." (Transcript.) He started BMA inboxes at "20 to 30 emails a day" and
capped Amber at 200 a day "just always running" (2026-09-17). Gate 5 holds the
warmup, inbox-per-domain and bounce checks this rule depends on.

**Volume for Zeutara, time-sensitivity in general.** For Zeutara he ruled max
volume ("Jonah cares about volume; send to every list he gives us", DECISIONS
`volume`, 2026-10-05, with Maggie) and about 500 leads a week across the
offers. In the March transcript he said "cold outbound, mass volume just
doesn't work really work anymore. And you need more time sensitive, direct
outbound." The client ruling wins for that client; elsewhere, lead with the
signal and let volume follow.

**One weekly rhythm.** Launch Monday, then "At the end of the week, we should
evaluate variance for 15 minutes in results, and make slight changes for the
next launch the following Monday." And "We should not be beholden to simply
this audiences list that we've set up, as Clay can allow us to enrich more."
(Slack zeutara-amber, 2026-10-04.)

**Ship the working run, then grow it.** "starting out with an auto run that
works but isn't fully comprehensive is always ok. The system should always be
living/agile." (Slack ext-oshi-clay, 2025-08-26.)

**His five foundations for a client.** "Weekly status, max volume, one clear
offer, timely signals, and telling Jonah in real time when he needs to act."
(Zeutara DECISIONS `foundations`, 2026-10-07.)

**Client channels carry results only.** No internal or process chatter in a
client channel; a "who hit launch" message gets deleted. (Zeutara DECISIONS
`client-channel`, 2026-10-03 and 10-05.) Enforced in
`tests/test_gtme_rules.py`, not in the grader.
