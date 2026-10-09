---
name: reviewing-changes
description: "Review code for real problems before it goes anywhere. Use when the user asks to review this, look over my code, check this for bugs, tell me if this is any good, find what is wrong with this, review my PR, or asks whether a change is safe to merge or ready for someone else to read. Also use before opening a pull request, after finishing a feature, or when a reviewer has called something sloppy."
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
