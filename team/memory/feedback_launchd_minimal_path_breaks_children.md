---
name: feedback_launchd_minimal_path_breaks_children
description: launchd gives a job PATH=/usr/bin:/bin:/usr/sbin:/sbin, so anything it spawns cannot find claude, node, python3 or any ~/.local/bin tool
metadata:
  type: feedback
---

A LaunchAgent runs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and nothing else,
unless the plist sets `EnvironmentVariables`. Every child it spawns inherits
that.

On 2026-09-21 this broke the HUD completely and silently. BobHUD spawns
`hud-listen`, which runs the `claude` CLI. `claude` lives under nvm at
`~/.nvm/versions/node/<v>/bin`, so it was unreachable. Speech reached the
microphone, transcribed correctly, and then went nowhere, with no error in the
HUD log, the stdout log or the stderr log.

**Why:** the same narrow-environment bug hit three separate things in one night.
`tools/inventory.py` deleted five tools from the published catalog because its
probe read `os.environ["PATH"]`. The MCP servers were slow because they resolved
through npx. And this. A process's environment is not the shell's, and code that
assumes otherwise fails quietly rather than loudly.

**How to apply:** when something launched by launchd "does nothing", check its
PATH first: `ps eww <pid> | tr ' ' '\\n' | grep ^PATH=`. Then check whether the
binary it needs is on that PATH, with
`env -i PATH="<that>" HOME="$HOME" sh -c 'command -v <tool>'`. Set
`EnvironmentVariables` in the plist rather than hardcoding paths in the caller.

Related: [[project_hud_stale_installed_tools]] and
[[project_session_startup_profiled_2026_09_21]].
