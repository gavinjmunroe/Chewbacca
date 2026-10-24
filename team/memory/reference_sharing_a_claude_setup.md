---
name: reference_sharing_a_claude_setup
description: Giving someone a copy of the kit's Claude Code setup is a prompt md for their Claude plus an idempotent install.sh that merges into their ~/.claude, not chewbacca setup.sh. First built for Colin on 2026-10-19.
metadata:
  type: reference
---

Giving a friend a copy of this Claude Code setup takes two pieces: a prompt
file their own Claude runs, and an install.sh behind it. The first build is
calebnewtonusc/colin-claude-setup (2026-10-19), and its handoff covers the
details.

Caleb asked on 2026-10-19: "would it make more sense to just give him an md to
throw into his claude to go along with giving him the chewbs repo link?" The
md is the front door (SETUP-FOR-CLAUDE.md). A bare md isn't enough on its own,
because the other person's Claude then rebuilds about 16 plugin installs, 14
MCP adds and 80 skill links from prose, and that's where it overwrites their
own CLAUDE.md and hooks.

Rules that held:

- The person already has their own ~/.claude, so never run chewbacca setup.sh
  for them. It edits CLAUDE.md and settings.json. Link skills from their own
  Chewbacca clone and add one `@` import line to their CLAUDE.md.
- Skip anything that already exists by name. Merge settings.json by adding
  keys and appending hooks, and back it up first. A second run must report
  `installed: 0`.
- To check whether an MCP server exists, read ~/.claude.json. `claude mcp get`
  health-checks the server and starts every npx process.
- Under a fake HOME the ~/.local/bin/claude shim fails with "no bundled copy
  of claude-code found", so tests put the nvm `claude` first on PATH.
- A status line must not run `git status`: a cloned repo's filters and
  fsmonitor can execute code. Read the branch with `git symbolic-ref` instead.
- Strip togari, medha, composio, Clay and the GTM packs. They're client work,
  not tools a friend needs.

## Intel Macs have no Homebrew (2026-10-23)

Ogo's Intel MacBook Pro printed "Homebrew on macOS is only supported on Apple Silicon processors!", so a setup that blocks on brew never starts there. `calebnewtonusc/ogo-claude-setup` (public, 2026-10-23) is the no-brew version: git and python3 from `xcode-select --install` (a dialog, no password), then node from nodejs.org `latest-v22.x`, uv from astral's installer, gh and ripgrep from their latest GitHub release assets, jq from `jqlang/jq/releases/latest/download/jq-macos-amd64`, all into `~/.local/bin` with a `.zprofile` PATH line. `NO_BREW=1` forces that path on a Mac that has brew, which is how it was tested here. A public repo for a friend means scrubbing names first: Amber is stealth, and copied skills quote Caleb and private paths.
