# Perplexity Code

The most resourceful AI coding system. A search-native, self-improving execution layer that helps you actually build things.

## What this is

Perplexity Code is a local coding agent powered by the Perplexity API. It combines search, repo discovery, model routing, command packs, rules, hooks, workflow memory, and real code execution into one coherent product.

## v0.7.1 features

### Core Runtime

- Global `perplexity` terminal command with interactive REPL
- 6 built-in tools: `list_dir`, `read_file`, `run_shell`, `write_file`, `write_patch`, `fetch_url`
- Permission modes: `ask`, `plan`, `acceptEdits`
- Hallucination detection (catches citation brackets, doc references, competing tool mentions)
- Patch-based editing with diff previews
- JSONL activity logging

### Discovery Engine (search-native)

- `/discover <what to build>`: find repos, starters, libraries via Sonar
- `/search <query>`: web-grounded search with citations
- `/compare <A vs B>`: structured comparison with reasoning
- `/docs <topic>`: find official documentation
- `/fetch <url>`: fetch and read any URL

### Model Routing

- Task-aware routing: discovery, architecture, debugging, generation, review, quick
- Automatic model selection based on task classification
- Search enabled/disabled per task type
- Command-level model overrides

### Active Rules Engine

- 18 rules files in `.perplexity/rules/` with YAML frontmatter
- Rules injected by file type (glob patterns), workflow, and command
- Context-aware: only relevant rules loaded per request

### Command System with Metadata

- 33 dynamic slash commands from `.perplexity/commands/`
- Frontmatter metadata: description, allowed-tools, mode, model, rules, post-actions
- Command collision handling (built-ins win, shadowed commands shown separately)

### Self-Improving Loop

- Source registry: track high-signal repos and prompt systems
- `/sources init`: seed with default sources (D1, Claude Code, shadcn, Vercel AI SDK, Next.js)
- `/sources scan`: detect updates across all tracked sources
- Staging pipeline: ingest, translate to Perplexity-native, review before merging
- `/staged`: list pending ingestion updates

### GitHub Integration

- Repo context in system prompt (branch, commits, changed files)
- PR listing, details, and diff retrieval via `gh` CLI
- Issue tracking and search
- CI/workflow run status
- `/github`: show current repo context

### Session Intelligence

- Repo-state snapshots (branch, commit, dirty state)
- Task lineage tracking (what was attempted, succeeded, failed)
- Smart resume with context-aware suggestions
- Compressed session summaries that preserve signal
- `/tasks`: view task history this session

### Extended Hooks

- Auto-typecheck after editing TypeScript files
- Command benchmarking (execution time logging)
- Quality gate: `/gate` runs tsc, eslint, git status checks
- Session summary on exit

### Slash Commands

```
Core:      /help  /commands  /exit  /reset  /save  /sessions  /resume  /context
Workflows: /plan  /mode  /debug  /refactor  /test  /explain
Discovery: /discover  /search  /compare  /docs  /fetch
System:    /sources  /staged  /gate  /tasks  /route  /github  /memory  /hooks  /recent
Dynamic:   33 commands from .perplexity/commands/ (build, deploy, review, audit, etc.)
```

## Install

### Local dev install

```bash
./install.sh
source ~/.zshrc
perplexity
```

### pipx install

```bash
./scripts/pipx_install_local.sh
```

## Setup

```bash
cp .env.example .env
# Add your PERPLEXITY_API_KEY

# Optional project files:
cp PERPLEXITY.md.example PERPLEXITY.md
cp PERPLEXITY_HOOKS.json.example PERPLEXITY_HOOKS.json
```

## Architecture

```
perplexity_code/
  cli.py                 Core REPL and agent loop
  hooks.py               Base hook system (pre_tool, post_tool, on_error)
  hooks_extended.py      Extended hooks (typecheck, benchmark, quality gate)
  logging_hook.py        JSONL activity logging
  session_store.py       Session persistence
  session_intelligence.py  Repo snapshots, task tracking, smart resume
  rules_engine.py        Active rules injection by file/workflow/command
  command_registry.py    Command metadata parsing and loading
  discovery.py           Sonar, Search, Agent API integration
  router.py              Task classification and model routing
  source_registry.py     Self-improving loop: track, ingest, stage, apply
  github_integration.py  GitHub context, PRs, issues, CI status
  cost_tracker.py        Token counting and cost estimation
  streaming.py           SSE streaming with spinner
  ollama.py              Free local inference via Ollama
  sandbox.py             Docker sandboxed shell execution
  parallel_agents.py     Concurrent task execution
  lsp_integration.py     Language server diagnostics (tsc, eslint, pyright, cargo)
  git_first.py           Auto-commit after edits
  context_manager.py     Smart repo map and file ranking

.perplexity/
  commands/              33 dynamic slash commands
  rules/                 18 rules files with YAML frontmatter
  hooks/                 Hook scripts
  sources/               Source registry and staging area
  sessions/              Session persistence
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```

212+ tests covering: rules engine, router, command registry, source registry, session intelligence, hooks, CLI helpers, sessions, dynamic commands, cost tracker, extract_json, hallucination detection, system prompt, and tool functions.

## Release

```bash
./scripts/release_alpha.sh
```

All glory to God!
