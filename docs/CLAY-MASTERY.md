# Mastering Clay: how Chewbacca becomes the best operator of one app

Research from 2026-09-23. The question: what would let Chewbacca run Clay
(app.clay.com) more reliably, cheaply and quickly than a person or any other
agent? The general theory of learning a site is in
[SITE-LEARNING.md](SITE-LEARNING.md) and [LEARNING-TO-ACT.md](LEARNING-TO-ACT.md).
This is the plan for one app, and the first place that theory gets tested for
real. What Chewbacca knows about the screens is in
[library/maps/app.clay.com/MAP.md](../library/maps/app.clay.com/MAP.md).

**What would prove this wrong:** Clay's own Sculptor finishing the task suite
below with fewer credits and fewer failures than Chewbacca. If that happens,
the edge is driving Sculptor well, not replacing it.

## Where the opening is

- **Clay is hard and burns money.** On G2 the complaints are led by learning
  curve (16 mentions), then expensive or unclear credits (10). Reddit
  repeats "credit burn" and "you need a Clay expert." One reviewer: the first
  table "took me a weekend, not an afternoon."
  ([CUFinder review](https://cufinder.io/blog/clay-data-enrichment-review/))
  Credits are the pain, which makes spending them carefully the product, not
  a side feature.
- **Clay's own agent surfaces leave gaps.**
  - The agent plugin and CLI (July 2026) build workflows and run routines,
    but cannot create or edit tables.
    ([Clay blog, 2026-07-09](https://www.clay.com/blog/build-on-clay-with-agent-plugin))
  - Sculptor, the in-app copilot, fully handles AI columns and formulas.
    For enrichments, waterfalls and credits it only reads and recommends.
    Run conditions, filters and sorting are "coming soon," and it works in
    Sandbox mode. ([Sculptor docs](https://university.clay.com/docs/sculptor))
  - Tables, which is where most Clay work happens, have no agent that
    operates all of them.
- **The UI changes often.** Clay reorganized the sidebar and navigation in
  June 2026. ([changelog](https://www.clay.com/changelog/product-roundup-week-of-jun-1-2026))
  A map that isn't re-checked goes stale within a quarter.
- **Nobody publishes a benchmark of agents operating Clay.** I searched and
  found none. So "better than anything on the market" can't be measured
  today. The task suite below is how we'd measure it.

## What Clay's terms say about automated access

Read 2026-10-09, before the first client pays for the Clay operator (CHW-150).
Not legal advice: this is a reading of public pages, and a lawyer or Clay
itself decides what they mean.

### What was fetched

| Page                                                                                                                  | Result                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [clay.com/terms-of-service](https://www.clay.com/terms-of-service)                                                    | Loaded. "LAST UPDATED MAY 23, 2024"        |
| [clay.com/dpa](https://www.clay.com/dpa)                                                                              | Loaded. Data processing only, no use rules |
| [Public API rate limits](https://developers.clay.com/public-api/rate-limits)                                          | Loaded                                     |
| [Public API quickstart](https://developers.clay.com/public-api/quickstart)                                            | Loaded                                     |
| clay.com `/terms`, `/legal`, `/acceptable-use`, `/acceptable-use-policy`, `/api-terms`, `/msa`, `/security`, `/trust` | 404. No acceptable use policy found        |
| developers.clay.com/terms                                                                                             | 404. No separate API terms found           |

The Terms of Service contain **no clause on bots, scripts, scraping,
crawling, robots, reverse engineering, or automated access of any kind**. The
whole text was downloaded and searched for those words, not only summarized.
A web-search summary claimed the terms require "each user" to have "their own
account"; that sentence is not in the terms text, so it is not relied on here.

### The clauses that touch it

All from the Terms of Service unless marked, fetched 2026-10-09.

- **Acting for a company** (preamble): "If you're accessing our services on
  behalf of a legal entity (like your employer), you agree that you have the
  authority to bind that entity to these terms"
- **Credentials** (4. User Responsibilities): "You are solely responsible for
  maintaining the confidentiality of your account information, including
  username and password, and for all activities that occur under your
  account."
- **Who did it** (4): "We may assume that any communications we've received
  from your account or the associated contact information have been made by
  you"
- **Account transfer** (4): "You agree not to license, sell, or transfer your
  account without our prior written approval."
- **Credits and data** (4): "you agree not to sell or transfer your Clay
  Credits to any other user without our prior written approval. You also agree
  not to re-sell any data you obtain from Clay."
- **Security, community-scoped** (4): the list opens "while participating in
  any Clay community do not do, try to do, or encourage others to:" and
  includes "Do not engage in activities that could damage or compromise the
  security of an account, network, or system." As written, that list governs
  the Slack community.
- **Capacity limits** (5. Investigations): "Clay has the right to create
  reasonable limits on Clay's use and storage of content, including reasonable
  limits on file size, storage space, or processing capacity."
- **Monitoring** (17.3 Process Integrity): "Clay Labs has the right to review
  and monitor all use of the Services to ensure compliance with this
  Agreement."
- **Unauthorized use** (Settling disputes): "claims of piracy or unauthorized
  use of our services will not be subject to arbitration."
- **Sensitive data** (17.3.1): "You shall not include personal health
  information (PHI) or cardholder data in your data unless explicitly
  permitted in a separate agreement"
- **API rate limit** ([rate limits](https://developers.clay.com/public-api/rate-limits)):
  "The Clay Public API enforces a per-workspace request rate limit. When you
  exceed it, Clay returns HTTP `429` and you should back off before retrying."
- **API purpose** ([quickstart](https://developers.clay.com/public-api/quickstart)):
  "Use the Public API to call Clay from your own applications and services"
  and "Requests authenticate with a Clay API key in the `clay-api-key` header."

Paid plans run on a contract ("your subscription will continue for the
duration laid out in your contract"). An order form or MSA can add terms that
are not public, so each client's own contract has to be read too.

### What that means for each thing Chewbacca does

| Activity                                                                    | Reading               | Why                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clay` CLI and Public API in the client's workspace, with a key it made     | Allowed               | Documented and sold for agents. Honor the per-workspace limit: back off on `429` and CLI exit code `4`.                                                                                |
| Driving the web UI as our own user, invited into the client's workspace     | Ambiguous, leans fine | Nothing bans automation. The client answers "for all activities that occur under" its account, so it should know and agree in writing. Keep the pace human, given the capacity clause. |
| Driving the web UI logged in as the client, with the client's password      | Avoid                 | Not banned in words, but it breaks the confidentiality duty on "username and password" and makes every action look like the client's own.                                              |
| Reading `api.clay.com/v3`, the app's private API, from the page             | Ambiguous             | No clause covers it and no doc offers it. It can change without notice. Use the Public API where one exists.                                                                           |
| Running several clients out of one agency workspace and billing its credits | Prohibited as written | Transferring credits to another user, or re-selling data obtained from Clay, needs Clay's "prior written approval."                                                                    |
| Taking over or handing off a client's account                               | Prohibited as written | No license, sale or transfer of an account without written approval.                                                                                                                   |
| Health or card data in any table                                            | Prohibited            | Section 17.3.1, unless a separate agreement and BAA exist.                                                                                                                             |

The safe shape follows from that: each client pays for its own Clay plan,
invites a Chewbacca operator account as a workspace member, and gets a short
written authorization naming the automation. Credits and data stay in the
client's workspace.

### What to ask

**Clay** (support@clay.run, or the
[Solutions Partner](https://www.clay.com/partners/solutions) team):

1. Is there an acceptable use policy or MSA for paid plans beyond the public
   Terms of Service?
2. May an invited workspace member drive the web app with browser automation,
   and is there a request pace you want kept?
3. Is calling `api.clay.com/v3` from a signed-in session acceptable, or should
   automation stay on the Public API and CLI?
4. What does the Solutions Partner agreement say about an agency operating
   client workspaces?

**Karthik:**

1. Has Amber or Togari already agreed anything with Clay, including a partner
   agreement?
2. Does Zeutara's Clay order form add terms beyond the public ones?
3. Does the server-side Clay automation in Togari use the client's login or an
   invited operator account?

## The design, in order of what pays most

### 1. Route every task to the cheapest surface that can do it

| Task shape                                 | Surface                                 |
| ------------------------------------------ | --------------------------------------- |
| Run a function, workflow or search in bulk | `clay` CLI (routines, searches)         |
| Build an automation that runs unattended   | `clay` CLI (workflows)                  |
| AI column or formula inside a table        | Sculptor, driven through its chat box   |
| Anything else inside a table, or no API    | The UI, through `chrome-js`             |
| Reading how much budget is left            | Settings > Usage, before every paid run |

Driving the screen is the most expensive and most fragile option, so it's the
last resort. Nobody else combines all four surfaces: the plugin ignores the UI,
Sculptor ignores the CLI, and generic browser agents know neither.

The CLI needs `clay login`. That was deliberately not run on 2026-09-23. It
waits on a decision about whose workspace the CLI should act in.

### 2. A credit guard that runs before anything spends money

Clay's own docs list the ways credits get wasted: table auto-run is on by
default, enrichments run on rows that don't qualify, tests run on the full
table, and contacts get enriched twice.
([credit docs](https://university.clay.com/docs/clay-credit-conservation),
[table settings](https://university.clay.com/docs/table-management-settings))
Each of those becomes a check, not a guideline:

1. Read Usage and stop if the estimated cost exceeds what's left.
2. Every table Chewbacca creates starts with auto-run off.
3. Every new enrichment runs on 10 rows first, and a person looks at them.
4. Every enrichment gets an "Only run if" condition that skips qualified-out
   and already-filled rows. "Keep existing results" stays checked.
5. Log what was spent against what was estimated, so the estimate improves.

A person spends credits by accident. Chewbacca shouldn't be able to.

### 3. Keyboard first, since shortcuts survive redesigns

Clay's shortcuts made it through the June navigation redesign, and the
sidebar did not. `Cmd+K` jumps to a table by name, `Cmd+E` opens the
enrichment panel, `Cmd+G` goes to a row, `Space` previews a row, and
`Cmd+Z` undoes. ([shortcuts](https://university.clay.com/docs/keyboard-shortcuts))
A procedure written in shortcuts and URLs holds up longer than one written in
clicks.

### 4. A graph of the app, not a list of pages

UI-KOBE (May 2026) explores an app on its own and stores UI states as nodes
and transitions as edges. Small agents then use the graph to work out where
they are and what to do next.
([arXiv 2605.29534](https://arxiv.org/abs/2605.29534); the abstract gives no
numbers.) For Clay: every page, panel and modal is a node, every URL, click or
shortcut that moves between them is an edge, and every edge is labelled
read-only, writes, or spends. Crawling stays read-only, and edges that spend
money are recorded but never taken during exploration. Planning then becomes
a path search: "the shortest path to the enrichment panel that crosses no
spend edge."

### 5. Explore once, then replay as code

This is what Stagehand, Skyvern and browser-use arrived at independently, as
covered in SITE-LEARNING.md. A 2026 budget-matched study found that feeding
learned text back into the prompt did no better than giving the agent more
steps. Learned code that runs without the model is what helps. So each Clay
task that succeeds once becomes `library/procedures/clay-<task>/`, with locators by
role and visible name, plus a verify step.

### 6. Check the result, not the screen

After every action, confirm the state changed as intended: the column exists,
the row count moved, the run finished. The Clay web app loads its state from
its own JSON API at `api.clay.com/v3` (the workspace, its resources, the
action catalog, usage), which was seen on 2026-09-23 in the page's own network
log. Reading that state directly would be the most reliable check available.
It hasn't been tried: a read of that API from the page was blocked by this
machine's permission check, so it waits on a decision from the person.
Until then, verify through the page text.

### 7. Mistakes become checks

Every mistake goes in the map's "Mistakes already paid for" list and becomes a
check that runs before the next attempt. A paragraph doesn't stop anything; a
check that runs does.

### 8. Watch Clay change

Once a week: read the changelog, re-read every page in the map, and compare.
A control that moved breaks its procedure on purpose, and the model repairs
only that step (Stagehand's self-healing). The map records the date it was
last confirmed.

## The task suite: how the claim gets measured

Ten tasks, each run by Chewbacca and, where it can, by Sculptor. Record
success, credits spent, wall time, and how many times a person had to step
in.

1. Find 25 companies matching a written ICP and land them in a new table.
2. Add a work-email waterfall to that table, test on 10 rows, and stop.
3. Add a conditional run that skips rows without a domain.
4. Build an AI column that classifies each company into one of 4 segments.
5. Write a formula column that scores fit from three existing columns.
6. Export the qualified rows as a CSV.
7. Build a Claygent from the Account Scoring template and test it for free.
8. Find the column that errored the most and explain why.
9. Rebuild a table's logic as a workflow through the CLI.
10. Answer "how many credits would running this on all rows cost" before
    running anything.

All of it happens in a folder Chewbacca owns. Nothing already in the workspace
gets opened for editing, run, or deleted.

## Next to build, in order

1. A `clay` section in `site`: snapshot each mapped page inside the signed-in
   Chrome and diff it against the last snapshot. This is step 8, and it makes
   the map maintain itself.
2. The credit guard (step 2) as a script that every Clay procedure calls first.
3. Tasks 1, 2 and 6 as procedures, in a scratch folder with auto-run off.
4. The graph (step 4) from the pages already mapped.
5. The CLI routing (step 1), once there's a decision about `clay login`.

## Sources

- [Clay agent plugin announcement, 2026-07-09](https://www.clay.com/blog/build-on-clay-with-agent-plugin)
- [Sculptor docs](https://university.clay.com/docs/sculptor)
- [Credit conservation guide](https://university.clay.com/docs/clay-credit-conservation)
- [Table management settings](https://university.clay.com/docs/table-management-settings)
- [Keyboard shortcuts](https://university.clay.com/docs/keyboard-shortcuts)
- [Table columns](https://university.clay.com/docs/table-columns-overview)
- [Product roundup, week of 2026-06-01](https://www.clay.com/changelog/product-roundup-week-of-jun-1-2026)
- [CUFinder's tested Clay review, with G2 and Reddit complaints](https://cufinder.io/blog/clay-data-enrichment-review/)
- [Clay terms of service](https://www.clay.com/terms-of-service) (last updated 2024-05-23; read 2026-09-23 and in full 2026-10-09: no clause on automated access)
- [Clay data processing agreement](https://www.clay.com/dpa) (read 2026-10-09)
- [Public API rate limits](https://developers.clay.com/public-api/rate-limits) (read 2026-10-09)
- [Public API quickstart](https://developers.clay.com/public-api/quickstart) (read 2026-10-09)
- [Clay Solutions Partner program](https://www.clay.com/partners/solutions)
- [UI-KOBE, graph-guided GUI agents](https://arxiv.org/abs/2605.29534)
- [JAMEL, joint memory and exploration](https://arxiv.org/abs/2606.01528)

Built with Chewbacca
