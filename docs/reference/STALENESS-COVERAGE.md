# Staleness audit coverage (backlog 26)

Per-file status for the repo-wide staleness audit, risk-first. Batch 1 is what every session loads. The parent row stays open until every tracked file (3,714 on 2026-10-16) has a row here.

What "reviewed" means in batch 1: every markdown link and backticked path was checked for existence (relative to the file, the repo root and HOME); every backticked command was run through `command -v`, and `chewbacca <sub>` lines through `chewbacca <sub> --help`; each flag was triaged by hand. External URLs and prose claims were not checked, so a later batch reads those.

Dismissed as false positives: Tailwind class strings, YAML keys, code snippets and commit-message examples that the scanner read as commands.

## Batch 1, 2026-10-16: always-loaded instructions, rules, top 20 skills

Top 20 skills means most commits in the last 30 days. There is no log of skill use on this Mac (checked ~/.chewbacca and the session transcripts), so churn stands in for use.

| File | Status | Note |
|---|---|---|
| CLAUDE.md | reviewed | reviewed: `tools/kit-check.sh` lives inside each kit and `~/.claude/.mcp.json` is one of two optional config spots; 1 external URL(s) not checked |
| AGENTS.md | fixed | fixed in code: the documented `chewbacca skills <query>` printed usage and exited 2; bin/lib/skills.sh now searches on a bare term (test in the chewbacca CLI group) |
| config/instructions/agent-neutral.md | fixed | fixed in code: same `chewbacca skills <query>` line as AGENTS.md, made true in bin/lib/skills.sh, so this file stayed untouched while other tabs edit it |
| config/instructions/unattended-lane.md | fixed | fixed: `decision-inbox check` is not on PATH, now `bin/decision-inbox check` from the checkout |
| .claude/rules/ai-features.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/context-discipline.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/deliverables.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/deploy-gate.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/design-system.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/do-it-yourself.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/git.md | reviewed | reviewed: `~/Chewbacca` and `../wt-slug` are an incident story and an example |
| .claude/rules/naming.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/research-the-craft.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/review-discipline.md | reviewed | reviewed: `~/Desktop/Home` is quoted incident evidence |
| .claude/rules/security.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/spatial-one-mapping.md | fixed | fixed: pointer to a memory note that was never saved, replaced with a line saying the inline numbers are the record |
| .claude/rules/typescript.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/untrusted-content.md | reviewed | reviewed: no dead path, link or command |
| .claude/rules/writing.md | reviewed | reviewed: no dead path, link or command |
| skills/gtm-engineering/SKILL.md | stale | stale, not fixed: lines 245 to 247 say `gtm clients`, `gtm client NAME` and so on, but `gtm` is not on PATH; the working form is `chewbacca gtm clients`. Left because another tab is editing this file; 1 external URL(s) not checked |
| skills/hud/SKILL.md | reviewed | reviewed: `~/.bob/spotify.json` is created when keys are added; `glance` is a HUD protocol word |
| skills/interface/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/texts/SKILL.md | reviewed | reviewed: `owed`, `qr`, `send`, `drop` are `people texts` subcommands |
| skills/coursework/SKILL.md | stale | stale, not fixed: line 294 `~/Chewbacca/apps/texts/ingest/ingest.py` is gone; the script is `apps/texts/ingest/ingest.py` in the chewbacca checkout. Left because another tab is editing this file |
| skills/clay-navigation/SKILL.md | reviewed | reviewed: the old test name is quoted on purpose as an incident; its three bin helpers exist |
| skills/spiderverse-style/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/kyber-surfaces/SKILL.md | fixed | fixed: `decision-inbox digest` now `bin/decision-inbox digest` |
| skills/nalana/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/web-apis/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/people/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/graph-engineering/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/mac-control/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/skill-training/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/agent-history/SKILL.md | reviewed | reviewed: `~/.claude-2` is an optional second config dir |
| skills/team/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/reviewing-changes/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/jev/SKILL.md | reviewed | reviewed: `~/.chewbacca/handoffs` is created on first save |
| skills/site-spec/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/mac-db/SKILL.md | reviewed | reviewed: no dead path, link or command |

## Batch 1 hooks: registration only

All 86 hook scripts registered in ~/.claude/settings.json exist on disk. `brake-guard.sh` runs by name through tools/shared_checks.py, as intended. `permission-log.sh` is registered under PermissionRequest but is in neither this repo nor setup.sh: a hand-installed local hook a fresh install will not get. Hook bodies were not read for stale claims; that is batch 2.

## Next batches

- Batch 2: hook bodies (.claude/hooks/*.sh), and bin/chewbacca verbs against README and docs/reference
- Batch 3: the remaining skills/*/SKILL.md
- Batch 4: docs/, team/memory, everything else
