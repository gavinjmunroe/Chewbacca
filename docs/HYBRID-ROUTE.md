# Hybrid skill routing: code, then Jev, then a model

`tools/hybrid_route.py` answers one bounded question, which installed skill
should load for a message, through a graph with explicit fallback. It is the
first workflow in this kit that runs code, Jev and a generative model as one
path and is scored end to end against baselines on a sealed set.

```
code rules ──exact──────────────────────────────┐
    │ pass                                       ▼
Jev choice ──p >= threshold, valid──────────▶ verify ──▶ result
    │ abstain, invalid, outage                   ▲
    ▼                                            │
claude -p --model haiku ──valid name────────────┘
    │ invalid, timeout, over budget, context leak
    ▼
unresolved (explicit, never a guess)
```

| Node   | Owns                                                               | Why here                                                            |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| code   | slash commands, machine notifications, prompts under 12 characters | exact rules cost nothing and cannot be wrong in a way a model fixes |
| Jev    | the closed choice over every skill description plus "none"         | a typed semantic judgment, the thing Jev is for                     |
| model  | only what Jev would not accept                                     | open reasoning is the expensive path, so it runs on the residue     |
| verify | the final name is in the frozen catalog                            | no backend can invent a skill                                       |

The answer is advice. It loads nothing and runs nothing, so a wrong answer
costs a misleading suggestion, not a side effect.

## Budgets and recovery

- One budget for the whole graph (`--max-usd`), checked before the model runs
  against a reserve for one call, and again after, so a call that cost more
  than it should is not trusted.
- One deadline for the whole graph (`--deadline`); the model gets what is left.
- Every stage is appended to a checkpoint keyed by prompt, catalog and policy.
  A run killed after Jev resumes at the model stage without paying Jev again; a
  torn last line from a crash is skipped. A changed catalog is a new key.
- Exit 0 resolved, 3 unresolved. The exit code decides, not the reply text.

## The contamination the model node guards against

`claude -p` with `--setting-sources project`, `--system-prompt` and no tools
still loaded the person's auto-memory. On 2026-09-26 a calibration call
answered a routing question with a list of the person's own projects, at
6,144 input tokens against 623 with memory off. That broke two things at
once: the model was judging on information Jev never saw, and private context
was going somewhere it was not asked to go.

The node now sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and refuses any answer
whose input tokens exceed the prompt it was sent plus the CLI's fixed context
(`context_leaked`). The limit is per model because tokenizers differ: the
same 34,646-character prompt is 8,948 tokens on Haiku 4.5 and 12,407 on
Sonnet 5. A single ratio flagged every clean Sonnet call as a leak.

## How it was evaluated

`tools/hybrid_route_eval.py` runs each arm through the same `route()` path.

1. The skill catalog was frozen by hash first.
2. Two agents that never saw a router, a prediction or each other's file wrote
   a 40-case calibration set and a 60-case test set, with every acceptable
   skill listed per case and a mix of direct, paraphrased, no-skill,
   adversarial (negation, quoted instructions, notification noise) and
   ambiguous requests. The test set was hashed and made read-only on arrival.
3. The threshold was chosen on calibration only, by a rule written before the
   run: highest cascade accuracy, then lowest cost.
4. Threshold, models, code hashes and the scoring rule were frozen, then the
   test set was opened once.

Arms: always-none, the keyword matcher behind `skill-route.sh`, Jev alone,
Haiku alone, Sonnet alone, and the cascade. Reported per arm: accuracy with a
Wilson interval, dollars per case (Jev at the published input rate, the model
at the CLI's reported cost, which includes Claude Code's own background call),
median and p95 latency, unresolved count and escalation rate, plus exact
McNemar tests of the cascade against each arm on the same cases.

The measured results are kept outside this repository. TypeSafe's agreement
(2.3(f)) bars publishing Jev performance figures.

## What this does not show

- Synthetic prompts, not real traffic. Real prompts are private text and do not
  go to Jev. The shadow-mode half of [JEV-EVERYWHERE.md](JEV-EVERYWHERE.md)
  is how real traffic would be measured.
- Skill choice, not task success after the skill loads.
- One run per case. Model answers vary between runs.
- Model cost depends on prompt caching: repeated calls read the catalog from
  cache. Jev has no cache.
