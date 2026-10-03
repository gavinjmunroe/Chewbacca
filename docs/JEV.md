# Jev integration

Chewbacca includes `chewbacca jev evaluate`, an explicit TypeSafe client for
Choice, Score, and Noul questions, plus `chewbacca jev route` for semantic skill
suggestions. The command is registered in help/completion and setup installs the
`jev` executable. No SDK dependency or prompt-hook change is required.

Set `TYPESAFE_API_KEY` in the environment. On macOS, `chewbacca jev auth` stores
it in Keychain under service `typesafe-ai`, account `chewbacca`; the environment
takes precedence. The key is never stored in the checkout. `status` checks local
credential availability; `smoke` verifies the service with synthetic input.

See [the Jev skill](../skills/jev/SKILL.md) for request examples and operation.
See [the orchestration research](JEV-ORCHESTRATION.md) for backend boundaries,
inspected implementations, evaluation requirements, and what remains unbuilt.
Install the upstream design skill for Codex with:

```sh
npx skills add typesafe-ai/skills --skill typesafe-ai --agent codex --global
```

The integration uses the [official HTTP API](https://docs.typesafe.ai/api).
As checked on 2026-09-23, [the model documentation](https://docs.typesafe.ai/models)
lists Jev 1.13 at $0.042 per million input tokens, with free output. This is a
published rate, not a measured cost comparison with another workflow. Additional
questions consume tokens. Multiply returned input usage by the current rate.

Skill routing sends the supplied task and installed skill descriptions to
TypeSafe. Evaluation sends the supplied JSON state and questions. Neither reads
the second brain nor executes a returned decision. There is no automatic upload
on ordinary agent turns. Errors are explicit; callers retain their existing
fallback. Probabilities and typed output do not establish factual correctness.

Run `bash tests/run.sh jev` for offline contract and failure-path tests. A live
smoke is separate and spends API credit. Accuracy, calibration, and relative
savings require a held-out task evaluation; synthetic smoke cases cannot prove
them. The existing keyword skill router costs zero API tokens.

Local verification on 2026-09-23: nine offline Jev tests and eleven CLI checks
passed, followed by an independent read-only review with no remaining findings.
A live synthetic call exercised all three primitives (348 input tokens, 360 ms).
Three skill-routing examples selected coursework, debugging, and no skill for
a greeting, respectively (10,747–10,750 input tokens, 212–262 ms). A separate
invocation through the installed executable also returned no skill for the
greeting. These are connectivity and behavior checks, not an accuracy benchmark
or evidence of savings against a generative-model baseline.
