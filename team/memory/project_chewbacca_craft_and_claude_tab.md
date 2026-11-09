---
name: project_chewbacca_craft_and_claude_tab
description: "Two Chewbacca capabilities added 2026-09-16: craft-gate, which refuses to produce in a craft nobody studied, and claude-tab, which drives another Claude tab and knows when its turn ends."
metadata:
  node_type: memory
  type: project
---

Both came out of one failure. Asked to record a product demo, the kit drove the
UI competently and produced four taps on a tab bar. Caleb: *"there's more to UX
than just the nav bar lol"*, then the rule that matters:

> "I don't want this to be just knowledge somewhere in chewbacca I want it to
> actually be applied. That goes for all chewbacca wisdom."

**He is right and the repo proves it both ways.** 84 skills and 9 rules of good
judgment sit in markdown and mostly never fire. The slop rules DO fire, and the
only reason is `prose-check` running in a Stop hook that refuses the turn.
**Enforcement is code that runs, not a paragraph.**

## craft-gate

`bin/craft-gate <genre>` exits 1 unless `~/.chewbacca/craft/<genre>.md` holds at
least 400 bytes of real research. `bin/demo-shoot` calls it before the camera
starts. On a studied craft it exits 0 **and prints the rules every run**, because
a gate that only says "ok" gets satisfied and then ignored, which is the same
failure one level up. `--record` refuses a stub.

`crafts/demo-video.md` is the research, from two HowdyGo teardowns and the
Consensus piece. The rule that mattered most: **one to three features, never
more**, named outright as the biggest mistake people make. Caleb had asked for
"all the screens", which is that mistake with a friendly name, and he sent the
sources himself.

## claude-tab

`bin/claude-tab` drives a Claude Code tab in VS Code. `new`, `status`, `wait`,
`send`, and **`ask`**, which sends and blocks until the turn genuinely ends.

**The signal is the input placeholder**: "Queue another message…" while a turn
is in flight, "Esc to focus or unfocus Claude" when it finishes. The field is
exposed to the accessibility tree as `description: "Message input"`, so it is
clicked by element id, not coordinates. Only the toolbar icon needs a derived
click, 154px in from the window's right edge and 53px down, and `new` verifies a
tab appeared rather than trusting it.

**Corrected 2026-09-16, same day:** the derived icon click is GONE. VS Code's
toolbar gained an icon, every button shifted ~25px left, and `new` failed with
"the tab did not change". It now presses `ctrl+alt+cmd+n`, bound to
`claude-vscode.editor.open`, and installs that binding itself. Do not go looking
for an icon offset to tune. The deeper lesson: `window()` picks the largest VS
Code window, so a second window breaks it, and a sibling tab cannot be filmed at
all because VS Code raises whichever tab is emitting output. See
[[feedback_chewbacca_video_separate_tab]].

**The guard worth remembering**: `send` refuses a tab that is mid-turn, because
the session running the tool is itself a Claude tab in the same window and is
busy for as long as it runs. Without it, a send issued before `new` succeeded
types the prompt into its own input box.

**Window ids are strings from `cap record windows` and ints elsewhere.**
Comparing the two reported a live window as gone twice in one session, and the
second time the clicks that followed landed on the Dock and launched
applications on Caleb's real machine. Always normalise to `str`.

Verified end to end with a recorded two-turn conversation: "pick a number" ->
73, "is it prime? one word" -> Yes. Turn one ran 29s, turn two 25s; a fixed
sleep would have cut one off, which is exactly what ruined the first attempt.

## Corrected again 2026-09-16 evening

`claude-tab new` broke a second time the same day, and not in its own code.
Peekaboo lost VS Code's Screen Recording grant, `peekaboo see` hung in
`mach_msg` waiting on a consent reply that never came, and **peekaboo's own
`--timeout-seconds` does not fire in that state**, so `new` sat for 90 seconds
and then printed a Python traceback. Every peekaboo call in `claude-tab` is now
bounded at 25s by the caller, and the two permission failures are turned into
one sentence naming the pane to open. The same run fails in 0.15s.

**The grant itself is Caleb's to restore**: System Settings > Privacy &
Security > Screen Recording > Visual Studio Code, then quit and reopen VS Code.
Every peekaboo-backed thing in the kit is dead until then: `claude-tab`,
`mac-see`, `mac-act`, and demo recording. Confirm with
`peekaboo list windows --app Code`. I am the reason it needs restoring, see
[[feedback_tccutil_reset_is_destructive]].

**The test was guarding nothing.** It still asserted on `ICON_FROM_RIGHT`, which
the keybinding fix had deleted hours earlier, so it blew up on import through
the whole afternoon `new` was being rewritten. It now covers the keybinding
path, including that the chord pressed and the chord installed are the same
string. It also sets `sys.dont_write_bytecode`, because `SourceFileLoader` was
caching `bin/claude-tab` and validating that cache on mtime and size, so a
mutation test that flips one character and restores it inside the same second
grades the mutant.

## Still open

`craft-gate` only guards `demo-shoot`. Every other producer in the kit is
unguarded. A worktree branch `feat/craft-gate-everywhere` was handed to a second
tab for that.

Related: [[project_chewbacca]], [[project_cap_in_chewbacca]],
a private note, a private note.
