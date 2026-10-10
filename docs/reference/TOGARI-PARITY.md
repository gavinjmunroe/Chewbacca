# Togari parity

Every capability in BMA's Togari platform (`togari-platform`, TypeScript on
Railway, read at `6ef088b` on 2026-10-10) and what answers the same question in
Chewbacca. Togari is BMA's; Chewbacca is Caleb and Gavin's and BMA uses it as a
service, so anything GTM work needs from Togari should run here without a
Togari login or a trip into Clay.

Status:

- **HAVE**: Chewbacca already did this before 2026-10-10, and it ran today.
- **PORTED**: ported on 2026-10-10 with Togari's own test cases.
- **GATED**: Chewbacca has it as a write that refuses without a person typing
  the op name at a real terminal (`chewbacca clay` writes). Never sent by an agent.
- **PARTIAL**: Chewbacca covers part; the gap is named.
- **MISSING**: not here. The last column says why and the gate it would need.
- **N/A**: Togari server plumbing with nothing for a local kit to do.

Counts, 63 rows: 16 HAVE, 10 PORTED (6 Togari ports, 4 rows of new Clay
reads), 2 GATED, 13 PARTIAL, 18 MISSING, 4 N/A. Of the 18 MISSING: 2 are
local computation with nothing to feed them here (cross-validation needs
ZoomInfo and Enformion records; the platform-limits ontology is not GTM
work), 2 are reads blocked on a credential that lives only on Togari's Railway
service (ZoomInfo search, Fireflies), 1 needs read access to Togari's
warehouse, and 13 send, spend credits, call a paid model, write Togari's or a
client's systems, or need a hosted server.

Every "ran" below was run on 2026-10-10 from a worktree of `origin/main` on
Caleb's Mac (load average 50 to 75), exit 0 unless noted. Live Clay reads ran
against a real client workspace, read only.

## Clay

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Read Clay: tables, rows, columns, run status, campaigns, analytics, inbox, threads, credits, signals, workflows, blocklist | none natively; Togari only receives Clay webhooks | HAVE: `chewbacca clay <op>`, 27 reads | `chewbacca clay ops`; `workspaces` and `workflows` live, 650 to 700 ms |
| Credit spend by table and column, campaign enrolled leads | none | HAVE, fixed today: `credit-usage`, `campaign-leads` | Both refused on main before any call ("dry run does not handle slot step query:days"); fixed, measured live 932 and 960 ms, regression test in `tests/test_chewbacca_clay.py` |
| Mailbox health: daily limit, sent today, SMTP/IMAP errors, warmup reputation | none (Clay UI, Email accounts tab) | PORTED as a Clay read: `sender-accounts` | 146 mailboxes, one call, 867 ms, measured |
| Campaign bounce health, activity feed | none (Clay UI, campaign page) | PORTED as Clay reads: `bounce-health`, `campaign-activity` | measured 908 and 624 ms |
| Table size, change history, sources; segment history | none (Clay UI) | PORTED as Clay reads: `table-count`, `table-history`, `table-sources`, `segment-history` | measured 882 to 937 ms |
| Did a workflow run, which step failed (Togari's reply, blocklist and forward webhooks land in Clay workflows) | `src/replies/autopilot.ts` posts; no read back | PORTED as Clay reads: `workflow`, `workflow-graph`, `workflow-runs`, `workflow-run`, `workflow-run-steps` | a real blocklist webhook run read step by step, 530 to 925 ms |
| Clay import audit (`togari_clay_list_imports`, `togari_clay_get_import`) | `src/mcp/tools/clay.ts`, `src/ingest/clay/*` | PARTIAL: Chewbacca reads the Clay side (`workflow-runs`, `table-sources`); Togari's own audit table is in its BigQuery | Clay side ran live; Togari side needs warehouse read access |
| Preview rows a push would send (`togari_clay_list_pushable`) | `src/mcp/tools/clay-outbound.ts` | MISSING: reads Togari's BigQuery warehouse | needs read access to that warehouse (the Chewbacca Live tab is adding a togari-platform read endpoint) |
| Push warehouse rows or clients into a Clay table (`togari_clay_push`, `togari_clay_push_clients`, `togari_clay_enrich`) | `src/icp/clay-push.ts`, `src/mcp/tools/clay-outbound.ts` | GATED: `chewbacca clay add-rows` (write:table-data; auto-run columns may spend credits) | `--dry-run` builds the request in tests; never sent |
| Receive Clay webhooks with HMAC (`routes/ingest/clay*`, `icp-callback`) and the Clay connector actions (`routes/clay-connector`) | `src/routes/ingest/*`, `src/ingest/clay/hmac.ts` | N/A: needs a public server; Chewbacca reads Clay instead of being called by it | not run |

## Replies

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Reply intent (unsubscribe, bounce, positive, referral, OOO, ...) | `src/agents/smartlead-responder/reply-intent.ts` | HAVE: `gtme-reply intent` | ran on "Please remove me from your list."; `tests/test_gtme_reply.py` carries every TS case |
| Clean reply HTML to what the person typed | `reply-text.ts` | HAVE: `gtme-reply clean` | `tests/test_gtme_reply.py` |
| May a drafted reply auto-send | `auto-send.ts` | HAVE: `gtme-reply autosend` | `tests/test_gtme_reply.py` |
| Readable reply card, campaign name split | `fit-review.ts` | HAVE: `gtme-reply campaign` | `tests/test_gtme_reply.py` |
| Lead name cleaning, auto-reply detection | `src/replies/lead-name.ts`, `card-copy.ts` | HAVE: `gtme-reply name`, `names`, `ooo` | `tests/test_gtme_reply.py` |
| Model-written reply draft with sentiment and track | `smartlead-responder/classifier.ts`, `campaign-strategies.ts` | PARTIAL: deterministic intent only; no model draft | a draft is local, but it calls a paid model; the send behind it needs write:sends-email |
| Answer, forward, blocklist from the reply bot | `src/replies/autopilot.ts` | GATED: `chewbacca clay reply`, `forward`, `blocklist-add` (write:sends-email, write:suppression) | `--dry-run` bodies in tests; never sent from here |
| Reply cards and buttons in the client's Slack | `src/replies/decks.ts`, `queue.ts`, `store.ts`, `smartlead-responder/slack-actions.ts` | MISSING | gate: write:client-channel, Caleb signs off on the card and the channel |
| Per-client voice and sender | `src/agents/replybot/client-config.ts` | PARTIAL: `~/.chewbacca/gtm/clients.json` and each client's `DECISIONS.json` | `chewbacca gtm clients` ran |
| Smartlead API reads | `smartlead-api.ts` | HAVE through Clay's sequencer (Clay runs on Smartlead): `campaign-stats`, `campaign-activity`, `inbox`, `thread` | live reads above |

## Do not contact

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Is this address or domain suppressed, and why | `src/dnc/service.ts` `check`, `guard.ts` | PORTED: `gtme-dnc check` across the GTM graph, DNC CSV exports, a saved or live Clay blocklist | `tests/test_gtme_dnc.py` (Togari's cases plus two stricter ones); live check against the graph and a Clay blocklist, 1,108 entries |
| List suppressions | `service.ts` `list`, `routes/portal/dnc.ts` | HAVE: `chewbacca gtm suppress --client NAME`, `chewbacca clay blocklist` | `gtm suppress --json` ran, 123 ms |
| Suppress or unsuppress | `service.ts` `suppress`, `unsuppress` (BigQuery `togari_dnc`) | MISSING for Togari's table; GATED on Clay's side (`blocklist-add`, `blocklist-remove`, `blocklist-add-bulk`) | gate: write:suppression with a person at the terminal |
| DNC tools for the agent loop | `src/dnc/tools.ts` | HAVE: `gtme-dnc` is the tool | as above |

Two deliberate differences in the port, both toward not emailing someone:
Togari fails open when BigQuery errors (the send goes ahead); `gtme-dnc`
answers "unknown" and exits 2. And Togari's SQL matches an email's domain
against every row's `company_domain`, so one opted-out contact silences the
whole company; its own test describes a domain block as a row with no email,
which is what `gtme-dnc` matches. `--company-wide` reproduces Togari exactly.

## Scoring and ICP

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Inbound lead score and work-email test | `src/routes/website/index.ts` `scoreIcpLead`, `isWorkEmail` | PORTED: `gtme-score lead` | every case in `website.test.ts`, in `tests/test_gtme_score.py` |
| Does this contact belong to that company | `src/agents/scoring/affiliationScoring.ts` | PORTED: `gtme-score affiliation` | hand-worked cases, Jaro-Winkler against the textbook value |
| Which contact at a company to email | `src/enrichment/primary-contact-resolver.ts` | PORTED: `gtme-score contact` (rule pass; a tie within 5 is flagged, not decided) | every case in `primary-contact-resolver.test.ts` |
| Tier 1/2/3 from fit score, reach and size band | `src/enrichment/tier-assigner.ts` | PORTED: `gtme-score tier` (rule pass; within 5 of a line is flagged) | every rule-path case in `tier-assigner.test.ts` |
| Contact quality score, completeness, who still needs an email or phone | `src/agents/scoring/qualityScoring.ts` | PORTED: `gtme-score quality` | upstream has no tests; cases worked from the source in `tests/test_gtme_score.py` |
| Cross-validation and address proximity | `src/agents/scoring/crossValidation.ts` | MISSING, local compute | merges ZoomInfo and Enformion records by phone and address; neither source is reachable here, so there is nothing to feed it. Port it with the first of those two |
| Company name cleanup | `src/agents/scoring/companyNameUtils.ts` | PARTIAL: `normalize_company_name` in `gtme-score`; `playbook-company-name-cleaning` skill | `tests/test_gtme_score.py` |
| Fit reasoning against a thesis | `src/enrichment/perplexity-reasoner.ts` | MISSING | spends Perplexity credits; gate: write:spends-credits with a priced first row |
| Mandates, tiering runs, enrichment runs, their costs | `src/mcp/tools/{mandates,tiering,enrichment,costs}.ts`, `src/worker/*` | PARTIAL: `gtme start` writes the ICP and plan; runs MISSING | runs spend Perplexity and Anthropic credits; gate: write:spends-credits |
| Website ICP funnel: job store, push to Clay, email the list back | `src/icp/*` | PARTIAL: `gtme start` and `gtme list` build an ICP and a deduped first list locally | sending the list is write:sends-email |
| Clay credit spend | `togari_costs_*` covers Togari's own runs | HAVE for Clay: `chewbacca clay credit-usage`, `gtm-memory credits` | both ran |

## Enrichment providers

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Exa search, similar, contents, answer | `src/integrations/exa/*`, `src/mcp/tools/exa.ts` | MISSING | every call bills Exa, and there is no Exa key on this Mac. Gate: write:spends-credits plus the key. `scrape` (one public page) and the deep-research skill cover reading |
| ZoomInfo company and person search (free) | `src/integrations/zoominfo/*` | MISSING | a free read, but ZoomInfo credentials live only on Togari's Railway service. BLOCKED on the credential |
| ZoomInfo company and person enrich, lookalikes (1 credit each) | same | MISSING | gate: write:spends-credits plus the credential |
| AI column written back onto a CRM record (`togari_enrich`) | `src/enrich/service.ts` | MISSING | writes Togari's CRM and calls a paid model |
| Structure free text into typed fields (`togari_structure`) | `src/enrich/service.ts` | PARTIAL: `chewbacca jev` typed decisions | `jev --help` ran |
| Enrichment agent loop | `src/agents/enrichment/*` | MISSING | model loop that spends provider credits |
| Perplexity Computer tasks | `src/perplexity/*` | HAVE: `perplexity-tab` drives Perplexity in Caleb's own tab | `perplexity-tab --help` ran |

## Source of truth: clients, tasks, context, pipeline

| Capability | Togari location | Chewbacca | Verified how |
| --- | --- | --- | --- |
| Ask anything about clients, tasks, context (`togari_ask`) | `src/v1/service.ts` | PARTIAL: `gtm client`, `gtm lead`, `gtm-memory contact/account`, `people brief` | `gtm funnel`, `gtm-memory credits` ran |
| Clients list and get | `v1/service.ts` | HAVE: `gtm clients`, `gtm client NAME` | ran, 105 ms |
| Client upsert and delete, reset | `v1/service.ts` | MISSING for Togari's tables | Togari DB writes; Chewbacca keeps clients in `clients.json` |
| Tasks add, update, list, delete | `v1/service.ts` | HAVE: `work-ledger`, `team` board | both `--help` ran |
| Context add, move, delete | `v1/service.ts` | PARTIAL: second brain notes and `people` | not a Togari write |
| Ingest a CSV, file or text; ingest status | `src/ingest/universal/*`, `v1/service.ts` | PARTIAL: `ingest` (file to text), `chewbacca import`, `gtm-memory ingest` | `ingest --help` ran |
| Pull Gmail, calendar, Slack on command | `src/sources/*`, `src/pdw/adapters/*` | HAVE: `chewbacca email` (gws), `mac calendar`, `chewbacca slack` | all three `--help` ran |
| Fireflies meetings | `src/sources/fireflies-fetch.ts` | MISSING: Chewbacca reads meetings from Anarlog on device | no Fireflies key here; Anarlog covers Caleb's meetings |
| Companies, contacts, datapoints in the warehouse | `src/mcp/tools/{companies,contacts,datapoints}.ts` | PARTIAL: `gtm-memory account/contact`, `people` (local stores, not Togari's warehouse) | ran |
| Custom fields (`togari_schema_*`) | `src/schema/*` | MISSING for Togari; Clay columns are `chewbacca clay columns` (read) and `add-column` (GATED) | Togari DB writes |
| Pipeline stages, move a deal, activity log, overdue | `src/mcp/tools/pipeline.ts` | PARTIAL: `gtm-memory overdue`, `owe`, `timeline` | deal moves are Togari CRM writes |
| Provision a client from plain English | `src/provision/*` | PARTIAL: `gtme start` (plan from seven questions); `togari_provision_client` writes MISSING | `gtme start --help` ran |
| Person resolver and relationship score | `src/pdw/person-resolver.ts`, `relationship-scorer.ts` | HAVE: `people` (resolve, brief, reconnect ranking) | `people --help` ran |
| Opportunity email: draft, status, approve and send | `src/opportunity/*` | MISSING | drafts with a paid model and sends as Sagar; gate: write:sends-email |
| Cold-call script | `src/dialer/script-builder.ts` | MISSING | model call; no send, so it needs only a model budget |
| Inbox triage TRASH/EASY/COMPLEX with drafts to Slack | `src/email-engine/*` | MISSING | model call plus a post to Slack; gate: write:client-channel |
| BMA Slack assistant (deals, proposals, reminders, meeting intel) | `src/core/*`, `src/agents/client-assistant` | MISSING as a server bot; Chewbacca is the agent in the terminal | needs a hosted bot; gate: write:client-channel |
| Platform limits and guardrails ontology | `src/ontology/*` | MISSING, local data | not GTM-critical; portable as data |
| Admin, client API keys, hello, tenancy, BigQuery, events, workers | `src/mcp/tools/{admin,client-keys,hello}.ts`, `src/tenant`, `src/bigquery`, `src/events`, `src/worker` | N/A | server plumbing |
| Website contact form | `src/routes/website/index.ts` | N/A | BMA site backend |
| OAuth connections store | `src/connections/*`, `src/routes/connections.ts` | N/A | Chewbacca signs in per tool (gws, Slack CLI, Clay session) |

## Why Caleb still opened Clay, and what changed

Three causes, found on 2026-10-10:

1. **The router never sent Clay questions to `chewbacca clay`.** Twelve
   real-shaped Clay questions went through `skill-route.sh`: none reached a
   skill that mentions `chewbacca clay`. A third-party pack (`clay-playbooks`)
   took six, and `clay-navigation`'s description only talked about driving the
   UI. The description now names the questions and the ops; every question
   that says Clay routes to it on the warm path. `tests/live/clay-route.sh`
   holds six of them, two controls and a mutant.
2. **Two reads were broken on main.** Any op with a query slot refused before
   a single call, so `credit-usage` and `campaign-leads` (and `rows` with
   `limit=`) never answered. Fixed in `bin/chewbacca-clay`, with the query
   checked pair for pair against the spec.
3. **Whole screens had no op**: mailbox health, bounce health, a campaign's
   activity, a table's size and history, a workflow's runs and steps. Twelve
   reads were added, each measured live and listed in `chewbacca clay ops`.

What still needs the page: Find People into a table, running empty rows,
configuring an enrichment column, and starting a campaign (`ui_only` in
`library/clay-api/registry.json`). All four are writes.
