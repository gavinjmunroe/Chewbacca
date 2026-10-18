---
name: feedback_model_reader_needs_clean_context
description: A `claude -p` call used as a judge (a recipient read, a triage, a repair) loads the whole personal CLAUDE.md stack and invents tool calls unless it runs with CLAUDE_CODE_DISABLE_CLAUDE_MDS=1, --setting-sources "", --tools "" and its own --system-prompt (zeutara-gtme monday_go.py, 2026-10-17)
metadata:
  type: feedback
---

On 2026-10-17 monday_go.py's first live recipient read ran `claude -p --tools ""`. It answered with fake Grep tool calls written as text where the JSON should have been, so the run crashed. A test call with the same flags also showed 111,075 cache-creation tokens and $0.89 for a one-line reply: every CLAUDE.md import (prayer rules, voice, personal context) loaded into what was supposed to be a neutral reader.

What works, measured: about 1,700 tokens and $0.014 for the same call.

```python
env = dict(os.environ, CLAUDE_CODE_DISABLE_CLAUDE_MDS="1")
subprocess.run(["claude", "-p", "--setting-sources", "", "--tools", "",
                "--model", MODEL, "--system-prompt",
                "You read text and answer with a single JSON object. You have no tools and need none.",
                "--output-format", "json"], input=prompt, env=env, ...)
```

Then parse `json.loads(stdout)["result"]` and pull the first `{...}` out with a regex, because a reader can still wrap the object in prose.

Why it matters beyond cost: a judge carrying Caleb's personal context and house rules isn't reading as the recipient, and the Stop hooks (prayer-guard, slop-guard) never run there, so `--setting-sources ""` is what keeps them off. `--bare` would do the same, but it needs ANTHROPIC_API_KEY, which this Mac doesn't set.

The pattern that came with it: the model proposes and code decides. In monday_go.py, `edit_problem()` refuses a model fix that drops or adds a merge field, adds a link, a long dash, a placeholder, or a number that isn't in the sequence or in Jonah's facts. Togari's repair loop (src/replies/repair.ts) uses the same split.
