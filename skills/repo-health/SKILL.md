---
name: repo-health
description: "Find what has rotted in a project: dead code, unused imports, stale or vulnerable deps, env drift, what's safe to delete. Also for an audit, a messy repo, or which stalled projects to pick back up."
triggers: >-
  Find what has rotted in a project. Use when the user asks to clean this up, find dead code, remove unused imports, check my dependencies, whether anything is out of date or vulnerable, what is safe to delete, or asks for an audit of a project or repo. Also use when a repo feels messy, before handing a project to someone else, or when env vars have drifted. Also use when asked which old or unfinished projects to pick back up, or to scan all repos for stalled work.
requires: [git]
---

# Repo health

Four kinds of rot, each with a deterministic check. Run the checks, then judge
what the output means: none of these tools is right often enough to act on
blindly.

## Dead code

```sh
npx ts-unused-exports tsconfig.json 2>/dev/null | head -20
npx depcheck 2>/dev/null
grep -rn 'TODO\|FIXME\|HACK\|XXX' --include='*.ts' --include='*.tsx' --include='*.py' . | grep -v node_modules
grep -rn 'console\.log' --include='*.ts' --include='*.tsx' . | grep -v '\.test\.\|\.spec\.\|logger\.'
```

**Confirm before deleting.** An export with no importer may be a public API, a
plugin entry point, or loaded by a string name that no static tool can see. Grep
the name across the whole tree, including config and docs, and check whether the
package's `main` or `exports` points at it. Deleting a genuine entry point breaks
consumers silently and the test suite will not notice.

A `console.log` in a hot path is a real finding. One in a CLI that is meant to
print is not. Read the line before flagging it.

## Dependencies

```sh
npm audit --audit-level=moderate 2>/dev/null || pnpm audit 2>/dev/null
npm outdated 2>/dev/null
```

Treat a vulnerability report as a claim to verify, not an instruction. Ask whether
the vulnerable path is reachable from this code at all: a prototype-pollution
advisory in a build-time dependency is not the same risk as one in a request
handler, and a blanket upgrade to clear a dashboard can break more than it fixes.

Report the count, then name the ones that are actually reachable.

## Environment variables

Compare `.env.example` against `.env`: variables the code reads and the example
never documents, and documented variables nothing reads any more. The first
breaks every new contributor on their first run. **Never print a value**, only a
name.

## Structure

Files over a few hundred lines doing several unrelated things, the same literal
in several files that should be one constant, and local reimplementations of a
helper that already exists in the repo. Grep before keeping any private copy.

## Reporting

Group by what it costs, not by what tool found it. Something that breaks a new
contributor's first run outranks a stale TODO, however many TODOs there are. Say
which findings you confirmed by reading the code and which are a tool's raw
output that still needs a human look.

## Scanning every repo for stalled work

Asked "what else is unfinished, scan all my repos" on 2026-10-10, the scan
listed 15 stalled repos as equal candidates. He picked "all of them", then said
two things that should have been in the first list:

- "We used to be so slop at desing lmao." Old repos were built before the
  current design bar. Finishing one means committing the stray work, getting the
  build green, AND a design pass to today's bar (design-system rule, interface
  skill), with desktop and 375px screenshots as the proof.
- "Some of them are slop lol." Six of the fifteen had no product behind them:
  three identical 3/15 "initial MVP" mission landing pages with a waitlist
  (Zero Hunger, The Vote, Reprogram), the same pattern in Newton Foundation, a
  generic planner Chewbacca already beats (Kairos), and a briefing site in an
  Expo shell (Vigil).

So the scan itself sorts before it lists:

1. Real: built for a named person or a live product (a grandpa's school, a
   co-founder's app, a client), with working code past a landing page.
2. Slop: a mission statement plus a waitlist, a batch of same-day "initial MVP"
   commits, or a thing the kit already does better. Name the reason in one line.

Lead with the real ones, list the slop ones under their own line with the
reason, and let him decide whether to drop them. Never finish a slop one
without his yes. Check the remote owner too: a co-founder's or an org's repo
gets a branch and a PR, never a push to their main.
