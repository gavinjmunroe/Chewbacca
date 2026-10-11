---
name: reviewing-changes
description: "Review code for real problems before it goes anywhere. Use for review this, check for bugs, is this safe to merge, review my PR, before opening a PR, after a feature, or when called sloppy."
triggers: >-
  Review code for real problems before it goes anywhere. Use when the user asks to review this, look over my code, check this for bugs, tell me if this is any good, find what is wrong with this, review my PR, or asks whether a change is safe to merge or ready for someone else to read. Also use before opening a pull request, after finishing a feature, or when a reviewer has called something sloppy.
requires: [git]
---

# Reviewing changes

Find real problems. Style opinions waste the one pass someone will actually read,
and a review that opens on naming teaches the author that reviews are noise.

The agent owns routine review and repair. Do not hand the diff to the user as a
required code-review step. Use a separate reviewer context, fix substantiated
findings within scope, rerun affected checks, and review the changed result.
Ask the user only for a genuine unresolved product decision or required authority.
Independent automated review reduces risk; it does not guarantee bug-free code.

For a local Git checkout, run independent review BEFORE composing the final reply.
Use `review-gate run --repo PATH --session-id ID` for a natively observed Codex
task, then `review-gate preflight --session-id ID`. Read the private review result,
repair substantiated findings and rerun affected checks. A changed snapshot,
partial coverage, process failure or unresolved finding is not a clean review.
After three unsuccessful repair cycles, diagnose the cause and report the limit.

Task receipts are separate from repository-wide receipts. The native adapter
captures HEAD, file contents and index entries before the first observed operation.
The task scope includes observed changed paths, index-only edits, every intervening
commit (including cancelling patches), and necessary caller/test context. If a task
touches an already dirty file, review all changes on that path against the starting
HEAD; do not pretend to attribute individual lines to an author. Untouched dirty
paths are explicitly recorded as preexisting obligations outside task coverage.
Concurrent commits are included conservatively, not silently assigned to another
worker. Unknown before-state or divergent history prevents a clean task receipt.
For review of inherited work with no new edit, use repeated `--include-path PATH`
arguments to expand task coverage explicitly. An empty observed task cannot mint a
clean receipt, and explicit paths never remove previously observed obligations.

Never reset an old frozen base to shrink a review. Repository-wide scope and older
incomplete obligations stay saved, and a task receipt cannot clear them. Without
`--session-id`, `review-gate run --repo PATH --base COMMIT` remains an integration
review using the existing frozen scope. Supply an explicit initial base for committed
work without native observation; an existing scope cannot be narrowed. Coordinate
ownership before incorporating unrelated work into an integration review.

Raw diagnostics, paths, internal identities and receipt details belong in private
review and hook logs, not user-visible completion replies. `report-incomplete`
records a disposition after a failed review; it does not prescribe exact reply text
or certify completion. State incomplete checks briefly in ordinary language, with a
specific user action only when one is actually required. Keep legitimate findings
and requested handoff details useful to the user without pasting hook instructions.

Desktop Stop runs after the final reply is rendered. It records check failures
privately and never requests a replacement completion reply. First Stop and retries
return no user-visible diagnostic message. The pre-reply preflight is therefore
required; a quiet Stop is not enforcement or proof of correctness. CLI Stop may
return a short check failure, but raw feedback remains private. Cancellation stops
work immediately. Neither cancellation, retry nor a read-only follow-up clears an
unresolved review duty. Do not run another review merely to end a cancelled task.

An untracked embedded Git repository is a separate scope. Parent snapshots record
its boundary and exclude its contents explicitly; changed children require their
own review. Removing a boundary brings ordinary files back into parent scope.
Tracked submodules, special files and unmerged indexes still fail closed. Snapshot
hashes read fresh content, including same-size edits with restored mtime. Stability
checks detect ordinary concurrent writes; this is not an atomic filesystem snapshot.

## A second model, and the human reads only the disagreements

The model that wrote the code should not be its only reviewer, and rerunning the
same model as a skeptic does not help: Ayush measured a skeptical second pass
moving accuracy from 68 to 66.7 percent, while a human reading only the cells
where two passes disagreed moved it from 63.3 to 88.3 percent and read 43 percent
of them. So the second reviewer runs on a different model, and plain code, not a
third model, decides what agrees.

```sh
review-cross detect                       # which reviewers would run; spends nothing
review-cross run --repo PATH [--base REV] # two reviewers, merged
review-cross run --repo PATH --a-report <review-gate receipt or failure JSON>
review-cross merge a.json b.json          # merge two saved reports, no model call
```

Only `claude` is ever started on a diff, because it can run with zero tools.
codex has no zero-tool mode: `--sandbox read-only` still lets its shell read
`~/.ssh` or `chat.db`, and an injected diff can ask it to quote them back as a
finding. So codex counts only as reviewer A through `--a-report`, which reuses
the findings review-gate already produced, and claude is reviewer B on its own
default model. Without a report, claude runs as two models (`opus` and `sonnet`
by default, `CHEWBACCA_REVIEW_CLAUDE_MODEL_A` and `_B` override). `detect` lists
codex under `excluded` when it is installed.

A diff is attacker-controllable text, so the reviewer gets no way to act on it.
`review-cross` builds the change itself (git with external diff, textconv and
fsmonitor off) and sends it on stdin to claude started in an empty temp
directory, so a repository's `.claude/settings.json` hooks, `AGENTS.md` and
`.mcp.json` are never in reach. claude runs with no tools, user settings only,
no MCP servers and an environment built from an allowlist (PATH, HOME, locale,
its own auth variables), so tokens in the caller's environment are not there.
The argv is one fixed template, never read from a config file, and a model name
that could pass for a flag is refused. Every string a reviewer returns, and any
`--a-report`, passes agent-history's redaction before it is printed, so a key
that did get quoted prints as `[GITHUB_TOKEN]` or `[PRIVATE_KEY]`. Output is
parsed as JSON data and printed, never executed.

The merge matches findings on the same file by line proximity and word overlap
of message plus scenario, one to one, best match first. Output has three parts:

- **Agreed**: both models found it. Fix these yourself, as with any substantiated
  finding. A severity mismatch is noted but is not a disagreement.
- **Only A / only B**: the disagreements. These, and only these, go to the user,
  each with the scenario, because one model's word against the other's is a
  judgment the agent should not settle by picking the reviewer it likes.
- **Single-model**: no second model was installed, or it failed or timed out.
  The output says SINGLE-MODEL on its first line and every finding is labeled
  unconfirmed. Never describe it as cross-checked.

Exit 0 means neither reviewer found anything, 1 means findings to fix or
arbitrate, 2 means the review could not run. `review-cross` is advisory and
mints no receipt; the `review-gate` receipt above is still the gate. The match
thresholds in `tools/review_cross.py` are guesses until calibrated against real
paired reviews.

## Get the code first

Never review from memory of what was written. Read the actual diff.

```sh
git diff HEAD                 # uncommitted
git diff main...HEAD          # the whole branch, against its merge base
git diff --stat               # what moved, before reading any of it
```

For a GitHub PR: `gh pr diff <n>` and `gh pr view <n> --json title,body`.

If the diff is large, read the stat first and review in dependency order: schema,
then the code that reads it, then the callers. Reviewing a caller before the
thing it calls produces confident wrong comments.

## What actually matters, in order

**1. Does it do what it claims.** Read the description, then check the code does
that and only that. An unrelated change smuggled into a diff is the single most
common source of a surprise regression, and it is invisible unless someone asks.

**2. Correctness at the boundaries.** Empty list, one element, null, the value
arriving as a string when a number was assumed, the second call after the first
already wrote. Walk one concrete failing input end to end rather than reasoning
about the code in the abstract. If you cannot construct one, say so instead of
implying you found nothing.

**3. Security, on every diff, no exceptions:**

- User input reaching a query as string interpolation rather than a parameter
- A secret in the source: hardcoded key, token, password, a `.env` value inlined
- A protected route that never checks the caller, or trusts an id from a request
  body without verifying ownership
- A query returning rows that could belong to someone else
- Logging that prints a token, a password, or personal data
- Text that moves from one agent's context into another's (a shared board, a
  handoff, a briefing file). Ask all four before the first commit: can it carry
  markup that poses as the reader's own framing, can it carry a secret to a
  different provider, which file or export does it end up in, and who else on
  the machine can read its store. On 2026-10-09 the tab board shipped and then
  took five rounds of security review, one finding per round, all four
  questions, each answerable on the first read.

**4. Error paths.** A swallowed exception is a bug, not a style choice. Expected
failures (validation, a 404) and unexpected ones (the database is down) need
different handling, and code that treats them the same will hide a real outage.

**5. What the change breaks elsewhere.** When a column, an enum value, or a
function signature changes, grep for every other caller. Fixing one call site and
declaring victory is how a schema change ships half-applied.

**6. Tests that pin the bug, not the behavior.** If an assertion encodes a wrong
value because that is what the code currently returns, both are wrong.

## Reporting

Lead with the most severe thing. For each finding: the file and line, one
sentence on what breaks, and a concrete input or sequence that triggers it. A
finding without a failure scenario is a guess wearing a suit.

Separate what must change from what would be nice. Say plainly when the diff is
clean: a review that manufactures findings to look thorough costs more trust than
it buys, and the next one gets skimmed.

If the author is the user, do not soften it. If a reviewer has already called the
code sloppy, concede the pattern before defending any instance, and fix the whole
category rather than only the lines they flagged.
