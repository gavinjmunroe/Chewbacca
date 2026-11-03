# claude-jobs

Scheduled Claude Code jobs that run on your own Claude Pro or Max plan, with no API key and no API bill. The service runs on Railway, so the jobs keep going with your laptop shut.

`claude setup-token` gives you a long-lived OAuth token for your plan. It's the same token Claude's GitHub Action uses. The service holds it as `CLAUDE_CODE_OAUTH_TOKEN` and runs each job as `claude -p` headless, so a job counts against your normal plan usage and nothing else.

## A job is one markdown file

Put it in `jobs/`. The file name is the job name (lowercase, digits, dashes). The frontmatter says when it runs and the body is the prompt.

```markdown
---
title: Morning brief
role: Chief of staff
at: "07:30"
days: daily
repos: calebnewtonusc/second-brain
---

Write the morning brief for today...
```

- `at` is 24-hour Pacific time. A job runs once a day, the first minute at or after `at`.
- `days` is `daily` or a list like `mon, wed, fri`.
- `repos` are GitHub repos cloned read-only before each run and handed to Claude with `--add-dir`.
- `tools` narrows what the job can use. The ceiling is `Read, Glob, Grep, WebSearch, WebFetch`. A job that names `repos` gets only `Read, Glob, Grep` unless it lists the web tools itself, so nothing planted in a private repo can fetch its contents out. The runner passes `--tools` (the whole list, not a pre-approval) and `--restricted`, so a Mac set to bypassPermissions, and its hooks, never apply to a job.
- `role` groups jobs on the org chart. `chewbacca claude-jobs org-chart` renders the one-page chart from these files, the way Phil Hewinson's "Org Chart.md" lists every role and its cadence.

Each run is saved to `$DATA_DIR/runs/<job>/<date>.md`. A failed run waits 30 minutes before it tries again, and the error you see is Claude's own stderr, never the command line.

## Reading the results

```bash
chewbacca claude-jobs status
chewbacca claude-jobs latest morning-brief
chewbacca claude-jobs trigger morning-brief
```

These read `CLAUDE_JOBS_URL` and `JOBS_SECRET` from `~/.chewbacca/claude-jobs.env`. Every route except `/health` needs `Authorization: Bearer $JOBS_SECRET`.

`chewbacca claude-jobs run <job>` runs one job on this Mac with its own Claude login instead, which is how you test a new job before it goes to Railway.

## Where it runs

Caleb's always-on home is his joel-os instance, https://caleb-os.up.railway.app, deployed with `bin/cloud-up` from `calebnewtonusc/joel-os`. Its own jobs runner turns on once `CLAUDE_CODE_OAUTH_TOKEN` is set on the caleb-os service, so don't stand up this service next to it. The job format, the local `run`, the org chart and the read-only hardening live here; folding these job files into joel-os's runner is the next step.

This service is for a kit user without a joel-os instance.

To turn jobs on, run `claude setup-token`, then `chewbacca claude-jobs set-token caleb-os` in a terminal and paste the token at the hidden prompt. It reaches Railway over stdin, never argv, and the command refuses piped input, so a person always does the paste.

## Railway, standalone

| Variable                  | What it is                                                                     |
| ------------------------- | ------------------------------------------------------------------------------ |
| `CLAUDE_CODE_OAUTH_TOKEN` | from `claude setup-token`, approved in your browser                            |
| `GITHUB_TOKEN`            | a fine-grained token with Contents: read on the repos your jobs name           |
| `JOBS_SECRET`             | any long random string, the same one in `~/.chewbacca/claude-jobs.env`         |
| `DATA_DIR`                | `/data`, with a Railway volume mounted there so runs and state survive deploys |

The service's root directory is `apps/claude-jobs`. `railway.json` sets the start command and the `/health` check. The GitHub token reaches git through `GIT_CONFIG_*` env vars only, and neither it nor `JOBS_SECRET` is passed to Claude.

## Tests

```bash
node --test apps/claude-jobs/test/*.test.js
bash tests/run.sh claude-jobs
```

Ported from `calebnewtonusc/joel-os`, which ran the first one.

---

All glory to God! ✝️❤️
