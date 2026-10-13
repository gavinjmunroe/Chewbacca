---
name: feedback_rehearse_with_the_hosts_timing
description: A headless rehearsal that calls the host's hooks at a friendly moment proves nothing about the cold path; on 10/13 Kyber's "shown" arrived before the agents page could hear it and every cold load sat on "Reading your agents"
metadata:
  type: feedback
---

Every headless run of the agents glass before 10/13 called `window.__realmGlassShown(true)` after the page had mounted. Kyber calls it in the same breath as `view.load` (AppPane.swift attach), before any page script runs, so on a cold load (first open, new pipe token, a crashed page) the word was dropped and the page never showed its tiles: 0 tiles at 12 s against the live server, 9 tiles 319 ms after a late tell. Fixed in 29f21956 (nav.mjs shownNow: go by visibility until Kyber speaks; a WKWebView in no window reads "hidden", measured with a Swift probe).

The same night a stranger-stopwatch run of setup.sh with `HOME=mktemp -d` replaced the real `com.chewbacca` launchd job with one pointing into the scratch kit (launchd's gui domain is per account, not per $HOME). The scratch folder was deleted, and from the first swap that ran realm-ui through `lib/listen_exec.py` beside that daemon (00:53) it exited 2 on every start, until the real job was put back at 00:56; any later start of a port-holding service would have failed the same way. Fixed in b5e3b041: launchd writes only from the account's own LaunchAgents.

**Why:** both bugs passed every rehearsal because the rehearsal chose the timing and the environment the code was written for, not the ones the host imposes.

**How to apply:** a rehearsal drives the host's real sequence (call the hook when the host calls it, including before mount), runs against the installed server and live engine, and starts by checking that the services it relies on are the real ones (`launchctl print gui/$(id -u)/com.chewbacca` path, `lsof` on the port). A script in ~/.chewbacca/overnight/n1012/a2-shots/rehearse.mjs does the first ten minutes this way. See [[feedback_morning_done_means_seen_live]].
