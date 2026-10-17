# RESUME: skill-route subtraction (branch fix/skill-route-subtract)

Paused 2026-10-16 at 10:48pm because Caleb closed the laptop. Nothing on this branch is on main yet.

## Already on main

- 5de5edc7: skill-route is silent on machine traffic. `tools/skill_route_eval.py` and the live floor check `tests/live/skill-route-eval.sh` are in.
- 4735880a: team memory `reference_skill_route_eval`.

## Labels (private)

`~/second-brain/systems/skill-route-eval.jsonl` has 540 rows:

- 238 random rows (`sample` is random)
- 302 targeted rows (`sample` is targeted), skill-shaped prompts that count for recall only
- 71 held-out positives and 82 train positives
- `big` marks big work on random rows: 17 train, 9 held

## Arms measured on held-out (tools/skill_route_eval.py)

Precision, false fires and tokens come from the 126 random rows. Recall is over all 71 positives.

| Arm                            | Precision       | Recall | Nudge tokens per 100 prompts | p95    |
| ------------------------------ | --------------- | ------ | ---------------------------- | ------ |
| A today (meaning on)           | 10.9% (5 of 46) | 40.8%  | 3784                         | 1337ms |
| B strict cutoff 0.46           | 7.7% (1 of 13)  | 11.3%  | 1083                         |        |
| C no meaning (keyword + named) | 11.9% (5 of 42) | 25.4%  | 4023                         | 577ms  |
| D named only                   | 25% (1 of 4)    | 4.2%   | 363                          |        |

No meaning cutoff reached 50% precision on train.

Gate arms:

| Gate arm          | Armed | Big     | Gate recall |
| ----------------- | ----- | ------- | ----------- |
| today, probe 0.50 | 30    | 9 (30%) | 100%        |
| probe 0.62        | 7     | 3 (43%) | 33%         |
| no probe          | 0     | 0       | 0           |

On train the probe at 0.50 is already 50% precise (17 of 34), so by the 50% rule the gate stays unchanged.

Under the manager's rule, C wins: precision above today and recall no more than 5 below the no-meaning control. C is that control. A loses on precision, D on recall, B on both.

## Uncommitted changes, now in the WIP commit on this branch

`.claude/hooks/skill-route.sh`:

- The meaning nudge is off unless `SKILL_ROUTE_MEANING=on`.
- `named_skills()` routes a prompt that names a skill: a hyphenated name, or `use/load/run X` and `X skill`. It ignores names inside paths.
- `SKILL_ROUTE_NO_STEM` and `SKILL_ROUTE_PROBE_CUTOFF` are env switches for the arms.
- Three more kit-tool prompt openers are silenced: `### EPISODE `, `The user opened with: `, and the native runtime check.

`tools/skill_route_eval.py`:

- Precision is measured on random rows only.
- New metrics: `nudge_tokens_per_100`, `gate_precision`, `gate_recall`.
- A stalled hook run counts as silent instead of crashing the eval.

## Next, in order

1. Confirm C on held-out with the committed hook once load is under 80. That run was killed by load 298.

   ```
   python3 tools/skill_route_eval.py run --split held --json
   ```

   Expect about P 11.9, R 25.4. Path stripping and the new openers may move it slightly.

2. `tests/live/gtm-route.sh` and `tests/live/clay-route.sh` assert meaning-router routes. Either export `SKILL_ROUTE_MEANING=on` in them (they test the opt-in matcher) or rewrite them for the keyword+named router. Decide that and say which in the commit.
3. Update the floors in `tests/live/skill-route-eval.sh` to C's held numbers. Add named-skill cases to `tests/test_skill_route_machine.py`: "use the texts skill" routes, and `~/second-brain/x` does not name second-brain.
4. Attack: Caleb's register ("wats due tmr", "Lock in bro make chewbs goated"), prompts that name a skill on purpose, and briefs with paths.
5. Update backlog 3 and the team memory note, then `chewbacca land --paths` with the files above. Report to the manager tab, quoting C's recall cost of -15 vs today: same 5 right nudges on random traffic, fewer wrong ones, half the latency, and about the same token count.
