# Math and graph capabilities

These local CLIs make arithmetic, dependency tracking, evidence checks, and
experiment comparison available to any runtime that can invoke a process. They
do not drive Clay, learn a UI by themselves, spawn workers, contact services, or
run campaigns. The host agent supplies observations and executes authorized work.

## Runtime and installation

The six `bin/` wrappers use `#!/usr/bin/env python3` and resolve their own symlinks
before locating `tools/`. They work from a checkout or an installed symlink,
regardless of the caller's working directory. Keep each wrapper with its matching
`tools/*.py` implementation in the checkout; copying a wrapper alone is not an
installation. No Python packages or private data are bundled.

Use Python 3.11 or newer for the full suite (`task-graph` uses
`hashlib.file_digest`). `gtme-graph` and `task-graph` require POSIX `fcntl` locking;
native Windows execution is unsupported. `gtme-library` requires SQLite FTS5 in
the Python build. Agent-runtime neutrality does not mean operating-system
independence. Run any command with `--help` for its exact arguments.

## Arithmetic and experiments

| Command | Implemented calculation | Required assumptions and limits |
| --- | --- | --- |
| `gtme-math order INPUT.json` | Orders AND rejection checks or OR validated-success waterfall steps by cost divided by stopping probability; reports baseline and chosen expected cost. | Requires the explicit `fixed_cost_independent` assumption, fixed per-attempt costs in one declared unit, and probabilities in [0,1]. Rejects prerequisite constraints and success-only billing. Zero-probability steps sort last. Supplied rates are not estimated or calibrated by this tool. |
| `gtme-math funnel INPUT.json` | Binomial success rate with Wilson score interval; pending observations are reported separately. | Requires a declared cohort, outcome, and maturity window; assumes independent matured binomial trials. Zero trials return no rate and the full [0,1] range. This is not a sequential interval or a causal estimate. |
| `gtme-math evaluate --labels … --predictions … --manifest …` | Confusion counts, explicit abstentions, coverage, precision, recall over all labeled positives, covered accuracy, and Brier score. | Exact ID coverage and a matching heldout-label hash are required; labeled IDs cannot overlap declared training/calibration IDs. Brier score covers only supplied probabilities. Hashes and disjoint IDs do not prove independent labels or calibration. |
| `gtme-learning evaluate --spec … --spec-sha256 … --results …` | Exact one-sided paired sign test on holdout wins/losses, excluding ties; cost/duration totals and promotion eligibility gates. | Requires disjoint training, holdout and regression sets, exact paired coverage, declared independence and preregistration, a minimum task count and success floor, no candidate severe errors, a cost budget, and preservation of baseline regression passes. Independent task pairs and one fixed comparison are assumed; repeated tuning/multiple candidates need separate error control. It reports eligibility and never promotes anything. |

Numeric validation rejects booleans where numbers are required, nonfinite
values, negative costs/counts, and out-of-range rates. Floating-point costs and
intervals remain subject to ordinary rounding; the sign-test tail is computed
as an exact rational before output. Extremely large inputs can be expensive;
these tools are not a resource sandbox. Input declarations are evidence about
what the caller recorded, not authenticated facts about an experiment.

## Graph semantics

`gtme-graph` is a GTM dependency DAG with per-node observable postconditions,
credit reservations, bounded attempts, and an event ledger. It rejects cycles;
enrichment requires identity and qualification ancestors, and send requires
verification and draft ancestors. A node can begin only after its dependencies
are verified and its reserved cost fits the remaining budget. Actual costs,
including failed attempts and overruns, are recorded. Optional ordered phases
require a recorded review before later phases become ready. **Send nodes are
always held for human handoff and are never released by this tool.**

Completion evidence is bound to the run, attempt, workspace, observation time,
and artifact hashes. The first artifact is a JSON observation object checked
against the node's expected fields using exact value and type equality. Replay
reconciles state with historical evidence. These checks detect changed bytes,
stale evidence and inconsistent state; they cannot establish that a local owner
captured truthful observations. A screenshot is not automatically interpreted.

`task-graph` tracks generic implementation and verification jobs. It enforces a
worker-slot limit with coordinator capacity reserved, one active job per owner,
bounded retries, prerequisites, and exclusive file/workspace resources. Each job
has a distinct canonical artifact path; verification declares a different owner
from the implementations it verifies. Claims and finishes are serialized by a
POSIX lock. State updates use atomic replacement and fsync; event replay checks
completed artifact hashes. Owner names and successful outcomes are declarations,
not identity authentication or semantic verification. Resource coordination only
covers participating jobs; it cannot stop unrelated processes touching files.
It has no worker launcher, automatic retry loop, or campaign integration.

Neither DAG is a UI-navigation graph. UI states, actions, recovery paths, and
app/version-specific observations need their own recorded model. Dependency
tracking supports that work but does not establish Clay mastery.

## Library and destination checks

`gtme-library --corpus PATH` provides `coverage`, `index`, and `search` for a
local source corpus using fetch inventories and SQLite FTS5. Indexing writes a
regenerable database inside that corpus; search opens it read-only. Source
paths must remain inside the corpus. Fetching, indexing, reading, comprehension,
and successful execution remain distinct statuses. Its default corpus is
`GTME_CORPUS_DIR` or `~/.chewbacca/gtme-corpus`; no corpus is included here.

`clay-fixture-check --fixture EXPECTED.json --actual EXPORT.csv` compares exact
exported headers, stable IDs, record coverage, and field values against an
independent expected fixture. Rows and columns may be reordered; fuzzy identity
matching and normalization are absent. Nulls require an explicit token or
`blank_equivalent` semantics; blank-equivalent mode cannot distinguish null from
an empty string. The result is scoped to exported content and cannot prove
hidden Clay settings, navigation quality, campaign state, or live application
correctness. Exit codes are 0 for a match, 1 for a mismatch, and 2 for invalid input.

## Verification recorded for this package

The original implementations, wrappers, and six test files were copied exactly
into the isolated checkout. All imports are Python standard library modules;
there are no untracked code dependencies or embedded client records.

On Python 3.14.7 on macOS, 69 existing tests passed: 47 across the four GTME
modules, 9 for fixture checks, and 13 for the generic task graph. Coverage includes
exhaustive small ordering comparisons and sign-test outcomes, malformed numeric
inputs, heldout leakage declarations, changed evidence, replayed attempts,
credit overruns, concurrent scheduler claims, resource aliases, corpus path
escapes, and strict CSV comparison. Each of the six wrappers also ran `--help`
through a temporary installed-style symlink from a different working directory.

Reproduce the focused suite from the checkout:

```sh
python3 -m unittest discover -s tests -p 'test_gtme_*.py'
python3 -m unittest discover -s tests -p 'test_clay_fixture_check.py'
python3 -m unittest discover -s tests -p 'test_task_graph.py'
```

These checks do not establish live Clay mastery, business uplift, authenticity of
caller-supplied evidence, Windows compatibility, or successful installation on
another machine. No lifecycle hooks or campaigns are enabled by these tools.
