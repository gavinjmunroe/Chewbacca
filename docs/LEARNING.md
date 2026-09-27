# Does Chewbacca learn? No. Here is exactly why, and what would fix it.

Caleb asked on 2026-09-21 whether any reinforcement learning had been
implemented, and then asked for a big emphasis on it. The honest answer is
that the machinery for a learning loop is mostly built and **the loop has
never closed once**. This file says precisely where it is open, so the next
person fixes the gap instead of rebuilding the parts that already work.

---

## What exists

| Piece | What it does | Real? |
| --- | --- | --- |
| `bin/evolve` | Applies a patch in an isolated worktree, scores it, archives the result | Yes, and it works |
| `bin/fitness` | Scores the kit: structural, and behavioural against eval cases | Yes |
| `bin/scars` | Failures written down so a later session inherits them | Yes |
| `memory/` | One fact per file, indexed, loaded every session | Yes |
| `.claude/hooks/ask-capture.sh` | Every prompt Caleb types, to `~/.chewbacca/asks.jsonl` | Yes, 86 captured |
| `write-log.tsv` | Which session wrote which path | Yes, 148 rows |

That is a reward function, an archive, isolation, a memory, and a log of
every request the user has ever made. It is most of an RL system.

---

## Why it is not learning

**The score has never moved.** Ten runs in `~/.chewbacca/fitness.jsonl`, and
`structural_score` is **90.12 in all ten**. A reward signal that returns the
same number regardless of the policy carries no information, and optimising
against it is a no-op dressed as progress.

**The behavioural score was recorded once.** Nine of the ten rows have
`behavioural_score: null`. The tenth says 84.76, with 139 passed and 25
failed.

**Nothing records WHICH 25 failed.** `failed` is the integer `25`. Credit
assignment is the entire problem in RL, and a scalar count makes it
impossible: there is no way to attribute the loss to a rule, a skill, a
prompt line, or a hook, so there is nothing to update.

**`evolve` deliberately never merges.** That is a defensible design and it is
written up in the file itself, but it means there is no selection step. An
archive with no selection is a museum. Variation without retention is not
evolution, and it is not learning either.

**The 86 captured asks are never read by anything.** Every correction Caleb
has typed is on disk, and nothing consumes them. That is the single largest
unused signal in the kit.

---

## What it IS, honestly

`evolve` is closer to the **Darwin Godel Machine** than to reinforcement
learning: archive-based evolutionary search over self-modifications, scored
by a benchmark. That is a legitimate and current approach, and it is not the
same thing as a policy updated from reward, so the two should not be
conflated when describing what this does.

Except that a DGM keeps the improvements it finds. This one does not.

---

## What would close the loop

In order, because each step is useless without the one before it.

**1. Make the reward move, and make it attributable.** `fitness` must record
WHICH eval cases failed, by id, every run. Until then nothing downstream is
possible. This is small and it is the blocker.

**2. Assign credit.** Each eval case names the rule, skill or prompt section
it exercises. A failure then points at a specific line of policy rather than
at the kit in general.

**3. Name the policy.** The policy here is not weights. It is the prompts,
the rules in `.claude/rules/`, the skill descriptions, and the hooks. Those
are the things a gradient would move, and they are all text under version
control, which is a considerable advantage over weights.

**4. Close it, behind a gate.** `evolve` gets a merge path that requires: the
behavioural score to rise, no eval case to regress from pass to fail, and the
full test suite to pass. A human approves the diff. That is the retention
step the archive is missing.

**5. Mine the asks.** 86 prompts, including every "bruh" and every
correction. A correction following a failure is a labelled example, and this
is the closest thing to on-policy data the kit will ever have. Gavin's
framing on 2026-09-21 was the same idea from the other direction: *"automate
prompting where whatever I say automatically gets interpreted by the engine
as self learning."*

---

## What closed on 2026-09-27

Gavin asked how to make the kit and his own setup improve themselves, and an
audit of his Mac found every part above present and the loop still open:
`fitness` had never recorded a score, `evolve` had never tried a change,
`maintain` was not scheduled, and `learn` read a brain path and a file name
pattern that did not exist there. Nothing wrote a patch, so nothing reached
`evolve`. Step 5 above was the gap, and this closes it:

```
reflect --write        harvest the voice log and every Claude Code transcript,
                       replay each voice failure against today's code, keep
                       the ones it still makes as cases
propose --shapes X     a headless Claude writes a fix for those cases, with
                       the person's hooks off and the judge out of reach
evolve --cmd "bin/propose --shapes X" \
       --expect "python3 tests/voice_cases.py --shapes X" --gate --branch
                       keep the fix only if the judge failed before and passes
                       after, no test newly fails, no eval case regresses; then
                       commit it to learn/<id> for a person to merge
```

| Piece                           | What it adds                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bin/reflect`                   | Episodes from both logs, redacted; live cases by replay; a trend row per run in `~/.chewbacca/learn/reflect.jsonl` |
| `fast_path` in `bin/hud-listen` | The voice's no-model checks with no side effects, so a logged sentence can be replayed                             |
| `tests/voice_cases.py`          | The judge. Every case not explicitly declined must reach a fast path                                               |
| `bin/propose`                   | The patch writer. Refusals are code: a touched judge or a deleted test line is reverted                            |
| `evolve --expect --branch`      | The flip test, suite regression against the unchanged commit, and a branch for review                              |
| `bin/learn`                     | Finds the brain setup.sh named, both memory spellings, and reads transcripts when asks.jsonl is absent             |

What replay showed on the first run: the router's 16 logged mistakes were all
fixed already, and the live failures were elsewhere. Spoken "open" requests
went to the model 15 times in two weeks at 6.8 s each.

### The first run, 2026-09-27

`reflect` ranked three live shapes: "open" (15 requests, 6.8 s median), and
"i" and "no". `propose` ran a headless Claude for 275 s, 32 turns and $0.98.
It wrote `bin/lib/opener.py` for a new Terminal window, a new Chrome window
and Google Sheets, with its own test, and declined six "open" sentences and
both other shapes with a reason each. "Open new Claude window" names no
folder, and a bare "No" can't be read without the conversation. The judge
failed before and passed after.

The gate refused it anyway, and it was right to stop. `test_reflect` had
built its slow cases from real "open" requests, so the first fix the loop
made broke the test that describes the loop. The fixture now uses drafting,
which needs the model for good. The same run found that every archived
attempt lost its final newline and could not be replayed with `git apply`.
Both have tests that fail without the fix.

Still open: a verb can only be judged on whether it takes the model out of the
path, not on whether the action was right, so every `learn/` branch is read by
a person before it merges. The session briefing lists each one until it does
(`reflect --pending`). The gate cannot yet compare eval cases one by one,
because `fitness --run` has never been run on both sides, so it says NOT
CHECKED rather than passing that half. The recursion, where the proposer's own prompt is
scored by how many of its branches merged, has its data (`prompt_sha` on every
proposal) and no runner yet. Nothing is scheduled until the loop has run clean,
supervised, more than once.

---

## The hard line

A kit that optimises its own score will optimise the score. Goodhart is the
default outcome of every step above, and the counterweight is already
written in `methods/doctrine.md`: the test is whether the people
around us are being transformed, and whether they can now do something they
could not, **eventually without it**.

So the behavioural evals have to measure whether Caleb got further, not
whether the kit looked clever, and any metric that can be moved without him
being better off is the wrong metric. Write the eval that could FALSIFY an
improvement before writing the improvement.

Built with Chewbacca
