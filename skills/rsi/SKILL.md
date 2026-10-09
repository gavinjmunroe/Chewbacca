---
name: rsi
description: Test a proposed change to a skill, rule, tool or working process with a bounded before-and-after experiment, and keep it only if it wins. Use when the user says self-improve, RSI, "does this change actually help", "A/B this skill", or wants a candidate skill edit compared against the current one. Ordinary session reviews belong in reflect.
---

# rsi

Improve how the agent works with the model held fixed. The output is a tested change or an evidence-backed decision to keep the current version. Exit codes and fixed scorers decide, not a persuasive write-up.

This guides experiments. It supplies no runner or spending cap: use the repo's own (`bash tests/run.sh`, `chewbacca live --list`, `evals/evals.json`). A written instruction that passes file validation is not better performance.

Diagnosis comes from [reflect](../reflect/SKILL.md) (reuse a current finding if it still applies). A single correction needs only [skill-training](../skill-training/SKILL.md). Evidence method: [decision standards](../../docs/DECISION-STANDARDS.md).

## 1. Bound it first

Record before running: editable scope, comparison task, model and settings, success criteria, protected behavior, run and cost cap, and who may adopt. Find existing runners before asking the user for setup. A review-only request stays review-only. Unspecified scope is not permission for an unattended campaign, paid models, publishing, production, or global instruction edits. Stop at the budget, a set number of attempts with no gain, or unreliable evaluation.

Separate a skill defect from a model limit, missing access, outage, or changed requirement. If a rule exists and was ignored, test discovery (does it load for the real request?) before adding rules.

## 2. Fair comparison

- One candidate, one mechanism, plus the smallest nearby case it might harm.
- Keep the current version. Stage the candidate in a worktree or copy and confirm each arm loads its own version.
- Same start state, tools, settings, limits. Reset state between attempts.
- Three case sets: development, selection, final. Pick final cases before seeing candidate results and keep them out of the optimizer's context. Any case used to edit again becomes development evidence, whatever it was named. A set the optimizer saw cannot certify unseen-task progress.
- Score from the requested outcome, fixed before looking. Deterministic checks for mechanical facts (exit code, grep, test). For judgment, a fixed rubric, blinded and order-balanced where possible. A model judge's preference is not the user's acceptance.
- Scorers, expected outputs and permissions live outside the candidate's writable scope. If a grader is broken, repair it separately, void affected comparisons, rerun both arms.

## 3. Run and decide

Smallest check that exercises the mechanism first. Log every planned attempt, including failures and timeouts, treated the same across arms. Repeat runs when variance could explain the gain; do not rerun only the candidate until it wins. Include previously passing tasks.

Accept only under the predeclared criteria. A higher average never offsets broken protected behavior. A tie or inconclusive result keeps the current version unless simplification was the goal and quality held. Reject answers that raise the score without the intended behavior. Check combined edits together. A failed final check is reported as failed; more tuning needs fresh final cases.

## 4. Adopt and record

A winning candidate is not an installed one. Adopt only inside the tested scope and the user's authority: confirm the target has not changed, apply, check the loading path, keep a rollback. Otherwise show diff and results.

Keep one record where the project keeps experiment notes: versions, prediction, diff, case split, settings, commands, all outcomes, cost, decision, rollback. Include rejected candidates. Private traces stay local. Report separately what was implemented, established, adopted, and unknown.

## Improving the improver

When the target is reflect, rsi or the proposal process, freeze scoring and adoption rules outside the candidate. Compare old and new procedures on the same fresh problems at equal budget, judged by downstream externally checked results, regressions and cost. More or better-sounding proposals do not count.

## Never

- Call a named holdout unseen after the optimizer saw its failures.
- Claim reliability from one run per arm.
- Let the candidate edit its own grader.
- Adopt, publish or spend beyond what was authorized.

## Credits

Adapted from cstack by Charles Zheng (MIT), https://github.com/goodnight000/cstack. License in [LICENSE](LICENSE).
