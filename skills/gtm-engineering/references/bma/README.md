# GTM references distilled from BMA's repos

Every rule Chewbacca needs is in the files in this folder. They're written to
stand alone: someone who installs Chewbacca with no access to any private repo
gets the full rubrics, numbers, vendor gotchas and checklists from these docs.

| File                                     | What's in it                                                                                                                                                                                                                                                    | Open it when                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [scoring.md](scoring.md)                 | Primary-contact rubric, account tiers and escalation band, relationship strength, the 1 to 10 signal score with the HOLD rule, lead-scoring constants and routing tiers, company-name variants, affiliation and mismatch checks, the personal-email domain list | Scoring contacts, accounts, leads or signals; deduping; checking an enriched contact belongs to the account |
| [vendor-recipes.md](vendor-recipes.md)   | Perplexity Computer over MCP, ZoomInfo auth and endpoints, Exa, Clay webhooks, Smartlead, BigQuery and Slack gotchas                                                                                                                                            | Calling or wiring any of those vendors                                                                      |
| [clay-playbook.md](clay-playbook.md)     | List hygiene, sources, prompt rules, column colours, templates, the credit table, webhook setup                                                                                                                                                                 | Building or running a Clay table                                                                            |
| [outbound-rules.md](outbound-rules.md)   | Send limits and warmup, channel character limits, compliance, persona email rules, the banned-phrase list, the 7-point review, call scripts, meeting briefs, client onboarding, coded versus configured                                                         | Planning a campaign, writing or reviewing copy, prepping a call or meeting, onboarding a client             |
| [reply-handling.md](reply-handling.md)   | Classifying, cleaning and answering replies to cold email, and when a reply may send unreviewed                                                                                                                                                                 | Any reply to outbound                                                                                       |
| [objections.md](objections.md)           | The four-beat answer to the seven objections a company raises when BMA sells it a service                                                                                                                                                                       | A prospect on an ABM account pushes back in a reply or on a call                                            |
| [offer-and-proof.md](offer-and-proof.md) | The offer, case-study numbers and ICP as BMA publishes them                                                                                                                                                                                                     | Pitching the service or needing a real engagement number                                                    |

## For maintainers only

The source repos live in the private `bluemodernadvisory` GitHub org (four
repos, checked 2026-10-09: 3 private, 1 public). Maintainers with access keep
clones at `~/code/work/bma/<name>` and resync the docs above from them. Pull
before re-reading:
`for r in ~/code/work/bma/*/; do git -C "$r" pull --ff-only -q; done`.

The clones are only for resyncing. Nothing in Chewbacca reads them at run time,
and a user without them loses nothing.

| Repo            | Distilled into                                                                                                | Maintainer map                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| togari-platform | scoring.md, vendor-recipes.md, outbound-rules.md, reply-handling.md (code ported to `gtme-reply`)             | [togari-platform.md](togari-platform.md)                 |
| togari-sandbox  | scoring.md, clay-playbook.md, outbound-rules.md                                                               | [togari-sandbox.md](togari-sandbox.md)                   |
| bma-website     | offer-and-proof.md                                                                                            |                                                          |
| togari-gtm-os   | objections.md; the rest is mapped, not yet ported                                                             | [togari-gtm-os-and-dedup.md](togari-gtm-os-and-dedup.md) |
| togari-dedup    | Superset of gtm-os plus the DNC and dedup layer; gtme-dedupe already covers matching                          | [togari-gtm-os-and-dedup.md](togari-gtm-os-and-dedup.md) |
| claude-context  | Nothing. It's a one-commit April fork of Chewbacca itself; every file is older than its Chewbacca counterpart |                                                          |

scoring.md, vendor-recipes.md, clay-playbook.md and outbound-rules.md each
carry a "Synced from" line with the commit they were read at. Bump it when you
resync.

togari-platform is the live bot on Railway, so a push to its main deploys.
Never push to it from a Chewbacca session unless the task says to.
