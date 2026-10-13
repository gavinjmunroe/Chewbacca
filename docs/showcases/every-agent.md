# Every agent, one command

```sh
git clone --depth 1 https://github.com/calebnewtonusc/Chewbacca && bash Chewbacca/setup.sh --every-agent
```

Setup finds every coding agent on the machine and installs into each one:

| Agent | What it gets | Where |
| --- | --- | --- |
| Claude Code | instructions, skills, hooks | `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/skills` |
| Codex | instructions, skills, hooks | `~/.codex/AGENTS.md`, `~/.codex/hooks.json`, `~/.agents/skills` |
| Cursor | hooks, skills, the Chewbacca MCP server | `~/.cursor/hooks.json`, `~/.cursor/mcp.json`, `~/.agents/skills` |
| Gemini CLI | hooks, skills, the Chewbacca MCP server | `~/.gemini/settings.json`, `~/.agents/skills` |
| VS Code | instructions, skills, the Chewbacca MCP server | `~/.copilot/instructions/chewbacca.instructions.md`, `Code/User/mcp.json`, `~/.agents/skills` |

Before it changes a file you already had, it copies it to
`<file>.chewbacca.backup` beside it. That copy is made once and never replaced,
so it always holds the file from before Chewbacca touched it. Undo:

```sh
python3 Chewbacca/tools/agent_runtime.py remove --runtime all
```

VS Code runs no Chewbacca hooks, so the shared checks (like the [brakes](brakes.md))
do not run inside it. Its agent gets the instructions, skills and tools only.

## Receipt

`tools/first_minute_bench.sh` builds a scratch home folder with a git identity,
one project of its own with work this week, and all five agents holding configs
of their own. It clones Chewbacca, runs `setup.sh --every-agent` with stdin
closed (so any prompt would fail the run), and stops the clock when the week
line prints. Then it checks every backup against the original's SHA-256, runs
the undo, and checks every config is back byte for byte.

Three runs on 2026-10-13, a 14-core Mac under load 25 to 34 from other work:

| Run | Load | Clone | Clone to first win | Prompts | Errors |
| --- | --- | --- | --- | --- | --- |
| 1 | 33.6 | 4.8 s | 6.2 s | 0 | 0 |
| 2 | 26.0 | 2.1 s | 3.4 s | 0 | 0 |
| 3 | 25.4 | 2.6 s | 4.7 s | 0 | 0 |

Every run: 5 of 5 backups matched the original, each person's own entries
(`theirs` MCP servers, `their-model`) survived, and undo restored all 5 files.
The same rig on the code before this change set up 4 agents (no VS Code),
made no visible backups, gave Cursor and VS Code no MCP server, and printed no
first win.

The clone came from a local copy, not GitHub. Agents were stand-ins (their
config folders plus a stub binary), so this measures the install, not a first
agent answer.
