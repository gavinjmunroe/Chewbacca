# Roadmap

Reconciled 2026-10-02. [BACKLOG.md](BACKLOG.md) owns statuses and acceptance; [evidence](docs/BACKLOG-EVIDENCE.md) owns the supporting observations. This file orders work without turning historical wishes into execution authority.

## Next batch

These are independent audits, each bounded to roughly one focused session. Estimates are planning caps, not performance claims. Shared backlog edits are serialized through the reconciliation owner. Each task returns a scoped report and stops at its boundary; unresolved work receives a next action rather than an unsupported completion.

| Task                            | IDs                          | Bound and output                                                                                                              | File ownership / dependencies                                                                                                 |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| N1: learning evidence audit     | CB-47, CB-0, CB-500, CB-501  | 60-90 min: validate ledger schema, failed IDs and comparable-run requirements; design smallest sealed baseline/candidate test | Read fitness/evolve and private evidence; own isolated report only. No paid/model runs or automatic promotion.                |
| N2: installer contract checks   | CB-250, CB-251, CB-252, CB-2 | 60-90 min: isolated merge/minimal fixtures and authenticity gap report                                                        | Own fixture/report only. Read setup/start; setup.sh is concurrently dirty, so implementation edits require ownership handoff. |
| N3: routing accuracy audit      | CB-3, CB-34                  | 60-90 min: freeze labeled positive/negative/machine prompts, run deterministic router and report errors                       | Own fixtures/report only. No changes to global hooks, selected runtime or active review files.                                |
| N4: bounded staleness inventory | CB-26, CB-214, CB-41         | 90 min: all tracked file families indexed; inspect highest-risk 20 with unread remainder explicit                             | Read-only repository inventory; own report. Do not turn inventory coverage into completed review.                             |
| N5: deployed-site follow-up     | CB-504                       | 45-60 min: redirect chain, route behavior and rendered-flow evidence; concrete repair proposal                                | Separate site repo; read-only checks and a repair proposal, with DNS, deployment and purchases outside scope. CB-4 initial release is satisfied.        |

N1-N5 have no execution dependency on each other, but they share machine resources. Run one heavy local job at a time; concurrency is optional and must fit actual host limits. Do not duplicate existing review, HUD cancellation or second-brain tasks.

## Subsequent batches

- Reliability: CB-116/201 suite scheduler and test repair, CB-42 Cap registry diagnosis, CB-29/205 HUD diagnostics. Start scheduler changes only after the review-tooling owner hands off shared test files. Each is a separate task, not one broad repair prompt.
- Experience: CB-45 portal input/render battery first; then CB-10/21; then CB-39; finally CB-43/49. Voice parity CB-44 depends on routing accuracy CB-3 for acceptance. Sound CB-13 can be designed independently; do not alter live playback by default.
- Research: CB-106 supplies the refusal filter for CB-107/108/110. Identify CB-109's model and CB-111's vector-transition before designing them. CB-114 cost/quality evidence and CB-0 verified selection precede CB-113's continuous-operation proposal.
- Product: CB-513 verifies the Mac install, then CB-255 verifies Windows; parent CB-2 requires both. CB-130 requires a defined beta and the Mac milestone; platform-specific unsupported capabilities must be explicit. CB-252 authenticity is distinct from ordinary checksums.
- Private workflows: CB-1/17/18/19/213 remain in their owning private workspace. Recover current mapping and authority, verify test-row outcomes, then consider CB-6 offline outreach learning. This document authorizes no outbound action.
- Learning and broad capability: CB-32/112/209/509/510 need untouched tasks and delayed retention; CB-511 also requires unaided learner outcomes. CB-512 preserves lower-level adaptation research without changing runtime. CB-5/7/51/208 retain research, workflow and animation scope; CB-14/15/16/22/23/40/206/207/210/211/212 remain separately bounded capability tracks.

## Original request crosswalk

The original thirty requests are preserved even where the older roadmap called them done, absent, or blocked. The original word-for-word roadmap is retained privately.

| Original request number | Canonical ID |
| ----------------------- | ------------ |
| 1                       | CB-22        |
| 2                       | CB-5         |
| 3                       | CB-130       |
| 4                       | CB-12        |
| 5                       | CB-24        |
| 6                       | CB-212       |
| 7                       | CB-212       |
| 8                       | CB-2         |
| 9                       | CB-23        |
| 10                      | CB-14        |
| 11                      | CB-15        |
| 12                      | CB-20        |
| 13                      | CB-20        |
| 14                      | CB-13        |
| 15                      | CB-19        |
| 16                      | CB-16        |
| 17                      | CB-17        |
| 18                      | CB-18        |
| 19                      | CB-213       |
| 20                      | CB-10        |
| 21                      | CB-21        |
| 22                      | CB-25        |
| 23                      | CB-207       |
| 24                      | CB-206       |
| 25                      | CB-208       |
| 26                      | CB-209       |
| 27                      | CB-210       |
| 28                      | CB-214       |
| 29                      | CB-211       |
| 30                      | CB-23        |

Original defect crosswalk: B1/B2 → CB-200/45; B3 → CB-116; B4/B5 → CB-201; B6 → CB-202; B7 → CB-30; B8/B9 → CB-203; B10 → CB-204; B11/B12 → CB-205.

## Principles retained

Verify observable behavior and permit/refuse cases. Measure before tuning. Separate identity, source provenance and execution dependencies. Use a continuous field for continuous visual effects rather than piling up shapes. Keep client/personal evidence private. A source read, code change, passing test, deployment, and retained learning are separate claims. Publishing tested procedures to main requires a later explicit release scope.
