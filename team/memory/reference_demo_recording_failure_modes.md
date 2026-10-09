---
name: reference_demo_recording_failure_modes
description: "Why a Chewbacca demo recording silently produces an empty video, and how to tell a wedged ScreenCaptureKit from a driving bug. Found 2026-09-16 over seven failed takes."
metadata:
  node_type: memory
  type: reference
  originSessionId: f4897774-cb45-4b10-83db-221e656dfe13
  modified: 2026-09-17T00:55:38.734Z
---

Seven takes died on 2026-09-16 shooting the video Sagar asked for. Every command
reported success each time. These are the four causes, in the order they bite.

## 1. A failed take leaves its recorder alive, and they all write to one file

`cap record stop` stops one session. A take that aborts before that leaves
`cap record __session-run` running. Six of them ended up writing into the same
`take.cap` at once, and the export failed with **"Invalid declared complete
fragment"** and **"Recording changed while copying"**. Those messages mean
concurrent writers, not a corrupt disk.

```bash
pkill -f "cap record __session-run"   # before every take
cap record status                     # lists strays, with pids
```

Give every take its own `--path`. Reusing one path is what let them collide.

## 2. The Return is swallowed, and nothing says so

`claude-tab send` prints `sent:` whether or not the turn started. The text types
into the box correctly and the Return lands with focus somewhere else, so the
box just sits there full. **Always verify `status` reports `busy` before
trusting a send**, and abort the take if it never does, rather than recording
an empty tab for 47 seconds.

Two things make it worse: `peekaboo type` runs at a human cadence, so a 190
character prompt takes **18.7 seconds** during which focus can drift, and
`focus()` activates the _application_, not a window, so with two VS Code windows
open the keystrokes can land in the wrong one. Paste instead of typing
(`pbcopy` then `cmd+v`) collapses that window to one action.

## 3. A slash or a tilde in the prompt opens an autocomplete

Typing `~/.chewbacca/clay-key` into the Claude input opens the file-path
suggestion popup, and the Return then picks a suggestion instead of sending.
Keep driven prompts free of `/`, `~` and quotes. A wrapper on PATH is the clean
way out: `clay-balance` exists now because
`CLAY_API_KEY=$(cat ~/.chewbacca/clay-key) clay credits balance` cannot be typed
into that box at all.

## 4. ScreenCaptureKit wedges, and then nothing on the machine can record

The tell is `cap doctor`:

```
capture ready: false
[fail] screenCaptureKit: ScreenCaptureKit returned no displays;
       Windows visible: 483, current-process windows visible: 0
```

Confirm it is system-wide rather than a Cap bug before debugging Cap: macOS's
own `screencapture -v -V 3 -x /tmp/t.mov` fails with "The operation could not be
completed", and ffmpeg's avfoundation device list loses its screen entry.
`killall replayd` and relaunching Cap.app did **not** clear it. A reboot is the
fix, and it is Caleb's hands, so say `BLOCKED` and ship the text version.

Twelve orphaned `peekaboo mcp serve` processes were running at the same time and
peekaboo began failing with "Index 7 is out of range"; `pkill -f "peekaboo mcp
serve"` restored it. Worth clearing before blaming anything else.

## The rule that came out of it

Verify the artifact, never the exit code. Extract frames and **look** at them
before reporting a video exists:

```bash
ffmpeg -v error -i out.mp4 -vf fps=1/3 /tmp/f%02d.png
```

Take one exported cleanly at 47 seconds and 8.4MB, and every frame was an empty
tab with a context menu open over it.

Related: [[project_cap_in_chewbacca]], [[project_chewbacca_craft_and_claude_tab]],
[[feedback_chewbacca_video_separate_tab]], [[project_clay_enrichment_poc]].
