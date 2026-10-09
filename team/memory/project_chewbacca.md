---
name: project-chewbacca
description: "Chewbacca (calebnewtonusc/Chewbacca, formerly D1-Vibe-Coding) is Caleb's public Claude Code kit: what it is, how its inventory regenerates itself, and the Todoist token he has decided to leave alone"
metadata:
  node_type: memory
  type: project
  originSessionId: 1efa20c1-d81e-416e-a1bb-bdac339eede1
  modified: 2026-08-11T04:14:43.574Z
---

**Chewbacca is Caleb's own Claude Code kit**, public at `github.com/calebnewtonusc/Chewbacca`,
tagline "turns Claude into the world's best sidekick." One `setup.sh` installs the whole
configuration: standards files, skills, subagents, hooks, MCP servers, and the macOS tools that let
Claude read the screen, drive apps, and open links. `doctor.sh` verifies the install, `uninstall.sh`
reverses it. It is config plus CLI tools, not a running program, which is the argument the README
makes against OpenClaw. **When a session's tool list shows skills like `agent-setup`, `peekaboo`,
`coursework`, `second-brain`, or `remote-mac`, that session is running Chewbacca.**

**Renamed twice on 2026-09-02, now `calebnewtonusc/Chewbacca`** (was D1-Vibe-Coding, then
Mac-Claude-Maxing for about an hour). Public. Local clone is
`~/code/chewbacca`, with symlinks left at both old paths. Tagline:
"turns Claude into the world's best sidekick." `~/.claude/hooks/sync-to-d1.sh` and `d1-inventory.py` were repointed each
time; both scripts keep their old filenames, so the `d1` in those names no longer means anything.

The rename carries a principle: **nothing should require typing a slash command.** Layers are
chosen for whether they fire on their own (standards, skills, subagents, hooks, macOS tools),
with slash commands last. Anything the installer cannot finish goes to the `agent-setup` skill,
not to a human checklist. Cloudflare D1 material stayed: that is the database, not the old name. The duplicate clone at
`projects/claude-workflow-kit` was removed 2026-08-10 and is in `~/.Trash`.

**Two things went wrong, both fixed 2026-08-10:**

1. A PostToolUse hook in `~/.claude/settings.json` copied `~/.claude/CLAUDE.md` into the repo and
   auto-pushed it to public main (commits `362eccb`, `faa1c42`). That replaced the 697-line
   generalized template with Caleb's personal instructions. Reverted in `85a03e0`. The mirroring
   branches are deleted from the hook. What remains: a secret-pattern guard plus auto-commit for
   files edited _directly inside_ the repo.

2. `SECURITY.md` printed the literal Todoist token in the example showing how to purge it. Public
   since 2026-04-09 at commit `3fced8a`. Redacted in HEAD, **still in git history**.

**Caleb decided on 2026-09-04 not to rotate the Todoist token. Do not raise it again.**
He was told the findings in full: it is live (200 on `api.todoist.com/api/v1/projects`, his personal
account), publicly readable at an old public commit of todo.md,
149 days exposed, and duplicated in 322 local files across the medha/amber worktrees. He said he does
not care and to stop asking. That is a decision, not an oversight, so treat it as closed: no
warnings, no re-verifying, no working it into a summary. Only bring it up if he asks.

**The CI gap that let it ship is closed (2026-09-04, `3775381`).** The old secret step grepped for
`sk-ant-api`, `ghp_`, and `ak_`; a Todoist token is forty bare hex characters, identical in shape to
the git SHAs this repo quotes in docs, so it matched nothing for five months. `bin/secret-scan` now
matches on **position instead of shape**: a long literal after `Bearer`, after `Authorization:`, or
assigned to a name containing token/key/secret/password. Env references and placeholders are exempt,
a line can opt out with `secret-scan: allow`, and CI proves the scanner fires on a synthetic
credential before trusting a pass.

**Why the repo's commands and rules differ from the live ones in
`~/code/archive/2026-code-root/.claude/`:** the repo copies are generalized on purpose (CUSTOMIZATION POINT
comments, no client org names, no absolute paths), sanitized in `13ecd61`. 14 files differ. Do not
"fix" that drift by syncing personal config over it. Run
`~/.claude/hooks/sync-to-d1.sh --check` to see the list; port changes by hand, keeping the repo copy
generic. See a private note.

## The extension inventory updates itself (built 2026-08-10)

Caleb's standing complaint was having to ask for the repo to be updated. The list of skills,
plugins, and MCP servers now regenerates from what is actually installed:

- `~/.claude/hooks/d1-inventory.py` reads `~/.claude/skills/*/`, `enabledPlugins` and
  `extraKnownMarketplaces` in `settings.json`, and `mcpServers` in `~/.claude.json`. It rewrites
  three marked regions: the extensions table and count badges in `README.md`, the clone-and-install
  block in `setup.sh`, and the manifest at `settings/toolkit.json`.
- `sync-to-d1.sh --sync` runs it, then prettier, then a secret scan, then commits and pushes. It is
  wired to the **Stop hook**, so it fires at the end of every session. `--dry-run` shows the diff.
- Publishing rule, and the reason this is safe: a skill reaches the public repo only if it carries a
  `.source` file with a public upstream URL, or ships in the repo's own `skills/`. A skill with
  neither is assumed personal and skipped, which is why `context` never leaves the machine. MCP
  servers are opt-in by name via `PUBLIC_MCP` in the generator, because `~/.claude.json` holds
  client hostnames and keys. The medha and togari servers are deliberately not on that list.
- The generator publishes metadata only (names, upstream URLs, licenses, counts). It never copies
  prose out of a personal file, which is the failure mode that caused the 2026-08-10 incident above.

**Two mode traps found and fixed while building it.** The Edit tool rewrites a file without
preserving its mode, and `sanitize()` used to `mv` a `mktemp` file (mode 600) over its target. Both
silently stripped `setup.sh`'s executable bit, which git records as a real change. `sanitize()` now
copies bytes back into the existing file, and `--sync` repairs exec bits before the dirty check.

`doctor.sh` reports 4 failures for missing kit hooks (`session-context.sh`, `format-and-sync.sh`,
`stop-check.sh`, `env-guard.sh`). Pre-existing drift, not a regression: Caleb's live setup uses
inline hooks in `settings.json` plus his own scripts, and never installed the kit's four. Do not
"fix" it by copying them in; they would sit there unreferenced.

See [[reference_writing_toolchain]] for what got added through this path first.

## Two more generated categories (2026-09-02)

`d1-inventory.py` grew past skills, plugins, and MCP:

- **`CLI_TOOLS`** publishes a command-line tool or macOS app only once its probe finds it
  installed (`bin` on PATH, `app` in /Applications, or `path`). Feeds a new
  `<!-- GENERATED: cli -->` table in `README.md`, a brew-install block plus MCP registration in
  `setup.sh`, and a `cli` key in `settings/toolkit.json`. An entry can carry its own `shell`
  (macOS-use, which has no formula) or `mcp_serve` (Peekaboo).
- **`PACKS`** collapses one upstream repo holding many skills into a single row with a live
  count, instead of 54 rows for one clone. Detected by resolving the symlink, since pack skills
  carry no `.source`.

Two bugs fixed while doing it, both pre-existing:

- `splice()` required a line between its markers, so a newly added empty marker pair reported
  "missing markers" and was skipped, which reads like a typo rather than an empty region.
- The generator and prettier rewrote `settings/toolkit.json` past each other forever (expanded
  arrays vs collapsed), committing the file every session with nothing changed. The file is now
  in `.prettierignore` because the generator owns it.

`doctor.sh` gained a macOS tools section. It uses `grep -c` rather than `case` inside `$( )`,
because macOS ships bash 3.2 which mis-parses the pattern's closing paren.

**The auto-commit hook swept unfinished work.** Another session's Stop hook ran
`sync-to-d1.sh --sync` mid-edit and committed this session's in-progress `README.md` and
`setup.sh` into its own commit (`81d702b`, "install Plynn on-device dictation"). Nothing was
lost, but commit messages in this repo do not reliably describe their contents.

See a private note.

## The 1000 list (2026-09-04)

`docs/1000.md` in the repo is 1000 numbered things wrong with the kit, written
by reading the tree. `docs/1000-STATUS.md` says which are closed and is
generated by `tools/fixed.py` from commit messages: a commit closes an item by
writing `Fixes items N of docs/1000.md` in its body. Never hand-edit the status
file, and put the item numbers in the commit or the work does not count.

Fourteen entries were wrong when written, because the list was compiled by
reading files rather than running them. `people` already had export, decay,
reconnect, birthdays, intro, tasks and three importers. Check before claiming a
feature is missing.

## Chewbacca is part of Amber (Caleb, 2026-09-04)

He said so directly. Earlier notes here and in `project_chewbacca_positioning.md`
framed it as a standalone personal kit; that framing is stale. It is a public
artifact under the Amber umbrella, which is also why the `people` CLI is a port
of Amber's identity architecture (Karthik and Sagar's design, ported with their
permission) rather than a coincidence. Resume bullets for Amber can carry
Chewbacca work.

## Connects to

- [[project_chewbacca_positioning]]: the audience thesis, and the note this file
  corrects on the standalone-versus-Amber question.
- a private note: why a viral repo is distribution at Amber
  launch rather than a side project.
- a private note: the `people` CLI, the port of Amber's identity
  architecture that is the kit's largest single feature.
- a private note: how that store broke silently for three days,
  and the symlink-never-copy rule that came out of it.
- [[project_chewbacca_live_checks]]: `chewbacca live` and `chewbacca guide`,
  both ported from Carlton Aikins' realm.
- a private note: what makes something a kit instead of a skill, which is the
  test every addition here has to pass.
- a private note: the Mac operator, project 2 of the 10-in-10, and the nearest
  neighbour to this one.
- [[reference_watch_skill]]: installed globally, and the perception layer a kit
  like this would consume rather than rebuild.

**2026-10-04.** Both prompt routers shadow-log every prompt to `~/.chewbacca/state/route-shadow.jsonl` (adb709c, 4d4f694); label with `bin/route-label`, tune with `tools/route_tune.py`, which refuses under 50 labels per hook. Thresholds unchanged until then. `python3 -m pytest tests -q` collects nothing: `tests/test_memory_terse.py:36` calls sys.exit at import (undiagnosed beyond that). The GitHub repo is PRIVATE as of this date, so the README curl installer 404s for signed-out users. Orphan Aryaa research commit pinned at branch `rescue/aryaa-memory-a916dac`.
