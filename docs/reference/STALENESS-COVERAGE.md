# Staleness audit coverage (backlog 26)

Per-file status for the repo-wide staleness audit, risk-first. Batch 1 is what every session loads. The parent row stays open until every tracked file (3,714 on 2026-10-16) has a row here.

What "reviewed" means in batch 1: every markdown link and backticked path was checked for existence (relative to the file, the repo root and HOME); every backticked command was run through `command -v`, and `chewbacca <sub>` lines through `chewbacca <sub> --help`; each flag was triaged by hand. External URLs and prose claims were not checked, so a later batch reads those.

The scanner is `tools/stale_scan.py` (test: tests/test_stale_scan.py). Run it on the next batch's files and triage each flag by hand.

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
| skills/gtm-engineering/SKILL.md | fixed | fixed in c5bd7f79 without touching the file: `gtm` and `gtme` are now linked onto PATH, so `gtm clients` runs as written |
| skills/hud/SKILL.md | reviewed | reviewed: `~/.bob/spotify.json` is created when keys are added; `glance` is a HUD protocol word |
| skills/interface/SKILL.md | reviewed | reviewed: no dead path, link or command |
| skills/texts/SKILL.md | reviewed | reviewed: `owed`, `qr`, `send`, `drop` are `people texts` subcommands |
| skills/coursework/SKILL.md | fixed | fixed 2026-10-31: the `~/Chewbacca/apps/texts/ingest/ingest.py` line (now line 466) goes through `chewbacca where` |
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

## Batch 2, 2026-10-16: every skill

All 71 skills/*/SKILL.md were scanned (the 20 from batch 1 again, plus 51 new), along with all 130 other markdown files under skills/. For each skill, the first command it tells agents to run was checked to exist. Then `--help` was run on it, but only when the tool handles `--help`, and every `--flag` the doc uses was matched against that help.

Results: 25 commands matched their help. 25 skills name no runnable command. 18 commands exist on PATH, but `--help` wasn't sent because the tool doesn't parse it, so sending it could run the tool. 2 were false positives (`uv pip`, `git log`). 1 actually ran: `people distill --help` started a real distill until it was killed at 20s, with nothing written (fixed in bin/people, test in the people group).

The audit's biggest finding: 14 bin/ tools that skills or rules name bare were never linked onto PATH by setup.sh (gtm, gtme, decision-inbox, qr, recur, reel-assemble, reel-check, gtme-interview, call-listen, chewbacca-permissions, kyber-surfaces, railway-domain, tabs, and the one the navigation skill names). Fixed in c5bd7f79 with tests/test_doc_commands_linked.py, which fails when a doc names an unlinked tool.

| File | Status | Note |
|---|---|---|
| skills/agent-setup/SKILL.md | reviewed | reviewed: no dead path, link or command; `peekaboo` checked, ok |
| skills/animated-video/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/asa/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/audio-brief/SKILL.md | reviewed | reviewed: no dead path, link or command; `uv` checked, check |
| skills/call-coach/SKILL.md | fixed | fixed (c5bd7f79): `call-listen` is now linked onto PATH by setup |
| skills/clone-site/SKILL.md | reviewed | reviewed: no dead path, link or command; `site-gate` checked, ok |
| skills/creative-video/SKILL.md | fixed | fixed (c5bd7f79): `reel-assemble`, `reel-check` linked; `higgsfield`, `whisper-cli` are external installs it explains |
| skills/debugging/SKILL.md | reviewed | reviewed: no dead path, link or command; `git` checked, ok |
| skills/deep-research/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/demo/SKILL.md | reviewed | reviewed: no dead path, link or command; `git` checked, check |
| skills/diagram/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/grilling/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/gtme-interview/SKILL.md | fixed | fixed (c5bd7f79): `gtme-interview` linked onto PATH |
| skills/handwriting/SKILL.md | reviewed | reviewed: no dead path, link or command; `slop-check` checked, ok |
| skills/inference-engineering/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/jev-browse/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewie` checked, help not sent: tool does not handle --help |
| skills/kit-builder/SKILL.md | reviewed | reviewed: no dead path, link or command; `date` checked, help not sent: tool does not handle --help |
| skills/life-context/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewbacca` checked, ok |
| skills/life-ops/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/list-audit/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/mac-act/SKILL.md | reviewed | reviewed: no dead path, link or command; `peekaboo` checked, ok |
| skills/mac-apps/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewie` checked, help not sent: tool does not handle --help |
| skills/mac-brief/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/mac-debug/SKILL.md | reviewed | reviewed: no dead path, link or command; `mac` checked, ok |
| skills/mac-followups/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewie` checked, help not sent: tool does not handle --help |
| skills/mac-permissions/SKILL.md | reviewed | reviewed: no dead path, link or command; `tccutil` checked, help not sent: tool does not handle --help |
| skills/mac-runtime/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewie` checked, help not sent: tool does not handle --help |
| skills/mac-see/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/manim/SKILL.md | reviewed | reviewed: no dead path, link or command; `pip` checked, help not sent: tool does not handle --help |
| skills/openspec/SKILL.md | reviewed | reviewed: no dead path, link or command; `command` checked, help not sent: tool does not handle --help |
| skills/oss-apps/SKILL.md | reviewed | reviewed: no dead path, link or command; `oss-apps` checked, help not sent: tool does not handle --help |
| skills/ponytail/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/prospect-brief/SKILL.md | reviewed | reviewed: no dead path, link or command; `mac` checked, ok |
| skills/reflect/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/repo-health/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/reverse-engineering/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewbacca` checked, ok |
| skills/rsi/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewbacca` checked, ok |
| skills/screen-time/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/second-brain/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/setup/SKILL.md | reviewed | reviewed: `bin/bootstrap.sh` exists (relative to the checkout) |
| skills/shipping/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/skill-forge/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/stack-rules/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/startup-finance/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/study-guide/SKILL.md | reviewed | reviewed: no dead path, link or command; `guide` checked, ok |
| skills/study-system/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/video-edit/SKILL.md | reviewed | reviewed: `scripts/restart_scan.py` is relative to the skill folder and exists |
| skills/video-script/SKILL.md | reviewed | reviewed: no dead path, link or command; names no runnable command |
| skills/welcome/SKILL.md | reviewed | reviewed: no dead path, link or command; `chewbacca` checked, ok |
| skills/what-can-this-do/SKILL.md | fixed | fixed: `~/Chewbacca/skills/` (old checkout path) now points through `chewbacca where` |
| skills/your-data/SKILL.md | reviewed | reviewed: `~/life-reference/` is a folder the skill tells the user to create; `people distill --help` RAN a distill (no `--help` handling), fixed in bin/people |

Other markdown under skills/ (130 files):

| File | Status | Note |
|---|---|---|
| skills/animated-video/references/character-rig.md | reviewed | reviewed: no dead path or link |
| skills/animated-video/references/motion-graphics.md | reviewed | reviewed: no dead path or link |
| skills/animated-video/references/reflection.md | reviewed | reviewed: no dead path or link |
| skills/animated-video/references/remotion-pipeline.md | reviewed | reviewed: no dead path or link |
| skills/animated-video/references/review-loop.md | reviewed | reviewed: no dead path or link |
| skills/animated-video/references/story.md | reviewed | reviewed: no dead path or link |
| skills/coursework/references/grading-models.md | reviewed | reviewed: no dead path or link |
| skills/coursework/references/lms-ingest.md | fixed | fixed: two `~/Chewbacca/library/...` paths now go through `chewbacca where` |
| skills/coursework/references/syllabus-intake.md | reviewed | reviewed: no dead path or link |
| skills/creative-video/references/blender-to-seedance.md | reviewed | reviewed: no dead path or link |
| skills/creative-video/references/cutting-to-music.md | reviewed | reviewed: no dead path or link |
| skills/creative-video/references/editing.md | reviewed | reviewed: no dead path or link |
| skills/creative-video/references/routes.md | reviewed | reviewed: no dead path or link |
| skills/diagram/UPSTREAM.md | reviewed | reviewed: the paths belong to the upstream repo it credits |
| skills/diagram/references/animation.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/export-registry.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/export.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/import-drawio.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/import-excalidraw.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/import-mermaid.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/layout-budget.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/output-spec.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/primitive-annotation.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/primitive-icons.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/primitive-sketchy.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/primitive-terminal.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/primitives-core.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/semantic-patterns.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/style-guide.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-architecture-delta.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-architecture.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-bar.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-data-flow.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-db-schema.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-dependency.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-deployment.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-dp-integration.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-dp-security-matrix.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-er.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-fishbone.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-flowchart.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-gantt.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-heatmap.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-high-level.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-it-state.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-journey.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-kanban.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-layers.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-line.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-loop.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-medallion.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-nested.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-org-chart.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-polar.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-process.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-pyramid.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-quadrant.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-radar.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-sankey.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-scatter.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-sequence.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-state.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-story-map.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-swimlane.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-timeline.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-tree.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-treemap.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-uml-class.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-venn.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-wardley.md | reviewed | reviewed: no dead path or link |
| skills/diagram/references/type-waterfall.md | reviewed | reviewed: no dead path or link |
| skills/graph-engineering/references/curriculum.md | reviewed | reviewed: no dead path or link |
| skills/graph-engineering/references/extraction.md | reviewed | reviewed: no dead path or link |
| skills/graph-engineering/references/fusion-and-llm.md | reviewed | reviewed: no dead path or link |
| skills/graph-engineering/references/modeling.md | reviewed | reviewed: no dead path or link |
| skills/graph-engineering/references/task-graphs.md | reviewed | reviewed: no dead path or link |
| skills/gtm-engineering/references/REPO-ATLAS.md | reviewed | reviewed: no dead path or link |
| skills/gtm-engineering/references/bma/README.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/clay-playbook.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/objections.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/offer-and-proof.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/outbound-rules.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/reply-handling.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/scoring.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/togari-gtm-os-and-dedup.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/togari-platform.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/togari-sandbox.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/bma/vendor-recipes.md | reviewed | reviewed: the docs/ and config/ paths are in the togari repo it describes, not this one |
| skills/gtm-engineering/references/demand-gen-playbooks.md | reviewed | reviewed: no dead path or link |
| skills/gtm-engineering/references/domains.md | reviewed | reviewed: no dead path or link |
| skills/gtm-engineering/references/evaluation.md | reviewed | reviewed: no dead path or link |
| skills/gtm-engineering/references/sagar.md | reviewed | reviewed: `~/Downloads/Docs/Outbound` is a personal source folder |
| skills/handwriting/references/standard.md | reviewed | reviewed: no dead path or link |
| skills/handwriting/references/surface-standard.md | reviewed | reviewed: no dead path or link |
| skills/handwriting/scripts/paper-scans/README.md | reviewed | reviewed: no dead path or link |
| skills/interface/references/craft-floor.md | reviewed | reviewed: the `taste-skill` path is an upstream credit |
| skills/interface/references/data-loaders.md | reviewed | reviewed: no dead path or link |
| skills/interface/references/discover-data.md | reviewed | reviewed: no dead path or link |
| skills/interface/references/taxonomy.md | reviewed | reviewed: no dead path or link |
| skills/kit-builder/references/existing-kits.md | reviewed | reviewed: no dead path or link |
| skills/kit-builder/references/hard-lines.md | reviewed | reviewed: no dead path or link |
| skills/kit-builder/references/scoring.md | reviewed | reviewed: no dead path or link |
| skills/second-brain/references/librarian-from-sift.md | reviewed | reviewed: no dead path or link |
| skills/skill-training/references/domain-corpora.md | reviewed | reviewed: no dead path or link |
| skills/skill-training/references/learning-transfer.md | reviewed | reviewed: no dead path or link |
| skills/spiderverse-style/references/sources.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/accessibility.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/api.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/audit.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/components.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/database.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/deployment.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/design.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/performance.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/scroll-effects.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/state.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/testing.md | reviewed | reviewed: no dead path or link |
| skills/stack-rules/references/ux-laws.md | reviewed | reviewed: no dead path or link |
| skills/study-system/references/exam-prep.md | reviewed | reviewed: no dead path or link |
| skills/study-system/references/reading.md | reviewed | reviewed: no dead path or link |
| skills/study-system/references/retrieval-practice.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/publish.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/reflection.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/resolve.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/skit.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/style.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/styles.md | reviewed | reviewed: no dead path or link |
| skills/video-edit/references/technical.md | reviewed | reviewed: no dead path or link |
| skills/video-script/references/insights.md | reviewed | reviewed: no dead path or link |
| skills/video-script/references/library.md | reviewed | reviewed: no dead path or link |

## Batch 3, 2026-10-16: bin/ and tools/ headers against their flags

All 326 files in bin/ and tools/*.py were read statically, nothing was run. Every --flag in a file's docstring or header comment was looked for in the code below it (or the tools/ file a thin wrapper runs). 192 headers document flags. 12 flags came up unhandled, and every one belongs to another program named in the prose (claude --bg and --bare, people send --via, the higgsfield CLI, propose --shapes, scrape's flags handled in bin/lib/scrape_page.py, setup.sh --every-agent). So none are stale.

| File | Status | Note |
|---|---|---|
| bin/agent-history | reviewed | reviewed: 8 documented flag(s), all handled |
| bin/agent-nice | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/agents | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/ai-scan | reviewed | reviewed: no documented flags |
| bin/amber-redact | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/amber-user | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/api-grow | reviewed | reviewed: no documented flags |
| bin/backlog | reviewed | reviewed: no documented flags |
| bin/bb | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/bootstrap.sh | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/brain-pull-safe | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/brain-rerank | reviewed | reviewed: no documented flags |
| bin/brand-grab | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/break-it | reviewed | reviewed: no documented flags |
| bin/brief-audio | reviewed | reviewed: no documented flags |
| bin/brightspace | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/brightspace-sync | reviewed | reviewed: 9 documented flag(s), all handled |
| bin/browser-bridge | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/call-listen | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/call-pill | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/call-practice | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/call-watch | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chatgpt-bridge | reviewed | reviewed: no documented flags |
| bin/chatgpt-gateway | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chatgpt-tab | reviewed | reviewed: no documented flags |
| bin/chewbacca | reviewed | reviewed: no documented flags |
| bin/chewbacca-api | reviewed | reviewed: --example belong to another program named in the header |
| bin/chewbacca-apps | reviewed | reviewed: no documented flags |
| bin/chewbacca-bridge | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chewbacca-browser | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/chewbacca-chat | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-clay | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chewbacca-daemon | reviewed | reviewed: no documented flags |
| bin/chewbacca-docs | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-email | reviewed | reviewed: --via belong to another program named in the header |
| bin/chewbacca-google | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-groupme | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-ig | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/chewbacca-jobs | reviewed | reviewed: 8 documented flag(s), all handled |
| bin/chewbacca-land | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/chewbacca-launch | reviewed | reviewed: --bg belong to another program named in the header |
| bin/chewbacca-linkedin | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/chewbacca-mcp | reviewed | reviewed: no documented flags |
| bin/chewbacca-node | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/chewbacca-office | reviewed | reviewed: 7 documented flag(s), all handled |
| bin/chewbacca-pdf | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chewbacca-permissions | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-slack | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/chewbacca-usc | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/chewbacca-welcome | reviewed | reviewed: 7 documented flag(s), all handled |
| bin/chewbacca-whatsapp | reviewed | reviewed: no documented flags |
| bin/chewbacca-x | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/chrome-js | reviewed | reviewed: 10 documented flag(s), all handled |
| bin/claude-tab | reviewed | reviewed: no documented flags |
| bin/clay-balance | reviewed | reviewed: no documented flags |
| bin/clay-build | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/clay-fixture-check | reviewed | reviewed: no documented flags |
| bin/clay-go | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/clay-inbox | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/clay-map | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/clay-review | reviewed | reviewed: no documented flags |
| bin/closeout | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/code-slop | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/consolidate | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/context-budget | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/corpus | reviewed | reviewed: no documented flags |
| bin/course-ingest | reviewed | reviewed: no documented flags |
| bin/coursework | reviewed | reviewed: no documented flags |
| bin/craft-gate | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/decision-inbox | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/decision-lab | reviewed | reviewed: no documented flags |
| bin/decisions | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/demo-shoot | reviewed | reviewed: no documented flags |
| bin/durable-check | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/edit-cut | reviewed | reviewed: no documented flags |
| bin/edit-dna | reviewed | reviewed: no documented flags |
| bin/evolve | reviewed | reviewed: --shapes belong to another program named in the header |
| bin/fanout | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/fitness | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/granola-import | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/graph-fuse | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/gtm | reviewed | reviewed: no documented flags |
| bin/gtm-memory | reviewed | reviewed: no documented flags |
| bin/gtme | reviewed | reviewed: no documented flags |
| bin/gtme-dedupe | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/gtme-dnc | reviewed | reviewed: no documented flags |
| bin/gtme-grade | reviewed | reviewed: no documented flags |
| bin/gtme-graph | reviewed | reviewed: no documented flags |
| bin/gtme-interview | reviewed | reviewed: no documented flags |
| bin/gtme-learning | reviewed | reviewed: no documented flags |
| bin/gtme-library | reviewed | reviewed: no documented flags |
| bin/gtme-lookup | reviewed | reviewed: no documented flags |
| bin/gtme-math | reviewed | reviewed: no documented flags |
| bin/gtme-reply | reviewed | reviewed: no documented flags |
| bin/gtme-rules | reviewed | reviewed: no documented flags |
| bin/gtme-score | reviewed | reviewed: no documented flags |
| bin/gtme-signals | reviewed | reviewed: no documented flags |
| bin/guide | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/handoff-check | reviewed | reviewed: no documented flags |
| bin/higgsfield-shot | reviewed | reviewed: --image, --start-image belong to another program named in the header |
| bin/hud | reviewed | reviewed: no documented flags |
| bin/hud-accounts | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/hud-agent.md | reviewed | reviewed: no documented flags |
| bin/hud-autostart | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/hud-codex | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/hud-context | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/hud-gemini | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/hud-guide | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/hud-listen | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/hud-music | reviewed | reviewed: no documented flags |
| bin/hud-ollama | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/hud-runtime | reviewed | reviewed: no documented flags |
| bin/hud-speak | reviewed | reviewed: no documented flags |
| bin/hud-verse | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/hud-watch | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/ig-read | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/ingest | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/install-plynn.sh | reviewed | reviewed: no documented flags |
| bin/intro | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/jev | reviewed | reviewed: no documented flags |
| bin/jev-browse | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/kit-debt | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/kits | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/kyber-genui | reviewed | reviewed: 10 documented flag(s), all handled |
| bin/kyber-sessions | reviewed | reviewed: 7 documented flag(s), all handled |
| bin/kyber-surfaces | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/learn | reviewed | reviewed: no documented flags |
| bin/list-audit | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/list-gate | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/list-sift | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/live-check | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/mac-db | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/mac-use | reviewed | reviewed: no documented flags |
| bin/mac_use_chatgpt.py | reviewed | reviewed: no documented flags |
| bin/mac_use_claude.py | reviewed | reviewed: --bare belong to another program named in the header |
| bin/mac_use_cli.py | reviewed | reviewed: no documented flags |
| bin/main-ci | reviewed | reviewed: no documented flags |
| bin/maintain | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/meeting-autopilot | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/method | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/model-route | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/orphan-reap | reviewed | reviewed: --resume belong to another program named in the header |
| bin/oss-apps | reviewed | reviewed: no documented flags |
| bin/page-render | reviewed | reviewed: 8 documented flag(s), all handled |
| bin/peekaboo | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/peel | reviewed | reviewed: no documented flags |
| bin/people | reviewed | reviewed: no documented flags |
| bin/perplexity-tab | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/phone-mirror | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/portal | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/preflight | reviewed | reviewed: no documented flags |
| bin/propose | reviewed | reviewed: --expect belong to another program named in the header |
| bin/propose-voice.md | reviewed | reviewed: no documented flags |
| bin/prose-check | reviewed | reviewed: no documented flags |
| bin/qr | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/quote-check | reviewed | reviewed: no documented flags |
| bin/railway-domain | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/reading-check | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/realm-engine | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/realm-ui | reviewed | reviewed: 8 documented flag(s), all handled |
| bin/recur | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/reddit | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/reel-assemble | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/reel-check | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/reflect | reviewed | reviewed: --expect belong to another program named in the header |
| bin/repo-graph | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/resolve | reviewed | reviewed: no documented flags |
| bin/review-cross | reviewed | reviewed: no documented flags |
| bin/review-gate | reviewed | reviewed: no documented flags |
| bin/room-capture | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/room-listen | reviewed | reviewed: --remote-debugging-port belong to another program named in the header |
| bin/route-label | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/scars | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/scrape | reviewed | reviewed: --css, --format belong to another program named in the header |
| bin/screen-time | reviewed | reviewed: 7 documented flag(s), all handled |
| bin/secret-scan | reviewed | reviewed: no documented flags |
| bin/sim-reap | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/site | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/site-fast | reviewed | reviewed: no documented flags |
| bin/site-gate | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/skill-refs-check | reviewed | reviewed: no documented flags |
| bin/skill-scan | reviewed | reviewed: no documented flags |
| bin/slop-check | reviewed | reviewed: 4 documented flag(s), all handled |
| bin/stays | reviewed | reviewed: no documented flags |
| bin/superassistant | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/tab-rescue | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/tabs | reviewed | reviewed: no documented flags |
| bin/task-graph | reviewed | reviewed: no documented flags |
| bin/team | reviewed | reviewed: no documented flags |
| bin/text-command | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/textbook | reviewed | reviewed: no documented flags |
| bin/ui-proof | reviewed | reviewed: 5 documented flag(s), all handled |
| bin/untrusted-screen | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/usc-food | reviewed | reviewed: 6 documented flag(s), all handled |
| bin/ux-decision | reviewed | reviewed: no documented flags |
| bin/ux-do | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/ux-learning | reviewed | reviewed: no documented flags |
| bin/ux-policy | reviewed | reviewed: no documented flags |
| bin/voice-check | reviewed | reviewed: 2 documented flag(s), all handled |
| bin/web-record | reviewed | reviewed: no documented flags |
| bin/weft-box | reviewed | reviewed: no documented flags |
| bin/weft-build | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/weft-mcp | reviewed | reviewed: 1 documented flag(s), all handled |
| bin/weft-view | reviewed | reviewed: 3 documented flag(s), all handled |
| bin/work-ledger | reviewed | reviewed: no documented flags |
| tools/agent_context.py | reviewed | reviewed: no documented flags |
| tools/agent_runtime.py | reviewed | reviewed: no documented flags |
| tools/agent_skills.py | reviewed | reviewed: no documented flags |
| tools/agents_md.py | reviewed | reviewed: no documented flags |
| tools/backend_health.py | reviewed | reviewed: no documented flags |
| tools/brand_buyer.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/break_it.py | reviewed | reviewed: no documented flags |
| tools/changelog.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/checksums.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/claude_md_dedupe.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/claude_md_scrub.py | reviewed | reviewed: no documented flags |
| tools/clay_fixture_check.py | reviewed | reviewed: no documented flags |
| tools/clay_review.py | reviewed | reviewed: no documented flags |
| tools/codex_context.py | reviewed | reviewed: no documented flags |
| tools/codex_execution_evidence.py | reviewed | reviewed: no documented flags |
| tools/codex_hooks.py | reviewed | reviewed: no documented flags |
| tools/codex_integrations.py | reviewed | reviewed: no documented flags |
| tools/codex_launch_consent.py | reviewed | reviewed: no documented flags |
| tools/codex_skills.py | reviewed | reviewed: no documented flags |
| tools/commands.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/committed_checksums.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/context_cost.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/context_import.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/counts.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/decision_evals.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/decision_lab.py | reviewed | reviewed: no documented flags |
| tools/evals.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/export-people-csv.py | reviewed | reviewed: no documented flags |
| tools/export-people-everything.py | reviewed | reviewed: no documented flags |
| tools/first_win.py | reviewed | reviewed: no documented flags |
| tools/fixed.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/frontmatter.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/gtm.py | reviewed | reviewed: 8 documented flag(s), all handled |
| tools/gtm_memory.py | reviewed | reviewed: 13 documented flag(s), all handled |
| tools/gtme_config.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/gtme_dedupe.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/gtme_dnc.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/gtme_done.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/gtme_grade.py | reviewed | reviewed: 17 documented flag(s), all handled |
| tools/gtme_graph.py | reviewed | reviewed: no documented flags |
| tools/gtme_interview.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/gtme_jev.py | reviewed | reviewed: no documented flags |
| tools/gtme_learning.py | reviewed | reviewed: no documented flags |
| tools/gtme_lessons.py | reviewed | reviewed: 13 documented flag(s), all handled |
| tools/gtme_library.py | reviewed | reviewed: no documented flags |
| tools/gtme_lists.py | reviewed | reviewed: no documented flags |
| tools/gtme_math.py | reviewed | reviewed: no documented flags |
| tools/gtme_operator.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/gtme_presend.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/gtme_ready.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/gtme_recovery.py | reviewed | reviewed: no documented flags |
| tools/gtme_reply.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/gtme_rules.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/gtme_score.py | reviewed | reviewed: 9 documented flag(s), all handled |
| tools/gtme_signals.py | reviewed | reviewed: no documented flags |
| tools/gtme_solo.py | reviewed | reviewed: 12 documented flag(s), all handled |
| tools/hook_bench.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/hookd_replay.py | reviewed | reviewed: 15 documented flag(s), all handled |
| tools/hooks_sync.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/host_hooks.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/host_install.py | reviewed | reviewed: no documented flags |
| tools/host_mcp.py | reviewed | reviewed: no documented flags |
| tools/hud_runtime.py | reviewed | reviewed: no documented flags |
| tools/hybrid_route.py | reviewed | reviewed: no documented flags |
| tools/hybrid_route_eval.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/inventory.py | reviewed | reviewed: no documented flags |
| tools/jev.py | reviewed | reviewed: no documented flags |
| tools/kit_runtime.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/lessons_audit.py | reviewed | reviewed: 4 documented flag(s), all handled |
| tools/linkcheck.py | reviewed | reviewed: no documented flags |
| tools/manifest_guard.py | reviewed | reviewed: no documented flags |
| tools/md_usage.py | reviewed | reviewed: no documented flags |
| tools/memory_compact.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/merge_regen.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/mine_asks.py | reviewed | reviewed: no documented flags |
| tools/missing_eval.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/needs_you_eval.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/next_move.py | reviewed | reviewed: 10 documented flag(s), all handled |
| tools/no_prompts.py | reviewed | reviewed: --every-agent belong to another program named in the header |
| tools/oss_apps.py | reviewed | reviewed: 6 documented flag(s), all handled |
| tools/oss_apps_build.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/proof_stats.py | reviewed | reviewed: no documented flags |
| tools/public_scan.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/rea_kit.py | reviewed | reviewed: 4 documented flag(s), all handled |
| tools/recall_gate.py | reviewed | reviewed: no documented flags |
| tools/resolve.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/review_cross.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/review_gate.py | reviewed | reviewed: no documented flags |
| tools/review_snapshot.py | reviewed | reviewed: no documented flags |
| tools/review_task_scope.py | reviewed | reviewed: no documented flags |
| tools/route_tune.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/rule_checks.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/send_approval.py | reviewed | reviewed: 4 documented flag(s), all handled |
| tools/send_policy.py | reviewed | reviewed: 16 documented flag(s), all handled |
| tools/shared_checks.py | reviewed | reviewed: no documented flags |
| tools/skill_match.py | reviewed | reviewed: no documented flags |
| tools/skill_requires.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/skill_route_eval.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/skill_route_shadow.py | reviewed | reviewed: no documented flags |
| tools/source_sync.py | reviewed | reviewed: no documented flags |
| tools/stale_scan.py | reviewed | reviewed: no documented flags |
| tools/steering_rate.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/stranger_run.py | reviewed | reviewed: 7 documented flag(s), all handled |
| tools/table_graph.py | reviewed | reviewed: no documented flags |
| tools/tabs.py | reviewed | reviewed: no documented flags |
| tools/task_graph.py | reviewed | reviewed: no documented flags |
| tools/team.py | reviewed | reviewed: 9 documented flag(s), all handled |
| tools/team_index.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/tools_link.py | reviewed | reviewed: 3 documented flag(s), all handled |
| tools/train_bigwork_probe.py | reviewed | reviewed: no documented flags |
| tools/treg_client.py | reviewed | reviewed: no documented flags |
| tools/triggers.py | reviewed | reviewed: 2 documented flag(s), all handled |
| tools/trust.py | reviewed | reviewed: 1 documented flag(s), all handled |
| tools/usage_report.py | reviewed | reviewed: 5 documented flag(s), all handled |
| tools/ux_decision.py | reviewed | reviewed: no documented flags |
| tools/ux_learning.py | reviewed | reviewed: no documented flags |
| tools/ux_policy.py | reviewed | reviewed: no documented flags |
| tools/verdicts.py | reviewed | reviewed: 11 documented flag(s), all handled |
| tools/work_ledger.py | reviewed | reviewed: no documented flags |
| tools/write_log.py | reviewed | reviewed: no documented flags |
| tools/writelog_parity.py | reviewed | reviewed: 2 documented flag(s), all handled |

## Next batches

- Batch 4: hook bodies (.claude/hooks/*.sh) and their claims
- Batch 5: docs/, team/memory, external URLs, everything else
