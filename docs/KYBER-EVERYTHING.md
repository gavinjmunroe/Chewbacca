# Kyber does everything

The goal, from Gavin on 2026-10-03: everything on the Mac can be done with three inputs. Hold
the globe (fn) key to talk to the assistant, hold Control then the globe key to type by voice,
and use the trackpad to point at the thing you mean. Around them is a desk of live panels on
screen, like Opal's (a listening timer, Tasks with a Go on each, People, Learn, Transcript,
Conversations, Chat, a dock and a side rail), built into Chewbacca.

This is the team's build list for that goal, phases 1 to 4. They're backlog items 117 to 120.
Every fact in "Today" was checked against the code on 2026-10-03. Older figures name their
source. Companion docs: [ANYTHING.md](ANYTHING.md) (doing anything on this Mac),
[JEV-HUD.md](JEV-HUD.md), [ROADMAP.md](ROADMAP.md).

**Decided 2026-10-03:** Kyber gets the Screen Recording permission, so it can crop what the
person points at itself instead of going through peekaboo.

## Today

| Input or surface | Job | State |
| --- | --- | --- |
| Globe held | talk to the assistant | built |
| Control then globe | type by voice at the caret, with whisper.cpp correcting on release | built |
| Trackpad | point at the thing you mean | **missing** |
| Panels | a desk of live widgets | engine built, product missing |

**Pointing.** The only gesture is Option+Command+drag (`hud/Sources/Kyber/main.swift`, around
715-765). It sends a rectangle labelled "this", held for 30 s (`POINT_TTL`, `bin/hud-listen`),
and the model has to screenshot it and guess what's inside. Nothing reads the element under
the pointer (`AXUIElementCopyElementAtPosition` appears nowhere). AX reads do work on any
window: the 2026-09-23 agent-cursor test found 96 framed controls on a Chrome tab.
`bin/hud-context` reads `AXSelectedText`, but whether that text reaches the prompt is
unverified.

**Speed.** Across the voice log's 123 September turns, the first words arrive at a median of
3.1 seconds, but a whole turn takes a median of 19 seconds and 61 at p90, and half of the turns
call a tool.

**Acting.** The action vocabulary is 9 hand-written verbs. The Mac declares 170 URL schemes and
249 App Intent actions that nothing calls (ANYTHING.md, 2026-09-20). `mac/lib/run_plan.py:209`
calls `_jarvis`, which doesn't exist, so `verify` has never run. AX press and type work on
background windows with the real cursor untouched, but routing doesn't prefer them, and
synthetic clicks posted to a background pid never arrive. A sentence spoken mid-run replaces
the run.

**Panels.** Surfaces persist over `~/.bob/hud.sock` with 18 component types, JSON data
bindings with count, sum and avg, 9 anchors, and card, bare or bracket chrome. Three things are
missing. The voice agent is barred from drawing (`bin/hud-agent.md:56`). A person can't move,
resize or save a panel. No panel refreshes from its source: each is drawn once with data the
agent fetched.

## Phase 1: point and say (backlog 117)

1. **Globe held plus a click means "this".** Kyber reads the AX element under the pointer
   (role, title, value, frame and app, plus the URL and DOM path in Chrome) and crops its frame
   with its own Screen Recording grant.
2. **Globe held plus a drag** means a region with a crop. It replaces Option+Command+drag.
3. **Selected text** rides along with every request. Verify the `hud-context` output reaches
   the prompt, and add a test.
4. **Several marks, one request.** Each click while the globe is held drops a numbered mark on
   the glass, and the spoken sentence applies to the set ("make 1 bigger, delete 2").
5. **Acting on the same element.** `ux-do` takes an `--element` ref, so "click this" is one
   AXPress with no guessing.

**Test:** on a local page in Chrome, hold the globe, click two cards, and say "swap these". The
request carries both selectors and both crops. Hold the globe on a Finder file and say "send
this to" someone: it stops before the send.

**Built 2026-10-03, not yet run on a real screen.** Steps 1, 2 and 4 are in, and step 5 became
`hud press <n>` instead of a `ux-do` flag, because Kyber already holds the element.

- `hud/Sources/KyberKit/Pointing.swift` reads the element under the pointer and crops it. A
  click and a drag are told apart by 6 points of travel.
- In `hud/Sources/Kyber/main.swift`, an event tap takes the click while the talk key is held,
  so a click on Send marks the button and does not send. The tap is off whenever the key is up,
  so a missed key release can't leave every click on the Mac swallowed. The AX reads run after
  the callback returns and give up after 0.5 s.
- Kyber sends a `pt {json}` line for each mark at once, then a `pc` line when its crop is on
  disk. Each line carries the hold, meaning which press of the talk key it came from. `hud-listen`
  keeps the marks for 30 s, drops anything from an older hold, and `marks_sentence` puts them in
  the prompt, crops included.
- `press <n> hold=<h>` presses the element Kyber holds for that number. It checks every label
  the control carries and refuses a send, payment, deletion, trash, reply or share, and any
  control with no name, because an icon-only button is how chat apps draw Send. Only English
  labels are checked. A press from an older hold comes back `stale`. `hud press <n> <h>` waits
  for the `pr` answer.
- Selected text (step 3): the bridge called `hud-context` without `--full`, so only "340 chars
  selected" reached the prompt. It now passes the text itself, marked as data to read.
- Tests: `PointingTests.swift` (11), plus `test_pointed_marks` (16 checks) and `test_seen_line`
  (5) in `tests/test_hud_listen.py`.

What's left is a live run. That needs the new build installed, with Accessibility and Screen
Recording granted to it.

## Phase 2: the desk (backlog 118)

1. Lift the draw ban for answers that work better as a panel, at most three panels a reply.
2. Panels can be moved, resized and closed by hand, and layouts save by name (`hud layout save
   morning`).
3. **Live widgets.** A panel can carry a `source`, a command plus an interval. Kyber reruns the
   command and rebinds the panel's `d` data with no model turn. The first five are Tasks
   (work-ledger plus the agent board), Today (`mac calendar list --json`), People (`people`
   recency), Learn, and Due (`coursework due --json`).
4. **A dock.** One key chord opens the desk and the same chord closes it. Open and close have no
   animation, because the desk is seen many times a day.
5. **A Go on a task** runs it through the same path as speaking it.

**Test:** `hud layout open morning` draws all five panels in under 1 s. An event added in
Calendar.app appears in Today within one refresh. A dragged panel reopens where it was left.

## Phase 3: fast enough to drive the computer (backlog 119)

1. More deterministic owners in front of the model: the `quick.py` and opener pattern (one
   regex, no model turn) for the twenty most common requests in the transcript.
2. `chewie catalog` generates actions from the URL schemes and uses the App Intents as a
   capability map (ANYTHING.md tier 1).
3. Background first: route to AX on a background window, and take the foreground only when
   asked or when the person is away.
4. One trace line per verb (ANYTHING.md tier 2), feeding a daily digest of what was read and
   done.
5. Fix `_jarvis` in `run_plan.py`, move the call inside the `try`, and add a test, so verify
   actually runs.

**Test:** the whole-turn p50 is under 5 s over a week of real turns, read from the `turn:`
lines.

## Phase 4: talk while it works (backlog 120)

One Jev call sorts a mid-run sentence three ways: steer the running task, start a separate one,
or replace it. Both runs show on the agent board and in the Tasks panel.

**Test:** "check fares to Denver", then mid-run "and text Sam I'm on it", ends with two
finished results and no cancelled run.

## Not on this list

Ambient listening (Opal's Live, Transcript and Conversations panels) is the person's call and
isn't scheduled. If it's chosen, the hard line is that Kyber never records anyone without them
knowing. That means a listening timer, a visible Live state, local-only storage, and deleting
any span in one tap.
