---
name: project_mcp_hub_2026_11_02
description: chewbacca mcp (60-server catalog, paste-to-add) and the MCP hub that runs each local server once for every tab are live on Caleb's Mac since 2026-11-02
metadata:
  type: project
---

`chewbacca mcp` is how any MCP server gets added: `chewbacca mcp add <name>` from `config/mcp/catalog.json`, or a pasted URL, `npx`/`uvx` line, `claude mcp add` line or README JSON. It registers with Claude Code and Codex (plus Cursor and Claude Desktop when their config file exists) and opens the browser sign-in itself. Caleb, 2026-11-02, after a Figma setup ended in "run /mcp": "just wire it into chewbs to be super easily setupable for anyone".

The hub (`bin/mcp-hub`, under chewbacca-daemon as `mcp-hub` on 127.0.0.1:7338) runs each moved stdio server once for every Claude tab. Moved on 2026-11-02: fetch, time, git, chart, filesystem, github, supabase, blender. Their tokens are in the Keychain (service `chewbacca-mcp`), not in `~/.claude.json`. Undo one with `chewbacca mcp hub undo <name>`; a full copy of the pre-hub config is in `~/.chewbacca/backups/claude.json.pre-hub-*`.

Kept per tab on purpose: peekaboo, macos-automator, api-anything, watch-skill (their screen, Automation or Chrome grants belong to the process that starts them, and the daemon is a different one), and playwright, chrome-devtools, sequential-thinking (per-tab state).

What broke and why it's fixed: the first live move timed out 7 of 8 servers, because an npx or uvx cold start took 11 to 16 s at load 14 against Claude Code's 30 s connect limit. The hub now answers initialize and tool lists from the last real reply while a server boots (71ea9d93), and refuses Claude's `server/discover` probe without starting anything.

Open as of 2026-11-02: Codex still starts its own copies (it only takes a bearer token from an env var); medha's MCP 404s in every tab; Figma's claude.ai connector is signed in as Colin Sweeney on a View seat. Design credit: Carlton Aikins's realm and mcp-manager (MIT), see CREDITS.md.
