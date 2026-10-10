# BMA's repos, funneled into Chewbacca

The `bluemodernadvisory` GitHub org holds four repos (checked 2026-10-09 with
`gh api orgs/bluemodernadvisory`: 3 private, 1 public). All four are cloned at
`~/code/work/bma/<name>`. Pull them before re-reading:
`for r in ~/code/work/bma/*/; do git -C "$r" pull --ff-only -q; done`.

| Repo            | What Chewbacca took                                                                                                                  | Read                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| togari-platform | Reply classification, cleaning and the unreviewed-send bar (ported to `gtme-reply`), drafting rules, scoring rubrics, vendor recipes | [reply-handling.md](reply-handling.md), [togari-platform.md](togari-platform.md) |
| togari-sandbox  | Signal and lead scoring, email checklist, Clay playbook, NL-to-BigQuery rules                                                        | [togari-sandbox.md](togari-sandbox.md)                                           |
| bma-website     | The offer, case-study numbers, ICP and team as BMA publishes them                                                                    | [offer-and-proof.md](offer-and-proof.md)                                         |
| claude-context  | Nothing. It's a one-commit April fork of Chewbacca itself; every file is older than its Chewbacca counterpart                        |                                                                                  |

Which file to open:

- Classifying or answering a reply to cold email: reply-handling.md first.
- Pitching BMA's service, or needing a real engagement number: offer-and-proof.md.
- Scoring contacts or accounts, or calling ZoomInfo, Exa, Perplexity Computer,
  Smartlead or Clay webhooks: togari-platform.md sections 2 and 4.
- Signal scoring or the Clay credit table: togari-sandbox.md.

togari-platform is the live Togari bot on Railway, so a push to its main
deploys. Never push to it from a Chewbacca session unless the task says to.
