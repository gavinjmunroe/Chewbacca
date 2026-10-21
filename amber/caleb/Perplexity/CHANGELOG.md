# Changelog

## 0.7.1

### Security

- Path traversal guard: safe_path blocks reads/writes outside project root
- URL scheme whitelist: fetch_url_content only allows http/https
- API key redacted from HTTP error output
- .gitignore updated to exclude .perplexity/sessions/, sources/, benchmarks, routing logs

### Correctness

- Fixed ROUTING_BENCH never recording (missing global declaration in main())
- Fixed SESSION_SUMMARY stale reference bugs in restore_state and /reset
- Fixed O(n^2) extract_json: brace-matching parser replaces brute-force loop
- Added retry logic with exponential backoff to \_call_sonar_api
- Removed duplicate shell execution logic (unified through SandboxManager)

### Usability

- /help now shows all 40+ commands organized by category
- Usage hints for all discovery commands when called with no arguments
- .env.example documents all 7 configurable environment variables
- TTY color detection: ANSI codes disabled when output is piped
- Version sourced from importlib.metadata everywhere (banner, --version, /help)

### Architecture

- threading import moved to top of file
- Streaming spinner for agent loop API calls
- /model command for runtime model switching
- /cost command for session token/cost tracking

## 0.7.0

- Three-tier model routing: Ollama (free local) -> Sonar (paid) -> Agent API (third-party)
- Ollama integration: free local inference for quick/generation tasks
- Parallel agent system: /parallel for concurrent task execution
- Docker sandbox: /sandbox for isolated shell execution
- Auto-commit: /autocommit for git-first workflow
- LSP diagnostics: /diagnostics for real-time code errors
- Context manager: smart repo map + task-relevant file ranking
- /scaffold command for finding starter templates

## 0.6.0

- Streaming API support with SSE and spinner animation
- Cost tracker: per-model token counting and cost estimation
- 212 tests across 29 test files

## 0.5.0

- Active rules injection engine: loads rules by file type, workflow, and command via YAML frontmatter
- Command metadata system: description, allowed-tools, mode, model, rules, post-actions per command
- Discovery engine: /discover, /search, /compare, /docs, /fetch via Perplexity Sonar API
- Model routing layer: task-aware classification (discovery, architecture, debugging, generation, review, quick)
- Source registry and ingestion pipeline: /sources, /sources init, /sources scan, /staged
- GitHub integration: repo context, PR/issue/CI queries via gh CLI, /github command
- Session intelligence: repo snapshots, task lineage tracking, smart resume suggestions, /tasks
- Extended hooks: auto-typecheck, command benchmarking, quality gate (/gate), session summary
- 44 tests (up from 5)
- Updated API URL to chat/completions endpoint
- Search enabled/disabled per task type via router

## 0.4.0

- Public alpha hardening
- Session save/load/resume with /save, /sessions, /resume
- Context budget and compressed session summaries
- Dynamic command collision handling

## 0.3.1

- Added /help command
- Added --version CLI flag
- Standardized /hooks output header
- Added public alpha docs and helper scripts
- Added .env.example, LICENSE, and release checklist

## 0.3.0

- Public alpha hardening
- Hook config support
- Patch-based editing
- Workflow slash commands
- Project memory and preflight checks
