---
name: feedback_one_background_item
description: Chewbacca puts ONE row in Login Items (com.chewbacca, chewbacca-daemon); a new background job is a service file, never its own LaunchAgent (Caleb, 10/11)
metadata:
  type: feedback
---

Chewbacca has exactly one LaunchAgent, `com.chewbacca`, run by the Chewbacca.app
runtime so Login Items shows one row named Chewbacca with its icon.
`bin/chewbacca-daemon` supervises every background job as a JSON service in
`~/.chewbacca/daemon/services/`. Register from bash or node with
`chewbacca-daemon register NAME --every SEC|--at HH:MM|--keepalive|--restart-on-crash|--app X.app -- argv`,
or from Python with `bin/lib/daemon_register.py`. `chewbacca-daemon status`
lists them.

**Why:** on 2026-10-11 two "Background Items Added" notices (kyber-sessions,
node) made Caleb write "Chewb should aim to be only 1 thing ... Most ppl will
get weirded out if they see too many things". Login Items listed 13 Chewbacca
rows named python3, bash, node and kyber-sessions, one plist per job.

**How to apply:** never write a plist or call `launchctl bootstrap` in a new
tool; `tests/test_chewbacca_daemon.py` fails any installer that does. Kyber is
kept open by LaunchServices with its PATH passed through, so it keeps its own
Accessibility grant. Every service inherits the runtime's Full Disk Access, the
same exposure `bin/chewbacca-node` documents. Old rows in System Settings point
at deleted plists until macOS rescans at the next restart. Related:
[[project_kit_runtime]], [[feedback_launchd_minimal_path_breaks_children]].
