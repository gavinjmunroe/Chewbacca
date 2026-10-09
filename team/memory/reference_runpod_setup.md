---
name: reference_runpod_setup
description: Runpod (GPU cloud) is wired into Claude Code as the runpod@runpod plugin, v1.5.0, installed 2026-10-07 for the Amber fridge renders; MCP auth is OAuth via /mcp.
metadata:
  type: reference
---

Runpod is the GPU cloud picked for the Amber fridge clip renders ([[project_amber_fridge_site]]), budget $5 of Caleb's own money.

Installed 2026-10-07 from Runpod's official guide (docs.runpod.io/agent-setup.md): `claude plugin marketplace add runpod/runpod-plugins-official` then `claude plugin install runpod@runpod`. v1.5.0, user scope, enabled. Skills: runpod, runpod-mcp, runpodctl, flash, runpod-usage, companion-clis, runpod-migrate, runpod-templates.

The hosted MCP server signs in with OAuth (`/mcp` then runpod then Sign in with Runpod), so no API key is stored for it. `runpodctl` and any API key get installed later by the skills, only when a task needs them.
