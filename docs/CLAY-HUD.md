# Clay HUD

Design spec, 2026-10-09, for Gavin, Caleb, Jake and Semyon. It covers a Kyber
layer drawn over Clay in Chrome, so that someone who has never used Clay can
ask for a lead list and watch it get built on the real page. Nothing here is
built yet. The look was chosen from browser mockups; the decisions and who made
them are listed below.

## The job

A client's operator says "find me 50 fintech VC partners with work emails".
Kyber drives the Clay tab they already have open, shows what it is touching,
stops before anything spends credits, and ends on a card that says what they
got and what it cost.

This is the first of three Clay HUD flows. The other two come after it works:
explaining what is under the pointer while a person drives Clay themselves,
and an approval card on any credit spend whoever starts it (CHW-163 covers the
card for this flow's runs).

**What would prove this wrong:** a first-time operator, given the sentence and
no help, either fails to get a 50-row emailable table or spends credits they
did not approve. Either one on a real run means the design failed, not the
person.

Watching an agent work does not teach anyone Clay. NN/g is plain that people
learn by doing ([onboarding tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)).
So the narration here exists so the operator can trust the run and stop it.
Teaching belongs to the explain flow.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| First flow | Ask, then watch it build | The demo Caleb described on 2026-10-06, and the Find People path is already mapped |
| What you see | Narrated driver: Clay stays visible, one note at a time beside what is touched | Every trusted agent UI keeps state in one fixed place and confirms before changing the world ([Operator system card](https://cdn.openai.com/operator_system_card.pdf), [Linear agent guidelines](https://linear.app/developers/aig)) |
| Where data comes from | `chewbacca clay` reads; the page is driven only where no API reaches | Caleb's registry (`library/clay-api/registry.json`) marks `find-people` and `run-empty-rows` as UI-only. Everything else reads in about a second |
| Look while acting and approving | OS1: window chrome, corner brackets, a wireframe icosahedron as the agent's mark | Gavin's pick, 2026-10-09 |
| Look when done | Dither: a stipple globe | Gavin's pick, 2026-10-09. It is the one moment of delight, once per run |

Rejected: running Clay out of sight with a progress card, which leaves nothing
to watch and is harder to trust, and dimming everything but the target, which
is the product-tour style and gets in the way of takeover.

## How it fits together

```
hyper bar / voice ──► hud-listen ──► clay-build "<sentence>" --count 50
                                         │
                       recipe: library/maps/app.clay.com/recipes/find-people-table.json
                                         │
          ┌──────────────────────────────┼───────────────────────────────┐
   chewie web eval                chewbacca clay                   ~/.bob/hud.sock
   (the one Clay tab)        (credits, table, table-status)    (cursor, bracket, note,
          │                                                       strip, cards)
   clay_geometry: page rect ─────────────────────────────────► screen points
```

### clay-build

`bin/clay-build "<sentence>" --count <n> [--dry-run]` runs the recipe one
step at a time. For each step it finds the element, draws the cursor and the
note there, acts, then waits for the page state the step expects. `--dry-run`
stops at the first approval card and spends nothing.

It drives the page with `chewie web eval` and `CHEWIE_WEB_FRAME` set to the
Clay tab. `chewie web` talks to its own Chrome over the debug port
(`mac/bridge/web.js`), a separate window on a copy of the profile, so the Clay
tab the run drives lives in that window. Step 0 counts Clay tabs there through
the port's `/json/list`. It opens one only when none exists, and that is the
only time a URL is passed, because a URL opens a new tab
(`library/maps/app.clay.com/MAP.md`, 2026-10-05). `chrome-js` was ruled out:
it does not await promises, it swallows page errors, and its Apple Events
switch turned itself off on 2026-09-23.

It registers on the tab board (`tabs register`, then `tabs note` each step), so
other sessions see "clay-build driving Clay, step 3 of 6". The board is for
visibility. The guard is a lock file at `~/.chewbacca/clay-build.lock` holding
the pid. A second run refuses to start while a live pid holds it.

### The recipe

A data file next to the Clay map. Each of the seven steps in the run table
carries:

- `id`, `title` (the note's title strip), `note` (the note's sentence) and
  `holds` (what it will not do yet, the muted line under the note)
- `surface`: `read`, `ui` or `approve`
- `cost`: `free` or `spends`
- `actions`, in order. Each has `find` (selectors tried in order, with the
  visible text expected on the element), `do` (`click`, `type`, `check` or
  `open-submenu`), `expect` (one of a URL fragment, page text, a page-text
  pattern, or a visible selector) and `timeout_s`. The one paid click in a
  `spends` step is marked `approve` and is always that step's last action.

When Clay moves a button, the recipe changes and the code does not. The recipe
is checked by a schema test, and the finder by a `node --test` run on element
descriptions. Saved Clay pages would carry lead data into a public repository,
and `tools/clay_fixture_check.py` compares CSV exports rather than selectors.
The live dry run is what checks the recipe against the real page.

### Geometry

`bin/lib/clay_geometry.py` turns a `getBoundingClientRect` result into screen
points with a top-left origin, the coordinate space every HUD line already uses.
The inputs are `window.screenX` and `screenY`, the toolbar height
(`outerHeight` less the zoomed `innerHeight`), and page zoom, which is
`devicePixelRatio` over the display's backing scale (read once through JXA).
The run stops instead of drawing in the wrong place when the toolbar height is
out of range, which means DevTools or a panel is docked, or when the window is
off the main display. The dry run's screenshots are the real check.

### Reads

Every number on the glass comes from Clay:

- `chewbacca clay credits`: the balance before the run, after the test, and at the end
- `chewbacca clay table`: whether table auto-run is on
- `chewbacca clay table-status`: per-column success, running, queued and error counts, for progress
- `chewbacca clay rows`: which rows have an email in the work email column, for the found count and the misses
- Clay's own "Run N empty or out-of-date rows" line: the estimate on the second approval card

Nothing on a card is computed by us except subtraction.

### What Kyber gets

- The beside-note: A surface with `chrome=window`, placed with a new
  `near=<x>,<y>,<w>,<h> side=right` instead of `at=`. It sits in the gutter
  beside the target, never over a cell and never over the element being
  pressed. One note exists at a time: the next step re-addresses it.
- The target bracket: An `m` marker on the element's rect. A step that failed
  draws it with a new `tone=miss`, red and dashed.
- The agent cursor: The existing `a <x> <y> act=true` line.
- The strip: An ordinary `chrome=window` surface at `at=bottom`, holding the
  mark, `CLAY-BUILD`, six step ticks, the current verb, the elapsed time, and
  Stop. Bottom-centre surfaces now sit above the hyper bar's lane, so the
  strip needs no new verb.
- The approval and done cards: `chrome=window` surfaces whose buttons come
  back as `e <action> <component> surface="<name>"` events. Every action is
  named `clay-*`, `hud-listen` passes them by, and clay-build waits on them.
  `e stop run` and `x` stop the run, and nothing is drawn after `x`.
- Two marks: A new `Mark` component. A wireframe icosahedron turns only while
  acting, and a stipple globe appears only on the done card. Both are layer
  keyframes, so they cost the app no CPU.
- Window chrome: This depends on `feat/window-chrome` (Departure Mono,
  black title strips, hard offset drop, halftone), which is not on main yet and
  lands as part of this work.

### Voice

`hud-listen` routes "find me N <who> in Clay", "build a list of <who>" and
"Clay, <request>" to `clay-build`. Anything the route cannot parse into a
sentence and a count asks one question on the pill instead of guessing.

## The run

| Step | What happens | Surface | Cost | Stops when |
| --- | --- | --- | --- | --- |
| 0 Check | One Clay tab, signed in. Balance read. No other run holds the lock | read | free | two Clay tabs, signed out, lock held |
| 1 Find People | Home, Find leads, People, Chat. Types the sentence and waits for "~N found" | ui | free | no count after `timeout_s`; N below the asked count asks first |
| 2 Count | Continue, custom N, destination table, Save | ui | free | the table URL never appears |
| 3 Test run | First approval card on Clay's "Save and run 10 rows" for Work email | approve, ui | spends | Not now, or no answer |
| 4 Read the test | Real spend from the balance; found rate from table-status | read | free | status still running after `timeout_s` |
| 5 The rest | Second approval card: "Test found 9 of 10 for 6.0 cr. The other 40 ≈ 24 cr", with Clay's own total | approve, ui | spends | Not now |
| 6 Done | Done card: people, work emails found, misses, credits spent, auto-run state | read | free | |

The test size is what Clay's enrich screen allows. On 2026-10-05 it offered
only "Save and run 10 rows". The standing rule in the registry is five rows per
live test, so if the dry run finds a way to save without running, the test
becomes five selected rows from the new table.

## States on the glass

| State | Cursor | On the page | Gutter | Strip |
| --- | --- | --- | --- | --- |
| Acting | on the element, glides about 300 ms between targets | bracket | note: step title, one sentence, what it will not do yet | ticks, verb, time, Stop |
| Approve | on Clay's own run control | bracket on that control | approval card: rows, cost (Clay's estimate), balance before and after. The first card offers Run the test and Not now; the second offers Run the rest and Not now | yellow pip, "waiting on you" |
| You took over | hidden | nothing | "Paused, you have the page", nothing spent, Resume re-reads the page first, End here | "paused", Resume |
| A step failed | hidden | red dashed bracket where the thing should be | what it expected, nothing spent, Try again (free steps only), Show me where, End here | red pip, "stopped at n/6" |
| Done | hidden | nothing | stipple globe, counts, spend, Show the misses (names of the rows with no email, from our own rows read), Close | green pip, rows and credits, Close |

Each approval verb has a muted line under it naming what it touches and whether
it can be undone, as in the mockup.

## Look

Taken from TypeSafe's site and Gavin's window chrome:

- Departure Mono for titles, chips and numbers. The system mono for sentences.
- Ink and paper only. Green, yellow and red appear only as full-strength tone, on what changed.
- Square corners, a black title strip, a 4 pt hard offset drop, and a halftone wash.
- Glass stays on the rim and the hyper bar. Content windows are opaque paper.
- Overlay windows look nothing like Clay's rounded light UI, so nobody tries to click an annotation thinking it is Clay ([NN/g instructional overlays](https://www.nngroup.com/articles/mobile-instructional-overlay/)).

Motion is budgeted by how often it is seen. A run is occasional, so it gets
standard motion:

- The mark turns while acting and stops otherwise.
- Windows swap with a fade under 150 ms.
- The done globe turns once, then rests.
- Under Reduce Motion, every movement becomes a cut and the marks stay still.

## Stop and takeover

- **Stop.** Two quick globe presses, Stop on the strip, or Not now on a card.
  All three halt at once. Esc is not offered, because the overlay never takes
  the keyboard. A press already sent to Clay finishes, and nothing new starts.
- **Takeover.** A trusted click, key or scroll in the Clay tab
  (`event.isTrusted`, from a listener the run installs) pauses the run on that
  frame. Switching away from the Clay tab pauses it too. Resume re-reads the
  page and continues only if it matches what the step expects.
- **Failure.** A step that misses its `expect` before `timeout_s` stops. A
  step whose `cost` is `spends` is never retried on its own.

## Hard lines

It never:

- starts a campaign or sends anything
- imports a file (the permission layer refuses it, and it is the person's step)
- edits, reruns or deletes anything it did not create in this run
- runs while table auto-run is on (it stops and asks)
- shows a credit figure that did not come from Clay

## Numbers still to measure

All are guessed until the dry run:

- every `timeout_s`
- the 300 ms cursor glide
- the toolbar height range that geometry accepts
- the gap between a note and its target, and the height kept for the hyper bar
- how long Clay takes to show "~N found"

Each gets the observation that set it, in a comment, once measured.

## Tests

- Recipe: a schema test (paid steps end on their one approval, known verbs, one expect each) and `node --test` on the finder.
- Geometry: unit test on recorded window and rect values, including zoom, a docked DevTools and a second display.
- Kyber: snapshot renders of the five states from the lines clay-build actually sends, through the existing `HUD_SNAPSHOT_DIR` path.
- Parser tests for `near=` and `tone=miss`; placement tests for the note and the bar lane.
- Runner: fakes for the page, Clay and Kyber drive every state, including stop, takeover, a short count and auto-run.
- Lock: a second `clay-build` refuses while the first is live and starts once it exits.
- Live: one `--dry-run` against the real tab, stopping at the first approval
  card. It spends nothing. Its timings replace the guesses above.

## Before building

- Gavin's working main has to catch up with Caleb's, since `chewbacca clay`
  and the tab board were only on Caleb's main on 2026-10-09.
- `feat/window-chrome` has to land, because every window here uses its chrome.
- The run needs exactly one signed-in Clay tab. The workspace it was designed
  against has about 100 data credits a month, and a real 50-row run costs about
  30, so the operator picks which workspace pays for the demo.

## Later

- Explain mode: hover a column, a button or a cost, and the same note explains it.
- "Next: pick a campaign" on the done card, which belongs to explain mode.
- Naming the filters Clay built on the Find People note, once a selector for them is recorded.
- An approval card on every Clay credit spend, whoever starts it (CHW-163).
- Reply handling, once something writes reply text into the graph.

Built with Chewbacca
