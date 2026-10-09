---
name: reference_launchd_node_full_disk_access
description: '"node would like to access data from other apps" popups come from launchd jobs running bare node; fix is one FDA grant on ~/.chewbacca/runtime/node'
metadata:
  node_type: memory
  type: reference
  originSessionId: 093de87b-1c68-4c9f-befe-173ca4069c92
  modified: 2026-10-09T08:50:31.185Z
---

The repeated macOS box "node would like to access data from other apps" (2026-10-09, many
times in one day) comes from launchd jobs that run node directly: no .app sits above them, so
TCC charges the request to the node binary. The culprits were
`~/Library/LaunchAgents/com.calebnewton.people-dashboard.plist` (KeepAlive, restarts) and
`com.calebnewton.people-sync.plist` (7:30 and 21:30), both on nvm's versioned node, plus the real repeat offender,
`com.chewbacca.messages-refresh.plist`, which ran `bin/people` every 10 minutes through
`env node` and so used Homebrew node; its 26.9 upgrade moved the Cellar path and lost the grant.

Fix applied 2026-10-09: `bin/chewbacca-node` copies node to `~/.chewbacca/runtime/node`
(a copy, not a symlink, because TCC resolves links; the copy keeps Node's signature, team
HX7739G8FX, so the grant survives refreshes). All three plists now point there, and setup.sh writes messages-refresh that way. One Full Disk
Access grant on that file covers every job. Any new launchd node job should use that path.

Node processes started inside Claude Code or VS Code are charged to that app instead, see
[[reference_desktop_app_full_disk_access]].

**Superseded 2026-10-10:** the runtime is now `~/.chewbacca/runtime/Chewbacca.app` (node inside, signed ad hoc as com.chewbacca.runtime, its own icon), and `runtime/node` is a symlink into it, so Settings and prompts say "Chewbacca", not "node". Caleb dragged it into Full Disk Access via `chewbacca permissions` the same morning. It rebuilds on any node version change (security review), and each rebuild needs that one drag again; `chewbacca permissions` shows it as missing and floats the card. The old FDA row for the plain `runtime/node` file is dead weight.
