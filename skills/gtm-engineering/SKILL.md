---
name: gtm-engineering
description: "Chewbacca's growth engineer: outbound campaigns that book meetings. Cold email, lead lists, ICP, signals, Clay enrichment, sequences, deliverability, replies. For GTM, GTME, Zeutara or Jonah work."
triggers: >-
  Chewbacca's growth engineer: run outbound campaigns that turn an offer into booked meetings, the way top agencies do. Demand generation, cold email, lead lists, ICP and signals, Clay enrichment, sequences, deliverability, reply rates and reply handling. Use when asked to set up or fix an outbound campaign, book meetings, get money in the door, build a list, write cold email copy, run GTM for a client like Jonah or Zeutara, learn how agencies run demand gen, or make Chewbacca better at GTM. Also fires on: pipeline, prospecting, lead gen, outreach, Clay, ICP, growth engineering, GTME.
---

# GTM engineering

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
- "Never lie to me bro": report the blocker list as it stands, the same turn,
  even when it is long.
- "Never tell anyone to press anything in clay themselves": the agent starts
  a graded draft with `chewbacca clay campaign-status ... status=START`.
- "Fuck perplexity it's too expensive": no paid per-lead line without his
  yes on the credit cost; a second variant can be free (reordered founder
  story vs number first, as on 10-12).
- "Everything should be togari": agents never post in a client's Slack as
  him. client-post-guard refuses it; Togari's bot is the voice there.
- Credit the right person: the Perplexity line was Maggie's process, Sagar's
  rule was only "2 variants of 3 messages". Name whose rule it is before
  citing it.

Everything BMA has built is in [references/bma/](references/bma/README.md):
how the live Togari bot classifies and answers replies, the bar a reply must
clear before it sends with nobody looking, its scoring rubrics and vendor
recipes, and BMA's published offer and case-study numbers. Read
`references/bma/reply-handling.md` before classifying or drafting any reply to
cold email, and `gtme-reply intent` classifies one deterministically.

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
   - `chewbacca gtme list` builds the free list (`chewbacca api`, `gtme-signals formd`).
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
  `--lines` only to override it (lesson `firm-foundation-lines-not-passed`).

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

## Start from the lesson ledger, and add to it (2026-10-16)

Before planning any campaign, list, table or copy change, run
`chewbacca gtme lesson plan "<what you're about to build>" --client NAME` and
run every check it prints. On 2026-10-16 Sabo's chain rediscovered by hand
the off-domain-email failure that Zeutara's lists had shown on 10-03. The
ledger (`team/gtme-lessons/`) now hands that check over. When an experiment
ends, success or failure, record it: `chewbacca gtme lesson template`, fill it
in, `chewbacca gtme lesson add FILE`. Later results go through `gtme lesson
record ID`, which keeps the old verdict in history. The oracles refuse a
`confirmed` built on a Clay category, an unchecked email domain, cost per
attempted row, a proxy score or under 500 per arm, so write `observed` or
`inconclusive` when that's what the evidence supports. The design is in
`docs/plans/GTME-MEMORY.md`.

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

Reply counts that disagree across sources, and replies read from a snippet: `chewbacca gtme lesson plan "reply handling"` (lessons `zeutara-reply-coverage-gap`, `zeutara-reply-text-not-category`).

## Three more from the all-night GTME session, 2026-10-11

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

## Sabo takeover lessons, 2026-10-16

- Buyer search, parent domains, `identifiers_only`, off-domain emails, Jev's
  score floor, cost per verified buyer and flipping the client's list are in
  the ledger: `chewbacca gtme lesson plan "find the buyer at a brand"`. Before
  touching a Clay table run `python3 -I tools/table_graph.py <table id>`
  (`gtme lesson show sabo-table-graph-before-touching`). The working chain is
  `~/Downloads/Sabo handoff/claude/live_chain.py`; team memory
  `reference_clay_people_search_finds_buyers`.
- **Bind columns in Clay, not by hand.** Caleb: "make sure we're following
  best practices for handling column to column flow". Codex found Scout by
  search, then pasted her URL into the Findymail input through the UI. Build
  people search, then a formula that picks the buyer by title, then Findymail
  on that formula, then ZeroBounce on the email, so a new row runs end to end.
  `add-column` only makes plain columns, so formula and enrichment columns are
  built once in the UI.
- **Inside a cap he set, don't ask again.** Caleb, 2026-10-16, after three
  approval asks in an hour for the same brands: "Fix chewbs you shouldn't be
  asking for permission maybe its bc im in the claude app instead of the vscode
  one". It wasn't the app. The asks were the agent's own. Reruns, retries and
  keyword fixes on the approved brands under the approved credits just run.
  Asking again is only for new brands or for going over the cap.
- **A missing Clay read is a build, not a reason to open Clay.** Caleb: "We
  should work towards never opening clay". When a read fails, map the endpoint
  into `chewbacca clay` (row `fields=`, views and view-order paging landed on
  fix/bg-nav, 3d9c8ace) instead of working around it in the UI.
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

## Never call a launch ready without `gtme ready`

- **Never say a launch is ready, good to go, "good until X", "only waiting on
  X" or "just needs X" until `chewbacca gtme ready --client <name> --drafts
<drafts.json>` prints READY.** Caleb, 2026-10-12: "DONT TELL ME UR READY IF
  THIS SHIT IS HAPPENING? FIX CHEWBS BRO UR SUPPOSED TO BE A GTME". What that
  launch actually looked like is lesson `zeutara-ready-claim-ungraded`. The command grades every draft through all five gates, checks the pre-send
  receipt and owed replies, and counts NOT CHECKED as a blocker. Report its
  NOT READY list as it stands. The Stop hook `ready-guard.sh` refuses a
  readiness claim without a signed READY under 2 hours old.

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
workflow or action test runs.

Use graph engineering instead when it is cheaper than the credit spend and the
data is reusable: firm -> invested_in -> company -> in_sector, built once from
each firm's own portfolio page, then walked per lead. Decide by cost per
verified usable line, not by habit.

Finish a segment, then launch; add later contacts as a new campaign. Build the
suppression list from actual sends (campaign activity, analytics, the send
log), never from enrollment.

What set those four, each readable with `chewbacca gtme lesson show <id>`: lessons `zeutara-unpriced-per-row-loop`, `zeutara-portfolio-graph-coverage`, `zeutara-live-campaign-segment-frozen`, `zeutara-suppression-from-enrollment`.

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

Check the names a feeder sends before they reach a client card (lesson `zeutara-feeder-trailing-e`).

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
