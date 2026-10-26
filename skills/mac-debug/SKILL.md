---
name: mac-debug
description: "Diagnose a failing Mac automation, especially a silent one: a click does nothing, typing doesn't land, empty accessibility tree, AppleScript hangs, wrong coordinates, or something that used to work."
triggers: >-
  Diagnose a Mac automation that is failing, especially one failing silently. Use when a click does nothing, typing does not appear, the accessibility tree is empty, an AppleScript hangs or errors, coordinates land in the wrong place, or something that worked before stopped working.
requires: [chewie]
---

# Debugging Mac automation

Most of these fail with no error, which is what makes them expensive. Diagnose before
you retry, and **never respond to a failure by escalating to a screenshot.** A failing
layer-3 read almost always means one specific fixable thing.

## Triage

```bash
chewie doctor                    # grants, host app, tools
chewie doctor --secure-input     # is the keyboard being blocked
```

## By symptom

### Typing does nothing, no error

**Secure Input.** A password field has focus somewhere, and macOS discards synthetic
keystrokes with no error. It is a process-global reference-counted flag, so one stuck
app starves the whole system.

```bash
ioreg -l -w 0 -d 1 -k IOConsoleUsers | grep -o 'kCGSSessionSecureInputPID"=[0-9]*'
```

Nonzero is the pid holding it. Fix: `open -a Finder`, retry. If an app is stuck, focus
and unfocus it, or quit it.

### An app reopens on its own after you quit or force quit it

**Something sent it an AppleScript.** `tell application "X"` launches X if it isn't
running, and `mac mail`, `mac calendar` and friends do exactly that. A background
poller turns one launch into "it keeps coming back". Find the poller:

```bash
ps -o pid,lstart -p $(pgrep -x Mail)          # launch time, then match it to a job
grep -rlE 'application "Mail"|"mac", "mail"' bin tools hud
launchctl list | grep -iE 'chewb|calebnewton'  # the agents that run on a timer
```

Fix: the poller checks `pgrep -xq <App>` first and leaves the app alone when it's
closed. On 2026-10-09 kyber-surfaces read unread mail every 60 s and reopened Mail
after every force quit (b9b9323e, test in tests/test_osgraph.py).

### An app comes back seconds after you kill it, with nothing polling it

**Its own launch agent restarts it.** Look for a vendor plist before killing anything:

```bash
ls ~/Library/LaunchAgents /Library/LaunchAgents | grep -i <vendor>
launchctl list | grep -i <vendor>             # a pid here means launchd owns it
sfltool dumpbtm | grep -i -A2 <vendor>        # login items, no AppleScript needed
```

On 2026-10-16 `kill` on Perplexity (idle at 17 to 33% CPU since boot, which Caleb
never opened: "PERPLEXITY?????", "I don't use either lmao") came back within a
minute as `Perplexity --daemon-headless`, and Comet was running the whole time. When
he doesn't use the app, uninstall it: `launchctl bootout gui/$(id -u)/<label>` for
each agent, kill the processes, then move the app, its LaunchAgents plists and its
Application Support, Caches, Preferences and HTTPStorages entries into one Trash
folder. Then confirm with `ps` and `launchctl list` that nothing of it is running.
Check every vendor app the same way: Perplexity installs Comet alongside itself.

### Clicks do nothing from inside an app

**App Sandbox** silently blocks `CGEvent.post` and returns no error. There's no fix inside the sandbox;
this is why every serious macOS automation tool ships outside the App Store.

### Accessibility tree is empty or all elements unnamed

**Chromium builds it lazily.** Chrome, Edge, VS Code, Slack, Discord, Notion, Figma,
Spotify.

```bash
chewie see --app Slack --force-ax
```

Sets `AXManualAccessibility`, waits ~400ms, re-reads. The wait matters: an immediate
re-read still looks empty.

If that returns `kAXErrorAttributeUnsupported` (-25208) on a non-Chromium app, the app
genuinely has no tree and you are at layer 5.

### Clicks land at double the offset

**Retina.** Screenshots are 2x device pixels; `CGEvent` takes screen points. Halve the
coordinate, or stop using coordinates and use refs.

### Clicks land on the wrong monitor

Multi-display origins go negative. Use `CGGetActiveDisplayList` geometry, do not assume
0,0.

### Clicking a ref hits the wrong element

**Stale ref.** It was scoped to a snapshot from before the UI changed. Re-snapshot after
any sheet, navigation, resize, or scroll.

### AppleScript errors

| Code  | Meaning               | Fix                                                       |
| ----- | --------------------- | --------------------------------------------------------- |
| -1743 | Not authorized        | `tccutil reset AppleEvents`, retry in the foreground      |
| -600  | App not running       | `open -a "App"`, then poll until System Events sees it    |
| -1712 | Timeout (~2min)       | `with timeout of 300 seconds`. Check for a blocking modal |
| -1728 | Object does not exist | Not permissions. Read the app's dictionary                |
| -1750 | errOSASystemError     | Usually TCC, reported uselessly                           |

### `defaults write` had no effect

Apps cache preferences in memory and rewrite on quit. Write with the app closed, or
restart it. `killall cfprefsd` if a read looks stale.

### `chat.db` rows have NULL text

Bodies moved to `attributedBody` on Ventura and later. Decode the typed stream, or use
`mac_messages_mcp`.

### "database is locked"

Open read-only (`file:...?mode=ro`) or copy to `/tmp` first.

### `do JavaScript` fails in Safari

Develop > Allow JavaScript from Apple Events is off by default. Enable the Develop menu
in Safari > Settings > Advanced first.

### The web task dies at a login page

A fresh Playwright browser has no profile. Attach to the user's running Chrome:
`open -a "Google Chrome" --args --remote-debugging-port=9222`.

### It worked yesterday

Almost always: the TCC prompt was dismissed once and never returns, or the host app
changed (different terminal, an update that re-signed the binary). `chewie doctor`.

### The Dock or "nav bar" twitches like something is about to open

Caleb, 2026-10-13: "My nav bar keeps oscialling back and forth like smth is gonna
open but then nothing spawns in". The Dock shifts to make room for a short-lived
app that dies before its icon draws. Sample, don't guess: run
`lsappinfo list | grep -E '^ *[0-9]+\) "'` ten times a second for a few seconds
and count names whose ASN keeps changing. Then walk `ps -o ppid=` up from one of
them to the loop that spawns it. That day it was the inbox read falling back to
`clay-inbox`, which called the inbox read again: 7 nested copies, each launching
a Chrome. Never patch the app that flashes (appctl was BackgroundOnly and
innocent) before the parent chain says who launched it.

## The Mac is slow ("all the tabs are slow", "stop whatever is eating my CPU")

Read memory before CPU. On 2026-10-19 three tabs crawled at load 110, yet live
CPU summed to about 250% of 1400%: the real cost was swap at 87% (10.6 of 12.3 GB)
and 34% free memory, so every app was paging. Load average also counts short-lived
hook processes, so it overstates the problem and drops fast once a burst ends.

1. `sysctl vm.swapusage; sysctl -n kern.memorystatus_level; uptime`. Swap stays
   high long after pressure ends (it read 87% again with 54% free), so judge by
   free memory, not swap alone.
2. `top -l 2 -s 3 -o cpu -n 25` for live CPU. `ps %cpu` is a decayed average and
   misleads.
3. Group RSS by app, then look for the known leaks: `ollama ps` (embedding models
   on 2h keep_alive), ppid-1 processes under `$TMPDIR/tmp*/kit/` (test servers),
   agent Chromes on `chewie-chrome-*` profiles, and `orphan-reap` output.
4. Kill only what's provably dead or reloads itself: `ollama stop <model>`,
   orphans, an idle agent Chrome. The user's own Chrome, Codex and Claude are
   theirs: name them with their numbers and let them quit them.

`orphan-reap --kill --pressure --min-age 7200` runs from the daemon every 5
minutes and covers step 4 on its own. If a slowdown happened anyway, find the
leak it missed, add it to `TAB_JOB` in `bin/orphan-reap` with a fixture row in
`tests/orphan_reap.sh`, and fix the source that leaked it.

## An app window is blank or frozen ("Granola is tweakin")

An Electron app (Granola, Slack, Notion, Linear, Discord) whose page crashed keeps its window
up, either empty or frozen on its last frame, and never recovers. On 2026-10-26 Granola showed
an empty cream pane, and Slack looked fine in a screenshot while it was dead too.

- Never judge it from a screenshot. Run `app-revive`: it lists any app that has a window but no
  `--type=renderer` process.
- Fix it with `app-revive --fix` run twice, or quit, force kill, and `open -g -a` the app. Quit
  alone was ignored on 2026-10-26.
- The daemon already runs `app-revive --fix` every minute and skips an app that's recording. If
  one stays blank, check `chewbacca-daemon status | grep app-revive` before anything else.

## Inspecting an element by hand

When `chewie click "Save"` cannot find something, the element is probably not called
what it looks like it is called. Apple's **Accessibility Inspector** (bundled with
Xcode) shows the real role, title, and available actions.

## The stop rule

Three failures on the same action: stop and report what you tried and what you saw. Do
not loop, and do not switch layers to route around a diagnosis you have not made.

Full list with detectors: `docs/mac/WORKAROUNDS.md` and `mac/data/failure-modes.json`.
