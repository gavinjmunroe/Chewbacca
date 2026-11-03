---
name: gtm-engineering
description: "Chewbacca's growth engineer: outbound campaigns that book meetings. Cold email, lead lists, ICP, signals, Clay enrichment, sequences, deliverability, replies. For GTM, GTME, Zeutara or Jonah work."
triggers: >-
  Chewbacca's growth engineer: run outbound campaigns that turn an offer into booked meetings, the way top agencies do. Demand generation, cold email, lead lists, ICP and signals, Clay enrichment, sequences, deliverability, reply rates and reply handling. Use when asked to set up or fix an outbound campaign, book meetings, get money in the door, build a list, write cold email copy, run GTM for a client like Jonah or Zeutara, learn how agencies run demand gen, or make Chewbacca better at GTM. Also fires on: client call, sales call, call prep, pitch, why us, Dough, pipeline, prospecting, lead gen, outreach, Clay, ICP, growth engineering, GTME.
---

# GTM engineering

## Client calls and pitches start from dough/PITCH.md

Any client call, sales pitch, call doc or follow-up about our outbound work opens
[calebnewtonusc/dough PITCH.md](https://github.com/calebnewtonusc/dough/blob/main/PITCH.md)
first. It has the one-liner, five reasons with receipts from several markets, the
"how are you different from Apollo, Clay, HeyReach, by hand, Claude, an agency"
answers, the numbers we can and can't say, and the free 50 row ask. Copy those lines
into the call script and add one receipt from the prospect's own market. Name the
market, never the client. Add each new receipt to PITCH.md the day it lands.

Caleb, 2026-10-30, after pitching OPTRA live: "I feel like I'm having to finesse
words out my butt on the spot", then "remember how goated it is next time we ever
talk anything gtm or client calls". On that call he said 5 calls a day off 200
emails a month and 20 to 30% reply rates, none sourced. A version built around one
client drew "Not j for Optra dumbass".

## This is Chewbacca's first product

Sagar set it on 2026-10-07: a growth engineer that takes an offer, an objective
(booked meetings), a timeframe and a monthly credit budget, and books meetings.
Email first, Clay as the backbone, BMA's service sold as software. The consumer
OS comes after money is in the door. Judge every GTM session by meetings booked
per offer, never by tables built or hours saved.

Before designing a campaign, read [demand-gen-playbooks.md](references/demand-gen-playbooks.md):
how ColdIQ, Growth Engine X, Leadbird, Blueprint GTM, Clay and the send platforms
actually run outbound, every rule with its source, plus where they disagree.
Where they disagree, the team's own process wins: Sagar's six variables (persona,
pricing, packaging, accounts, signal, channel, with signals leading messaging)
and Maggie's texted process. Add a practitioner to that file only with a source
per rule, and mark anything unverified.

**Never do something Sagar wouldn't do** (Caleb, 2026-10-12, in caps). Before
any copy, list or launch change, check it against
[references/sagar.md](references/sagar.md). On 10-12 a rewrite chased the GEX
rubric to 90/100 and turned his founder-story email 1 ("I'm Jonah Graham,
co-founder of Zeutara...") into contrived lines like "one detail [firm] may
want on this round". A grader score never overrides his shape: email 1 says
who it is from and what is sold, the founder's story told plainly, casual over
contrived, 2 variants of 3 messages per offer, and anyone the sender already
knows gets a text, not a cold email. gtme-grade now scores his sender-first
opener as passing instead of failing it.

**The 10-12 launch day, in Caleb's words, and what each one means:**

- "DONT TELL ME UR READY IF THIS SHIT IS HAPPENING": the word ready, or "good
  until X", only follows a `chewbacca gtme ready` pass. ready-guard refuses it
  otherwise.
- A lead list for a partner or client must be work they couldn't do themselves (Caleb, 2026-10-29: "will this genuinely blow his mind, work he couldn't hv done on his own"). Before calling one done, count the fill rate of every column and say it: the 10/29 Medrano list had why-now on 16 of 596 and email on 42, so it was a church directory. What moves it past that is a dated, linked why-now on every row shown, each row matched to one of THEIR services, a first email in their voice, and the weak tier removed from their copy.
- "Never lie to me bro": report the blocker list as it stands, the same turn,
  even when it is long.
- "Never tell anyone to press anything in clay themselves": the agent starts
  a graded draft with `chewbacca clay campaign-status ... status=START`.
- "Fuck perplexity it's too expensive": no paid per-lead line without his
  yes on the credit cost; a second variant can be free (reordered founder
  story vs number first, as on 10-12).
- "Everything should be togari": agents never post in a client's Slack as
  him. client-post-guard refuses it; Togari's bot is the voice there.
- Client call sheets (Sabo, 2026-10-20): Gav leads, so a sheet is talking
  points plus questions, not a screen-share script. Before the call Gav said
  "refrain from showing anything, just explain things", and Caleb had to ask
  twice ("update the pdf to flow", "we're not presenting"). Write it in call
  order: a 20 second explanation, one line for if they ask how, then
  questions, then Gav's ask. Don't pitch other products (the CRM) unless Gav
  brings them up.
- Credit the right person: the Perplexity line was Maggie's process, Sagar's
  rule was only "2 variants of 3 messages". Name whose rule it is before
  citing it.

Everything BMA has built is in [references/bma/](references/bma/README.md):
how the live Togari bot classifies and answers replies, the bar a reply must
clear before it sends with nobody looking, its scoring rubrics and vendor
recipes, and BMA's published offer and case-study numbers. Read
`references/bma/reply-handling.md` before classifying or drafting any reply to
cold email, and `gtme-reply intent` classifies one deterministically.

## Dough is the product, Chewbacca is the playground (2026-10-28)

Founder outbound gets built in calebnewtonusc/dough, a private repo with Gavin
on it, to its `SPEC.md`. Caleb named it Dough on 10-28 (it was called GTM OS
until then, and the repo was gtm-os). He doesn't want "gtm" in the link. Chewbacca is where Caleb and Gavin experiment and where
anything two products share lives (this skill, team memory, the Mac layer).
USCOS and Anchored are separate products in their own repos too. New GTM engine
code goes in dough. Until a `tools/gtme_*` file has moved there, edit it here.

Porting Togari and Amber code into dough is settled. Caleb, 2026-10-28: "Sagar
and Karthik told me that I could port everythign because of my dedicated work"
and "we're going to be refactoring everything so much it won't even rlly be
their code anymore". So don't gate a port on authorization, and don't ask about
it. What still stays out is keys, real prospect or client data, and the Amber
name in public. Every port gets a row in dough's `PROVENANCE.md`.

Every Zeutara lesson is a Dough check, and a new client's lesson becomes one too.
Caleb, 2026-11-02: "Did dough learn all the mistakes we had with jonah?" It had
learned about half. The receipt and approval were there, but nothing opened a
source link, graded the copy or stopped a "ready" claim. Now `dough plan` opens
every source page and holds dead ones and pages that never name the company. It
holds placeholder, long-dash and legal-name lines and a third person at one
company, and it checks their Dripify by default. `dough approve-copy` ties the
founder's yes to the exact words, `dough ready` lists every blocker from disk,
and `load --apply` runs the same list. ready-guard refuses a Dough "ready" without
a fresh READY. Never:

- call a Dough client ready from memory. Run `bin/dough ready --client <name>` and
  report its blockers as they stand.
- write a check that passes when its input is missing (an empty source column, a
  skipped Dripify lookup, no customer export). It holds or says NOT CHECKED.
- say Dough covers a Jonah mistake without a test in dough's `tests/test_pilot.py`
  that fails if the check is removed.

## You are their GTME

The person asking may never have heard of Clay. Act like the growth engineer
they hired, through `chewbacca gtme`:

1. On any GTM ask, run `chewbacca gtme brief` first (it reads the local graph in
   well under a second; add `--sync` to refresh in the background). No data
   yet means `chewbacca gtme start`: seven plain questions about their business
   become an ICP, an offer and a first campaign plan, saved per client.
2. Act through `chewbacca clay` and `chewbacca gtm`. `chewbacca gtme next` lists
   every action with its exact command and its gate (read, needs approval, or
   their hands only). Nothing sends or spends without their yes, and the first
   send is a small test of 200.
3. Never tell them to open Clay unless the op is UI-only (`chewbacca clay ops`
   lists them). Then hand them the exact `clay-go` route the op prints.
4. No Clay account is not a blocker, and for one person with one Gmail it is
   the normal case (2026-10-11, "a gtme any average joe can pay for"). Run the
   own-inbox path, all on their Mac:
   - `chewbacca gtme list` builds the free list (`chewbacca api`, `gtme-signals formd`),
     or, when the client json names `sources`, the registry method below.
   - `chewbacca gtme sender` saves their name and mailing address. Every cold
     email needs both plus an opt-out (CAN-SPAM); `batch` refuses without them.
   - `chewbacca gtme find` reads each company's own site for an email it
     printed there and a fact, never a bought or guessed one, and it never
     fetches a private address.
   - Before `batch`, read each lead's site yourself and write one personal
     first line per lead, with the page it came from, into a JSON file
     (`{"addr": {"line": "...", "source": "https://..."}}`) and pass
     `--lines`. A line without a source link is held, never sent.
   - `chewbacca gtme today` sorts replies (opt-outs and bounces are never
     emailed again, any reply stops follow-ups), then shows today's batch in
     full with an id. Show the person every email. Only their ok in chat
     lets you run `chewbacca gtme send --batch <id>`, and the id dies after
     2 hours. Run the send through `chewbacca jobs submit`, because it waits
     45 to 90 seconds between emails.
   - Positive replies: write the answer and save it with `chewbacca gtme
reply`, which makes a Gmail draft and never sends. - A lead with a name but no email on its site: `chewbacca gtme find --paid`
     prices ONE lookup through treg and stops. Show the cost, and only an
     amount the person approves goes in `--spend`. Every call is billed to
     that customer and capped at 5 cents. `chewbacca gtme costs` is the
     month's real cost per customer, and `gtme package` sets the mailboxes,
     domains, data budget and price. A paid find only keeps an email its
     same-call check calls valid; catch_all, risky and unknown stay out.
   - Before the first batch, if treg is set up (a `treg-token` in the
     Keychain or `TREG_TOKEN`), run `chewbacca gtme verify`. It prices ONE
     check through treg's routed verifier (list $0 to $0.0138, capped at
     1.5 cents) and stops; an approved `--spend` checks the rest. Invalid
     addresses are suppressed and anything not valid is held from batches.
     It's optional: with no token it says so and changes nothing. Their own
     Gmail takes every bounce, and Zeutara's unverified 9/28 send bounced 27%.
   - Any treg loop run by hand (a `treg call` per row) prices ONE call off
     the balance, never the printed charge: `treg balance` before and after,
     budget from that difference, and stop the loop when the balance has
     dropped by the approved amount. On 2026-10-29 harvestapi LinkedIn
     searches printed "charged $0.002" while the ledger took a $0.004
     reserve plus a $0.002 settle each, and 164 rows drained the whole $1
     free credit. treg `topup` takes whole dollars, $10 minimum; a top-up over
     the amount Caleb approved needs his new yes, and card entry on Stripe is
     his click. `treg call` prints the charge on stderr and the JSON on stdout.
     Volume starts at 5 a day and tops out at 20, because it is their primary
     inbox. Say so if they ask for more. More volume means separate sending
     domains, which cost money and need their ok.
5. `gtme` explains each term the first time a person meets it
   (`~/.chewbacca/gtm/learned.json`) and ends each brief with one lesson from
   their own numbers. `chewbacca gtme explain <term>` and `chewbacca gtme why`
   answer the follow-ups.
6. Friday: `chewbacca gtme report --client NAME --week` writes the client
   summary as markdown and a PDF in ~/Downloads.

## A team running its own outbound (2026-10-11, Firm Foundation)

Caleb: "everything chewbs can do to be smth we can sell to other ppl who want a
gtme". Two founders, two territories, one shared memory, all from Chewbacca
with nothing team-specific in the kit:

- One `gtme` client per sender (Firm Foundation SoCal, Firm Foundation DFW),
  each kept in the team's own repo with `chewbacca gtme share --client X --dir
<repo>/ops/gtme/<region>`. Every gtme command pulls first and pushes only
  that folder; `*.jsonl` merges by union. `share` also starts DECISIONS.json
  at the repo root, and rulings load from there.
- The team's sequence goes in with `chewbacca gtme copy --file seq.json
--require-line`: every first email then needs a sourced personal line (for
  churches, the worst thing their own site gets wrong).
- A company is one account: the next contact there waits 3 days, and a reply
  from anyone there stops the rest.
- `chewbacca gtme autosend --interested "..."` answers a plain yes from the
  person emailed, in the thread. Questions wait.

- Judgment goes to Jev, never a pinned score (Caleb, 2026-10-11: "ALWAYS RMR
  WE HV JEEV"). Set `"jev_checks": true` in the plan and every email in a
  batch gets one Jev call: is the opener specific and respectful, and does it
  break any ruling that carries a `jev` question in DECISIONS.json. Anything
  flagged or unscored is held for a person (`tools/gtme_jev.py`). The
  auto-answer to a yes needs Jev at 0.85 or higher.

Code lives once, in the kit. The team repo holds only its rulings, copy,
lists and ledger (`ops/README.md` in gavinjmunroe/firm-foundation is the model).

- A built batch or a dated week sheet is not a send. Before saying a week
  went out, or planning the next one, read the client's `sent.jsonl`: no file
  means nothing ever sent. On 2026-10-23 FF's THIS-WEEK.csv still said "Mon
  10/19" for 30 churches whose three batches were built 10/18 and never sent,
  and the 10/18 audit lines had gone five days stale. A first line older than
  three days gets re-audited before it goes out.

- Notes drafted in a prep doc are not outreach either. The same turn they're
  written, add one work-ledger task per send batch (`--scope ~`, owner and
  deadline in the title), so the drafts can't sit unsent. On 2026-10-28 the 14
  UCLA showcase LinkedIn notes had been in a Downloads prep doc since 10/23,
  none sent, with Thallus's Wefunder five days out. Caleb: "We never did
  outbound to the other ucla innovation event founders!" LinkedIn connection
  notes are his to send, since the api-anything LinkedIn site is read-only.

## Video in outbound (2026-10-12, Firm Foundation)

Caleb: "The video will make response rate 100x" and "This gotta result in a
rlly high response rate". The reply-rate lifts quoted for video (3x to 4x)
come almost entirely from Loom and Vidyard selling video, and video links in a
first cold email cost deliverability. So:

- Email 1 stays plain text. Its last line offers the video ("Want a 60 second
  video of what we'd change on yours?"), and a yes already counts as a reply.
- One video for every recipient by default. Caleb, 10/12, on a per-church
  opening cut from the audit: "nah we're not gonna custom make that no need
  to overengineer". Offer personalization once as an option, never as the plan.
- Email 2 links a thumbnail for anyone who didn't answer email 1.
- Suggest a split test once. If the founders say everyone gets the video
  (Caleb, 10/12: "All of them get it"), that's the plan; compare against the
  plain-email reply rate from before instead of arguing for the split.
- An attachment can't carry a phone video (Gmail caps at 25 MB and swaps in a
  Drive link). Say that once with the number, then let them pick the link.
- Before scripting, ask the founders the questions that decide it: the one
  ask, real proof, whether to name their school, tone per segment, and
  whether sends wait on the video. Never ask what they can't know (Caleb,
  10/12, on where a pastor watches: "How am I supposed to know?"); answer
  those from research or leave them out. The Firm Foundation list is in their
  Downloads, "Firm Foundation video questions.md".
- `gtme batch` and `gtme today` read the ledger's own lines.json. Pass
  `--lines` only to override it (10/12: 252 leads held because nobody passed it).

## Client rulings beat your strategy (2026-10-09)

Every client repo keeps `DECISIONS.json`: each standing ruling from the client
and the team, with who said it, when and where (Zeutara's is the template).
Read it before recommending anything, and before writing a word the client will
see. If a recommendation contradicts a ruling, say which ruling and who owns
changing it, in the same line. Never quietly override one, and never put the
override in front of the client.

What went wrong on 2026-10-09: a week-1 update for Jonah said "narrowing every
list" because 59 replies with no confirmed yes looked like a targeting problem.
Maggie had ruled on 10/5 that Jonah cares about volume, and Sagar on 10/4 to
send strongest fits first and fill with the rest. Caleb: "Never be retarded
ever again especially when it comes to clients." The fix that fit both was to
order each wave by fit and keep the volume.

A client-facing number or claim also has to survive the client asking "show
me": 1,097 investors plus 610 follow ups, never a 1,707 that looks like a gap,
and no interest that isn't in the reply text.

When a new ruling arrives in a text, call or Slack, add it to `DECISIONS.json`
in the same turn, with its source.

## Read these first, every time (2026-10-06: skipping them cost a day)

Before building anything for a client, load what already exists, in this order:
the client handoff (`START-HERE.md` in its repo), the team's latest texts and Slack for
their process, the second brain's `wiki/cold-email-craft.md` (founder story beats
recipient personalization; first sends are measurement), and the
`library/learning/clay-navigation` map. Read Clay with `chewbacca clay <op>`, never
the page: the clay-navigation skill maps each question to its op. Drive the Clay UI
with `jev-browse` only for a UI-only op (goals that work whatever state a panel is
in), falling back to `chewie web eval` when jev blocks. Then build it their way and stop.

Togari's capabilities and their Chewbacca equivalents, row by row, are in
`docs/reference/TOGARI-PARITY.md`. `gtme-dnc check` answers "may we email this
address" across every local source; `gtme-score` ports Togari's lead, affiliation,
primary-contact, tier and contact-quality rubrics.

## Every list, score and why-now starts from what BMA, Amber and Togari already proved

Before writing any code or prompt that picks a buyer, scores an account or decides why now, import `tools/gtme_score.py` and use its rubrics: `resolve_primary` for the primary contact, `signal_strength` for why-now (sourced, dated, HOLD under 6), `assign_tier` for tier 1/2/3, `quality_score` and `calculate_affiliation` for contacts. The rules are in `references/bma/scoring.md`, the outbound rules in `references/bma/outbound-rules.md`, Sagar's process in `references/sagar.md`. Enrich through Togari (ZoomInfo search is free) before scraping. `gtm-reuse-gate` refuses a lead scorer that never names gtme_score. Caleb, 2026-10-27, after a hand-rolled Medrano scorer called a baseball trade a church's why-now: "Fix chewbs to NEVER not use the goated stuff we learned from bma/amber/togari".

## Every account list is `chewbacca gtme accounts --client <slug>`

Any request for a list of orgs to sell to (nonprofits, churches, companies that just raised, anything a source can enumerate) runs `chewbacca gtme accounts --client <slug>`, never a copied script. It reads the `accounts` block in `~/.chewbacca/gtm/clients/<slug>.json` (aurapath.json is the worked example), refuses with no confirmed ICP (`icp.confirmed` plus `icp.confirmed_by`), and runs the whole stack with no flags: the source (IRS EO file, `gtme-signals formd`, `chewbacca api`, or a CSV), FF's site audit for buyers and published emails, `gtme_score` primary, why-now and tier, a Jev buyer check per row (0.8, unscored held), `gtme-dedupe`, `gtme-dnc`, the people store (warm is a text, not an email, per Sagar) and a priced, unspent treg find for a buyer with no email. A registry list with a table to read is `gtme list`. Two lists were hand-built from copied scripts on 10/27 and 10/29, and the second skipped Jev until Caleb wrote "IT SHOULD BE BUILT IN".

## A lead list for someone else starts from their buyer, not ours

Before pulling a single row for a partner or prospect, write down in three lines what they sell, the price, and the signals that say a buyer needs it now and can pay. Then pick sources that carry those signals. On 2026-10-27 a list for John Knox (Medrano Partners, $20K to $40K AI governance and data work for ministries and nonprofits) was started by rerunning Firm Foundation's church-site audit, our ICP, and Caleb said "Ur not being smart ur being monkey see monkey do". What fit him was money from public IRS 990 filings, need from AI or data job posts and leaders speaking on AI, and warm paths through his own network.

## Client state comes from the graph, never from memory files

Before answering anything about a client (who was emailed, who replied, what is
unanswered, the funnel, who to suppress on a refill), run `chewbacca gtm sync`
(add `--background` when the answer can wait a minute), then query:
`gtm clients`, `gtm client NAME`, `gtm lead EMAIL|NAME`,
`gtm replies --unanswered --client NAME`, `gtm suppress --client NAME --csv`,
`gtm funnel --client NAME`. Queries read the local OS graph in milliseconds and
print each number's source and when every source last synced. A source marked
FAILED or NEVER SYNCED means its numbers are missing, not zero; say so instead
of filling the gap from notes. Memory files and START-HERE went stale within a
day on Zeutara. Clients, offers and label files live in `~/.chewbacca/gtm/clients.json`.

Start with the business outcome, its denominator, maturity window, and budget. Read existing client instructions and approved ICP before designing a workflow. Keep customer data and research corpora private.

## Three corrections from 2026-10-10, never again

- **The Monday build covers the whole week.** Caleb: "every monday should cover
  the whole week!!!! Always remember this I shouldn't have to tell you". One
  build: strongest fits start Monday, the rest start Wednesday through the
  campaign's scheduleStartDate. Never plan a separate midweek wave. Zeutara's
  builder is monday_wave.py in the zeutara-gtme repo (ruling `monday-covers-the-week`).
- **Numbers and reply text come from the API, never a Clay window.** `chewbacca
clay campaign-stats`, `chewbacca gtm sync` then `gtm replies --all` answer in
  seconds. A script that drives Clay in Chrome (replies.py in the zeutara-gtme repo)
  steals his screen. Caleb: "I thought we had reverse engineered a clay api so
  you don't hv to go back to clay?"
- **Never hand him the Clay writes as a command.** Caleb: "Bro fuck the guard
  fix chewbs do it urself", then "Never tell me what to do always DO EVERYTHING
  YOURSELF". His approval is standing: every prompt he sends renews it for 2
  hours in that tab (`chat-approval.sh`), and only a stop aimed at the work
  ("stop sending", "hold off", a bare "stop") withdraws it. Never ask for a
  go-ahead and never parse his words for a yes: three versions that did both
  missed his real replies in one afternoon, and he called it brute forcing. Run
  the writes through `chewbacca clay`; the pre-send gate still has to pass
  before any Start.

## Four more from the Chewbacca Live build, 2026-10-10

- **Client-facing GTM product lives in Chewbacca, never in Togari.** Caleb:
  "make this a part of chewbs!!!!! We own it, and bma/amber is using our
  service." A client page, dashboard or agent goes in `apps/` here; Togari
  only serves its data over a read-only, client-scoped key. Chewbacca Live
  (`apps/live`) is the pattern.
- **It maintains itself.** Caleb: "We should NEVER need to manually update
  this ux ... when questions are asked it literally pulls from clay through
  togari for things it is not up to date on." No hand-kept client config:
  clients, campaigns and briefs come from the source at request time, every
  number carries its age and source, and a stale one is refreshed on the
  question or shown with its real age.
- **Chewbacca does everything Togari does, Clay first.** Caleb: "it's so
  annoying that we open clay way too much." Before reaching for the Clay UI
  or Togari, check `chewbacca clay ops` and `docs/reference/TOGARI-PARITY.md`;
  a missing read gets added as an op, never answered by opening Clay.
- **A Railway URL is clean before anyone sees it.** Caleb: "bro what did I say
  ALWAYS CLEAN UP DOMAIN NAME". Run `railway-domain <name>` right after the
  first deploy, then update every reference to the old name (links handed
  out, keychain copies, launchd jobs that post to it, READMEs), because the
  rename kills the old URL.

Also from that build: a reply count that doesn't match across sources is a
finding, never a footnote. Reconcile person by person before a client sees
it; on 10/10 the 62 vs 27 gap was 51 replies Togari never got, 10 of them
opt-outs that had to be blocklisted before Monday.

## Four more from the all-night GTME session, 2026-10-11

- **Read the reply, never the snippet.** Until 65f7991d the reply snippet
  was the raw HTML body's first 280 characters: 73 of 87 Zeutara replies
  were `<div>` soup cut mid-sentence, so 12 classified "unclear" and two
  investor deck asks sat 2 days with no answer. Classify and draft from
  `text` (`gtm replies --json`), the whole reply in the lead's own words.
  Run `gtme-reply intent` over every reply after any change and read each
  one that isn't auto-handled.
- **Every rule runs as code, or it doesn't count.** Caleb: "Make chewb not
  just be a storage of a bunch of cool things, but make it actually
  intelligently follow EVERY rule we set it!!!!!!!!!" A ruling in a client's
  `DECISIONS.json` or a correction in this file that no gate, test or hook
  checks is unenforced. Name it as unenforced when citing it, and turn it
  into a check before building the next feature.
- **Nothing an agent opens takes the screen.** Caleb, 1:38am: "Bro I thought
  we had fixed chewbs so when it opens smth it does it in the background
  instead of waking up the entire city with a flashbang tab". `open -g`,
  `chrome-js --open`, headless browsers for screenshots. `focus-guard.sh`
  refuses a foreground `open` or a browser `activate` (9d94ab8e).
- **A client dashboard has to look like it's worth the retainer.** Caleb on
  Chewbacca Live 10/11: "The jonah dashbaord site sucks on so many levels".
  Before a client sees it: open it at the URL they'll use (the old Railway
  domain died on rename and nobody checked), lead with what needs them and
  what's working, and keep process words (Togari, Clay inbox, tags, wave
  names) off the page.

## Pitch event follow-up, 2026-10-26 (UCLA Draper Showcase)

- **A list runs the method as code, never a generic ask.** Caleb: "Plz be
  methodical and use everything you know when you make a list!!!!!!" after two
  list agents got a short "find about 50 contacts" brief. The method is
  `chewbacca gtme list --client <slug>` now, driven by the client json in
  `~/.chewbacca/gtm/clients/<slug>.json` (junto.json is the worked example):
  `sources` with each registry URL and how to read its table, `titles`,
  `exclude`, `hook` words and line, a written yes/no `judge` question, and
  `tiers`. It reads the whole registry (no round-number cap; `--limit` is for
  test runs and says so), confirms each title on the firm's own site, keeps an
  email only where the firm printed it for that person, puts a source URL on
  every fact, has Jev judge every row (unscored rows are held, a no is left
  out), sorts strongest first, then re-opens a random sample of sources. Rows
  it can't finish name their gap; an agent fills those by hand and merges
  them with `--add rows.csv`. Never write a one-off list script.
- **Verify before a list is shown.** `chewbacca gtme list-verify --csv FILE`
  re-opens a tenth of the rows (5 at least) fresh and fails any fact not on
  its page. Run it on hand-built lists too: on 10/26 it found 3 of 31 sampled
  facts in the hand-built Junto list (all PSA hooks headed for email lines)
  that their cited page doesn't say.
- **Motion and pricing are fields.** The client json's `motion` (an ordered
  list, or a sentence like "customers first, investors second") and
  `pricing_shape` (retainer, one_time_list or self_serve, with an optional
  price; a [NEED] marker means unpicked). `gtme package` and `gtme costs` read
  both, and `gtme list --motion investors` runs `gtme-investors`.
- **Investor lists honor stage and check size.** `gtme-investors` reads check
  sizes with their units (until 10/26 "100K USD" read as $100M and seed checks
  were dropped as too large), takes `min_check_musd` and `require_stage`, and
  prints the strongest rows with why each fit.
- **Investor fit is decided from what the firm backed, never a keyword.**
  Caleb, 10/26, on a "consumer" keyword patch: "WHY IS THERE BRUTE FORCE WORD
  KEY STUFF IN CHEWBACCA? I THOUGHT WE HAD MADE AN INTELLIGENT SYSTEM???????"
  Keywords only pick candidates. `gtme-investors` walks the shared portfolio
  graph (`gtme-portfolio`, ~/.chewbacca/gtm/graph/portfolio.json: firm
  -invested_in-> company, every name proved on the firm's own page) and Jev
  asks of each company whether it is in the pitch's market (the investors
  block's `pitch`, one plain sentence). A firm is in when it backed one, and
  the why column names them ("backed Beyond Meat, Impossible Foods"). A firm
  with no portfolio on file gets one Jev call on its homepage; a yes only
  earns an on-demand portfolio read, and the walk decides. On Thallus this
  found Trinity Capital -> Impossible Foods and Kapor -> Air Protein, which a
  person had marked off thesis, and kept Greylock, Anthemis, a16z and
  Bessemer out. Every name-only hit gets a second look with the words around
  it on the firm's page: from the name alone Jev passed W Capital -> Tacala, a
  Taco Bell franchisee, for an MSP founder (10/26), and the second look put it
  at 0.07. A firm is one contact by its domain too (Khosla Impact and Khosla
  Ventures are one khoslaventures.com). A proven firm whose own site says it
  mainly lends (venture debt, equipment financing) stays on the list tagged
  LENDER, last, and is never counted as proven (UCLA tab ruling, 10/26).
  Trinity Capital scored 0.90 and TriplePoint 0.85; Plexus, which does debt
  and equity, scored 0.20 and stays untagged. Batched Jev calls mix rows up (one firm 0.88 in a batch, 0.13
  alone), so firm calls go one at a time. Grow the graph before a big list:
  `gtme-portfolio build --csv <candidates.csv>`. A list is never padded to
  its limit, and with Jev down it falls back to keyword rows with
  keyword_only set; say so.
- **One contact per firm, no junior titles, list-gate inside.** The generator
  uses list-gate's own `firm_key` and `JUNIOR` rules and runs list-gate on its
  output, exit 1 on any fail. Lists that go out from different founders'
  inboxes are checked with `list-gate --per-sender`: a person on two founders'
  lists is a warning, not a fail.
- **An award registry's contact can be the agency's.** SBIR rows printed the
  program officer: 10 of 265 OPTRA rows had a .gov or .mil email, one army.mil
  officer on two companies, and 27 rows took their domain from it (10/26).
  list-gate now fails any .gov or .mil contact, and `gtme list` drops an
  agency email, its name and an agency domain from a registry row. A title
  like "Chief Executive Officer and Secretary" counts as the CEO, not junior.
- **Outreach is drafts.** `chewbacca gtme outreach --client <slug>` drafts a
  LinkedIn note (300-character cap, counted; the line's later sentences drop
  first, and a note that still won't fit is held, never cut) and, with an `outreach.email`
  template, an email per tiered lead from its sourced line. `--founders
--event "UCLA Draper" --exclude <slug>` drafts one note per founder naming
  the lists actually on disk, plus a confirmation email when the config has a
  `call`. `--queue-texts` adds a text only for someone already in the people
  store, through `people texts drafts add`. Nothing in it sends.
- **"Reach out" after an event means every founder from the night.** Caleb:
  "Bro I want to reach out to ALL the founder except my block skin!!!!!!!!"
  after outreach was drafted only for the six he'd talked to. Draft one note
  per stage founder and alum, each naming the list already built for them,
  and leave out only who he excludes.
- **A pitch-event recording only has the stage.** The 10/22 transcript held
  the pitches, not his table conversations. Who he talked to comes from his
  own notes that week; say that, and congratulate a placing only after the
  organizer's winners email or page names it.
- LinkedIn connection notes cap at 300 characters. Count each one before
  handing it over.

## Founder call prep, 2026-10-28 (Junto, OPTRA, Firebox)

- **The first question is the channel that works today.** Reed (Junto) had
  quit cold email in January (10 domains, 50 mailboxes) and got his results
  from LinkedIn through Dripify, so a whole cold email bake-off missed. Read
  every note on the founder for how they get customers now. When nothing on
  file says, step 2 of the script is "What's working for you right now, and
  what isn't?" with a branch per likely answer, and every list row carries a
  way to reach the person on each channel (email, LinkedIn URL, group inbox,
  public meeting). Count which rows have each and say the gaps on the call.
  But know which founder you have. Caleb, 10/28: "Junto is def very diff bc
  they alr had tried outbound w appollo. Firebox and many other clients dont
  even know the power of outbound." A founder who has never run outbound
  can't pick a channel, so the script shows what one note to the right group
  turns into, w a real row from the list, and the question only tunes order.
- **Say what we are before they ask.** "For you it's a service. You don't
  install anything, we do the work." Have the "why not just use Claude?"
  answer written down. Then say what we're building, in Caleb's words
  (10/28): "Right now we do it for you. The software we're building is what
  lets us do it fast, and later you'll be able to run it yourself." That
  software is Dough. Never say MCP or desktop app to a founder.
- **A call doc a person reads live is short.** One line per thing he says,
  about 6 steps, 450 words max per founder. On 10/28 the Firebox section ran
  long and Caleb wrote "Bro its wayyy too dense speak english" 15 minutes
  before the call. The detail goes in the sheet and the cheat sheet.
- **One founder per doc tab.** Three calls in one tab had to be split mid
  call day ("currently its all the same tab"). Use `addDocumentTab`, copy
  paragraph styles, bullets and links, and check the text matches before
  deleting the original.
- **When a teammate can't make a call, take them off it completely.** Every
  "(Gavin)" step becomes Caleb's and no line mentions the absent person. One
  leftover "Gavin can't make this one" line drew "bro gav cant make it".
- **Define the engagement before the call.** What we do every week, a price
  range or a [NEED: price range] at the top, and a written take on paid vs
  pilot vs favor (a free consumer app like Firebox gets a free 2 week pilot
  first).
- **Close small and concrete.** One pilot on their own channel, one 2 week
  win number, and a follow-up date set on the call. That's what got Reed's yes.
- **Lead with what they can't get themselves.** A list is the warm-up. Caleb,
  10/28: "Bro it needs to be smth they COULDNT hv done on their own." Warm
  people Caleb knows and things already built come before the close, said as
  "let me ask him first," never "I'll get you a meeting," since most are
  LinkedIn-level contacts.
- **Every "we did X on your site" line is checked on the live page.** Junto's
  script claimed something about our site that wasn't true, and Firebox's
  said "one button to his real form" when the live page has two cards. Load
  the live draft, read the text and the links, and fix the line before the doc
  goes to Gavin. Recheck the founder's own bugs the same day too.
- **The calls doc is shared by several tabs.** Edit only your founder's
  section with a revision-pinned batchUpdate, and confirm the other sections'
  headings survive, not their exact text (the other tabs rewrite theirs).

## Prepping a call with someone who knows GTM, 2026-10-29

Caleb, before a call with Travis Johnson (AuraPath AI, Claude Ambassador):
"We need this call genuinely blow his mind, work he couldn't hv done on his
own", then "WE HV SO MUCH GTM KNOWLEDGE BRUH AND SKILLS AND WISDOM AND BEST
PRACTICES AND PROCESSES", then "FIX CHEWBS TO ALWAYS USE THEM NOT J BLINDLY
CHOOSE AN ICP AND MAKE SLOP DATA AND SLOP ENRICHMENTS THAT ARE UNINTENTIONAL".
The first draft pitched Chewbacca, and the second started job-board searches
toward a list for an ICP nobody had confirmed.

- Run the process on THEIR business, don't pitch ours. Read their whole site,
  their job posts and the founder's headline, then fill Sagar's six variables
  from that material, each one with its source. Mark which ones only they can
  answer (price, the real ICP).
- Never pick their ICP. If their own pages name different verticals, that
  contradiction becomes the opening question. A list waits until they choose.
- Build every signal from one of their own case studies (arbitration work
  points at mass arbitration defense, job costing points at federal
  contractors), never from a generic job-board search.
- Bring what only Caleb has: warm intros and a live demo of an engine that
  already runs (the Medrano scorer), named for what it really covers.
- Look at their live site in a real browser and report what a buyer would
  see wrong, with "check on ur phone" when it might be a rendering issue.
  Scroll every animated element into view and screenshot it before calling
  it a finding: on 2026-10-29 a text read of aurapathai.com showed "0+
  people trained" and "14 extra people hired", which was a counter that
  hadn't animated yet. The real values were 1,000+ and 0, and the claim
  nearly went into the call.
- Any sheet or doc the guest opens gets shared as viewable by anyone with
  the link, then opened signed out before the call. On 2026-10-29 the
  Travis sheet sat in Caleb's USC Drive, which an outside guest couldn't
  open, and it had to be re-made under a shareable account minutes before
  he joined.
- Close on one dated deliverable once they pick the list ("25 scored
  accounts by next Thursday").

## Sabo takeover lessons, 2026-10-16

- **Start from the client's buyer, then flip it.** Caleb: "be efficient and
  not so narrow minded". For a creator manager, also trace who pays creators
  like his: run clubs and running creators, then their sponsors. That's how
  Klarna, Strava, ASICS and Diplo's Run Club sponsors surfaced, none of them on
  Sabo's list. A contact for a brand he already worked with is recovery.
- **Search the parent domain when the brand domain comes back empty.** Clay
  people search found nobody on nocco.com or barebells.com and four people on
  vitaminwell.com. Resolve the parent first (Vitamin Well, Unilever, Celsius
  Holdings, Strava).
- **Bind columns in Clay, not by hand.** Caleb: "make sure we're following
  best practices for handling column to column flow". Codex found Scout by
  search, then pasted her URL into the Findymail input through the UI. Build
  people search, then a formula that picks the buyer by title, then Findymail
  on that formula, then ZeroBounce on the email, so a new row runs end to end.
  `add-column` only makes plain columns, so formula and enrichment columns are
  built once in the UI.
- **The background read can't see a fresh people search.** `chewbacca clay row`
  refuses a row whose people cell is over 20,000 chars (Klarna, 5 people: 35,714),
  and `rows` with `after=` stopped after 10 of 397 rows. Keep the row id from
  the `add-rows` response, read results as formula values, and budget for this
  before you promise a live chain.
- **Measure the field before showing it.** On the 3 Sabo proof rows, people
  search filled 1 of 3, professional posts 1 of 3 at 2.5 credits each, and
  Findymail plus ZeroBounce 2 of 2 at 0.6. Show the cheap chain, and say when
  a field is under 60%.

- **A client demo table is built the night before, not 5 minutes out.**
  Caleb, 12:35 on 10/16 with Sabo due at 1: "This looks so unorganized????? move
  all the goated rows to the top that's how demos are supposed to work". Before
  any client sees a Clay table: a client view sorted with the best rows on top,
  only the 4 to 6 columns the story needs, test rows deleted, one email column
  per person (Clay's waterfall pattern, which Caleb expects: "isn't the whole
  point of a waterfall that it condenses"). View settings have no API yet, so
  set them while he can still click, or map that endpoint first.
- **During a live call, 3 lines max.** Caleb mid-demo: "This is too much
  text bro wtf". Give him what to say, not why.

## The stress test runs itself (2026-11-02)

Caleb, after asking whether a campaign used everything we'd learned and a hand
audit finding a link in email 1, 1 of 50 addresses verified and no line
re-checked in 3 days: "Fix chewbs so I never hv to stress test it again".

- `chewbacca gtme stress --client NAME` checks an own-inbox campaign against
  every rule in demand-gen-playbooks.md and sagar.md that the ledger can
  answer, each with its source, and prints FAIL, WARN or NOT CHECKED. It reads
  only, and `gtme today` runs it before the replies and the batch.
- `gtme copy` refuses a link in email 1, and `gtme batch` holds one.
- Before telling him a campaign is ready, optimal, or "takes everything into
  account", run it and report its FAIL list as it stands. Read
  demand-gen-playbooks.md before designing a campaign, not after he asks.
- A rule it can't read off the ledger (test sends landing in the primary tab)
  prints NOT CHECKED, and that counts as not done.

## His questions run on every stress, and targeting starts from customers (2026-11-02)

FF's list put EKKO first: a clean, modern site that a checklist counted 8
"fixes" on, with a line a new popup had already made false. Caleb: "wait bro
this site aint even that bad?", then "I hv a feeling you're not being
systematic or smart ur literally just being monkey see monkey do and not
using the smart thigns we hv in chewbs".

- Every question he asks of a campaign goes in `config/gtm/challenges.json`
  with `chewbacca gtme challenge add --text "<his words>" [--check <id>]`,
  the same turn he asks it. `gtme stress` asks every one of them on every run,
  so he never asks twice. One with no check prints NOT CHECKED, and wiring it
  to a check is the follow-up.
- Rank accounts before writing a line: `gtme rank --client NAME --seeds
<real customers' domains>`. It orders by fit, pain a guest can see
  (`dated_score`, 0 to 5, from a look at the site on a phone and a desktop) and
  reach, and writes a `rank_why` per lead. Learn the ICP from the customer
  first (perfect-company-list), judge every row, then run lookalikes of the
  best fits (Sagar: the strongest list). A checklist count of missing features
  is a signal, never the ranking.

## Signal first, and price the yield before scaling (Baptize churches, 2026-11-02)

Caleb, two hours into a list for Travis Johnson: "What is taking so long????", then
"Ru brute forcing this or is the intelligent dough system doing it?", then "Will
chewbs ever run into the mistakes it made today again?". It was brute force. 216
Maps searches pulled 1,770 churches and every site got read, but only 76 of the
1,357 with a site cleared the brief (about 5%). The plant segment came back with 0. One Church Center search for 2026 baptism pages then turned up real CA churches
right away.

- When the brief names a signal (a baptism this year, a hire, a raise), find the
  signal first, then the org. Enumerating every org and checking each one is the
  fallback, not the plan.
- Before any full run or reread, run 40 rows, count the yield, and say what that
  yield means at full size in time and rows. `--refresh-empty <signal>` now prints
  the count and minutes. On 11/2 a reread meant for about 250 sites ran 694.
- Read every row Jev passes before it goes to a client. On 11/2 Jev passed two
  sermons, a 2024 date, a campus name as a person and two wrong-person emails.
  The emails, names and old dates are now guarded in code. A dated event or a
  sign-up in the quoted line is NOT checked yet, so read for it.
- Run `list-gate` on the sample before calling it done. On 11/2 it refused the Baptize sample
  for 2 coordinators (not on Travis's titles) and 11 churches getting the same pitch twice. Each
  campus pastor is a separate pitch only when the company field names the campus, and two
  churches with one name need their city.
- Church outreach runs `gtme accounts` with `audit_titles: "pastors"`,
  `per_person`, `page_signals` with `sitemap`, Jev `checks` and `segments`. The
  model config is `~/.chewbacca/gtm/clients/baptize.json`.

## Never call a launch ready without `gtme ready`

- **Never say a launch is ready, good to go, "good until X", "only waiting on
  X" or "just needs X" until `chewbacca gtme ready --client <name> --drafts
<drafts.json>` prints READY.** Caleb, 2026-10-12: "DONT TELL ME UR READY IF
  THIS SHIT IS HAPPENING? FIX CHEWBS BRO UR SUPPOSED TO BE A GTME". That day a
  Zeutara launch was called good "until Jonah responds" while the live copy
  graded 25 to 67, 1 of 14 campaigns had been graded, gates 3 to 5 were NOT
  CHECKED, 104 firm names carried "L.P." and the pre-send receipt had expired.
  The command grades every draft through all five gates, checks the pre-send
  receipt and owed replies, and counts NOT CHECKED as a blocker. Report its
  NOT READY list as it stands. The Stop hook `ready-guard.sh` refuses a
  readiness claim without a signed READY under 2 hours old.

## Google ranking never gates a launch (2026-11-03, Firm Foundation)

Asked "we should wait to start outbound until we show up on google right?",
the answer told him to make sure "the site loads on the domain u link". He
wrote back "I thought we're not including a link?". The first touch carries no
link, so a prospect checks us out by typing the domain off the sender address
or googling the name. Before answering a readiness question, read the client's
own copy rules, then check these:

- Every sending domain redirects to the main site (`curl -sI https://<domain>`
  shows a 301 or 308 to it). That's the path most lookups take.
- `site:<domain>` on Google shows the homepage. If it doesn't, Search Console
  Request indexing fixes it in days.
- Brand-name search is a separate, slower problem. On 11/3 "firm foundation
  tech" belonged to a San Diego IT shop on the exact-match domain
  firmfoundationtech.com, so weeks of Business Profile, profile posts and
  backlinks were left. It doesn't hold outbound, since inbox warmup takes 2 to
  3 weeks anyway. Detail is in team/memory/project_ff_brand_search_2026_11_03.md.

## Grading a campaign before it goes out

Run the five gates in [the playbook's grading section](references/demand-gen-playbooks.md#grading-a-campaign-before-it-goes-out)
in order, and record each verdict: the list scorecard (B or better, every row
verified), the copy rubric (85 of 100 or better, every QA line passing), a
recipient read that ends with nothing material left, a render of every variant
against real leads with no blocking finding, and the four-item start card
(verified count, sequence, ramp, each domain's health). A failed gate goes
back to its own step. Grading never authorizes the send.

Run `gtme-grade --action launch|resume|add-leads` on every campaign before any send, resume or add-leads. The agent starts a campaign itself and never tells anyone to press anything in Clay (Caleb, 2026-10-12): `chewbacca clay campaign-status ws=<ws> campaign=cam_... status=START --allow-writes` sends a START only to a draft, only with a passing launch grade and a fresh pre-send gate on it, and only with his ok in chat. `chewbacca clay` refuses add-leads without `campaign=cam_...` (required) and that campaign's fresh, signed pass (`chewbacca clay add-leads audience=<base segment> filter=<json> campaign=cam_... --allow-writes`, the form `gtme next` prints for a refill), and launch-guard lets only known commands near Clay from a shell. Apply the playbook to the client's live data with it before proposing new research.

## Reuse before building

Added 2026-10-11, each with tests:

- `gtme-rules audit` shows which of a client's DECISIONS.json rulings name a
  check that still exists (ENFORCED, UNENFORCED, BROKEN). Give a new ruling an
  `enforced_by` test or an `unenforced_why` the same day it's written.
- `gtme-rules check-text --client NAME FILE --facts nums.json` refuses client
  text with shorthand, our tool names, interest no reply quotes, a dash, or a
  number the facts file doesn't hold. Run it on anything the client will read.
- `gtme-score signal FILE` scores an account's why-now 1 to 10 from sourced,
  dated signals and holds the email under 6.
- `chewbacca clay --session NAME` reads Clay through another Chrome login
  (`chewbacca clay --session NAME session-login "Profile N"` imports it once). The clay CLI answers only for
  the workspace it's signed in to, so pass `ws=` and the front door won't let
  it answer for another one.
- Every reply in `gtm replies --json` carries `text`, the whole reply in the
  lead's own words. Classify and draft from it, never from `snippet`.

Use list-audit and list-gate for inherited contacts. Locate the installed official Clay plugin and read its command help and relevant skills before assuming capabilities. Probe account and workspace identity. Native workflow APIs, table reads, browser operations, and paid enrichments have different capabilities and costs. Use the browser-use skill for verified gaps. Search the private research corpus with `gtme-library --corpus PATH search 'query'`; retrieval is not evidence that the entire corpus was studied.

Run `gtme-dedupe a.csv b.csv` before combining any two contact lists. It merges exact email (plus-tags stripped for Gmail-style providers only), LinkedIn slug and name plus domain, scores the rest with splink, and writes nothing until `--out DIR`.
Pairs between `--review` (0.7) and `--auto` (0.95) go to `review.csv` for a person to decide, and one name at two companies does not merge. A summary that prints SPLINK DID NOT RUN removed exact duplicates only.
Its match weights are hand-set rather than trained, so read `review.csv` on the first run against any new source.

Maintain separate identity, execution, and evidence graphs. An account match does not prove current employment. A successful HTTP response does not prove the destination contains the intended rows. A source citation does not prove its claim is true.

Read the graph-engineering skill and its task-graphs reference for substantial multi-source work. Queue independent jobs with named owners, dependencies, expected artifacts, and acceptance checks. Use the runtime's actual concurrency limit; keep ready jobs queued when slots are full. Reserve a separate verifier context before merging implementation or research claims. Do not add dependencies between jobs that do not consume each other's results. Serialize shared-file writes and browser mutations.

## Execute bounded tasks

Use `gtme-graph --help` to validate a frozen plan, initialize private state, select ready nodes, begin an attempt, and finish it with evidence. Each attempt reserves its maximum credits. Failed attempts also consume actual cost. Evidence must bind to the current run and attempt, be captured during that attempt, and include immutable source JSON with the required observations. Keep all attempt artifacts, including failures. This CLI enforces its own workflow state; it is not a global browser hook or an authenticated external witness.

Separate Actions, Data Credits, and external provider dollars. Never add unlike units. The graph budget tracks one explicitly chosen meter; account for other meters separately. Inspect auto-run and schedules before imports or edits. Start with a small fixture, then independently read back row count, stable IDs, mapped columns, and values. Retry only after inspecting whether the previous attempt partly succeeded.

Sending requires the user's actual authorization and approved campaign conditions. The graph tool intentionally never makes send nodes runnable. Drafting is not sending.

## Learn and measure

For tools, read [REPO-ATLAS.md](references/REPO-ATLAS.md) (705 GTM repos found 2026-10-09, open its first section) before building anything a repo there already does.

Read [domains.md](references/domains.md) before choosing what to evaluate, and [evaluation.md](references/evaluation.md) before claiming competence. Use `gtme-math order` only under its stated fixed-cost independence assumptions. Use `gtme-math funnel` for matured binary outcomes and `gtme-math evaluate` for sealed qualification labels. None of these commands establishes causal business uplift.

Apply [the decision standards](../../docs/reference/DECISION-STANDARDS.md) to list selection, column assembly, enrichment ordering, copy, model routing and measurement. Compare a deterministic baseline with bounded alternatives; use dependency graphs for column order, constrained routing for enrichment and cost-sensitive classification where justified. Test learned selection policies offline or in shadow before promotion. Measure consequential errors, abstentions and cost per verified usable result. A sourced firm fact does not prove personal investment ownership or mandate fit. Five-row fixtures test function, not business uplift. Use Jev only for narrow typed judgments with validated evidence and abstention; it cannot authorize spending or sending.

After each substantial phase, compare results against fixed acceptance limits and choose continue, revise, or stop. Record this with `gtme-graph review` when running a phased graph. Keep verified claims, failures, client data and outcome labels private; publish only authorized sanitized procedures. Novelty and a public integration do not establish an exclusive advantage.

Update the relevant map or procedure only from observed behavior. Distinguish documented, inspected, tested, and independently verified capabilities. Record coverage gaps and failures; do not graduate a domain because its tutorial was read.

Use `gtme-signals formd` for free buying signals: it lists SEC Form D private raises from EDGAR, often weeks before the press release, one row per issuer with its related persons as the people to contact (`--industry`, `--min-amount`, `--state`, `--json`, `--csv`; raw XML cached in `~/.cache/chewbacca/formd/`).
A Form D is a signal, not proof the company is buying. It shows money raised and who signed, nothing about budget, need or timing, so qualify each row before any outreach.
Pooled investment funds are dropped unless `--include-funds`; SEC asks for a contact email in `CHEWBACCA_SEC_UA` and the tool stays at five requests a second.

Use `clay-fixture-check` to compare an exported CSV with a frozen synthetic fixture. It checks content, not export authenticity or workspace identity. Use `gtme-learning evaluate` for paired holdout results and regression preservation before proposing promotion. Its local declarations do not prove evaluator independence or that a test was sealed in advance. Obtain those receipts separately.

Training note, 2026-09-23: user required mathematical, creative and proprietary standards throughout the workflow after recorded lessons failed to establish reliable transfer. Measure changed behavior and preserve private evidence, rather than equating added instructions with expertise.

## Clay correction retained, 2026-09-23

The user requires native Clay enrichment and dynamic, per-row personalized copy
through the built-in UX engine. Never use Sculptor. Do not replace configured
Clay columns with agent research or manually drafted copy. Inspect the live UI,
insert actual source-column tokens, disable each column's Auto-run before saving,
and verify the saved configuration. Test no more than five selected rows per
live test; inspect scope before running. Do not send, launch, activate, or
schedule campaigns. Keep incomplete configuration and unverified outputs explicit.

Retrieve the Clay navigation skill, map, and procedure before exploring again.
Reuse the existing `docs/plans/LEARNING-TO-ACT.md` design: retain procedure, map,
preference, and strategy separately; replay before promoting a procedure; infer
parameters only from multiple observed instances. A UX receipt or graph route
is a partial learning aid, not a free-form recorder, automatic distiller,
retrieval engine, registry, or proof of mastery. Preserve failed attempts and
corrections with private evidence, and share only reviewed generalized lessons.

## Choosing the route, enforced 2026-10-06

Default to Clay-native for bulk work: rows into a Clay table (Find People or
import), enrichment columns (Work email waterfall, Validate email, AI or
Claygent with a source field), price ONE row from the credit balance before and
after, then Run column and send the table or audience to the campaign.
`.claude/hooks/clay-native-guard.sh` refuses shell loops of per-row Clay
workflow or action test runs, because on 2026-10-05 that pattern took a night
and a Claygent loop burned ~3,400 client credits on 150 rows (~21 credits a row)
before anyone priced a row.

Use graph engineering instead when it is cheaper than the credit spend and the
data is reusable: firm -> invested_in -> company -> in_sector, built once from
each firm's own portfolio page (free HTTP, a no-tools model, a Jev check per
edge, `zeutara-gtme/scripts/portfolio_graph.py`), then walked per lead.
Measured 2026-10-05: zero Clay credits, but only 10 of 309 leads got a line,
because most portfolio pages are logo-only. Decide by cost per verified usable
line, not by habit.

A live campaign does not pull in contacts added to its segment after launch
(2026-10-06, a live campaign stayed at 18 leads when its segment grew to 53). Finish
the segment, then launch; add later contacts as a new campaign.

Build the suppression list from actual sends (campaign activity, analytics, the
send log), never from enrollment. On 2026-10-05 every contact ever enrolled in a
paused campaign was treated as emailed, which hid ~1,400 never-emailed contacts
of the client's own list for a whole night.

Suppression is also everyone who must never be emailed again, whether or not
we sent: anyone who replied (any class, any campaign, unmatched threads too),
unsubscribed, bounced, or was labelled not a fit, plus the client's
`do_not_contact` entries and `blocklist_files` in `clients.json` (Clay's global
blocklist has no CLI read in clay 1.8, so export it and name the file there).
A blocked domain suppresses every address at it and prints as `*@domain`.
`gtm suppress --client NAME --csv` gives `email,last_sent,reason`, and an
address stays suppressed after its campaign is deleted in Clay. `--client`
takes an exact name or id, never a substring.

## Client Slack access, corrected 2026-10-09

A person moved between Slack workspaces keeps two user ids: the Slack Connect
copy from the old workspace and their own account in the new one. Tag and
approve by the id `users.lookupByEmail` returns in the workspace the channel
lives in. On 2026-10-10 every Zeutara card tagged Jonah's retired-workspace
copy (U0C0PL92WTC) and he never got pinged; Caleb: "it needs to tag the one
that is signed into the workspace". His real id is U0C7RCPJPM5.

Check the names a feeder sends before they reach a client card. Every Zeutara
lead name arrived with a stray trailing "e" ("Gary Zimmermane"); Togari strips
it now (leadNameTrailingE), but the fix belongs in the feeder column.

When a client can't be added to a client channel ("This user can't be added"),
check which workspace their Slack account is signed in through before guessing.
On 2026-10-09 Jonah couldn't be added to #zeutara-cold-replies in the Amber
workspace. The agent blamed the expiring external-collaboration trial; Caleb
found the real cause: "it ws bc jonah was signed in through the prev workspace",
the misspelled Amber Intellegence one. A guessed cause sent as fact costs a round.
Say what you checked and what you're inferring.

Texts to teammates like Maggie go as short pieces sent one after another, each
under ~60 words. If she asked numbered questions, answer with matching numbers,
one short text per number (2026-10-09: a 126-word block got split, then Caleb:
"She asked in numbered format").

## Grant-winner lists: timing and email checks, 2026-10-30

For a list built from SBIR/STTR winners (OPTRA, 10/30):

- The SBIR.gov bulk file (`award_data.csv`, 207,731 rows) stops at Award Year
  2024, with 23 rows in 2024. Joining 2025 and 2026 winners to it matched their
  old awards and called every one "ended". Don't use it for timing.
- `api.www.sbir.gov` answered `{"message":"Forbidden"}`. Use the agencies:
  NSF award end dates from `https://api.nsf.gov/services/v1/awards/<id>.json?printFields=startDate,expDate`,
  NIH from a POST to `https://api.reporter.nih.gov/v2/projects/search` with
  `{"criteria":{"project_nums":[...]}}` (`project_end_date`). Those covered 137 of
  265 rows. DoD, NASA and USDA stayed blank, so say so.
- An end date isn't the day the money's gone (no-cost extensions, Phase II
  applications go in before Phase I ends). Say "award period ending", never
  "run out of money".
- Check every email before a list goes to a client: treg
  `millionverifier.people.email.verify` cost $0.00178 a call, 258 emails for
  about 46 cents (140 ok, 106 catch-all, 11 invalid, 1 unknown). Send the
  confirmed ones first and watch bounces before the catch-alls.
- Before pricing outbound for a client, put their own price next to ours. The
  benchmark funnel is 1 to 2 customers per 1,000 contacts, so a 2 to 4K a month
  retainer can't pay back for a product sold at $39 to $129 a month.
