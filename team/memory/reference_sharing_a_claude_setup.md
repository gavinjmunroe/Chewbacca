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

On the first Intel run (126 installed, 3 problems) `uv tool install watch-skill[standard,ocr,loop,api]` failed and the installer still registered the watch-skill MCP, so Claude would have listed a dead server. ogo-claude-setup 36e171c steps the extras down and registers the MCP only once the binary exists. Rule for any installer: register a server only after the thing it launches is on disk.

Everything Homebrew gave has an Intel-safe download (tested 2026-10-23 w NO_BREW=1): peekaboo and summarize from steipete release tarballs (keep peekaboo's whole folder, the binary needs libswiftCompatibilitySpan.dylib beside it), yt-dlp via `uv tool install`, ffmpeg via the ffmpeg-static npm package. The GitHub MCP can reuse `gh auth token` so a first-timer never makes a token, but only outside --dry-run, since any gh call writes ~/.local/state/gh/device-id.

Correction (cb00d25): never copy `gh auth token` into `claude mcp add -e`, it lands in plain text in ~/.claude.json. Register the GitHub MCP as `sh -c "GITHUB_PERSONAL_ACCESS_TOKEN=$(<abs gh> auth token) exec <abs npx> -y @modelcontextprotocol/server-github"` so the token is read at startup; checked live, the server answered initialize.

The Claude app starts stdio MCP servers with the GUI PATH, which has no ~/.local/bin. On a no-Homebrew Mac every `npx`/`uvx` server showed "Couldn't reconnect git, connection closed" (Ogo, 2026-10-23). ogo-claude-setup 21e-era fix: store the command as an absolute path plus `-e PATH=$HOME/.local/bin:...`, and rerunning the installer removes and re-adds any server whose command is bare. Testing `claude mcp add` in a temp HOME needs the real binary (~/.local/share/claude/versions/<v>), the kit wrapper exits with "no bundled copy".

## Teammate setup repos start from zero (2026-10-27)

Built for team Chip In (ACAD 185): `calebnewtonusc/chip-in-setup`, private. Caleb's corrections mid-build, 2026-10-27:

- "Assume they hv NOTHING setup not even homebrew." So setup.sh installs Homebrew itself (arm64, interactive, password explained), falls back to direct downloads (`NO_BREW=1`, Intel, non-admin), and installs git via Command Line Tools before anything else.
- "they just made a github acct but didn't set up." Brand new accounts must verify their email before an invite opens, a private repo can't be curled, so the front door is Accept invite, then Download ZIP, then `bash ~/Downloads/<repo>-main/setup.sh`. setup.sh accepts the owner's pending invites itself via `gh api user/repository_invitations` after `gh auth login --web`, and sets the commit email to the GitHub noreply address.
- "LOCK IN", "GO FASTER": in class he wants the repo pushed in minutes. Write files in batches, one smoke test, ship.
- "NO AI SLOP": run `slop-check --issues` over every doc before the commit, not after he asks.

Dry runs must not call `gh` (even `--version` writes ~/.local/state/gh/device-id) or `code --list-extensions` (creates ~/Library/Application Support/Code); tests/smoke.sh in chip-in-setup asserts an empty HOME stays empty. A one-page PDF for the group chat follows his own gc messages in order and only adds the walls a new account hits.
