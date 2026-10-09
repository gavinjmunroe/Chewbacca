---
name: gtm-engineering
description: "Chewbacca's growth engineer: run outbound campaigns that turn an offer into booked meetings, the way top agencies do. Demand generation, cold email, lead lists, ICP and signals, Clay enrichment, sequences, deliverability, reply rates and reply handling. Use when asked to set up or fix an outbound campaign, book meetings, get money in the door, build a list, write cold email copy, run GTM for a client like Jonah or Zeutara, learn how agencies run demand gen, or make Chewbacca better at GTM. Also fires on: pipeline, prospecting, lead gen, outreach, Clay, ICP, growth engineering, GTME."
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

## Read these first, every time (2026-10-06: skipping them cost a day)

Before building anything for a client, load what already exists, in this order:
the client handoff (`START-HERE.md` in its repo), the team's latest texts and Slack for
their process, the second brain's `wiki/cold-email-craft.md` (founder story beats
recipient personalization; first sends are measurement), and the
`library/learning/clay-navigation` map. Drive Clay with `jev-browse` (goals that work
whatever state a panel is in), fall back to `chewie web eval` only when jev blocks.
Then build it their way and stop.

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

## Grading a campaign before it goes out

Run the five gates in [the playbook's grading section](references/demand-gen-playbooks.md#grading-a-campaign-before-it-goes-out)
in order, and record each verdict: the list scorecard (B or better, every row
verified), the copy rubric (85 of 100 or better, every QA line passing), a
recipient read that ends with nothing material left, a render of every variant
against real leads with no blocking finding, and the four-item start card
(verified count, sequence, ramp, each domain's health). A failed gate goes
back to its own step. Grading never authorizes the send.

## Reuse before building

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

Apply [the decision standards](../../docs/DECISION-STANDARDS.md) to list selection, column assembly, enrichment ordering, copy, model routing and measurement. Compare a deterministic baseline with bounded alternatives; use dependency graphs for column order, constrained routing for enrichment and cost-sensitive classification where justified. Test learned selection policies offline or in shadow before promotion. Measure consequential errors, abstentions and cost per verified usable result. A sourced firm fact does not prove personal investment ownership or mandate fit. Five-row fixtures test function, not business uplift. Use Jev only for narrow typed judgments with validated evidence and abstention; it cannot authorize spending or sending.

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
Reuse the existing `docs/LEARNING-TO-ACT.md` design: retain procedure, map,
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
edge, `scripts/portfolio_graph.py` in zeutara-gtme), then walked per lead.
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
