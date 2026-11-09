# Backlog evidence, 2026-10-02

Scope: reconciliation and planning at local HEAD `3cd8ec67dc4b9083b5c3596b49be87857541a905`, with pre-existing dirty review, hook and HUD changes. Those changing bytes have no new release or full-review certification from this task. Dates use America/Los_Angeles; some receipts fall on 2026-10-03 UTC. No commits, pushes, publication, messages or paid/model benchmark runs were performed.

## E0: selection, preservation and identity

Read `AGENTS.md`, `bin/backlog`, the selected root `BACKLOG.md`, root `ROADMAP.md`, `docs/ROADMAP.md`, and workspace-scoped work-ledger entries. `bin/backlog.backlog_file()` actually selected the checkout. Source precedence is explicit private environment directory, default private directory, checkout. Neither private candidate supplied a file in this run. No source selection logic was changed.

The pre-edit three documents are preserved byte-for-byte with SHA-256 hashes and request crosswalk in the existing private store's dated backlog-reconciliation record. This avoids retaining client, personal-policy and private-message details in public files. The 65 numbered original rows map to 65 canonical IDs, including disambiguation of legacy 30b and duplicate 51. All 30 original roadmap requests have a crosswalk. H entries preserve historical completion claims for later verification. No source was discarded merely because its old status said done.

The CLI expects numeric IDs and an H2 named Now, and only renders table rows. The new first column remains numeric, Now contains only remaining work, and all entries appear in tables. Rich acceptance criteria remain in Markdown because CLI output is deliberately abbreviated. The inbox's lexical matching is not evidence of exhaustive request capture.

## E1: public site observation

Read-only HTTP requests through Python urllib on 2026-10-02 returned:

| URL                       | Status | Observed title                                           |
| ------------------------- | ------ | -------------------------------------------------------- |
| https://www.usctts.com    | 200    | Trojan Tech Solutions: USC applied AI implementation lab |
| https://www.usctts.com/tc | 200    | T Combinator: USC builders, working on your company      |
| https://usctts.com/tc     | 404    | HTTPError; no successful destination                     |

The dedicated web reader could not access these URLs; the independent HTTP fetch succeeded for the www pages. CB-4 means deployed initial site content is available, not that interactive flow, copy claims, all subpages or apex redirects pass. CB-504 owns the distinct remaining verification/repair. No DNS, deployment or account changes occurred.

## E2: learning implementation versus outcomes

Inspected `behavioural()` in `bin/fitness`: it consumes per-case JSON, persists failed IDs/reasons and per-skill counts. Inspected `bin/evolve`: it reads case IDs and has a retention gate; the gate is deliberately not automatic merge authorization.

`python3 tests/test_evolve_gate.py` exited 0, reporting 0 failures. Its fixture tests include refusal of newly failing cases and failed suites, ranking candidates, missing evidence and no merge. This establishes CB-501's bounded test claim, not a real learned improvement.

Read the existing private fitness ledger without running fitness: 13 rows, one with per-case data, 186 total cases, 152 passed and 34 failed, 34 failure IDs. That row is timestamped 2026-09-21 UTC at abbreviated commit `36970ae` with dirty=true. This refutes the old zero-per-case-runs statement, but it is historical evidence and does not establish the current checkout's behavior or a comparable before/after improvement. CB-47 remains unverified; CB-0 stays open. No model quota was spent on a behavioral rerun.

## E3: handoff guard

`bash tests/handoff_guard.sh` exited 0: six passed, zero failed. Three refusal cases returned exit 2; normal replies and the explicitly requested copy-paste prompt case returned exit 0. CB-115's missing-tests claim is resolved. This does not establish every host's native hook enforcement or a general accuracy rate.

## E4: routing

Inspected `.claude/hooks/skill-route.sh`, its deterministic matching and machine-notification exclusions; inspected `tools/codex_hooks.py` wiring to the router. This session's supplied prompt context also named matching skills. Therefore absence of routing is stale. No held-out accuracy benchmark or all-runtime guarantee was established. CB-3 is implemented, with behavior acceptance still open.

## E5: installer/product roadmap

`setup.sh` calls `bin/lib/merge-claude-md.sh`; the helper preserves prior text and backups and replaces its marked region. The `--minimal`/`--fast` option skips named sections. `start.sh` verifies committed checksums. `tests/run.sh` declares a Windows installer group. These are inspected implementation paths, not clean-machine receipts. No global install was run. Existing checksums do not establish independent signing/pinned-release provenance. CB-250/251 are implemented; CB-252/255 and parent onboarding remain open.

## E6: closeout and group test discrepancy

`bash tests/closeout_groups.sh` exited 1 with StopIteration: the test seeks a class exposing `_groups`, but current `bin/closeout` exposes `Checks.groups`. A direct read-only call returns all 19 actual `if group` declarations. A broad unanchored regex also picks up a regex fragment in the suite itself, so it must not serve as the expected group inventory.

Integration follow-up, 2026-10-02: reproduced the stale test failure, then repaired it to call `Checks.groups` and compare against `tests/run.sh --list`. All 19 groups match in order. Separate fixtures verify duplicate removal, rejection of comment/string false matches, and empty/missing-suite fallback. The repaired test exits 0. No parallel speedup, changed-file skipping or cross-tab locking claim is made; CB-116/201 remain open for those checks.

## E7: Codex handoff correction

Current user instructions report October 1 success for native whats_due and native verification of five trusted lifecycle hooks in fresh Codex sessions, including permitted/refused operations. This user-provided evidence supersedes September 23 blanket disabled-hook and transport-failure notes. It is explicitly not a new verification of every MCP service, an existing desktop task's hot reload, or a clean closeout receipt. Current source retains registration checking; the earlier 33-test receipt was not rerun here.

Preserve the selected model, runtime, permissions, unrelated plugins and enabled connections. The other review-tooling owner controls CB-401/410/412; this reconciliation does not close those tasks.

## E8: work ledger and ownership

Read all entries for the exact Chewbacca workspace, plus the current projectless workspace (initially empty). Existing commitments include HUD cancellation, parent review profiling, full review/release preparation, second-brain housekeeping and Codex review scope/chat clutter. Their task IDs and before-state are preserved privately. Only this reconciliation's own task may be updated by this task. Ledger status is a declaration, not independent proof; a separate owner's status changed during the read and is not overwritten.

## Private evidence references

P1 is the owning private GTM project note and current private work artifacts. Later evidence supersedes the old claim that identifying five companies is the sole blocker; mapping, sequence connections, approval and destination outcomes remain unverified here. P2 is the owning private coursework authorization note: the historical blanket course-AI ban is stale; current task-specific policy and no-unasked-submission boundaries must be checked. Exact names, message IDs, client claims and personal details stay in the dated private reconciliation record. This task does not reopen those workflows or authorize outreach, recording, submissions or spending.

## Verification boundary

Only the two named fixture checks and the three HTTP observations above establish fresh feature evidence. The rest is source inspection, explicit user-provided evidence, or historical/unverified material. The whole repository suite, native HUD experience, Windows install, model benchmarks, release authenticity and full-repository independent code review were not completed by this planning task. No clean checkout or release receipt is claimed.
