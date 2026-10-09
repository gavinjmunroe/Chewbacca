---
name: reference-bypass-permissions-two-keys
description: "Turning off Claude Code permission prompts takes three switches across three surfaces: the CLI defaultMode, the VS Code extension gate, and the desktop app's dispatch mode"
metadata:
  type: reference
---

`permissions.defaultMode: "bypassPermissions"` in `~/.claude/settings.json` covers the CLI only.
The VS Code extension gates bypass mode behind its own machine-scoped key and **ignores the CLI
setting until that key is true**, which is why Caleb had `defaultMode` set for months and still got
prompted inside the editor.

Both are required, in the editor's user `settings.json`:

- `"claudeCode.allowDangerouslySkipPermissions": true`, permits bypass mode at all
- `"claudeCode.initialPermissionMode": "bypassPermissions"`, the mode new conversations start in

Setting only the second does nothing. Both are `scope: machine`, so a committed
`.vscode/settings.json` will not work. Restart the editor; the extension reads them at launch.

Set on this machine 2026-09-02 for both VS Code and Cursor
(`~/Library/Application Support/{Code,Cursor}/User/settings.json`).

`deny` rules in `~/.claude/settings.json` still apply under bypass mode and are the only brake
left, which is what makes this safe: no undo-less operations, no reads of `.env`, `~/.ssh`,
`~/.aws`, or the credentials file.

## The desktop app is a third surface

The Claude desktop app runs its own bundled copy of the CLI at
`~/Library/Application Support/Claude/claude-code/<version>/` and reads `~/.claude/settings.json`,
so `defaultMode` covers its chat and code sessions with no extra gate. **Coding tasks dispatched
from the app do not use it.** They read `dispatchCodeTasksPermissionMode` from the app's own store
at `~/Library/Application Support/Claude/config.json`, which ships as `acceptEdits`: edits go
through, bash still asks. Set to `bypassPermissions` on this machine 2026-09-02.

Accepted values are `default | acceptEdits | plan | auto | bypassPermissions`. Anything else fails
the app's schema check and it renames the whole file to `config.json.corrupt-<ts>` and starts over.
**Quit Claude before editing it**: the app holds the config in memory and writes the whole file back
on save, so a change made while it runs is dropped.

## bypassPermissions only counts from the user tier

`bypassPermissions`, `auto`, and `dontAsk` are ignored when they come from `.claude/settings.json`
or `.claude/settings.local.json`. The resolver drops them with "repo-committed settings can't
default to" and falls back to `default`, silently as far as the UI is concerned. The reason is that
cloning a repo would otherwise disable a stranger's permission prompts. `~/.claude/settings.json`
is the only place it counts.

A managed policy at `/Library/Application Support/ClaudeCode/managed-settings.json` with
`permissions.disableBypassPermissionsMode` beats all of it. Not set on this machine.

Shipped generally in `Chewbacca` (commits `6c752df`, `569fea5`): `settings/vscode-settings.json`
is the template, `setup.sh` writes all three surfaces, and `doctor.sh` reports each one plus the
managed policy and the misplaced-tier mistake. See [[project_chewbacca]].
