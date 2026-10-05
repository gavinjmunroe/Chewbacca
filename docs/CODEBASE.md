# Codebase guide

A map of the whole repository for someone who has never seen it. It explains
what each part is, how the parts talk to each other, where state lives, and
what will surprise you. It was written on 2026-10-05 against `main`, from the
code rather than from older docs. Counts drift, so rerun the commands shown
when an exact number matters.

If you read one section, read [The mental model](#the-mental-model).

## Contents

1. [The mental model](#the-mental-model)
2. [Repository map](#repository-map)
3. [How it gets onto a machine](#how-it-gets-onto-a-machine)
4. [The session lifecycle and hooks](#the-session-lifecycle-and-hooks)
5. [The instruction layer: rules, skills, commands, agents](#the-instruction-layer)
6. [Kits, procedures, methods, crafts and maps](#kits-procedures-methods-crafts-and-maps)
7. [The command-line tools](#the-command-line-tools)
8. [Controlling the Mac](#controlling-the-mac)
9. [Kyber: the HUD app](#kyber-the-hud-app)
10. [The voice loop](#the-voice-loop)
11. [Surfaces, generated panels and sessions on the glass](#surfaces-generated-panels-and-sessions-on-the-glass)
12. [Jev](#jev)
13. [The learning loop](#the-learning-loop)
14. [Personal data and the second brain](#personal-data-and-the-second-brain)
15. [The team board](#the-team-board)
16. [Multiple agent runtimes](#multiple-agent-runtimes)
17. [Tests, CI and release integrity](#tests-ci-and-release-integrity)
18. [Where state lives](#where-state-lives)
19. [Making a change](#making-a-change)
20. [Things that will surprise you](#things-that-will-surprise-you)
21. [Where to read next](#where-to-read-next)

---

## The mental model

Chewbacca is mostly **not a program**. It is a large set of plain-text files
that change how a coding agent you already run (Claude Code first, Codex
second) behaves, plus command-line tools that agent can call, plus one macOS
app that puts a voice and a screen overlay on top of all of it.

Think of it as five layers stacked on the agent:

```
                         you (typing, or talking)
                                   |
        +--------------------------+---------------------------+
        |                                                      |
        v                                                      v
  Claude Code / Codex session                      Kyber.app (hud/, Swift)
        |                                          overlay + mic + keys
        |  1. INSTRUCTIONS  CLAUDE.md, .claude/rules,            |
        |                   skills/, .claude/commands,           | ~/.bob/hud.sock
        |                   .claude/agents                       | (line protocol)
        |                                                        v
        |  2. ENFORCEMENT   .claude/hooks/*.sh, run by the    hud-listen (Python)
        |                   harness at fixed moments; some    the voice brain; runs
        |                   can refuse a tool call or a turn  claude -p / codex
        |                                                        |
        +--------------------------+-----------------------------+
                                   |
                                   v
                 3. TOOLS   bin/ (CLIs), tools/ (Python), mac/ (chewie),
                            mcp/ and bin/*-mcp (MCP servers)
                                   |
                                   v
                 4. STATE   second brain repo (private markdown),
                            ~/.chewbacca, ~/.bob, ~/coursework, people.db
                                   |
                                   v
                 5. THE MAC Messages, Contacts, Calendar, Mail, Chrome,
                            the accessibility tree, the screen
```

Three ideas explain most of the design:

- **Instructions are the product, hooks make them stick.** A rule in a
  markdown file is advice. A hook that runs a script and exits 2 is a refusal.
  Most of `.claude/hooks/` exists because a rule was written down, ignored, and
  then turned into code. The commit history and the comments in those files
  record the incident behind each one.
- **No model where code will do.** Routing, fast paths, quality gates and most
  panels run without a model call. A model is the fallback, not the first
  step. Jev (a hosted typed-judgment API, see [Jev](#jev)) sits between the
  two: one small, fast, closed-question call where a rule is not enough.
- **Personal data stays local and private.** The repo is public. Everything
  about the person using it lives in a separate private "second brain" repo
  and in state folders under `~`. Nothing in the repo should contain personal
  facts, keys or Jev measurements.

There is no server to deploy, except one: the team board web app
(`apps/team-web`), which is a thin view over task files in this repo.

---

## Repository map

About 1,400 tracked files and 240,000 lines of text. Tracked source is small
(a few MB per directory). The checkout on disk can be several GB because of
gitignored Swift build output (`hud/.build`, `voice/.build`, `plynn/.build`).

| Directory | What it is |
| --- | --- |
| `CLAUDE.md` | The global standards. `setup.sh` merges it into `~/.claude/CLAUDE.md`, so editing it changes every session on every installed machine. |
| `AGENTS.md` | Generated from `instructions/agent-neutral.md` for Codex and other agents. Never edit by hand. |
| `.claude/rules/` | 14 standards files (git, security, writing, naming, typescript, review, context discipline, and so on). |
| `.claude/hooks/` | About 49 bash hooks plus `lib.sh`. The enforcement layer. |
| `.claude/commands/` | 57 slash commands (dev workflow, school, Mac, personal ops). |
| `.claude/agents/` | 4 subagents: `code-reviewer`, `context-keeper`, `debugger`, `explorer`. |
| `.claude/skills` | A symlink to `../skills`. |
| `skills/` | About 50 first-party skills, each `skills/<name>/SKILL.md` plus `evals/` and sometimes `references/`. |
| `bin/` | About 128 command-line tools (Python, Node, bash) and `bin/lib/` (shared libraries, the surfaces package). |
| `tools/` | About 56 Python modules: generators, checkers, the review gate, runtime adapters, Jev CLI, team CLI. |
| `mac/` | `chewie` (Mac control by layers), its data files, a Chrome bridge, an app wrapper, the `weft-box` VM definition. |
| `hud/` | **Kyber**, the Swift macOS overlay app (formerly BobHUD). |
| `voice/` | Optional Swift text-to-speech server (Kokoro on CoreML). |
| `plynn/` | A retired dictation app kept as a parts bin. Not built or installed. |
| `call/` | `ears.swift`, the audio capture binary for the call coach. |
| `genui/` | Catalog, policy and benchmark for model-composed HUD panels. |
| `surfaces/`, `data/` | Registries for HUD surfaces, local "engines" and the open-source app catalog. |
| `team/`, `apps/team-web/` | The team task board: one markdown file per task, plus its web UI. |
| `methods/` | Question sets for each kind of work (build, debug, research, decision...). |
| `crafts/` | Researched rules for genres (demo video, short-form video, web UX...). |
| `maps/` | Per-website knowledge, `maps/<host>/MAP.md`. |
| `procedures/` | Tasks learned once and replayed (Airbnb/Booking comparison, Blackboard ingest, LinkedIn). |
| `learning/`, `decisions/`, `fanout/` | Learned navigation graphs, labeled Jev decision sets, the Jev fan-out experiment. |
| `second-brain/`, `templates/` | Templates for the private context repo and for coursework. |
| `settings/` | A settings template and `toolkit.json` (generated list of plugins, MCP servers, skill packs). |
| `runtimes/`, `instructions/` | Runtime profiles (Claude Code, Codex, exports) and the shared agent-neutral instructions. |
| `tests/` | About 230 files: `tests/run.sh` plus Python, bash and Node tests. |
| `docs/` | About 87 docs. See [Where to read next](#where-to-read-next). |
| `extensions/`, `prompts/`, `snippets/`, `examples/`, `texts/`, `research/`, `work/`, `patches/` | Smaller support folders: a ChatGPT bridge extension, one runtime prompt, code snippets, a sample app, textbook ingest tooling, one memo, one prompt, third-party patches. |
| `setup.sh`, `start.sh`, `start.ps1`, `install.sh`, `uninstall.sh`, `doctor.sh`, `add-skill.sh` | Install, repair and removal. |

Two folders appear on some machines but are **gitignored and not part of the
repo**: `kits/` (kits are their own repos) and `asa/` (a private course
corpus).

---

## How it gets onto a machine

### Entry points

| Script | Use |
| --- | --- |
| `start.sh` | The `curl ... | bash` path. Downloads a tarball into `~/.chewbacca`, verifies every covered file against `SHA256SUMS.txt`, runs `bin/bootstrap.sh` (Xcode tools, Homebrew), then `setup.sh`. `--dry-run` changes nothing. |
| `setup.sh` | The real installer, about 2,900 lines of bash in named sections. |
| `start.ps1` | Windows: copies the portable configuration only. |
| `install.sh` | Small per-project install. Copies files and the `settings/settings.json` template. |
| `uninstall.sh` | Removes what setup added. `--dry-run` first. |
| `doctor.sh` | Proves the install works. Exit 0 clean, 1 warnings, 2 broken. `--fix` repairs the safe things. |

### setup.sh sections

Sections run in order and each is guarded by `should_run`, so any one can be
skipped or run alone (`--only`, `--skip`, `--fast`, `--profile
personal|student|developer|portable`). CI asserts every section header is
followed by that guard and that setup never calls `read`.

`prereq`, `repos`, `settings`, `editor`, `desktop`, `mcp`, `rules`, `skills`,
`plugins`, `tools`, `agents`, `mac`, `plynn`, `verify`, `manifest`.

### What lands where

| Destination | How | Note |
| --- | --- | --- |
| `~/.claude/hooks`, `rules`, `commands`, `agents`, `output-styles` | **copied** | Editing the repo copy does nothing until setup runs again. |
| `~/.claude/skills/<name>` | **symlinked** to `skills/<name>` | Edits are live. Setup refuses to overwrite a foreign skill of the same name. |
| `~/.local/bin/<tool>` | **symlinked** to `bin/<tool>` | About 70 tools. `chewie` links to `mac/bin/chewie`. |
| `~/.claude/settings.json` | rewritten by a Python block inside setup.sh | Hooks are registered here with `_register(...)`. |
| `~/.claude/CLAUDE.md` | merged between `<!-- CHEWBACCA:BEGIN/END -->` | Your own text below the region is kept. |
| `~/.claude/d1-config.sh` | written | `PERSONAL_CONTEXT_DIR`, `CHEWBACCA_REPO_DIR`. Read as data by tools, never sourced. |
| `~/.chewbacca/` | written | Version, install manifest, craft notes, and later all runtime state. |
| Codex side | `tools/agent_runtime.py` | `~/.codex/AGENTS.md`, `hooks.json`, `config.toml`, receipts in `~/.chewbacca/runtime-installs/`. |
| Shell rc | a PATH line and a guard block | |

Setup installs **no launchd agents**. Background jobs are opt-in through the
tool that owns them (`hud-autostart`, `maintain --install`,
`chewbacca-bridge`, `people`, `mac/app/install-brief.sh`).

**Important:** `settings/settings.json` is a template used by `install.sh` and
`start.ps1`. It is not what `setup.sh` installs, and it registers far fewer
hooks. The authoritative hook list is the `_register` calls in `setup.sh`.

### Removing it

`chewbacca uninstall` removes the kit's own settings keys and hooks, and any
file in `~/.claude/{skills,commands,rules,agents,output-styles,hooks}` whose
name matches a repo file. The Codex side is removed separately with
`chewbacca agent remove`, which restores each file from its receipt only if
the file is unchanged since install.

---

## The session lifecycle and hooks

Hooks are bash scripts the agent harness runs at fixed moments. Each gets the
event as JSON on stdin. A hook can add context (print to stdout, or emit
`additionalContext`) or refuse (exit 2, `decision: block`, or
`permissionDecision: deny`). `.claude/hooks/lib.sh` gives every hook a
watchdog, an output cap and a log at `~/.chewbacca/logs/hooks.log`, which is
what `chewbacca log` and doctor's hook-health check read.

```
SESSION START
  session-context.sh     brain digest (identity, NOW, people, memory index),
                         kits list, due coursework, recent voice questions
  kit-autopull.sh        fast-forward the kit repo, at most hourly

EVERY PROMPT (UserPromptSubmit, all advisory)
  skill-route.sh         match prompt to skill descriptions, by meaning then by
                         stems; "read this skill first"
  kit-route.sh           match prompt to a kit's use-when line
  method-guard.sh        inject the questions for this kind of work, once
  model-route.sh         Jev's advice on model and effort tier
  design-context.sh      design constants when the work is visual
  coursework-context, voice-remind, ask-capture, youtube-transcript-ready,
  prayer-remind (inert unless the person opted into a session opener)

EVERY TOOL CALL
  PreToolUse   guards that can refuse: load-guard (CPU fan-out), zsh-guard,
               chatdb-guard, submit-guard (coursework submission),
               launch-guard (outbound campaigns), suite-rerun-guard,
               fusion-guard, browser-ux-guard, ux-guard, plan-guard,
               skill-gate; advisory: env-guard, repo-overlap-guard
  PostToolUse  write-log.sh (who wrote which file), format-and-sync.sh
               (prettier, then auto-commit and push the second brain),
               untrusted-screen.sh (flags prompt injection in fetched
               content, never blocks), prose-guard, clay-reply-guard

END OF TURN (Stop)
  slop-guard.sh          scores the reply with slop-check; refuses on em
                         dashes or banned words above the threshold
  handoff-guard          refuses a reply that ends with a command for the user
  durable-guard          refuses when a correction was not written down
  agent-claim-guard, assumption-guard, vibe-guard, design-gate,
  stale-read-guard       other refusals
  stop-check, list-guard, kit-debt   advisory notes
  kit-autopush           pushes already-committed work after a quick local gate
```

`terminal-loop.sh` also runs on several events to relay what a terminal
session is doing to the voice loop.

Adding a hook means two edits: the script in `.claude/hooks/` and a
`_register` line in `setup.sh`. `tests/hooks_registered.sh` compares the two.
"Written but never registered" is the most repeated bug class in this repo.

---

## The instruction layer

### Rules

`.claude/rules/*.md`. Some are always loaded (imported with `@` from
`CLAUDE.md`), others carry `paths:` frontmatter and load only when matching
files are touched (design system, deploy gate, AI features, spatial mapping).
`chewbacca context` shows what the always-on set costs in tokens.

### Skills

A skill is a folder with a `SKILL.md`. Its frontmatter has `name`,
`description`, and optionally `requires: [cli, ...]` (doctor checks those CLIs
exist) and `license`. The **description is the interface**: it is written as a
list of things a person would actually say, because that is what routing
matches against. Bulk detail goes in `references/`, loaded only after the
skill engages. `evals/evals.json` holds test prompts:

```json
{ "skill": "coursework",
  "cases": [ { "prompt": "what is due this week", "expect_tools": ["coursework"] },
             { "prompt": "write my essay", "reject": true, "why": "..." } ] }
```

Skills are routed four ways, cheapest last:

1. **Native.** The model sees every description and loads a body when one fits.
2. **`skill-route.sh`** (UserPromptSubmit). Embedding match first (a local
   model through Ollama), then a deterministic stem matcher. It prints "read
   this skill first" when something matches and stays silent otherwise.
3. **`skill-gate.sh`** (PreToolUse). For skills marked enforced, refuses the
   first non-Skill tool call once, so the skill is actually read.
4. **`tools/skill_match.py`.** The same matcher, used by the voice agent.

Families, roughly: Mac control (`mac-*`, `hud`), school (`coursework`,
`study-system`, `study-guide`), people and context (`people`, `texts`,
`second-brain`, `life-ops`), video and media (`creative-video`, `demo`,
`manim`), GTM and sales (`gtm-engineering`, `clay-navigation`, `list-audit`,
`call-coach`), design and web (`interface`, `clone-site`, `site-spec`,
`stack-rules`), engineering (`debugging`, `reviewing-changes`, `shipping`,
`graph-engineering`), Kyber (`kyber-surfaces`, `team`, `oss-apps`), Jev (`jev`,
`jev-browse`), and meta (`skill-forge`, `kit-builder`, `setup`,
`deep-research`).

Beyond the first-party skills, setup installs about 8 cloned upstream skills
and 3 skill packs. Those live outside the repo and are listed in
`settings/toolkit.json`.

`stack-rules` deserves a note: it holds twelve stack-specific standards
(components, API, database, deployment, accessibility...) that would cost about
16,000 tokens if always loaded, so they load only when the work touches them.

### Commands and subagents

Slash commands (`.claude/commands/*.md`) are prompt files invoked as `/name`.
The kit's stance is that you should rarely need them, because skills route
themselves. Subagents (`.claude/agents/*.md`) are separate agents with their
own tools for a bounded job: review, debugging, read-only exploration, and
auditing the personal context repo.

---

## Kits, procedures, methods, crafts and maps

| Thing | What it is | Where |
| --- | --- | --- |
| **Kit** | A separate repo a person lives inside for weeks while an agent walks them through a long, scored process (an application, an appeal). Carries state in `PROGRESS.md`, a phase machine in its `CLAUDE.md`, scripts for the arithmetic, and a named hard line it refuses to cross. Discovered by a `.kit` marker file. | Own repos. `bin/kits` finds them; `kit-route.sh` routes to them; `skills/kit-builder` says when something deserves to be one. |
| **Procedure** | A task done once by hand, traced, distilled to a script, replayed once before it is kept. Files: `PROCEDURE.md`, `params.json`, `run.*`, `verify.*`, `effects` (read-only, writes-local or outbound), `stats.json`. | `procedures/<name>/`, with a `bin/` shim (for example `bin/stays`). `bin/site find` searches them. |
| **Method** | A short set of questions for one kind of work, opening with a falsifier and the cheapest test. | `methods/*.md`, injected by `method-guard.sh`. |
| **Craft** | Researched rules for a genre, with sources. `bin/craft-gate <genre>` fails closed when no notes exist, so production cannot skip research. | `crafts/`, copied to `~/.chewbacca/craft/`. |
| **Map** | What is known about one website: URLs, selectors, quirks, mistakes already paid for. | `maps/<host>/MAP.md`, written by `bin/site snap`. |

`docs/LEARNING-TO-ACT.md` is the spec for procedures. It is honest that the
recorder and distiller are not built yet: procedures are currently written by
hand from a traced run.

---

## The command-line tools

### The dispatcher

`bin/chewbacca` is a bash script with a hand-written `case` table. It finds its
repo by following its own symlink (or `$CHEWBACCA_ROOT`). Subcommands map to
three kinds of target:

- repo scripts: `doctor`, `setup`, `install`, `uninstall`, `add-skill`
- `bin/lib/*.sh` helpers: `status`, `skills`, `commands`, `why`, `log`,
  `bench`, `export`, `completion`
- Python tools: `context`, `evals`, `triggers`, `import`, `agent`, `jev`,
  `review-gate`, `work-ledger`, `task-graph`, `ux-*`, `gtme-*`, `clay-*`,
  `decision-lab`, `live`, `guide`

The help text comes from a separate `COMMANDS` array, so a new verb needs both
edits. Most tools in `bin/` are not reached through `chewbacca` at all: they are
linked into `~/.local/bin` and called directly by the agent.

Many `bin/` entries are short shims that run a module in `tools/`. When a tool
looks tiny, read the module it runs.

### Families

| Family | Tools | Notes |
| --- | --- | --- |
| Mac control | `chewie` (in `mac/`), `mac-use`, `peekaboo` (wrapper), `chrome-js`, `ux-do`, `web-record`, `portal`, `agents` | See [Controlling the Mac](#controlling-the-mac). |
| Browser model backends | `chatgpt-tab`, `chatgpt-gateway`, `chatgpt-bridge`, `claude-tab`, `perplexity-tab`, `browser-bridge`, `chewbacca-bridge` | Drive signed-in browser sessions of other models; the bridges let a browser-hosted model run an allowlisted set of local tools. |
| Web reading | `scrape`, `site`, `site-fast`, `jev-browse`, `brand-grab`, `reddit` | Playwright based. `jev-browse` lets Jev choose each click and stops before any send, pay or delete. |
| Quality gates | `slop-check`, `prose-check`, `ai-scan`, `code-slop`, `secret-scan`, `skill-scan`, `craft-gate`, `list-gate`, `handoff-check`, `durable-check`, `closeout`, `review-gate` | Mostly model-free. Many run inside hooks. |
| Learning loop | `reflect`, `propose`, `evolve`, `fitness`, `learn`, `scars`, `consolidate`, `maintain`, `method` | See [The learning loop](#the-learning-loop). |
| Personal data | `people`, `coursework`, `course-ingest`, `bb`, `brightspace`, `textbook`, `intro`, `stays`, `amber-user` | `people` is an 8,000-line Node CLI over SQLite. |
| Voice and HUD | `hud`, `hud-listen`, `hud-speak`, `hud-guide`, `hud-music`, `hud-context`, `hud-autostart`, `kyber-surfaces`, `kyber-genui`, `kyber-sessions`, `text-command`, `superassistant` | See [Kyber](#kyber-the-hud-app). |
| Calls | `call-listen`, `call-watch`, `call-practice`, `room-listen` | Live call coaching. |
| Jev and routing | `jev`, `decisions`, `decision-lab`, `model-route`, `list-sift`, `fanout`, `route-label` | |
| GTM and lists | `gtme-*`, `clay-*`, `list-audit` | Offline except `clay-balance`. |
| Work state | `work-ledger`, `task-graph`, `backlog`, `team`, `kits` | |
| Agent sandbox | `weft-build`, `weft-mcp`, `weft-box`, `weft-view` | Builds agents with weft inside a Lima VM that sees only `~/weft-projects`. |
| Video | `reel-check`, `reel-assemble`, `edit-cut`, `edit-dna`, `page-render`, `demo-shoot`, `higgsfield-shot`, `brief-audio` | ffmpeg based. |

### MCP servers this repo provides

| Server | File | Tools |
| --- | --- | --- |
| chewbacca | `bin/chewbacca-mcp` (Node, stdio or HTTP) | `who_do_i_know`, `person_brief`, `who_am_i_overdue_with`, `whats_due`, `course_ai_policy`. Read-only wrappers over `people` and `coursework`. |
| amber | `mcp/amber/amber-mcp` | Per-user contact memory with preview, apply and undo for imports. |
| weft | `bin/weft-mcp` | One `weft` tool whose argv is checked by `bin/lib/weft_fence.js`. |

Setup also registers third-party MCP servers (peekaboo, git and
others). Those are listed in `settings/toolkit.json`.

---

## Controlling the Mac

`mac/data/layers.json` defines seven ways to make the Mac do something,
cheapest first. The rule is to climb from layer 1 and stop at the first that
works. A screenshot is the last resort.

| # | Layer | Needs | Examples |
| --- | --- | --- | --- |
| 1 | Data | Full Disk Access | `sqlite3` on `chat.db`, `defaults`, `mdfind` |
| 2 | Scripting | Automation | `osascript`, JXA, Shortcuts |
| 3 | Accessibility | Accessibility | `chewie see`, `agent-desktop`, `peekaboo see` |
| 4 | Synthetic input | Accessibility | `peekaboo click/type`, `cliclick` |
| 5 | Vision | Screen Recording | `peekaboo image`, `screencapture` |
| 6 | Browser | varies | Playwright over CDP, `chrome-js` |
| 7 | Sandbox | nothing on the host | a VM |

Two names get confused:

- **`chewie`** (`mac/bin/chewie`, in this repo) is the layered controller:
  `see`, `shot`, `click`, `type`, `run`, `texts`, `terminal`, `web`, `plan
  check|run`, `brief`. Plans are type-checked against `mac/data/grammar.json`
  and actions marked `confirm` need `--yes`.
- **`mac`** is a separate Swift binary (from `github.com/31Carlton7/mac-cli`)
  that setup builds into `~/.local/bin/mac`. It reads and writes Calendar,
  Reminders, Contacts, Mail, Messages and Notes with `--json`. Exit 2 means a
  person must grant a permission; do not retry.

The `mac-control` skill chooses between them.

---

## Kyber: the HUD app

Kyber (`hud/`, installed as `/Applications/Kyber.app`, bundle id
`dev.bobthebuilder.hud`) is a Swift accessory app: no Dock icon, never takes
focus, holds no model. It draws over everything, listens to the microphone and
global keys, and talks to the rest of the system over a Unix socket.

### Targets

`hud/Package.swift` (Swift 6 tools, macOS 14):

| Target | Size | Role |
| --- | --- | --- |
| `KyberKit` | about 46 files, 14,500 lines | Almost everything: socket server, line parser, views, voice capture, hands, surfaces |
| `Kyber` | 3 files | `main.swift` (wiring), `KeyDictation.swift`, `TextTrigger.swift` |
| `Portal` | separate app | Hand-tracked "portal" that shows a real window through a hole (`docs/SPATIAL-OS.md`) |
| `HudHand` | 1 file | Presses accessibility elements and draws the agent's cursor |
| `HandDemo` | demo only | |

### How it draws

One full-screen, borderless, non-activating `NSPanel` at floating level, on
every Space, transparent, clicking through by default. It turns mouse events on
only while the pointer is over something it drew. Surfaces are placed by
named region, never by coordinates.

### The socket protocol

`~/.bob/hud.sock` (mode 0600, peer uid checked). Newline-delimited text lines.
The spec for anyone sending lines is `hud/CLAUDE.md`; the parser is
`KyberKit/LineParser.swift`.

Downstream (client to Kyber), the core verbs:

```
@ name at=<region> w=<width>   open or switch to a surface
c id Type props                create a component
> parent child child           attach children
d /pointer <json>              set data at a pointer (props bind to pointers)
r root                         name the root; nothing paints until r
- name                         close a surface
s "text"                       a line on the pill ("hyper bar")
w "answer"                     the written answer in the conversation panel
p state                        presence (idle, listening, thinking, speaking)
m id x y w h label= tone=      mark a screen rect (guide rings)   u id  unmark
a x y | a off                  move the agent cursor
press n                        AXPress an element
to s-<id>                      address the panel to a Claude session card
listen token=<hex>             subscribe to events
```

Upstream (Kyber to subscribers): `h "text"` (a request, spoken or typed),
`k down/up` (talk key), `x` (dismissed), `e <action> ...` (button presses and
other events), `v /pointer <json>` (value changes), `g`, `pt` (pointing).

Events are only sent to clients that subscribed with the token in
`~/.bob/hud.token`. An event that names a `surface=` goes only to the client
that drew that surface. A client that never subscribes gets no errors and no
events, which is a common first confusion.

### Processes Kyber owns

- **`hud-listen`**, the voice brain, spawned at launch and respawned when a
  request finds no listener. `ListenerWatchdog.swift` restarts it if it drops
  off the socket.
- **`whisper-server`** on 127.0.0.1:8178, used only to correct dictation.
- Kyber itself is kept alive by launchd once `bin/hud-autostart` has written
  its LaunchAgent (with `PATH` baked in, because launchd's `PATH` cannot find
  `claude` under nvm).

### Keys and modes

| Input | Does |
| --- | --- |
| Hold the talk key (globe by default) | Talk to the assistant |
| Hold Control, then globe | Dictation: words type at the caret live, whisper corrects them on release. Nothing goes to the assistant. |
| Option-Space | Typed command bar |
| Option-Command-Space | Hide or show the HUD |
| Option-Command drag | Point at a screen region ("this") |
| A self-text starting "Kyber" | `TextTrigger.swift` watches the Messages database and runs `bin/text-command`, which answers by text. Anything that would send, pay or delete comes back as a draft. |

Guide mode (`bin/hud-guide`) finds a control in the front window's
accessibility tree and draws a ring around it; Kyber reports when the person
clicks inside it. `bin/hud-music` is a no-model music player (Spotify, then
YouTube).

### Build and install

```
hud/scripts/bundle.sh [debug|release]   swift build, assemble build/Kyber.app, sign
hud/scripts/install.sh                  verify signature, old app to Trash, install, relaunch
swift test   (in hud/)                  Swift unit tests
```

**Why signing matters.** macOS stores an Accessibility grant as a code
requirement. An ad-hoc signature can only pin the binary hash, so every
rebuild silently revokes the grant while System Settings still shows it on.
`hud/scripts/signing-identity.sh` creates a stable local certificate, and
`install.sh` refuses an ad-hoc or different certificate. `bin/lib/axgrant.py`
detects a dead grant.

---

## The voice loop

```
Person      Kyber (Swift)                hud-listen (Python)                models / tools
  | hold key   |                               |                               |
  |----------->| k down --------------------->| hush any speech               |
  | speak      | Apple speech recognizer,      |                               |
  |            | partials on the pill          |                               |
  | release    | h "text" -------------------->| 1. no-model fast paths        |
  |            |                               |    (stop words, math, time,   |
  |            |                               |    music, open an app, agenda,|
  |            |                               |    "show my day" surfaces)    |
  |            |<---------------- p thinking --| 2. hud-context: front app,    |
  |            |                               |    window, selection          |
  |            |                               | 3. route.py decides where ---->| Jev, one choice,
  |            |                               |    it goes                    | when rules are unsure
  |            |                               | 4. run it:                    |
  |            |                               |    assistant -> warm claude -p|-> Bash: hud, mac, ...
  |            |                               |    terminal  -> draft into a  |
  |            |                               |      Claude tab (sent only    |
  |            |                               |      when the person says so) |
  |            |                               |    browser / perplexity       |
  |            |<-- s "...", w "...", @ c d r -| 5. stream the answer back     |
  |  hears it  |<-- level (band animates) -----| 6. hud-speak (Kokoro) speaks  |
  |            |                               | 7. log to superassistant/     |
  |            |                               |    questions.jsonl            |
```

Key files:

- `bin/hud-listen` (about 4,000 lines). The loop. Claims a lock so only one
  listener runs, scrubs inherited Claude Code environment variables, keeps a
  warm `claude -p` process taking stream-json turns, and queues typed requests
  while letting a spoken one interrupt.
- `bin/lib/route.py`. The router. In order: explicit naming ("in terminal"), a
  correction within 15 seconds ("no, to you"), rules (texting someone goes to
  the assistant; work-shaped words with a Claude tab open go to the terminal),
  then one Jev call, then default to the assistant. The front app is evidence,
  not a destination.
- `bin/hud-agent.md`. The voice agent's rules.
- `bin/superassistant`. Builds the voice agent's system prompt from
  `hud-agent.md`, `methods/doctrine.md`, a few rules, a names-only skill index,
  and a digest of the second brain (identity, NOW, people, memory index). It
  is rebuilt before every run and rewritten only when the text changes, so the
  prompt cache survives. Also logs every question and answer.
- `bin/hud-speak`. Kokoro text-to-speech on MLX, a long-lived child speaking
  JSON lines. `voice/` is an optional CoreML replacement (`HUD_SPEAKER=hud-voice`).
- `tools/hud_runtime.py`. Whether the voice runs on Claude or Codex, claimed by
  the session hooks.

The call coach is a sibling: `call/ears.swift` captures the microphone and the
other side's system audio, `bin/call-listen` segments and transcribes it with
its own whisper server and shows cues on the glass (rules first, then Jev
choosing a line from a bank, then a warm model), and `bin/call-watch` offers
coaching when a call app takes the microphone.

---

## Surfaces, generated panels and sessions on the glass

These turn Kyber from a voice pill into a place where work happens. The
authoritative docs are `docs/KYBER-SURFACES.md` and `docs/GENUI.md`.

### Surfaces

A **surface** is a live panel that stands in for opening a Mac app, drawn with
no model call. The data behind most of them is one typed graph,
`~/.chewbacca/os-graph.sqlite`:

- `bin/lib/osgraph.py` defines the ontology (Person, Thread, Message,
  MailItem, Event, Assignment, Task, Project, File, Day...) with typed edges
  (`SENT_BY`, `AWAITS_REPLY_FROM`, `DUE_ON`, `OWED_BY`...).
- `osgraph_ingest.py` reads Messages, Mail, coursework, Calendar, Reminders,
  the people store and Claude sessions into it. Only short recent snippets are
  kept.
- `osgraph_walks.py` holds the queries.

Each surface is a `Provider` in `bin/lib/surfaces/` with four parts: `fetch`
(a walk or a CLI read), `layout` (Kyber lines drawn once, every changing prop
bound to a pointer), `model` (returns `{pointer: json}`), and `actions` (run
only on a button press, all prefixed `ks-`). Kinds include needs-you, today,
tasks, conversations, people, person, code, notes, github, whatsapp, music,
files and engine.

`bin/kyber-surfaces` is the daemon that draws them. It subscribes on the HUD
socket, sends the layout once, then sends only the `d` lines that changed.
`hud-listen` starts it, hands it phrases like "show my day" through
`bin/lib/surface_intent.py`, and deliberately ignores `ks-*` presses so a
press never becomes a model turn.

### Generated panels

`bin/kyber-genui` handles a panel request no fixed surface covers. A model
composes the layout from a closed catalog (`genui/catalog.json`), binds data
only by reference, never sees the data itself, and may only use the button
actions in `genui/policy.json`. Every line is validated; a failed layout gets
one repair and then a plain fallback panel.

### Claude sessions on the glass

`bin/kyber-sessions` draws a card per running Claude Code session with its
transcript and diff. Typing a reply on the glass is written into that
session's own inbox by `bin/lib/sessions_inbox.py`, or resumes it headless if
nothing has it open. It never sends mid-turn and never grants permissions.

### Local engines and the open-source catalog

`data/oss-apps/apps.json` is a catalog of open-source Mac apps with licenses
(built by `tools/oss_apps_build.py`, queried with `bin/oss-apps`). The engine
surface renders an open-source program already running locally (Ollama,
Tailscale, Gitea) from `data/surfaces/engines.json`, and refuses any engine
that is not permissively licensed in that catalog.

---

## Jev

Jev is TypeSafe's typed-judgment API: send a state and closed questions, get
typed answers back quickly. Chewbacca uses it wherever a rule is not enough
but a full model turn is too slow or too open-ended: voice routing, choosing
which Claude tab gets a request, picking a call-coach line, choosing a click in
`ux-do` and `jev-browse`, advising on model tier, flagging injected text.

There are two clients on purpose:

| Client | Used for | Behavior on failure |
| --- | --- | --- |
| `bin/lib/jev.py` | Runtime calls inside voice turns and pickers. Short timeout, latest model. | Returns `None`; every caller falls back to rules. |
| `tools/jev.py` (`bin/jev`) | Explicit CLI calls. Pinned model, longer timeout, input size cap. | Errors loudly. |

The key is read from `TYPESAFE_API_KEY` or the Keychain. Every runtime call is
logged to `~/.bob/decisions.jsonl` so outcomes can be joined back later
(`bin/decisions`, `bin/decision-lab`).

**Do not publish Jev scores or timings** anywhere in this repo. TypeSafe's
terms forbid it; measurements live in private notes, and code comments point
there instead of stating numbers.

---

## The learning loop

The kit tries to improve its own voice routing from what went wrong, with a
person approving every change:

```
reflect  ->  cases  ->  propose  ->  evolve --expect --gate --branch  ->  learn/<id>  ->  a person merges
```

- **`bin/reflect`** reads voice logs and Claude Code transcripts, replays every
  failure through today's `hud-listen` fast path, and keeps only the ones that
  still fail. One case in three is held out.
- **`bin/propose`** asks `claude -p` to write a patch from the visible cases. A
  patch that touches protected paths (the loop itself, tests, `.claude/`,
  setup, CI) or deletes a test line is reverted.
- **`bin/evolve`** applies the patch in a throwaway worktree, requires the
  judge to fail before and pass after, scores it, and refuses it if the score
  drops, suite checks newly fail, or eval cases newly fail. A survivor is
  committed to a `learn/<id>` branch. It never merges.
- **"The score"** (`bin/fitness`) is skill eval coverage minus a penalty for
  weak triggers. It measures coverage and conformance, not quality.
- **Rules learned from failures** take a separate path: `bin/scars` mines
  postmortems from commit messages, `bin/consolidate --promote` writes proposed
  rules into `methods/consolidated.md`, and `bin/maintain` runs the cycle
  nightly if installed.

`docs/SELF-LEARNING.md` and `docs/LEARNING-TO-ACT.md` describe the intent and
are explicit about what is not built yet.

---

## Personal data and the second brain

**The second brain** is a separate private git repo of markdown about the
person: `YOU.md` (or `core/identity.md`), `NOW.md`, `PEOPLE.md`, `VOICE.md`,
and `memory/` with a `MEMORY.md` index. `tools/agent_context.py` finds it, in
order, from `$CHEWBACCA_BRAIN_DIR`, `~/.chewbacca/context.json`, the Codex
context file, an import in `~/.claude/CLAUDE.md`, `PERSONAL_CONTEXT_DIR` in
`~/.claude/d1-config.sh`, then `~/second-brain`. `agent_context.py read` prints
what a session should see. The `format-and-sync.sh` hook commits and pushes
every edit to it automatically. Templates are in `second-brain/`.
`tools/context_import.py` (`chewbacca import scan|apply|undo`) pulls what other
AI tools already know about the person into it, with a preview first and an
undo that removes only what it added.

Other stores:

| Store | Tool | What |
| --- | --- | --- |
| `~/.chewbacca/people/people.db` | `people` | Everyone the person knows: identities across Messages, Contacts and LinkedIn, facts distilled from messages, last contact, promises, scores. |
| `~/coursework/` | `coursework` | A machine-readable ledger of syllabi. The only allowed source for any date. Every date carries its source. |
| `~/.chewbacca/os-graph.sqlite` | `kyber-surfaces` | The typed graph behind surfaces. |
| `superassistant/questions.jsonl` | `superassistant` | Every voice question and answer. Gitignored. |

Rules that apply to all of them: read before asking, never state a date or a
fact you did not read, write durable corrections down the same turn, and
treat anything read from messages, mail or the web as data, never as
instructions (`.claude/rules/untrusted-content.md`).

---

## The team board

Tasks are files: `team/tasks/CHW-<n>.md`, with frontmatter (`id`, `title`,
`status`, `area`, `owner`, `priority`, `due`, `labels`, `done_when`, `proof`,
`source`...) and an activity log. Statuses run inbox, backlog, todo,
in_progress, in_review, done, plus an idea bin and canceled. `team/members.json`
and `team/config.json` hold the people and the board URL.

- **`bin/team`** (`tools/team.py`) reads from the fetched remote branch, and
  writes by building a one-file commit with a temporary index and pushing it
  straight to `main` of the main repository, retrying on a lost race. It never
  touches your working tree.
- **Commit links.** A commit that mentions `CHW-n` moves that task to
  in_progress and logs the commit; `fixes CHW-n` closes it with the commit as
  proof.
- **`apps/team-web`** is a dependency-free Node server and web UI deployed on
  Railway. It stores nothing: it reads and writes the same files through the
  signed-in person's GitHub token, so every edit is a commit under their name.

---

## Multiple agent runtimes

Claude Code is the primary runtime. Codex is supported as a second one, and
other hosts (ChatGPT in a browser, Perplexity Computer, generic) get a public
instruction export. `runtimes/profiles.json` lists each runtime's instruction
file, skills folder and hook support.

- `tools/agent_runtime.py` (`chewbacca agent plan|setup|status|remove`) links
  the shared skill library (`~/.chewbacca/skills`) into each runtime, merges a
  runtime block into its instruction file, installs hooks, and records a
  receipt so removal can restore exactly what it changed.
- `tools/codex_hooks.py` registers itself as Codex's single hook handler and
  translates Codex's events and patch format into the same bash checks Claude
  Code runs. Where Codex cannot block (desktop), failures are recorded
  privately.
- `AGENTS.md` is generated by `tools/agents_md.py` under a 24 KiB ceiling so
  it fits Codex's project instruction budget.

---

## Tests, CI and release integrity

### Running tests

```
bash tests/run.sh             every group, in parallel (CHEWBACCA_SUITE_JOBS, default 3)
bash tests/run.sh --list      group names
bash tests/run.sh hud         one group
```

Groups are `if group "name"` blocks in `tests/run.sh`, found by grep, so a new
block is a new group. Main groups: installer, tools, hud, reasoning backends,
people, guide, hooks, doctor, coursework, decision-learning, chewbacca CLI,
pytest (runs every Python test file), live, and smaller ones. A full run takes
several minutes; `suite-rerun-guard.sh` refuses a second full run on an
unchanged tree.

**Hermetic by construction.** The suite points every state directory
(`PEOPLE_DIR`, `COURSEWORK_DIR`, log dirs) into a temp folder, and tests that
install or run doctor use a sandbox `HOME`. A leaked `CLAUDE_CONFIG_DIR` once
made sandboxed tests touch the real config; setup and the context tools now
reset it when `HOME` is not the real home, and `tests/test_sandbox_config.py`
pins that.

**Live checks are separate.** `chewbacca live --list` lists checks that touch
real apps or models (`tests/live/*.sh`). The suite only checks that they parse
and have a skip path.

### CI

One workflow, `.github/workflows/lint.yml`, on pushes and pull requests to
`main`:

| Job | Runs |
| --- | --- |
| scripts (Linux) | `bash -n` and shellcheck on scripts; embedded Python compiles; setup.sh has no `read` and every section is guarded; `tools/evals.py`; `checksums.py --check`; `committed_checksums.py`; `counts.py --check`; `slop-check docs/ skills/ --max 60` |
| tests (macOS) | `bash tests/run.sh` |
| markdown-lint | broken relative links, hardcoded home paths, `secret-scan` |

### Generated regions and drift checks

| Generator | Writes | Check |
| --- | --- | --- |
| `tools/counts.py` | README counts region | `--check` in CI |
| `tools/agents_md.py` | `AGENTS.md` | `--check` in the suite |
| `tools/checksums.py` | `SHA256SUMS.txt` | `--check` (working tree) and `committed_checksums.py` (committed blobs) in CI |
| `tools/changelog.py` | `CHANGELOG.md` | built from commit messages |
| `tools/inventory.py` | README badges, `docs/REFERENCE.md`, setup.sh extension lists, `settings/toolkit.json` | **none**: it reads what is installed on the current machine. Never run it on a tree bound for `main`. |

Never hand-edit between `BEGIN GENERATED` and `END GENERATED` markers.

### Release integrity

`SHA256SUMS.txt` covers every script the installer runs (`*.sh`, `*.ps1`,
`bin/*`, `bin/lib/*`, `tools/*.py`, hooks, `runtimes/*.json`). `start.sh`
refuses to install if any downloaded file does not match. So **any change to a
covered file must be committed together with a regenerated `SHA256SUMS.txt`**.
The pre-commit hook (`.githooks/pre-commit`, through
`tools/manifest_guard.py`) refuses a commit that forgets.

### Review gate and quality gates

- **`review-gate`** (`tools/review_gate.py`) runs an independent read-only Codex
  review of the changes and mints a receipt only for a clean review. `check`
  passes only if the repository is byte-for-byte the state that was reviewed.
  Enforced by the Codex adapter at stop; used by procedure elsewhere
  (`skills/reviewing-changes`).
- **`slop-check`** scores prose for structural tells (em dashes, emojis,
  banned words, recap endings). It runs in CI at `--max 60` and as the Stop
  hook on every reply.
- **`secret-scan`** finds credential-shaped literals. **`code-slop`** finds
  AI-authorship tells in a diff. **`skill-scan`** grades a skill out of 100.
  **`handoff-check`**, **`durable-check`**, **`list-gate`** and
  **`craft-gate`** back the Stop and production hooks described above.

---

## Where state lives

| Path | What | Written by |
| --- | --- | --- |
| `~/.claude/` | Installed rules, hooks, commands, agents, skill links, settings, merged `CLAUDE.md` | `setup.sh` |
| `~/.local/bin/` | Tool symlinks | `setup.sh` |
| Second brain repo | Private markdown context and memory | the agent, the person, auto-synced by a hook |
| `~/.chewbacca/` | Version, manifest, people DB, os-graph, write-log, asks, work ledger, learning loop state (`learn/`, `evolve/`, `fitness.jsonl`), review receipts, craft notes, logs, runtime receipts | tools and hooks |
| `~/.bob/` | HUD socket, token, agent prompt, decisions log, voice memory, whisper model, recordings | Kyber, `hud-listen`, Jev callers |
| `~/coursework/` | The semester ledger | `coursework`, `course-ingest` |
| `~/.chewie/runs/` | Traces of `chewie plan run` | `chewie` |
| `~/Library/LaunchAgents/` | Only what opt-in tools install | `hud-autostart`, `maintain`, others |

Note that `~/.chewbacca` has two jobs: it is the state folder, and for
`curl | bash` installs it is also where the repo itself is unpacked.

---

## Making a change

1. Check the branch and the tree first: `git branch --show-current`,
   `git status`. Several agent sessions often work in the same checkout. Leave
   files you did not write alone; `stop-check.sh` and `write-log.tsv` tell you
   whose they are.
2. Make the edit, in a separate worktree if the work is long.
3. Run the groups you touched: `bash tests/run.sh <group>`.
4. Docs or skills changed: `python3 bin/slop-check <paths> --max 60` and
   `python3 tools/linkcheck.py`. A new skill needs `evals/evals.json` with at
   least four cases, one of them a rejection.
5. If `instructions/agent-neutral.md` changed, run `python3 tools/agents_md.py`;
   if skills, commands or rules were added or removed, run `python3 tools/counts.py`.
6. A covered script changed: `python3 tools/checksums.py` and stage
   `SHA256SUMS.txt` with it.
7. Stage by name and commit by path: `git commit -- <paths>`. Never `git add
   -A`, never a bare `git commit` while other sessions have staged files.
8. `python3 tools/committed_checksums.py` must pass on the new commit.
9. Get the change reviewed (`reviewing-changes` skill, `review-gate`).
10. Merge the latest `main`, rerun the checks on the merged tree, push, and
    watch the three CI jobs.

A new hook also needs its `_register` line in `setup.sh`. A new `chewbacca`
verb needs both the `case` branch and the `COMMANDS` entry. A new skill should
have a description written as the phrases people actually use.

---

## Things that will surprise you

1. **Copied versus linked.** Hooks, rules, commands and agents are copied into
   `~/.claude`; skills and tools are symlinked. If a hook edit "does nothing",
   rerun setup.
2. **Two settings files.** `settings/settings.json` is a template for the small
   installers. `setup.sh` builds the real one.
3. **Rules arrive twice in this repo.** Working inside the Chewbacca checkout,
   the project's `.claude/rules` and the installed user rules both load.
4. **`chewie` is not `mac`.** One is in this repo, the other is an external
   binary.
5. **Two Jev clients** with different timeouts and pins. Fixing one does not
   fix the other.
6. **Events need a subscription.** A HUD client that never sends `listen
   token=...` receives nothing and gets no error.
7. **Rebuilding Kyber can silently revoke Accessibility** unless it is signed
   with a stable certificate.
8. **Environment leaks.** Anything started from inside a Claude Code session
   inherits `CLAUDE_CODE_*` and similar variables. `hud-listen` scrubs them.
   Never `open -n` Terminal from an agent.
9. **Shared checkout.** Expect other sessions' uncommitted work in `git
   status`. The pre-commit hook refuses an index holding two sessions' files.
10. **Docs drift.** Several older docs (`ARCHITECTURE.md`, `GLOSSARY.md`,
    `SKILLS.md`) quote counts from earlier versions. Trust `tools/counts.py`
    and the code.
11. **`kits/` and `asa/` are not in git**, even when they are on disk.
12. **`tools/inventory.py` describes your machine**, not the repo.

---

## Where to read next

| You want | Read |
| --- | --- |
| Install, privacy, threat model | `docs/SETUP.md`, `docs/PRIVACY.md`, `docs/THREAT-MODEL.md` |
| Every skill, hook, command and plugin | `docs/REFERENCE.md` |
| Something is broken | `docs/TROUBLESHOOTING.md`, `chewbacca doctor` |
| The HUD wire format | `hud/CLAUDE.md` |
| Surfaces and generated panels | `docs/KYBER-SURFACES.md`, `docs/GENUI.md` |
| Voice design | `docs/VOICE-DESIGN.md`, `docs/JEV-HUD.md` |
| Mac control in depth | `docs/MACOS-TOOLS.md`, `docs/MACOS-APP-CONTROL.md`, `docs/mac/` |
| Runtimes and Codex | `docs/RUNTIMES.md`, `docs/CODEX-HOOKS.md` |
| Jev | `docs/JEV.md`, `docs/JEV-BROWSE.md`, `docs/DECISION-LAB.md` |
| Learning | `docs/SELF-LEARNING.md`, `docs/LEARNING-TO-ACT.md`, `docs/SITE-LEARNING.md` |
| School | `docs/SCHOOL.md` |
| What is open and next | `BACKLOG.md`, `ROADMAP.md`, `team/tasks/` |
| What changed | `CHANGELOG.md` |
| Contributing | `.github/CONTRIBUTING.md` |
