---
name: reference_clay_cli_one_workspace
description: The clay CLI keeps one current workspace for every tab on the Mac; chewbacca clay pins each call through a private CLAY_CONFIG_HOME
type: reference
---

The clay CLI stores its sign-ins in ~/.config/clay/config.json as one profile per
workspace, plus a single activeProfile that every process reads and that
`clay workspaces switch` moves. It takes no per-command workspace flag. It does
honor CLAY_CONFIG_HOME, and it uses the only profile when there's one.

On 2026-10-17 at 12:43, the Sabo tab's CLI calls left activeProfile on 1149025.
The Zeutara tab's csv-upload then answered "Trigger not found" for ids in 1372623.

The fix is in `chewbacca clay`, since ab9f3125 and 15e34d19. Each CLI call gets
a private config that holds only that op's workspace. A refreshed token is
written back by compare-and-swap, and an answer naming another workspace is
refused. Kit bins (clay-balance, clay-inbox) aren't pinned, since they never read
that config.

So pass ws= on every client op. Never run the bare clay CLI for client work, and
never switch its workspace.
