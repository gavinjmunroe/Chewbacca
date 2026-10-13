---
name: hud
description: "Draw live interfaces on the screen over everything, no browser or window. Use for show me, put that on screen, pull up, a dashboard, chart, diagram or status display, and to update or take it down."
triggers: >-
  Draw live interfaces on the screen over everything else, with no browser and no window. Use when the user asks to see something rather than be told it, says show me, put that on screen, pull up, or asks for a dashboard, chart, diagram, or status display. Also use to update or animate something already on screen, and to take it down when they are done.
license: MIT
requires: [hud]
---

# The display

The user has a transparent layer over their whole screen that you can draw on.
It is click-through everywhere except where something is drawn, so they keep
working underneath it. Panels stay up after you disconnect, which means you can
change one later instead of drawing it again.

```bash
hud status                 # is it running
hud open                   # start it
hud draw                   # Kyber Lines on stdin
hud demo                   # put one of everything on screen
hud close <surface>        # take one down
```

Reach for this when the answer is a shape rather than a sentence. "How are my
reply times looking" is a chart. "What is due this week" is a list on the glass,
not four paragraphs in a terminal they have to scroll back to.

Do not reach for it to answer a question that is one sentence long. A panel that
says "yes" is worse than saying yes.

## Drawing

```bash
hud draw <<'EOF'
@ people at=topRight w=400
c s Screen title="RELATIONSHIPS"
c a Sparkline label="Messages this week" points=[31,28,44,39,58,52,71] value="71"
c b Bars caption="Time since last reply" rows=[{"label":"Sam","value":2,"display":"2h"},{"label":"Ava","value":31,"display":"1d"}]
c e Events caption="Needs a reply" items=[{"time":"9:04","text":"Sam sent the gates","accent":true}]
> s a b e
r s
EOF
```

Every line is one op. Nothing paints until `r`, and `c` and `>` may arrive in
any order, so a child can be sent before its parent.

Send `r` as soon as the Screen exists rather than at the end. Children that
arrive after the root still land, so a stream that gets cut off has drawn
something instead of nothing.

```
@ <surface> [at=region] [w=points] [urgency=level] [chrome=kind]
c <id> <Type> prop=value ...
> <parent> <child> ...
d /pointer <json>
r <id>
- <surface>
s "<text>" [step=true]             say one line on the pill under the panels; step marks a tool call
w "<text>" [done=true]             the written answer, whole, for the conversation panel
q <n>                              how many requests are waiting
t "<text>" state=running|waiting|done   the Claude Code tab's state, as a strip under the pill; t off hides it
listen                             ask to receive events on this connection
```

Arrays are JSON and the parser splits on whitespace, so write them with no
spaces inside: `points=[31,28,44]`.

## Where, and how loud

`at=` is a region, never a coordinate: `topLeft top topRight left center right
bottomLeft bottom bottomRight`. Put what they asked about where the eye already
is and standing context in a corner. Two or three panels is a workspace, six is
a mess.

`glance <surface>`, sent right after its `@` line, makes a card leave when the
person clicks anywhere off the cards, the same as pressing its X. Use it for an
answer read once: a search result, a repo card, a lookup. Leave it off anything
meant to stay up.

`urgency=` is `ambient`, `normal`, `alert`, or `critical`. Only `critical`
appears when the display is hidden. Spend it on a payment failing or a meeting
starting in one minute, never on a task being due next week.

`chrome=` is `card`, `bare`, or `bracket`. **`bare` draws no panel at all**: the
content floats directly on the screen. It is right for a diagram or a figure and
it is the thing this display can do that a window cannot. `bracket` puts corner
marks around a region without covering it.

## Components

Anything not listed here is dropped silently by the renderer, so the panel will
just be missing that piece and nothing will tell you. Write arrays with no
spaces inside them.

<!-- generated: components -->

### Structure

- **Screen** The root of a surface. Exactly one per surface, and every other component hangs off it. A short title in caps reads best at a glance.

  ```
  c s Screen title="RELATIONSHIPS"
  ```

- **Stack** Groups components. Vertical by default; use grid with cols for several small numbers, because four metrics in a column waste the height of a panel that is already capped. Gap is in units of 4 points.

  ```
  c row Stack direction=grid cols=2 gap=3
  ```

### Prose

- **Heading** A label over a section. Use it when one panel holds two unrelated groups; a panel with one group already has its Screen title.

  ```
  c h Heading text="Needs a reply" level=2
  ```

- **Text** A sentence. Reach for it last: a heads-up display is glanced at, and prose is the thing a glance cannot do. Never use it to describe a chart that is already on the panel.

  ```
  c t Text value="Nothing is overdue." tone=muted
  ```

- **List** Plain bullets. Prefer Events when the items happened at times, and Bars when they have magnitudes worth comparing.

  ```
  c l List items=["Bring the charger","Print the form"]
  ```

### Data

- **Metric** One number that matters. Give it thresholds and it colours itself when the value crosses one, which is the difference between a number read at a glance and a number that has to be read.

  ```
  c m Metric label="Unread" value=12
  ```

  ```
  c o Metric label="Overdue" value=4 thresholds=[{"at":1,"tone":"bad"}]
  ```

- **Table** Rows with several fields each. Use it when the person needs to compare across columns; if there is one number per row, Bars says it faster.

  ```
  c tb Table columns=[{"field":"name","label":"Name"},{"field":"due","label":"Due"}] rows=[{"name":"Origin Story","due":"Sep 9"}]
  ```

- **Status** One line about how something went. For an outcome, not for standing state: a panel that permanently says everything is fine is a panel nobody reads.

  ```
  c st Status message="Deploy finished" level=success
  ```

### Dashboard

- **Sparkline** A trend. Six to thirty points: fewer is noise and more is a smear. Always pass value, because nobody reads an exact number off a 34-point chart, so the drawing carries the shape and the text carries the number.

  ```
  c sp Sparkline label="Messages this week" points=[31,28,44,39,58,52,71] value="71"
  ```

- **Bars** Ranked rows, scaled against the largest rather than against zero, so four values within ten percent of each other still read as different. Horizontal because the labels are words. `display` is what gets printed; `value` only sets the length.

  ```
  c b Bars caption="Time since last reply" rows=[{"label":"Sam","value":2,"display":"2h"},{"label":"Ava","value":31,"display":"1d"}]
  ```

- **Ring** A proportion, and only ever a proportion: value runs 0 to 1 and the thing must have a real ceiling. A ring around an unbounded number is decoration, and decoration costs the same attention as information while carrying none.

  ```
  c r Ring label="Attendance" value=0.82 caption="82%"
  ```

- **Events** Things that happened or are about to, most recent or soonest first. Set accent on the one that matters; setting it on all of them sets it on none.

  ```
  c e Events caption="Due" items=[{"time":"Sep 9","text":"Origin Story","accent":true}]
  ```

### Anything else

- **Diagram** Reach for this whenever the answer is a shape rather than a number: how things connect, what flows into what, the parts of a system, a hierarchy. Draw it out of nodes and arrows in a unit square where x and y run 0 to 1, and label the nodes. Lay a sequence left to right along y=0.5, and a hierarchy top down from y=0.2, so that two drawings of the same thing come out the same way and somebody can recognise a diagram they have seen before instead of reading it again from scratch. The drawing is the entire answer: do not put a written version of it beside the diagram, because a panel that says the same thing twice has wasted the one glance it gets. Not for anything Bars or Events already says.

  ```
  c d Diagram aspect=2.4 parts=[{"t":"node","x":0.2,"y":0.5,"w":0.22,"h":0.3,"label":"Model"},{"t":"arrow","x":0.32,"y":0.5,"x2":0.68,"y2":0.5},{"t":"node","x":0.8,"y":0.5,"w":0.22,"h":0.3,"label":"Glass"}]
  ```

  ```
  c d2 Diagram aspect=2 parts=[{"t":"node","x":0.5,"y":0.2,"w":0.3,"h":0.24,"label":"Request"},{"t":"arrow","x":0.44,"y":0.32,"x2":0.22,"y2":0.62},{"t":"arrow","x":0.56,"y":0.32,"x2":0.78,"y2":0.62},{"t":"node","x":0.18,"y":0.76,"w":0.28,"h":0.24,"label":"Cache","tone":"good"},{"t":"node","x":0.82,"y":0.76,"w":0.28,"h":0.24,"label":"Model","tone":"warn"}]
  ```

- **File** Shows an actual file: a PDF through the system's PDF engine, an image as an image, anything that decodes as text as text. Use it when the person names a document, instead of describing the document back to them. `editable` on a text file gives a real editor whose save overwrites that exact path.

  ```
  c f File path="~/Downloads/resume.pdf"
  ```

### Controls

- **Button** A press that sends an action back up the socket. Only add one when there is something for it to do; a button nobody is listening for is a promise the panel cannot keep.

  ```
  c go Button label="Send it" action=send variant=primary
  ```

- **Field** A text input bound to a pointer in the panel's own data. It writes locally the moment it is typed in, so it responds at typing speed whether or not anything is still listening.

  ```
  c n Field label="Note" bind=/draft/note
  ```

- **Select** One of a fixed set. Use it wherever the answer is a known list, because a text field that must match one of five strings is a trap.

  ```
  c s Select label="Status" bind=/draft/status options=["Todo","Done"]
  ```

- **Checkbox** A yes or no, bound to a pointer. Use it for a state the person toggles, not for a list of things to tick off: several checkboxes in a row is a form, and a heads-up display is a bad place to fill in a form.

  ```
  c c Checkbox label="Urgent" bind=/draft/urgent
  ```

<!-- /generated -->

## Marking the screen

A panel sits _beside_ the work. A mark sits **on** it.

```
m <id> <x> <y> <w> <h> [label="..."] [tone=bad] [life=30]
u [<id>]
```

Coordinates are **points with a top-left origin**, and points are not pixels: a
Retina screenshot reports twice the number you want. Run `hud screen` to get the
size before you place anything.

```bash
hud draw <<'EOF'
m bug 420 260 380 90 label="This is the one failing" tone=bad
EOF
```

Marks decay. The default life is twelve seconds, `life=0` pins one, and re-sending
the same id with a new rectangle moves it rather than leaving a trail. That is
deliberate and it is the rule that makes the layer trustworthy: a mark that
outlives what it described is worse than no mark, because the person learns to
disbelieve all of them.

Twelve marks maximum. Past a dozen the screen is not annotated, it is hatched.

## Guiding a person

A mark says "look at this" to somebody who knows the screen. A guide says
"press this" to somebody who does not: a ring around the control, a bubble
that says what to do in words, and a slow pulse so the eye finds it.

```
m guide 724 70 30 30 label="Click Sign in" tone=guide life=120
```

`tone=guide` is the whole difference. A guide is the one mark that answers a
click: when the person presses inside its rectangle, or on the ring around it,
the display takes it down and sends

```
e hit guide label="Click Sign in"
```

so whoever is guiding can look at the screen again and show the next step.
Nothing on the glass takes the click itself; it reaches the app underneath as
it always did.

`bin/hud-guide` does the finding: `hud-guide list` reads the front window's
controls through the accessibility tree, `find "sign in"` matches by name,
`show elem_12 --say "Click Sign in"` sends the line above, `clear` takes it
down. One bubble at a time, by design: re-sending `guide` moves it, and a
person following along wants the next step, not a trail. The voice's rules
for guiding, one step, their words, their hands, are in `bin/hud-agent.md`
under "Showing them where".

`chewbacca permissions walk` is the same loop run over System Settings for
every missing macOS grant ("set up my permissions"): it reads the Privacy
pane's tree through the Swift helper in `mac/permission-guide` (its
`snapshot` command, built on first use), finds the app's row and
switch with hud-guide's own matcher, rings the switch ("Turn on Kyber"), and
moves on when the grant is detected. When the pane's tree is unreadable, the
ring goes on the list area of the window instead (`bin/lib/permission_walk.py`).

## Playing music

"Play Blinding Lights", "play some Drake", "pause", "skip", "what's playing",
"turn it up": the bridge reads these itself and drives the player, so nothing
waits on the model. `bin/hud-music` is the same code as a command:

```bash
hud-music play "fred again"      # Spotify by name, or YouTube audio without keys
hud-music pause | resume | next | previous | again | stop | shuffle
hud-music volume up              # or down, or a number
hud-music now                    # what is on, in a sentence
hud-music status                 # which players are ready, and why not
```

Spotify plays whatever its own search puts at the top for the words, misheard
or not: a headless browser (`pip3 install playwright && playwright install
chromium-headless-shell`, once) reads the top result off Spotify's web player,
about 1.5 s, and the desktop app plays it. With keys in `~/.bob/spotify.json`
(`hud-music setup`, a free developer app's client id and secret) it is one
API search instead. Without either, Deezer, Wikidata, MusicBrainz and
Spotify's public embed pages find the URI for anything well known, and a
guess they are not sure of goes to the model, which works out the name and
plays it with `hud-music play --anyway`.
"On YouTube" plays the first result through `ffplay` with no window, a few
seconds in, and so does any request when Spotify is not installed. "Stop" on
its own pauses the music when the voice is idle; "stop the music" always does.

## Panels that take themselves down

`@ toast at=top life=6` closes after six seconds. Use it for something the person
does not need to dismiss: a build finishing, a file saved, a reminder that stops
being true.

Leave `life` off for anything they will read or act on. A panel that vanishes
mid-sentence is a bug they will blame on you.

## Noticing without being asked

`hud-watch` is the half that speaks first. It checks for things worth
interrupting for, shows at most one, and then stays quiet.

```bash
hud-watch                 # check once
hud-watch --daemon        # keep checking
hud-watch --dry-run       # what it would say
hud-watch --status        # what it has said, and the budget left
```

The restraint is the design, not a limitation of it. Two interruptions an hour,
nothing repeated for twenty hours, only the worst finding shown, and everything
it draws expires on its own. A thing that interrupts whenever it has an opinion
gets muted within a day, and a muted assistant is worth less than none because
you believe you have one.

If you add a check, give the finding a stable `key` and a `severity` that rises
when the situation worsens. Severity is in the fingerprint, so getting worse
counts as news and staying the same does not.

## Pointing

Holding Option-Command and dragging outlines a region on screen, and the display
sends `g <x> <y> <w> <h>` when it is released. If a request arrives shortly
after, its "this" or "that" means whatever is in that rectangle. `hud listen`
attaches it to the prompt for thirty seconds and then forgets it, because
pointing at something and asking about it a minute later is a coincidence rather
than a reference.

The display sends coordinates, never pixels. Look at the region yourself if you
need to see it.

## Hearing them

The display can listen. It is off until the person turns it on from the menu bar
(hold the talk key, the globe by default, or a wake word), and when it hears
something it sends `h "what they said"` back up the socket.

What they said is drawn on the pill at the bottom of the screen first, in
quotes, and held there for a second before `h` goes up, so pressing the key
again takes it back instead of sending it. To the person the pill is the
"hyper bar", which is what the voice calls it. Two quick presses of the talk key
are the way out: the panel, the microphone, a run in flight, the voice and the
glass all go, and `x` comes up the socket so `hud listen` stops talking. One
press sends `k down` before the microphone opens, and `hud listen` stops
talking on that line too; what is said next replaces whatever it was doing.

The native app and voice listener each hold an OS lock, so concurrent launches
reuse one HUD. Chewbacca's foreground session-start and prompt hooks record the
last runtime used: Codex/ChatGPT or Claude Code. `hud listen` checks that selection
before its next model request; a running answer finishes on its original runtime.
HUD child sessions cannot claim the selection. An explicit `--model-cmd` or
`BOB_MODEL_CMD` remains an override. Codex uses its saved user defaults through
`hud-codex`; neither runtime's model is forced by automatic selection.

**Switching runtime, account and model** happens on the glass with no model
turn (bin/lib/hud_accounts.py). "Which account" or "which model" draws the
`accounts` card: what answers now, one Use row per Claude account (its email,
ok / limit hit with the reset time / signed out) and per runtime (Codex,
Gemini through `hud-gemini`, local Ollama models through `hud-ollama`), the
model buttons for the current runtime, Sign in on anything signed out, and Add
account. "Use sonnet", "use codex", "use gemini", "use local", "use claude",
"use my other account", "use <email>" and "add an account" act directly. The
pick lives in `~/.bob/hud-accounts.json`, never in `~/.claude/settings.json`;
an explicit runtime wins over the hooks' selection until "Follow my last
session" is pressed. When a reply is a limit notice, that account or runtime
is marked out until the reset it names, the same request runs once on the
next one that is not, and the pill says "Answered on <b>, <a> is out until
9am". With nothing left the pill says who is out until when and the card
opens. Add account makes `~/.claude-<n>` and opens `claude auth login` for it
in a Terminal tab, Caleb's hands, then adds it when its `.claude.json` has a
signed-in email. The menu bar's "Model and account" submenu is the same pick
through `hud-accounts`. Escape, the X or "close it" takes the card down.

When Claude is selected, `hud listen` runs Claude Code under a lean profile: its own short
system prompt (`bin/hud-agent.md`, which carries the `mac` usage), one tool,
and none of the person's settings, with their permission mode and deny list
passed back by hand. That is 15k tokens a turn against 237k, measured on one
calendar question, and it is what makes a day of talking fit a subscription.
`--profile full` runs it the way `claude -p` runs at a terminal. Every turn
writes one `turn:` line to the log with where the time and the tokens went.
The reply is read by `hud-speak` (Python) or, with `HUD_SPEAKER=hud-voice`,
by the Swift server in `voice/`, which needs nothing installed.

How the voice is meant to sound, and where each rule came from, is in
`docs/reference/VOICE-DESIGN.md`: a tone on the press, the model's restate-then-acknowledge
first sentence ("Texting Caleb you're running ten late. On it."), and a
context-shaped filler from the bridge only when nothing has been said for two
seconds. Change `bin/hud-agent.md` with that doc open.

`hud listen` is the loop: it holds a connection open, and when something is said
it asks a model to answer by drawing. Run it in the background of a session where
you want the screen to be answerable out loud.

The pill is also where the answer is spoken. `hud listen` turns every tool call
into a breadcrumb on it (`s "Reading your calendar"`) and the reply's first two
sentences into the last line, and it sends `q <n>` when more than one request
is waiting. A spoken reply is one to two sentences and at most 140 characters,
because the pill holds two lines of 13 point text at 440 points wide and a
panel has less room than an ear. Lead with the answer; the panel carries the
rest. A long answer is not read at all: the model writes it for the panel and
says one line pointing at the hyper bar ("All the info on the Civil War is
ready for you in the hyper bar"), and `hud listen` reads only up to that
sentence. A long block with no such line is cut at `SPOKEN_CAP` words and
"The rest is in the hyper bar." is said instead. The panel's header has the
switch, "Speech off for long answers", on by default; off, the display sends
`e prefer voice long=spoken`, `hud listen` reads everything out and tells the
model on each spoken request not to point at the hyper bar.

Recognition is on-device. Do not add anything that ships audio somewhere.

## Changing something already up

This is the part worth learning, because it is what makes the display feel alive
rather than like a slideshow.

A surface survives your disconnection. Address it again by name and anything you
leave off is kept:

```bash
hud draw <<'EOF'
@ people
c a Sparkline label="Messages this week" points=[31,28,44,39,58,52,88] value="88"
EOF
```

That surface stays in the top right at 400 points wide. The sparkline **changes**
rather than being replaced, and a `Diagram` whose coordinates changed animates
between the two: nodes travel to their new positions.

For anything that updates more than once, bind it and then push data. The
component goes out once and every update after is a single short line:

```bash
hud draw <<'EOF'
@ live at=center w=620 chrome=bare
c s Screen title="BUILD"
c d Diagram aspect=2.2 parts=@/graph
> s d
d /graph [{"t":"node","x":0.2,"y":0.5,"label":"compile"}]
r s
EOF

# later, one line, no component re-sent
printf 'd /graph [{"t":"node","x":0.5,"y":0.5,"label":"compile"}]\n' | hud draw
```

`@/pointer` is the binding. Re-sending a whole component every tick works, costs
far more, and throws away the animation.

## The presence field, and how to judge a change to it

The field is the living edge of the screen: the thing that says the assistant is
here and what it is doing. Seven states, one shader, and the numbers that
separate them live in one table, `Presence.field` in `PresenceField.swift`.

Two pages in `skills/hud/presence/`, both generated by `build-tuner.py` from the
real Metal so neither can drift from what ships:

```bash
python3 skills/hud/presence/build-tuner.py   # writes tuner.html and states.html
```

- **`tuner.html`** is one big field with the palette and the alpha terms on
  sliders. It answers "what should this look like."
- **`states.html`** is all seven at once, each paced at its own fps, with a blur
  slider and a table of which pairs sit too close. It answers "can you tell them
  apart," which is the question that actually decides whether the field works.

Never hand-copy the state table into a preview page. The old one in
`tuner.template.html` drifted to `hearing: 0.38` while the Swift said `0.200`,
so an evening of tuning was spent on a state that does not exist.

### What separates states, in order of how well it works

From the ambient and calm-technology literature, and confirmed by looking at the
seven tiles side by side:

1. **Colour.** The strongest channel by a distance, and preattentive. It is
   spent on exactly three readings and no more: white while it is idle,
   listening or waiting on you, green while it is doing something to your
   machine, red when something failed.
2. **Motion rate.** Works, but only while you are actually watching. A glance
   catches one frame, and in one frame `attentive`, `hearing` and `attention`
   are the same picture. `acting` is the exception, because it breathes on its
   own clock and nothing else does.
3. **Thickness.** The weakest, and for a long time the one asked to do the
   most. `attention` is documented as "the thickest, because this is the one
   that has to be noticed" while sitting 35% above `acting`, and 35% on a
   channel nobody can measure by eye is not what makes those two different.
   The hue is.

So: **spend colour on the states that must be noticed, and do not ask thickness
to carry a distinction on its own.** Two states with the same fps, thickness
within 15%, and no hue difference are one state with two names, and `states.html`
prints that pair in red rather than leaving you to notice it.

The steel palette is what makes that affordable. Every constant in the shader
sits within a few percent of neutral, so the palette itself carries no meaning
at all and the whole colour budget is free for the state to spend. A tint is
one `SIMD4` in `Presence.field`: rgb the body is multiplied by, and how much of
it to take. Steel takes none, `acting` takes 0.60 of a green that breathes
between a quarter and six tenths of that, `done` takes 0.75 of a darker one and
holds still, `failed` takes all of a red.

Two rules hold that together and both are load-bearing:

**The hue goes on the body and never on the hot specular.** A highlight that
takes the object's own colour is the single thing that makes a surface read as
plastic. The shader keeps the blown core neutral and tints everything below it,
which is what a coloured light on steel does.

**Green means something is happening to the machine, not that something is
being considered.** `thinking` is white. Nothing has been done yet, and a
person who cannot tell those apart cannot tell when it is safe to walk away.

### Judge it at the edge of your eye, not in a tab

These live in peripheral vision on a screen somebody is not looking at. Staring
at a bright tile judges the wrong thing. Open `states.html`, turn the blur up,
then look at something else and say out loud which tile just changed.

## Agent work on the glass: what we took from Zed, Cursor and Warp

Researched 2026-10-11 before the Realm IDE layer (bin/lib/realm_ui/glass)
was built, from Zed's agent panel docs (zed.dev/docs/ai/agent-panel), Warp's
agent and interactive code review docs (docs.warp.dev), Cursor's forum
threads on its 2.0 review controls, and The New Stack's Warp 2.0 Q&A. Each rule is checkable on a frame.

Taken:

1. **Edits are reviewed per hunk, Keep or Reject, plus the whole set.** Zed's
   multibuffer review and Cursor's Keep/Undo both settled on the hunk as the
   unit. On the glass a hunk is its lines with signs and tints (colour never
   alone, Carlton's design.md), Keep and Reject under it.
2. **Review controls live with the hunk, near where the eye already is.**
   Cursor moved its Keep/Undo bar to the top breadcrumbs in 2.0 and users
   called it "awkward and easy to miss" and asked for the lower placement
   back (forum.cursor.com, 155718). Ours sit directly under each hunk.
3. **Follow the agent.** Zed's follow mode jumps the editor to every file the
   agent touches. On the glass the file comes in beside the conversation
   while it is edited, lit where it changed, and goes when the turn settles.
4. **The agent's commands are shown while they run.** Warp's blocks make a
   command and its output one object. Ours is one card: the command, its
   tail, Running or Ran, folded away 2.4 s after it ends.
5. **Several agents, each with a state you can read at a glance, and a
   notification only when one is blocked.** Warp's Agent Management Panel
   colour-codes running, done and blocked tasks. Ours are tiles: the state is
   a word plus a mark, and only a tile that needs a press gets an orange edge.

Rejected:

1. **A permanent agent side panel inside an editor window** (Cursor, Zed's
   default). The New Stack's Warp interview calls the side chat panel the
   weak point of IDE agents; on an OS surface nothing sits on screen with
   nothing on it, so there is no panel to dock.
2. **A separate review page.** Warp opens a Code Review panel; Carlton's own
   design.md removed a separate Agents page because "what needs you is said
   where you already look". The diff arrives in the column the work was in.
3. **Auto-approve ("fast-forward").** Warp offers it once you trust an agent.
   Every write on the glass is a press, and the row says what it changes
   first ("Reject: puts back 3 added and 1 removed in auto-compact.ts").
4. **Layout toggles and saved layouts** (Cursor's top-right layout menu). The
   layout follows the agent; nobody arranges it.

### Starting a new agent from the glass

The tiles end with a New agent door. It opens Carlton's own new space sheet
over his workspace, and his "Choose folder" is answered on the glass by
`glass/FolderPick.tsx`: the repos his Claude Code tabs worked in lately, then
the checkouts in ~/code, plus a field that takes any path the server confirms
is a git checkout under $HOME (`GET /glass/folders`, `folders.mjs`). Create
opens the new agent in his workspace and its first turn plays as the story.
Until 2026-10-11 the bridge answered "Choose folder" with null, so the glass
could only reopen old agents, never start one in a repo. Dropping a folder on
his sheet still does nothing on the glass: a web view gets no file path.

## An agent turn told by the screen

Caleb, 2026-10-11 8:29pm: "It needs to be a digestible UX! Vscode and the
claude app are ok at it, carlton's is pretty good! With the power of HUD we
can make this literal storytelling level UX like the lemma site, each part of
your screen being intentional, not just a sequence of lines". Built as
bin/lib/realm_ui/glass/beats.mjs (the beats, pure) and Story.tsx (the
regions), over Carlton's renderer, which stays untouched.

Researched first. Lemma's site (our replica, apps/lemma-replica, W3-panels)
pins ONE stage and changes the state of one set of objects as a single
progress value moves: a caption on the left says the one idea, the panel on
the right shows it, and the four panels crossfade one at a time, never side by
side. Bret Victor's Explorable Explanations: the reader can "read it as-is",
the deeper layer is there on demand, and there are "no UI elements screaming
for attention". Segel and Heer's martini glass (Narrative Visualization,
2010): a narrow author-driven stem, then the reader is released into
exploration. Bostock's "How to Scroll": no surprise motion, readers keep
their own controls. What that means for an agent turn: the glass tells the
stem (what happened, in order, one idea at a time), and the transcript is the
bowl, one press away.

### The beats, and the one region that owns each

One agent turn has six beats. Each is decided from Realm's own session events
(beats.mjs `beat()`), never guessed from text.

| Beat      | Comes from                                    | Headline says                    | The figure shows                     |
| --------- | --------------------------------------------- | -------------------------------- | ------------------------------------ |
| You asked | `user_message`, nothing done yet              | "Starting on it"                 | nothing                              |
| Reading   | Read, Grep, Glob, LS calls                    | "Reading orgs.ts"                | the files it opened, newest lit, and under a search the one line its result said ("Found 2 files"), never a line we wrote |
| Changing  | Edit, Write, MultiEdit                        | "Changing orgs.ts"               | that file, the changed lines lit     |
| Proving   | a test or check command                       | "Running the tests"              | the command, then its verdict        |
| Your call | `permission_request`, or a settled diff       | what it wants, or what it did    | the command it wants, or the hunks   |
| Done      | settled, nothing waiting                      | the first sentence of its answer | what changed, as file names          |

Regions, each with one job:

1. **The ask** (top left, small, quiet ink): "You asked: fix the org access",
   the agent and its age. It never changes during the turn.
2. **The headline** (left, the biggest type on the glass, 28): one sentence of
   what is happening now, or what happened. The only thing you have to read.
3. **The beat line** (under the headline): the six beat words in order. Past
   beats are read, the current one is lit, later ones are faint. This is the
   whole progress bar; there is no other.
4. **The figure** (right, one object): the thing the beat is about. One at a
   time, swapped on one crossfade, like Lemma's four panels.
5. **The proof** (under the beat line once something ran): "Proved: 4 tests
   passed", "Checked: npx tsc ran clean", or "Not checked: nothing ran". A
   turn that changed code and proved nothing says so, plainly.
6. **Your call** (bottom left): the one decision waiting on him, with the
   press that answers it and what it does. A permission is "Allow runs
   exactly what's on the right" with Allow and Deny, and the figure draws the
   request as the thing it is: a command as its lines, an edit as the file
   with its lines out and in, a write as the file and what goes in it. One
   typed view per tool kind (beats.mjs REQUESTS, Story.tsx REQUEST_VIEWS),
   each only when every field of the input is drawn whole; anything else is
   the raw agents.py line, and Allow waits until all of it is in view. Realm
   says waiting_permission a moment before the request lands: that beat is
   "It's asking for your OK" over the object of the beat it paused, never an
   empty screen. A question it asked is "Answer it", which opens the
   transcript at its card. A settled diff is "Keep all 2 files" (writes
   nothing) beside the per-hunk Reject in the figure. With nothing waiting the
   region is not drawn.
7. **The transcript door** (bottom right): "Transcript" and "Reply", both
   open Carlton's full workspace. Voice that fills the reply opens it too.

### At rest, working, and needing him

- **At rest** (Done): the ask, the headline, the beat line all read, the proof,
  and the changed files. Nothing moves. One glance answers "what happened and
  did it prove it".
- **Working**: the headline and the figure change with each beat. The only
  thing that moves at rest is the lit beat's dot, breathing (the one live-work
  signal); under Reduce Motion it is still.
- **Needs him**: the beat line lands on Your call, the call region appears in
  his orange edge, and the headline says what it wants in words.

### The transcript stays, one press away

Carlton's workspace (conversation, composer, his stage column) is mounted the
whole time, so "Transcript" is instant. Escape from the transcript comes back
to the story; Escape from the story goes back to the tiles.

### Subtraction: what the story removes from Carlton's default view, and why

- The conversation scroll. It is the sequence of lines he asked to stop seeing
  by default; it is the transcript, one press away.
- The composer, the branch bar, the model picker, the machine and folder
  footer. Replying is a press ("Reply") or the talk key, not a field that sits
  there.
- Nothing of his frame. His pane bar (the space crumb, the title, Summary and
  files, the pane menu) stays on screen above the story, and so do his rail,
  sidebar, lead and trail ("His navigation stays", below).
- "Worked for", the message action icons (copy, retry, branch, thumbs). Not
  part of what happened.
- The "Edited 2 files +20 -3" card and its Undo and Review. The figure and the
  call region carry the same facts and the same presses.
- The stage column's stacked cards (file, command, tests, changes at once).
  The figure shows one object; the others are beats already told.

### Motion

From Carlton's ladder only, 140 to 320 ms. One morph per change: the figure
swaps on one 200 ms crossfade, the headline on one 140 ms swap, the beat line
moves its light in 240 ms. The tile still grows into the story in 320 ms.
Nothing moves at rest except the lit beat's dot.

## The agents IDE, held the way Daniel would hold it

Daniel Thomas on Chewbacca, 2026-10-11: "oddly similar to rust's design
philosophy", and "how does it mitigate context rot especially related to the
sheer number of tasks". Caleb the same night: "Make this how daniel thomas
would". Five rules for the agents IDE on the glass (bin/lib/realm_ui/glass),
each held by a test that failed on the code before it:

1. **Invalid states can't be drawn.** An agent turn is one typed value
   (turn.mjs): asked, reading, changing, proved, needs-you, done, failed, with
   every allowed move listed in `NEXT`. Each phase carries exactly what it
   draws, so a changing turn with no file, a review with no hunk (no Keep with
   nothing behind it) and Done while realm or the tab says running can't be
   built. Callers go through `match()`, which wants an arm for every phase; no
   `switch` on a phase, no default branch.
2. **One owner per region.** The table below. The layer is a CSS grid whose
   named areas are its regions, and the story is a grid inside one of them,
   so the layout can't put two on one spot. Headless WebKit checks the drawn
   rectangles too: no two drawn regions overlap in any frame of a turn.
3. **Errors are values.** Every failure is a named fault (`FAULTS`): what
   happened, what the system said, and the one thing to do, with Retry where a
   retry can help. Engine calls settle within `ENGINE_ANSWER_MS` or become a
   timed-out fault, so nothing spins forever. An engine that is down reads
   "Realm's engine isn't answering", never "No agents yet".
4. **No context rot.** Only the current turn is held whole. Beats it has passed
   fold to one line each, turns before it to one line each, and only the newest
   five of either are kept, with a count of the rest. Tiles cap at nine with a
   count. Twenty agents with two hundred turns rest in the same view as nine
   with six (tests/test_realm_turn.mjs).
5. **Zero cost at rest.** Nothing animates and nothing polls faster than it
   must when every agent is at rest. The measured numbers sit next to each
   constant in GlassLayer.tsx.

### Getting around

Caleb's first live open, 2026-10-12 3:38pm, after every headless rehearsal
had passed: "Bro wtf is this ux I can't navigate anything???" The glass
opened straight into a 2-day-old Gemini session that had died on sign-in,
its raw error as a three-line headline, and the only ways out were Escape,
a small x over his desktop icons and two grey words in a corner. The
rehearsals had tested a fake agent on an empty engine, so none of them met
an old dead session or a desktop. This is the spec that answers it; the
rules live in `bin/lib/realm_ui/glass/nav.mjs` and are held by
`tests/test_realm_nav.mjs`.

Taken from the places that already make this obvious. The uselemma.ai
replica keeps one header on screen at all times with one primary action on
the right and a quiet secondary beside it. Claude's desktop app and
Carlton's own Realm window keep the session list in a left column, with New
at its top and the open session marked in it, so switching is one press and
never a trip back through a home screen. VS Code's agent panel keeps "new
session" and the history in the panel's own header.

What opens first:

- **Always the tiles.** Every time the glass is shown, even when the page
  never left (Kyber reattaching a kept page), it opens on the tiles with
  nothing focused and nothing picked (`opening()`). Never the agent that was
  up last.
- **Nothing is picked until he picks.** Return opens only a tile he moved
  to with the arrows or the pointer (`tileKey`), and the talk key reaches
  no agent from the tiles until one is picked (`/glass/voice` refuses with
  no session). A stale tile can't be opened by a stray key.
- **No tile is drawn until every tab's state is in** (`tilesReady`). Drawn
  early, the only drawable tile was realm's one native session, the dead
  Gemini one, alone and first. "Reading your agents" holds the field for
  the ~50 ms it takes.
- **Newest real work first.** Waiting on him, then working, then a failure
  from the last 30 minutes, then everything settled by age, and last any
  failure older than that (`FRESH_FAIL_MS` in turn.mjs).

What's always visible: his whole frame, plus one bar over it.

- **The bar, in every mode:** All agents with the count (marked current on
  the tiles), then on an agent its name and a Story / Transcript switch,
  then New agent (the one primary action), Close with its `esc` key drawn
  on it. Labeled buttons, 36 pt tall.
- **His sidebar, in every mode:** every session, Needs you first, grouped
  by space, the one showing marked. A row is one press to that agent: its
  story from the tiles or a story, its transcript from the transcript. The
  glass never draws a second agent list beside it.
- **His rail, lead and trail, in every mode:** Home, Library, Connections,
  Scheduled tasks, Code review, his account; back and forward; the side
  panel toggle. A rail page shows in the workspace. Home is "Back to your
  sessions" in his app, so on the glass it goes to the tiles.
- **On the story, the doors are buttons:** Open transcript, and Reply as
  the primary. Never grey words.

Where the exits are: All agents (or Escape, or his Home) from the story or
the transcript goes to the tiles; Story in the bar (or Escape) from the
transcript goes to the story; Close (or Escape on the tiles) takes the
glass down. Every one of them is a button on screen; the keys are
shortcuts, never the only way.

Only his presses move the glass. His store restores the last layout on
boot by itself, and the first build that followed his focus showed the
glass straight into the dead Gemini session again; `followHis` in nav.mjs
moves only on a change of his focus within `PRESS_MS` of a press or key in
his frame.

A failed turn is a named state, never the provider's words as a headline:
"Gemini can't sign in" over the beat line, and the call says what to do
("Gemini's login is dead. Use Claude for this, or sign Gemini in again.")
with New agent with Claude and See the full error as its presses, and the
raw error small and grey under it. The beat line reads up to the beat it
died on, drawn as "Failed before it started" (or while reading, changing,
checking) in red, and nothing past it. The tile and the nav row say
"Signed out" for an agent whose provider refused its login.

The panel never collides with the desktop: the realm surface is 1000
points wide, centred, which on his 1246-point display leaves 123 points on
each side, clear of the icon column macOS keeps on the right, and every
panel is 96% opaque so nothing behind it reads through. With no figure for
the beat the story is one column, never a telling huddled left of an empty
two thirds.

How it is proved: a headless WebKit run seeded with a read-only copy of his
real realm database (the dead Gemini session and every old tab included),
over a test backdrop with a column of desktop icons on the right edge, at
1246 x 900 at 2x and at 1440 x 900. The first frame must be the tiles, and
from every state the way back to all agents must be on screen and one
press. Then every frame is opened and looked at.

### His navigation stays

Caleb, 2026-10-12 4:10pm, after his first live test: "Bro study carlton's UX
on realm, we need buttons to get through a UX fucker! Yes it is the ux of the
future but the future is intuitive ux!" Until then glass.css hid Carlton's
rail, sidebar, lead and trail with `!important`, and the story replaced his
screens with a layout that had no buttons. Subtraction went too far: it
removed what makes his app easy to get around.

The contract: **every navigation affordance Carlton ships stays visible and
pressable on the glass**, unless a line below gives a reason Caleb would
agree with. The story and the tiles are views inside his main pane, where his
transcript goes, never a full-screen replacement. `tests/test_realm_floating.mjs`
refuses any rule in glass.css that hides a piece of his chrome.

What his app gives, read from his source (App.tsx, sidebar/, WindowLead.tsx,
SidePaneToggle.tsx, CommandPalette.tsx, keys/) and from a headless build of
his app with none of our layer (frames in
`~/.chewbacca/overnight/live-ide-realm-nav-report.md`):

| Where | Affordance | What it does | Key |
| ----- | ---------- | ------------ | --- |
| Rail (`.app-rail`, 52 pt) | Home | "Back to your sessions": closes a page, or starts a session if none is up. On the glass: the tiles | |
| Rail | Library, Connections, Scheduled tasks, Code review | that page over his main pane; pressed again, closes it | |
| Rail foot | You (his name) | menu: your page, Settings | ⌘, |
| Lead (`.window-lead`) | Go back, Go forward | step the window's trail of what was showing | ⌃- / ⌃⇧- |
| Lead | Show sidebar | only while the sidebar is folded | ⌘B |
| Sidebar head | Hide sidebar, Search, New session | fold it; the palette; a new session in this space | ⌘B, ⌘K, ⌘N |
| Sidebar | Profile switcher | other profiles, All spaces, profile settings | ⌘⇧Space |
| Sidebar | Needs you | every session waiting on him, one row each, with Answer here inline | |
| Sidebar | Spaces lens / Activity lens | sessions by space, or by day | |
| Sidebar | A space's row | collapse; hover: New session here, More (worktree, Finder, memory, archived, settings) | |
| Sidebar | A session's row | show it; ⌘-click beside; hover Archive; right-click: move, pin, rename, peek, focus, checkpoints, close, delete | |
| Sidebar foot | New space | his new-space sheet (name, colour, folder) | |
| Pane bar (`.panel-bar`) | Space crumb, title, Summary and files, Pane menu, Close | the space page; rename; the session summary; split, focus, close | ⌘W |
| Trail (`.window-trail`) | Show / Hide side panel | the side panel's tabs: browser, files, terminal, sub-agents | |
| Palette (`.palette`) | Open, the space's sessions, Actions, Theme, Deep search | jump anywhere; Respond to pending permission | ⌘K, ⌘P, ⌘⇧P |
| Transcript | Permission card | Allow, Allow always, Deny, Submit | ↵, ⇧↵, ⌘⌫, Esc |
| Anywhere | Toasts (`.toasts`), the connection banner | every failed action as a toast with its action; engine trouble with Retry | |

What the glass adds on top, and nothing more: the bar (All agents, Story /
Transcript, New agent, Close), the tiles and the story in his main pane, and
the stage column beside the transcript while something is live.

The stated exceptions, each one Caleb would agree with:

- His Home, on the glass, goes to the tiles. His tooltip says "Back to your
  sessions", and on the glass the tiles are his sessions.
- His main pane's loops are paused while the tiles or the story cover it
  (40 to 44 infinite animations measured under a pane nobody could see).
  The sidebar's are not; its dots are on screen.
- Escape is still ours first (bridge.js), so it steps transcript to story to
  tiles. His dialogs, menus, palette and pages keep it while they are up.

### One owner per region

<!-- regions:begin -->
| Region    | Owner                 | Grid area        | Modes              | Draws |
| --------- | --------------------- | ---------------- | ------------------ | ----- |
| notice    | Notice                | notice (pane)    | tiles, story, work | a fault no one agent owns (engine down, the talk key lost), with its one fix |
| frame     | Carlton's app (#root) | -                | tiles, story, work | his window chrome, never hidden: the rail, the session sidebar, back and forward, search, New session, the side panel toggle |
| nav       | Nav                   | -                | tiles, story, work | the bar over his frame, always on screen: All agents, Story and Transcript, New agent, Close |
| field     | TileField             | main (pane)      | tiles              | the agent tiles, one line each, a count of the rest, and the New agent door when there are none |
| story     | Story                 | main (pane)      | story              | one agent's turn told by the screen, in the five regions below |
| ask       | Story                 | ask (story)      | story              | what he asked, which agent, how long ago |
| tell      | Story                 | tell (story)     | story              | the one headline, the beat line from the typed turn, what proved it |
| call      | Story                 | call (story)     | story              | the one decision waiting on him, or the fault that stopped the story, with its press |
| figure    | Story                 | figure (story)   | story              | one object for the beat: the turn's file, command or tests, the request, the hunks |
| doors     | Story                 | doors (story)    | story              | Open transcript and Reply as buttons, his full workspace one press away |
| stage     | Stage                 | -                | work               | the one live object beside his transcript: the command, the file being written, the check, or the fault |
| workspace | Carlton's app (#root) | -                | work               | his conversation, composer and panes, untouched |
| pick      | FolderPick            | -                | work               | Choose folder on the glass, over his new space sheet: his repos and a path field |
| light     | Light                 | -                | tiles, story, work | the morph outline between a tile and the story, for 320 ms |
<!-- regions:end -->

A new region is a row here, a row in regions.mjs, a `data-region` on exactly
one element its owner draws, and a `grid-area` in glass.css that no other
region of the same grid and mode uses. One component may own several regions
(the story owns five); a region never has two owners. tests/test_realm_regions.mjs refuses any one without the
others. The regions with no area are fixed strips of their own: his frame,
the bar over it, the stage beside it, and the light, drawn for the 320 ms of
a morph, over everything, and then gone. The pane over his main pane is one
grid in every mode, placed by the measured rectangle of his `.main`.

## Navigation patterns from shipped agent apps

Read from the bundles of Claude.app, the Claude Code and Codex VS Code extensions, ChatGPT.app (Codex), Cursor, Linear, Notion and Carlton's Realm source on 10/12, after the first live test had no way to navigate. Ranked by how much each one fixes the 10/12 3:38pm live test (opened into a dead day-old Gemini session, raw sign-in error, no way back). Every mapping keeps Carlton's navigation visible: the story is a pane inside his frame, and his rail, sidebar and back/forward stay pressable (team/memory/feedback_glass_keeps_visible_buttons.md). Patterns are described and cited by where they live in each shipped bundle, never copied. The full per-app evidence is in `~/.chewbacca/overnight/ux-universe-report.md` from 10/12.

1. **A session list that never leaves the screen, status dot on every row.** Claude.app sidebar (dot order "Needs input" > "Ready for review" > "Working", ion-dist i18n en-US.json), Claude Code ext ("Session history", "Active · N", dots for running/waiting/idle/unread/failed, webview/index.js), Codex ("Chat history" dropdown with in-progress count, All/Local/Cloud), Cursor (Pinned/Today/Yesterday/Last 7 Days/Archived groups), Realm (sidebar spaces + recent). Glass: stop hiding `.app > .sidebar` and `.app-rail` in `glass.css:59-66`; in tiles and story our `Nav` rows are the list, in work mode his sidebar is. One list is visible in every mode.
2. **Needs-you inbox you can answer in place, plus "next waiting".** Realm sidebar "Needs you" answers permissions without opening the session; Claude.app "{title} is waiting on you" and the group rollup "A session in this group is waiting on you"; Codex rows "Awaiting approval"/"Needs input" and Cmd+Alt+A jumps to the next chat needing attention; Cursor tray group "Needs attention". Glass: draw `restingView().waiting` (computed in `turn.mjs`, never drawn today) as a strip above the tiles with Allow/Deny inline; bind one key to "next waiting".
3. **Old and failed sessions never open first; the first screen is a recent board.** Claude.app home "What's up next, {name}?" (last 7 days, unread first, suggested tasks like "Fix the failing CI checks on {branch}"); Cursor "Open New Agent Chat" reuses an empty agent instead of a blank one; Realm restores the last saved view, else a fresh prompter. Glass: tiles stay the opening (`nav.mjs opening()`), but filter to the last 7 days, unread first, and put failures older than `FRESH_FAIL_MS` under an "Older" row instead of a tile.
4. **Archive with reasons, archived group, reopen key.** Claude.app archives on PR merge/close or finish and says why it is paused ("Claude is waiting for your reply, so automatic archiving is paused for up to a day"), Cmd+Shift+Backspace archive, Cmd+Shift+T reopen; Claude Code ext archives idle after 14 days but never open/running/waiting/unread; Cursor "Archived (n)" collapsed, Cmd+Shift+E; Codex archive also cleans worktrees; Realm Settings > Archived. Glass: "Archive" on each tile and nav row (calls his archive), an "Archived (n)" row at the bottom of `Nav`, the past-nine count becomes a pressable "N more" that expands the list.
5. **Cmd+K that searches sessions and starts one.** Claude.app "Search or start a session" over about 60 commands; Linear one action registry (`id, name, keywords, keyboardShortcut, applicable(ctx)`) drives the palette, G-sequences and help; Codex desktop Cmd+K; Realm palette (`DEFAULT_KEYBINDINGS`, packages/contracts/src/keybindings.ts). Glass: bind Cmd+K in tiles and story to his palette (today it only works in work mode); feed it our agents as items.
6. **Keyboard switching between sessions.** Claude.app Cmd+1..9 and Cmd+Shift+[ / ]; Cursor Cmd+Alt+Up/Down; Realm back/forward Ctrl+- / Ctrl+Shift+-. Glass: 1-9 opens tile N, Cmd+Shift+[ / ] walks `Nav` rows in story, both shown as `<kbd>` hints on the rows.
7. **Back/forward that shows whether it can go.** Linear main process sends `navigationStateChange {canGoBack, canGoForward}` so arrows grey out, plus a fixed Home (Shift+Cmd+H); Notion tab bar Back/Forward with Cmd+[ / ]; Cursor Cmd+[ / ]; Realm WindowNav. Glass: unhide `.window-lead/.window-trail`, or give `Nav` a Back whose disabled state reads a `nav.mjs` history stack; "All agents" is Home.
8. **Permission asks: the exact command, three labeled choices, keys.** Claude.app "Allow Claude to {action}?" over "What Claude sent", "Allow once" / "Allow for this session" / "Deny", Cmd+Enter / Cmd+Shift+Enter / Esc, keys ignored for 400ms after the card appears and on key repeat; Claude Code ext numbered "1 Yes" / "2 Yes, and don't ask again" / "3 No" with "Tell Claude what to do instead" and an editable Bash command; Cursor "Run" (Enter) / "Allowlist 'npm'" (Shift+Enter) / "Skip" (Esc); Codex "Allow once" / "Deny" + split menu "Allow this conversation", "Always allow"; Realm Allow / Allow always / Deny with Enter, Shift+Enter, Cmd+Backspace/Esc, 1/2/3. Glass: `decision()` in `beats.mjs` gets "Allow always", Enter/Shift+Enter/Esc and 1/2/3 on the story, a 400ms key guard next to our existing scroll-into-view gate, and a "Tell it instead" box.
9. **One error, our words, one action.** Claude.app "Service is busy... try again in a moment, or switch to a different model", "{cause}. Retrying in {seconds}s (attempt {attempt} of {maxRetries})"; Cursor "Try again"/"Resume", logged out "Log in", context overflow "Start New Thread With Summary"; Codex transient errors turn Send into "Resume", usage errors go to the usage modal; Realm auth failure swaps the composer for Sign in / Check again / Open in terminal; Linear crash page one button "Reload Linear". The live test showed the provider's raw string as a 40pt headline. Glass: `headline()` never prints a provider string; `signed-out` in `FAULTS` gets "Sign Gemini in" (his InstallCard flow) plus "Use Claude instead"; retryable faults show a countdown and "Retry now".
10. **Working vs at rest: present-tense activity, live timer, then a past-tense line.** Claude.app "Running a command" + "{m}m {s}s" + tokens, collapses to "Thought for {m}m {s}s"; Codex "Running {command}" with elapsed, then "Worked for {time}"; Realm "Cooking..." then "Cooked for 2m 14s"; Cursor "Planning next moves", "Waiting for approval" in cyan. Glass: live elapsed on the tile and story headline while `data-working`, "Worked for Xm" at rest; tiles today show only a coarse age.
11. **Stop is always one press, and Esc interrupts.** Claude.app Esc stops, Esc Esc rewinds; Realm Esc interrupts and the composer button becomes Stop; Cursor Cancel next to the running status. Glass: Stop button in story `call` and on running tiles; fix the `bridge.js` capture listener so Esc in his composer reaches his interrupt and his card's Esc=Deny.
12. **Per-turn change card, then a review bar that counts.** Codex "N files changed" with Undo/Reapply; Realm "Edited N files" with Review/Undo, per-file stage, deliberately no per-hunk stage (DiffPane.tsx); Cursor floating bar "3 of 7 total changes", "2 of 4 files", "Review next file", "Keep All"/"Undo All" (and Undo All can be undone), Alt+J/K hunk, Alt+L next file; Claude Code ext per-hunk "Accept this change"/"Reject this change" in the native diff; Claude.app comment on a line then "Send to Claude", Rewind "Code and conversation / Conversation only / Code only". Glass: our `Review` already has per-hunk Keep/Reject; add the counting header and next-hunk/next-file keys, and "Tell it what to change" on a hunk.
13. **One action tray at a time, chosen by priority, same keys everywhere.** Cursor agents window shows one tray picked by a fixed priority list (error first), Cmd+Enter primary, Cmd+Shift+Enter secondary, Esc dismiss. Glass: `call` already shows one `decision()`; make its order explicit (fault > permission > question > review > done) and bind the same three keys to whatever is there.
14. **Messages queue instead of failing.** Claude.app holds messages while signed out, rate limited or archived and sends when cleared, plus "Send now"; Claude Code ext "Queue another message..." shown as "You, queued"; Cursor queued follow-ups editable/send now/remove; Codex queue, steer, interrupt. Glass: Reply from the story queues into his composer and shows "Queued, sends when it's free" on the tile.
15. **Attention outside the window.** Codex desktop dock badge, tray menu (Running, Unread, Pinned), notifications you can reply to, a floating overlay that answers approvals; Linear and Notion deep links (`linear://` + localhost handoff, `notion://`). Glass: Kyber menu bar count of waiting agents, a voice "next waiting" intent in `voiceIntent`, and a deep link that opens the glass straight to one session's story.

Also clever, not ranked: Cursor sends separate user-facing and model-facing tool errors ("Tool call failed" goes to the model); Claude.app and the Claude Code ext warn before an expensive re-read ("Your next message re-reads all {tokens} tokens. Compact first"); Claude.app moves keyboard focus to the next row when you dismiss one; Notion queues navigation commands until the page is ready (`sendOrQueueNavigationCommand`) and keeps the current URL on reload; Linear's `applicable(ctx)` hides "Go to X" while you are on X.

## Rules

**Everything on the glass is instant.** A surface paints its last known state
the moment it is asked for and refreshes in place; nothing on the open path
waits on the network, the engine or a fetch. Anything that costs more than a
frame to build (a web view, a session) is made once, warmed at launch, and
shown and hidden, never rebuilt on reopen. Budget: 150 ms on a reopen, 1 s on
the first open after login. hud/CLAUDE.md, "Instant on the glass", has the
measurements (Caleb, 2026-10-11: "everything on the glass should be INSTANT").

**Do not narrate the panel.** If you drew the chart, do not also describe it in
the terminal. Say what you put up and where, in one line.

**Do not open a surface per fact.** Related things belong in one panel.

**Close what you opened.** `hud close <name>` when they are done. The screen is
theirs.

**Do not invent components or props.** Anything not listed here is dropped
silently by the renderer, so the panel will just be missing that piece and
nothing will tell you.

**Set the ring.** It is the only signal the user has that you are alive, and
it costs one line:

| Line                 | When                                                                                                           | What they see                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `p thinking`         | you took a request and are working out what to do                                                              | white, thin, moving fast                                            |
| `p acting`           | you are running something on their machine                                                                     | green, breathing                                                    |
| `p done`             | it worked                                                                                                      | darker green, still                                                 |
| `p failed`           | it did not                                                                                                     | red                                                                 |
| `p attention`        | you are blocked on them                                                                                        | white, thick, two pulses                                            |
| `p dormant`          | nothing in flight                                                                                              | nothing at all                                                      |
| `p speaking amp=0.6` | the voice is playing; hud-listen sends this itself, twenty times a second, from the level of what it is saying | white, thickness moving with the voice, the same as while they talk |

The pill opens into the conversation panel when clicked: every request and
answer of the session, selectable, with a field to type the next one. A typed
request comes up the socket as `h "<text>" via=typed` and is answered in
writing. `w "<text>"` is the answer so far for that panel, the whole text each
time rather than a delta, and `w "<text>" done=true` closes it; hud-listen
sends these itself from what the model writes, one per sentence. The panel
draws Markdown in full (lists, headings, quotes, tables, fenced code with a
copy button), keeps each tool call (`s "<text>" step=true`, which hud-listen
sends for every tool use) as a folded list of steps under the answer with how
long it took, and gives each answer copy, read aloud and ask-again buttons.
Read aloud comes up as `e say turn text="<answer>"` and hud-listen speaks it.

Send `p acting` before the thing that takes time, not after. A state that
arrives once the work is finished is a state nobody ever saw, and the colour
takes about a second to come up on purpose.

**Get the screen size before placing a mark.** `hud screen`. Coordinates are
points, and a Retina screenshot reports twice that. This is the single easiest
way to put a mark in the wrong place.

**Check `hud status` first** if you have not drawn this session, and `hud open`
if it is not running.

## Never draw over the person's work unasked

Since 2026-10-11 `hud draw` and `kyber-surfaces open` refuse an agent (CLAUDECODE set)
while the person has touched the keyboard or mouse in the last two minutes, because a
background agent's test panels kept popping up over Caleb's work ("It keeps popping up?
Fix chewbs bro"). When the person in this conversation asked to see something, prefix the
draw with `KYBER_LIVE_OK=1`. To check your own work, render offscreen with HUD_LINES_FILE.
