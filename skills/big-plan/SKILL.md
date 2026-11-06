---
name: big-plan
description: "Make a plan worth committing to before something big starts: evidence, rival plans, a pre-mortem, an independent breaker, and phases that can change. Use for roadmaps, phases, or building something that takes weeks."
triggers: >-
  Make the plan for something big before building it. Use when asked to plan a product, a roadmap, phases, or what to build next and in what order, when work will take weeks or span several builds, when a decision is hard to undo, or when asked how confident we are in a plan. Skip it for a task a few commits finish.
---

# Big plan

A list of steps isn't a plan. On 2026-11-05 Hall got a table of 8 scored builds with one agent's judgment for every score. Caleb read it and wrote "create a way to make the plan that is robust and we are CONFIDENT that this is the phases/steps to commit to". That same day `docs/plans/` held 43 files, none with a pre-mortem and none with a gate block.

Plans here fail two ways, and this skill is built for both. They get written from impressions, and then they don't get followed: on 2026-09-27 two good plans each opened on a measurement phase nobody ran (`plan-guard.sh` has the story).

Confidence here means three things are true, and nothing more:

1. The assumption that would kill it has been tested, or phase 1 tests it cheaply.
2. Effort comes from what similar work took, not from how this one feels.
3. Someone who didn't write the plan tried to break it, and what they found got handled.

It never means certainty, so the plan also says what's still unknown.

## How much of this to run

For work a few commits finish, skip this. For anything that takes weeks, spans several builds, costs real money, or can't be undone, run all of it. Bigger or riskier gets more evidence and more rival plans, and never fewer of the steps.

Write to `PLAN.md` from [TEMPLATE.md](TEMPLATE.md) as you go, with `Status: DRAFT`. `plan-check PLAN.md` says what's missing.

## The steps, in order

**1. Pin the outcome.** Write what's true at the end, for whom, and the observable result that proves it. Write what this plan won't do. Quote the person's own calls exactly, and keep them apart from your read of them. A call they've made is a constraint, but it's still a hypothesis: if the evidence cuts against it, say so with the reason and let them decide.

**2. Get evidence before ideas.** Read the code, the repo's history and the notes. Measure what exists. Read how practitioners do this kind of thing, per `research-the-craft`. Every evidence bullet names its source, and what you couldn't verify goes in as unverified. Facts are your job: run `chewbacca resolve` before asking anyone.

**3. Find the reference class.** Before any estimate, list comparable things that already finished and what they really took. `git log` is the first place to look, since it holds what past work here actually cost, including what got abandoned. Assume this one lands like those. "We'll be faster this time" needs evidence. If nothing comparable exists, say so and mark every estimate guessed. Method: Flyvbjerg's reference class forecasting, built to counter the planning fallacy.

**4. Name what would kill it.** List the assumptions, the deadliest first, each with what happens if it's false and the cheapest test that could show that. They're often not technical: whether anyone wants it, whether the data exists, whether they're allowed. If a test takes hours, run it now and not in phase 1, because the result can change every later step.

**5. Make whole plans compete.** Write at least 3 really different shapes, and one has to be much smaller. Reordering the same steps doesn't count. Change the bet: a different first user, a different wedge, buying instead of building, not doing it. Each one says what it bets on. Choose one and say why the others lost.

**6. Build the smallest real thing first.** Phase 1 goes end to end through the riskiest part, even if it's ugly (Cockburn's walking skeleton). It has to be able to prove the plan wrong. A phase that only sets things up teaches nothing.

**7. Write phases that can change.** Each near phase has a Goal, an Exit a stranger could check, a Stop if, what it Decides about the next phase, its Effort with its source, and Confidence with the reason. Later phases stay rough on purpose (Goal and Exit only), because what comes back from phase 1 will rewrite them. Keep one-way doors as late as you can: anything public, paid, signed, or sent to real people. Two-way doors get decided fast, and one-way doors get listed so a person makes them.

**8. Run the pre-mortem.** Write this as if it already happened: "it's a year from now and this failed." Give at least 5 specific reasons, and for each one, the signal that would show it early (`Catch:`). Klein's method. Anything with no possible catch becomes a change to the plan or a line in the riskiest assumptions.

**9. Get it broken by someone else.** Hand the plan and the question "how does this fail?" to a fresh reviewer, with none of your reasoning, and tell them to attack the evidence and estimates too. Run `reviewing-changes` if code is involved. Put what they found and what you changed in the review log. Your own second read doesn't count. If the machine budget refuses a subagent, queue it and leave the plan DRAFT.

**10. Say what can change.** Write who can change what: what the agent changes on its own, what needs a person, and what forces a replan (a Stop if fires, an estimate runs past double, a Decides answer flips). A replan edits this file, and the log says why.

**11. A person commits.** Bring the choice in one short message: the chosen shape, what it bets, what it can't promise, and the one-way doors ahead. Only they change `Status` to COMMITTED, with their name and the date. `plan-check` refuses it while the top assumption is untested and phase 1 skips it, while a `[NEED: ...]` is left, or with no independent review.

**12. Make it hold.** Prose doesn't enforce itself. In a code repo, add the `PLAN-GATES` block so `plan-guard` refuses work that skips the active phase, and add the near phases to the work ledger. At each phase's end, compare what happened to the plan's estimate, write it in the review log, and read Decides before starting the next one.

## Things that make a plan fake

- Numbers with no source, or scores that are just your opinion in a table. If a score is judgment, say whose, and don't rank on false precision.
- An Exit nobody can fail, like "works well". Use a command, a count, a person doing a thing.
- Every rival plan being a worse version of the one you already liked.
- Phases sized to look tidy and not by what they'll teach.
- Asking the person to review what a subagent could have attacked first.
- Calling it committed because they said "looks good" to a summary. Show them the bets.

## Sources

Gary Klein, "Performing a Project Premortem", HBR, 2007. Bent Flyvbjerg and Dan Gardner, _How Big Things Get Done_: its figure that about 8.5% of projects meet cost and time estimates comes from reviews of the book, not read first hand. Alistair Cockburn's walking skeleton. One-way and two-way doors come from Amazon, read through secondary sources. Rolling detail, where only near phases get specifics, is standard project practice from memory and didn't turn up in the 2026-11-05 search.
