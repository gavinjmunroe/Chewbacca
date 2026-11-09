---
name: reference-writing-toolchain
description: "Four writing tools are installed and they overlap; which one to reach for, plus the ai-scan CLI that checks prose with no model"
metadata:
  node_type: memory
  type: reference
  originSessionId: 2bfb33e4-817f-40f4-aa87-7deead631154
  modified: 2026-08-11T04:14:23.704Z
---

Installed 2026-08-10. Three editors plus one deterministic scanner. Running all three editors on
one draft mostly burns tokens: pick one.

| Tool               | Layer           | Reach for it when                                                            |
| ------------------ | --------------- | ---------------------------------------------------------------------------- |
| `no-ai-slop`       | skill           | Quick pass on Caleb's own draft, voice preserved. Matches the CLAUDE.md rule |
| `avoid-ai-writing` | skill           | The draft matters: 61 categories, 112-word table, detect/rewrite/edit modes  |
| `humanizer`        | plugin          | Second opinion. Its catalogue is Wikipedia's "Signs of AI writing"           |
| `prompt-optimizer` | self-hosted MCP | Rewriting a _prompt_, not prose. Three tools over HTTP                       |

**`ai-scan` is on PATH** (`~/.local/bin/ai-scan`, also vendored at `bin/ai-scan` in Chewbacca).
It runs the avoid-ai-writing detector with **no model in the loop**:

```
cd <dir> && ai-scan docs/            score every markdown file, worst first
cd <dir> && ai-scan draft.md --issues
cd <dir> && ai-scan docs/ --max 40   exit 1 if anything scores above 40
```

Score is 0 to 100. Run it before spending tokens: under 10 does not need an editing pass. The
skill's own `scripts/self-scan.js` only reads its own repo, which is why the wrapper exists.

**prompt-optimizer runs in Docker** as container `prompt-optimizer` on port 8081, restart policy
`unless-stopped`, registered at user scope as an HTTP MCP server pointing at
`http://localhost:8081/mcp`. Its tools go dead whenever the container is down. It is wired to
**local Ollama** (`llama3.1:8b` via `host.docker.internal:11434/v1`), so it costs nothing and is
weaker than it should be. Swapping in a real key is one env var: `VITE_OPENAI_API_KEY` plus
`MCP_DEFAULT_MODEL_PROVIDER=openai`, then recreate the container. It is **AGPL-3.0**: running it as
a service is fine, copying its source into a project is not.

See [[project_chewbacca]] for how these propagate to the public repo.
