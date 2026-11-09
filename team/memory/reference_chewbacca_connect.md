---
name: reference_chewbacca_connect
description: `chewbacca connect` wires Claude Code, Codex, Cursor, Gemini and chat-app exports from one source; how it works and its known gaps
metadata:
  type: reference
---

`chewbacca connect` (shipped 2026-10-08, commit f7c9baf0 on main) makes every installed AI host use the same Chewbacca:

- `~/.claude/CLAUDE.md` + `~/.claude/settings.json` hooks stay the single source. Cursor and Gemini run those exact Claude hooks via `tools/host_hooks.py`, called through the fail-open launcher `~/.chewbacca/bin/host-hook`.
- Codex is found inside ChatGPT.app; `codex` works in the terminal through a shim in `~/.local/bin`.
- MCP servers copied from `~/.claude.json` into Codex, Cursor and Gemini by name.
- ChatGPT / claude.ai get `~/.chewbacca/exports/` (CHEWBACCA.md, custom-instructions.txt, claude.ai skill zips). Uploading them is a manual browser step.
- A SessionStart hook runs `host-hook connect` so a newly installed app connects itself.

Known gaps: Gemini CLI is dead on his free tier (Google moved it to Antigravity, 2026-10-08), so its bridge is untested live. Cursor bridge unverified until a real Cursor session shows a refusal. Codex needs `/hooks` re-trust after hook changes. Related: [[project_chewbacca]], [[reference_desktop_app_full_disk_access]].
