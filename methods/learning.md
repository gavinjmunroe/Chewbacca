# Learning from evidence across processes

Use this method during research, coding, design, UI navigation, operations, and
GTM work. Apply only the structure the decision needs: observing a control and
checking its result is enough for a simple action. A costly or repeated workflow
benefits from explicit dependencies, measured outcomes, and comparison. The
method is shared guidance, not a lifecycle hook or permission gate.

## Before and during work

Name the intended outcome and how it can be observed. Retrieve relevant prior
recipes and failure records; check their app version, workspace assumptions,
date, and evidence scope before reuse. Distinguish a current observation from a
recalled instruction. Define the cheapest test that could change the approach.

When comparing approaches, record a baseline, units, denominator, and assumptions.
For example, distinguish cost per attempted record from cost per verified result;
keep pending outcomes separate from matured trials. Report uncertainty when the
sample supports an estimate, and say when it does not. An arbitrary score or
unvalidated probability is not a calibrated prediction. Use `gtme-math` for its
supported arithmetic and `gtme-learning` for a fixed paired experiment; read their
limits in `docs/MATH-GRAPH-CAPABILITIES.md`. Do not force a statistical test onto
an anecdote or treat repeated attempts on one task as independent samples.

Use the graph that represents the question:

- Source/provenance graph: claims, sources, observations, and support or conflict.
- Entity graph: identities and relationships, keeping ambiguous matches explicit.
- Task DAG: prerequisites, owners, expected artifacts, budgets, and verification.
- UI transition graph: observable states, actions, preconditions, postconditions,
  failure states, and recovery paths. Fresh observations ground the next action.

Keep these meanings separate even when they share stable IDs. A dependency does
not prove truth; a matching name does not prove identity; a clickable control does
not prove the expected state was reached. `gtme-graph` and `task-graph` manage
DAG bookkeeping. `ux-learning` manages its explicit navigation/evidence schema.
None observes or controls an application by itself.

## Native workflows and bounded trials

When a platform supports the intended repeatable operation, build and verify its
native workflow instead of manually replacing its enrichment or generation with
one-off work outside the platform. Keep the setup reusable and preserve the
user's chosen data flow. Use an authorized small test batch before wider runs;
carry the user's explicit row limit, credit limit, and no-send instructions into
the run contract. Never infer approval for a full-table run from approval to test.
A task-specific limit (for example, five rows) stays specific to that contract;
it is not a universal platform default.

## Preserve useful learning

Record meaningful attempts promptly in the authorized private workspace: intended
state, actual outcome, evidence reference, app/context version, failure category,
recovery attempted, and remaining uncertainty. Save failed and blocked attempts
as well as successes; preserve changed hypotheses so the next attempt does not
repeat the same mistake. Record an improvement proposal separately from proof
that it improves results. Review which observations were missing and which test
would make the next attempt more informative.

Retain the minimum evidence needed to reproduce the finding. Keep client records,
credentials, private URLs, raw screenshots, and personal context private. Shared
recipes should contain synthetic examples, semantic control descriptions,
preconditions, exact observable success criteria, known failure cases, and tested
scope. Check the sanitized artifact itself before publishing it through an
authorized workflow. Redaction is not established merely by naming a field safe.

A reusable recipe should survive a different record and a fresh session. Test
candidate changes against a baseline on heldout tasks and preserve previously
working cases. Keep versions and regression evidence so a failed change can be
revised. Promotion is an explicit evidence-backed update, not an automatic side
effect of writing a receipt or receiving an eligible experiment report.

## State capability precisely

Distinguish documented, attempted, verified for a stated case, and tested across
a declared range. A single verified import is not Clay mastery, and Clay success
is not proof of transfer to every application. A changed UI invalidates affected
assumptions until rechecked. Hashes bind recorded bytes; they do not authenticate
an observer or prove that an outcome was interpreted correctly.

These steps run within existing user authorization. Keep disabled hooks disabled;
do not activate startup injection, tool gates, durability hooks, or publication
hooks to apply the method. Do not change the user's model, permissions, or runtime.
Campaigns and external messages remain subject to the user's explicit instruction.
