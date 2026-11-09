---
name: project_claude_jobs_on_subscription
description: apps/claude-jobs runs scheduled Claude jobs on the owner's own Pro/Max plan via `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN), no API key, on Railway so they run with the laptop shut. Live on caleb-os since 2026-11-02
metadata:
  type: project
---

`apps/claude-jobs` is Chewbacca's scheduler for Claude jobs that keep running
with the laptop closed. Each job is one markdown file in `apps/claude-jobs/jobs/`
(frontmatter `at`, `days`, `repos`, `role`, optional `tools`; body is the
prompt). The service calls `claude -p` with `--strict-mcp-config`, read tools
only, and repos cloned read-only. Auth is `CLAUDE_CODE_OAUTH_TOKEN` from
`claude setup-token`, the same token Claude's GitHub Action uses, so runs bill
to the plan, not an API account. `chewbacca claude-jobs` lists jobs, renders
the org chart (Phil Hewinson's "Org Chart.md" idea, built from the job roles)
and reads results back from Railway.

Ported from calebnewtonusc/joel-os, which found the setup-token path on
2026-11-02. Lessons kept from there: never surface execFile's err.message (it
repeats argv and leaked an MCP secret), close the child's stdin, retry a failed
job after 30 minutes, validate job names against `^[a-z0-9-]+$`.

Status as of 2026-11-02 21:22 PT: LIVE. `chewbacca claude-jobs connect caleb-os`
ran setup-token, Caleb approved in the browser, and the token went straight to
the caleb-os Railway service (health then said jobs: true). A triggered
morning-brief run on caleb-os returned ok and wrote 610 chars from his CRM, on
his plan, no API key. `connect <project> [service]` is the one-step setup for
anyone's Railway service; `set-token` is the paste fallback.

Caleb's deployed home for scheduled jobs is his joel-os instance (caleb-os on
Railway, via joel-os `bin/cloud-up`), not a second service from this app. Next
step: joel-os's runner loads these job files and takes the same hardening
(`--tools` plus `--restricted` and `--permission-mode default`, no web tools on
jobs that read private repos, fs errors fail the job instead of the service).
