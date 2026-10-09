---
name: reflect
description: Review a finished, stalled or failed work session, read what the user said back to you, and propose evidence-backed edits to the instructions that steered it. Use when the user says reflect, retro, postmortem a session, "what went wrong", "what should we do differently next time", or asks to improve a skill or CLAUDE.md from how a session went. For a single correction just made, use skill-training instead. For an executed before-and-after test of a change, use rsi.
---

# reflect

Review one session, report what helped and hurt, and propose edits to the reusable instructions that shaped it. No instruction change is a valid outcome.

Versus [skill-training](../skill-training/SKILL.md): that skill fires on one correction and persists it. This one reviews a whole session, including the path taken, and may find that nothing should change. Versus [learning-from-mistakes](../learning-from-mistakes/SKILL.md): that one is for video answers. Versus [reviewing-changes](../reviewing-changes/SKILL.md): that reviews a diff, this reviews the work process.

## Boundary

Reading evidence and showing findings is free. Editing shared or global instructions (CLAUDE.md, rules, another skill) waits for the user to approve the concrete edit shown. "Reflect" and "I agree" are not approval. Reflecting never expands permission to publish, change memory, install tools, or resume the task. If the user already said to persist a lesson, that is the approval: apply it and say so.

## Steps

1. **Reconstruct from evidence.** Brief, corrections, tool results, accepted artifacts. Separate "claimed done" from "verified" (exit code, output, user acceptance). Mark compacted or missing evidence as missing. A changed requirement is not a mistake against the original brief.
2. **Review the path, not just the result.** Repeated discovery, checks that resolved no uncertainty, unneeded implementation, waiting. For each, say what was known then and the smaller action that would have worked. A long investigation is not waste by length. Quantify time or cost only if measured.
3. **Inspect the guidance that steered the work.** Read the CLAUDE.md, rules and skills actually used. For each failure decide: missing, wrong, hard to find, or clear but ignored. If it existed and was ignored, fix how it reaches the agent (where it loads, which step enforces it), or add a check that exits nonzero. Do not restate it louder.
4. **Check earlier fixes.** Look at the guidance's git log or changelog. If a prior edit targeted this same failure and it recurred, that edit's reasoning is weakened: change the delivery or remove it. Do not re-propose what the user already rejected without new evidence.
5. **Show preliminary findings, then ask.** Short, with examples, before asking for the user's view. Keep investigating while they answer.
   - Preference: theirs to decide; scope it ("my interviews", not "all edits").
   - Reported problem: take it seriously, diagnose separately.
   - Factual claim or proposed remedy: push back when evidence shows a concrete failure ("skip validation" vs the integration check that caught a real defect). Offer an alternative that serves their goal, e.g. cut the redundant reruns instead.
6. **Select what deserves a durable edit.** Needs: evidence kind (preference, observed result, hypothesis), a recognizable future trigger, still sensible on an unfamiliar brief, and something not already stated. Drop names, one-off settings, outages, unverified optimizations. Carry an example forward only if the user accepted it, labeled as one instance. Reject "keep refining until great" with no stop point.
7. **Route to the smallest home.** Behavior fix: the doc that steered it. Procedure: the existing skill. Project fact: project docs. Person or project fact: second brain, not a skill. Mechanical failure: a test or check next to the code (`bash tests/run.sh <group>`), proposed separately. Temporary state: no durable write. Loads-every-session files must justify the cost; prefer a place that loads only when relevant. Edit the maintained source, not a generated copy. Name how a future agent will encounter the change.
8. **Propose.** Per edit: file and section, exact text or diff, evidence, scope, what it replaces, one mechanism, expected observable change, and a verification (a nearby case where it should not apply, and a different past task where it should). Name rejected candidates. Removing or narrowing guidance is a proposal too. For a new skill, stage it outside the live path.
9. **Apply approved edits only, then verify.** Re-read the target for intervening edits, apply, read it back (grep the new text), run the relevant check, and record hypothesis and expected effect in the commit message or changelog. Structural validation shows the file works, not that behavior improved. When a change needs an executed comparison, hand it to [rsi](../rsi/SKILL.md).

## Never

- Apply edits to shared instructions before approval (unless the user already ordered persistence).
- Treat many tool calls as waste, or invent timing savings.
- Save a lesson nothing will read.
- Paste raw transcripts or private detail into reusable instructions.
- Call a rule fixed because it was written. A later session that retrieves and applies it is the evidence.

## Credits

Adapted from cstack by Charles Zheng (MIT), https://github.com/goodnight000/cstack. License in [LICENSE](LICENSE). Dropped: the Codex `agents/openai.yaml` (implicit invocation off), because this kit routes by description.
