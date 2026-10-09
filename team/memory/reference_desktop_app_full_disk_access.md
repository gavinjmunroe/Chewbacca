---
name: reference_desktop_app_full_disk_access
description: "Claude desktop app's Code tab needs Full Disk Access on its nested, versioned claude.app, not /Applications/Claude.app"
metadata:
  node_type: memory
  type: reference
  originSessionId: dd1c6bd3-3486-4eea-8d8f-c59a22cf6789
  modified: 2026-10-09T03:40:33.737Z
---

In the Claude desktop app's Code tab, shell commands run under a nested binary at
`~/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app`, launched
through `Claude.app/Contents/Helpers/disclaimer`, which hands macOS privacy responsibility
to that nested app. Granting Full Disk Access to `/Applications/Claude.app` alone left
`chat.db` returning "authorization denied" even after a full restart (2026-10-08).

Adding the nested `2.1.293/8433d0d9cd0d/claude.app` fixed it with no restart: chat.db read
641,577 messages.

**How to apply:** if Messages, Mail or other TCC-protected reads fail in a desktop-app
session, trace the parent chain (`ps -o ppid=,comm= -p $$` upward) and grant the nested
claude.app it names. Expect it to break on each Claude Code update, since the path
carries the version. Related: [[feedback_launchd_minimal_path_breaks_children]].

Launchd jobs with no app above them are charged to node itself: [[reference_launchd_node_full_disk_access]].
