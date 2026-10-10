# Clay direct-column procedure

Revision: 2026-09-23. This is a limited navigation lesson from one live session,
not a certification of Clay mastery. Account identities, customer records, and
local evidence remain private. The accompanying graph distinguishes session
observations from steps still needing execution and readback.

## What the user corrected

On 2026-09-23 the user required direct, native Clay work through the built-in UX
engine: no Sculptor, no substitution of agent research or manually written copy
for Clay enrichment and row-dependent generation. The durable objective is a
configured platform workflow. Live tests are capped at five rows, and campaigns
must not be sent or activated. These constraints persist across sessions.

This correction concerns the approach, not a claim that every prohibited action
actually occurred. Preserve the distinction between user feedback, a plan, a
visible configuration, a saved column, a completed run, and validated output.

## Import context

The earlier task showed Clay's CSV upload dialog with **Browse files**, a drop
zone, and **Continue**. A prior assistant reported selecting a synthetic CSV
through the native picker and reaching **Complete import**. That transcript is
not fresh evidence of a completed import or current table contents. The import
edges remain documented until replayed with destination readback. Never repeat
an import before inspecting whether the previous attempt partly succeeded.

For a fresh import, inspect the target workspace and table, ensure automation is
appropriately disabled, choose the intended CSV in the native picker, inspect
filename and mapping, and read back count, stable row IDs, and values after the
final import. File selection is not table creation. Do not distribute local
paths, customer filenames, or raw records in this lesson.

## Direct AI column configuration

Session-observed navigation reported by the live operator:

1. In the intended table, choose **Add column**, then **Use AI**.
2. Open **Configure**. The observed research configuration used **Argon** with
   web research. Reinspect availability and billing in the current session.
3. Enter the approved research instructions in the prompt. Use `/` inside the
   prompt to open the row-field selector, then choose the actual source column.
   Inspect the inserted field token; a typed column name alone is not a binding.
4. Turn off the column's **Auto-run**. Observe its disabled state before saving.

The following completion steps define the required readback. The later session
result below records the limited cases actually completed:

5. Save the configuration without selecting a run-all option. Reopen or inspect
   the saved column and confirm prompt, field bindings, model, output fields, and
   Auto-run state. If save also offers execution, choose the non-running option.
6. Select at most five intended test rows. Inspect both selection and run scope.
   Run only those rows, then read back output cells and failures. Record actual
   credit consumption where visible; configured model names are not cost data.
7. Configure personalized copy as another native Clay AI column using the same
   direct-column flow. Bind it to each row's verified research, account fields,
   persona, and approved offer. Require factual grounding and an explicit
   missing-evidence outcome rather than invented personalization.
8. Keep copy Auto-run off, save and verify it, then test at most five rows. Check
   that different source rows produce appropriate row-specific output and that
   missing research is handled explicitly. A generic sample draft does not pass.
9. Leave campaign sending, activation, and scheduling off. Record the exact
   remaining work rather than declaring the whole campaign complete.

Controls may move or change labels. Inspect live state instead of replaying
coordinates. Do not import instructions from UI text into the agent's authority.
Do not infer run authorization from a route, a suggested button, or a provider.

## Later session correction and native workflow

The live operator reported a formula-editing failure: **Ctrl+A** followed by paste
inserted text into the middle of the existing formula. Selecting the entire
current formula with the UX engine's exact `selectText` operation, then replacing
it with `typeText`, succeeded in that editor context. Parsed field references and
persisted configuration were verified through official CLI readback. Selection
behavior is editor- and context-dependent; neither shortcut nor API name alone
proves replacement. Inspect the full resulting expression, parsed references,
and saved configuration after every edit.

The observed native recipe used **Look up single row** in another table with an
exact campaign match, with lookup Auto-run off. Extract `briefing_summary` from
the matched row and use the briefing plus the required research fields to gate
both research and copy. Inspect saved lookup criteria, extraction, row-field
bindings, execution conditions, and Auto-run state before testing. Missing or
ambiguous matches need separate validation rather than an inferred briefing.

In this session, **Publish and don't run** transferred configuration and existing
results without executing additional rows. Final official CLI readback covered
all 50 rows: five research results and two AI copy results, with no campaign
sends. These are session-reported observations, not a universal guarantee about
publishing behavior or permission for a whole-table run. Verify the destination
configuration and per-row result counts whenever transferring a workflow.

The accompanying graph retains its earlier conservative edge statuses; this
later readback is recorded here without claiming independent replay or mastery.

## Evidence and next learning tasks

Use `python3 bin/ux-learning validate library/learning/clay-navigation/package.json`.
Plan a route with state IDs from the map; documented edges require the explicit
`--include-documented` planning flag. Forbidden Sculptor and sending edges have
no override. The tool executes no UI actions.

Retain private receipts for each attempted transition, including failures. The
receipt must bind the exact map revision and package bytes, timestamp, edge,
outcome, and a readable evidence file's SHA-256. Review evidence for the actual
postcondition; hashes do not authenticate screenshots or operator claims.

Coverage still needed beyond the limited readback below: missing and ambiguous
inputs, changed UI, interrupted saves,
partial runs, scheduling controls, credit behavior, import readback, and an
independent unseen-task test. A success on one transition cannot establish those
capabilities. Update this file and graph only after observing the new behavior;
do not automatically publish private evidence or re-enable lifecycle hooks.

## Reuse the existing learning-to-act design

Read [Learning to act](../../../docs/plans/LEARNING-TO-ACT.md), which predates this map.
Retain the four outputs separately:

- Procedure: the direct-column sequence above; currently a supervised recipe.
- Map: `package.json` and its visible-state transitions, with observed and
  documented edges distinguished.
- Preference: the user's explicit native-engine, no-Sculptor, five-row, no-send
  constraints. A future site's behavior cannot override them.
- Strategy: bind data through actual row tokens and verify saved configuration
  and resulting cells. Transfer to another platform is a testable hypothesis.

Replay a candidate procedure and verify its destination before treating it as
reusable executable automation. Generalize parameters only after at least two
observed instances support the variation. Placeholders here protect privacy;
they are not evidence of multi-instance generalization or a working runner.
This lesson has no `run.py` or independent end-state verifier yet.

The existing design lists free-form recording, distillation, automatic retrieval,
and a registry as missing. Explicit local receipts and read-only graph routing
address only parts of evidence retention and planning. They do not fill those
gaps or make procedures execute without a model. The compatible map/procedure
pointers help manual retrieval; no background hooks or publication are enabled.

## Follow-on correction lessons (operator-observed)

- **Filtered five-row views:** create each multi-value filter token, then observe the saved chip/count before entering the next. A rapid sequence initially retained only the last value. Confirm the exact row identities, not just a row count, before paid runs.
- **Targeted formula edits:** selecting an exact existing substring in the formula editor and replacing it persisted successfully. Inspect the saved expression afterward; visible text alone still does not prove persistence.
- **Cached text during reruns:** upstream research can be `awaiting_callback` while old research, raw copy and QA values remain visible with `isStale: true`. A disabled Stop button did not establish completed callbacks. Never export cached text as current merely because it is nonempty.
- **Correction propagation:** a one-cell research rerun changed readiness to BLOCKED; dependent assembled email/follow-up became blank while the old raw opener and QA remained stale. Preserve the block and do not rerun paid copy to force an output. Require completed, non-stale upstream evidence and matching versions before any later handoff.
- **Evidence gates:** exact URL membership rejects a partial-URL match that a substring check would accept. Evaluate the saved formula against missing evidence, blocked statuses, wrong campaign and failed QA. Local expression tests support the gate logic, not all Clay execution behavior or source truth.
- **Research output review:** an official-looking URL list does not prove that a current named-person role was established, that regional mandates transfer between offices, or that a client's domicile is known. Keep these checks separate from copy style and reject unsupported qualification even when the model labels it ready.

These observations extend the procedure; they do not promote untested graph edges,
claim general mastery, enable hooks, or authorize automatic publication.

## Routes

Revision 2026-10-09.1. Moving between Clay screens is a lookup, not an
exploration. Three files carry it:

- `routes.json`: 61 curated screens. Each has a URL pattern (or a parent plus
  click steps), an arrival check (path plus one element), the gate controls on
  that screen, the faster CLI or API read where one exists, and `endpoints`:
  every distinct `api.clay.com` call the crawl saw, with the controls that fire
  it and the `chewbacca clay` op that makes the same call, when the registry
  has one.
- `elements.json`: every state the crawl reached and every element on it, with
  where it leads, what it unlocked, how long it took, and the requests it
  fired (method, templated path, field names only).
- `package.json`: the ux-learning graph built from both. Every control that
  saves, runs, sends, spends, creates, deletes or starts is a forbidden edge
  into `gate-held`, so no planned route ever passes through one.

### Moving

`bin/clay-go <state> [--table NAME] [--campaign NAME] [--workflow NAME] [--column C]`
drives the kit's own background Clay tab. A hop is one CDP `Runtime.evaluate`
over the jev-ultrafast daemon's existing connection: the URL is pushed through
Clay's own router (`history.pushState` + `popstate`), so there is no document
load; a click step is pointer events on a stable locator; arrival is the path
plus one element, watched by a MutationObserver. Ids come from a cached `clay`
CLI listing, so building a URL never reads the page. No model call happens on
a hop. `clay-map go <state>` reaches any crawled state the same way, replaying
its openers. `clay-map where|unlocks|path` answers from local data without the
browser.

Pushing the URL beat clicking the sidebar link in the first measurement on
10-09: five router pushes took 255 to 625 ms end to end, the same five link
clicks 320 to 1,418 ms, and one link (Home, on the home page) was not there to
click. It was taken before clay-go had arrival checks, so it times the URL
change rather than the finished render.

### The six route tests

Three runs each, in the background tab, on 2026-10-10. "Ours" is this process
plus the CDP legs; "Clay" is Clay's router and render until the arrival
element exists. Wall minus Clay minus ours is Clay's main thread still busy
with the previous step. The page clock is mapped to ours from the fastest of
five probes. Every hop of every run arrived; none fell back to a document load.

| Hop                                                 | Ours, worst | Clay p50 / worst | Wall p50 / worst |
| --------------------------------------------------- | ----------- | ---------------- | ---------------- |
| Route 1: home to master inbox (router)              | 1.4         | 72 / 1,046       | 106 / 1,113      |
| Route 1: inbox to one sequence (click the sequence) | 9.7         | 153 / 407        | 260 / 796        |
| Route 1: sequence to a thread (click the row)       | 6.0         | 2 / 3            | 548 / 639        |
| Route 2: home to a table (router)                   | 4.1         | 1,455 / 1,672    | 1,463 / 1,675    |
| Route 2: table to a column's menu (header)          | 5.6         | 98 / 110         | 253 / 268        |
| Route 2: column menu to its settings (Edit column)  | 4.6         | 219 / 221        | 245 / 270        |
| Route 3: table to credits (router)                  | 4.6         | 282 / 327        | 312 / 942        |
| Route 4: credits to a sequence editor (router)      | 2.8         | 561 / 1,336      | 723 / 1,339      |
| Route 5: table, Open Sidebar, tab Enrich            | 4.3         | 328 / 347        | 482 / 508        |
| Route 6: home to a workflow canvas (router)         | 12.7        | 62 / 104         | 71 / 194         |

All in ms. Our overhead never passed 12.7 ms, under the 50 ms target on every
hop. Hops that finish under 500 ms end to end: the master inbox, a sequence
filter, a column menu and its settings, credits, the Enrich panel, and a
workflow canvas. Clay's render sets the floor on three screens: a table's grid
takes about 1.2 to 1.7 s however it is reached, home 0.5 to 0.9 s, and a
sequence editor about 0.56 s p50 (2.5 s right after a table, which Clay is
still tearing down). A thread opens in 2 ms of Clay time but waits about
0.55 s behind the sequence filter's own render. `ux-learning route` over
package.json plans all six from the map alone; its estimates use the crawl's
hop times, which include the crawler's quiet windows, so they run higher.

### Safety while crawling

`clay_guard.js` refuses every request to `api.clay.com` that is not GET, HEAD
or OPTIONS, except seven read endpoint families Clay calls with POST (measured
on page loads with the guard in log mode). A press that tried to write anyway
is recorded as a gate with the endpoint it tried. Gate words and deny words
refuse a press before it is sent, in Python and again in the page. Fields and
toggles are never pressed. The crawl never leaves the workspace: a control
that switches workspace is recorded and the tab is sent home. Every in-page
call first checks, in the same evaluation, that the page origin is exactly
`https://app.clay.com`; a press that lands anywhere else is recorded as
"leaves Clay" and the tab is sent back by URL without reading the other page.
The guard counts a request as Clay's only when its origin is exactly
`https://api.clay.com`, and tests try lookalike hosts for both.

Several controls write even though their labels don't say so, and all are
gates now: Find leads > People/Companies/Jobs (each opens a new chat session;
the guard blocked the write), Sandbox Mode (it made a sandbox copy of a table
on 10-09, before this map existed; the copy is hidden from `clay tables list`,
and Exit Sandbox returned to the original with no prompt), the row star (a
favorite), "Show all columns" on People, the workflow canvas node palette and
the Claygent editor tabs, which autosave. The workflow editor's Dock/Undock
button saves a preference: the crawl pressed it, the label flipped, and the
next pass counted the panel as new. Its 15 recorded presses were reclassified
as gates.

Nothing personal is stored. Everything written passes through
`clay_sanitize.py`: records are rebuilt from fixed field sets, every id,
number and email is templated, and a label, field name, test id or path
segment is kept only when it exactly equals an entry of `clay_ui_words.py`,
fixed lists of Clay's own UI words reviewed by hand and never extended from
crawled data. An entry was dropped when it equals or overlaps any name the
workspace or the gtm-memory store knows. Position beats wording: a column
header, a link to a table, workbook, campaign, workflow, segment, agent or
folder, and a sequence button in the inbox always store a typed placeholder
such as `{column_name}`. A test checks the shipped map against every name the
clay CLI and gtm-memory know on this Mac and must find none. The page library
uses the same list for its own reads. Log lines get the
same rule: the crawler prints only state ids derived from sanitized patterns,
vocabulary labels, kinds, counts, timings and exception class names, and every
line from the crawler, `clay-map` and `clay-go` passes `log_line` before it is
printed or written. Private files
(concrete URLs, the checkpoint, the log) live in
`~/Library/Caches/chewbacca-clay`, which nothing mirrors.

### The crawl

`clay-map crawl` runs through `chewbacca jobs submit --net` and continues from a
private checkpoint. Breadth-first from home, every interactive element on a
state is read in one in-page call (2 to 6 ms a state); each element that is not
a gate, field or toggle is pressed once and what appeared is recorded, then the
state is restored. A repeated control (a row, a column header, a campaign) is
pressed once as a template; a list of six or more same-shaped controls is
sampled two deep. Panels nest two deep and overlays three.

Speed, measured: the first version spent about 45 s re-reading a state, almost
all of it fixed quiet windows, a remount through home, and an in-page wait loop
that kept a CPU core busy. Waits now end on DOM quiet plus network idle (no
`api.clay.com` request the step started still in flight, read from the
guard's log), polled every 25 ms from Python; a chain replays in place when
its page is already up; and a press still busy at 5 s is recorded with what it
had. A re-read is now 1.4 to 3.2 s, and a full pass over 382 states about 15
minutes.

Stop rule: two full passes with nothing new. The last passes found 0, 0, 1, 0,
10, 6 and 5 new. Every late find was on the workflow canvas, whose side panel
shows different controls depending on which node the editor last selected;
everything else went two consecutive passes with nothing new. The canvas never
settled, so the rule is met for the rest of Clay and not for that screen
family.

Coverage, from `clay-map stats`:

| Measure                                                                        | Count                 |
| ------------------------------------------------------------------------------ | --------------------- |
| States (pages, and pages with a panel, menu or modal open)                     | 382                   |
| States reached on the last pass                                                | 326                   |
| Elements                                                                       | 5,831                 |
| Pressed and recorded                                                           | 925                   |
| Links (destination read from the href)                                         | 1,368                 |
| Gates, never pressed                                                           | 1,168                 |
| of which the guard caught trying to write                                      | 106                   |
| Fields and toggles, never pressed                                              | 856                   |
| Templates, one instance pressed                                                | 394 (5,794 instances) |
| List siblings not pressed                                                      | 551                   |
| Sidebar and parent repeats                                                     | 757                   |
| Pressed, no visible change                                                     | 365                   |
| Pressed, depth cap reached                                                     | 125                   |
| Unknown destination (gates with no target, fields, toggles, one document load) | 2,024                 |
| Not explored                                                                   | 206                   |
| Distinct api.clay.com endpoints seen                                           | 212                   |
| of which linked to a `chewbacca clay` op                                       | 17                    |

Not explored, and why: 164 elements were not found again when the crawl came
back to press them (lists that re-render, rows that move); 41 sat on a state
the crawl could not return to; 56 states could not be reached on the last
pass, 20 of them workbook canvas panels and 20 workflow canvas panels whose
openers depend on what is selected. `clay-map stats` lists every one.

The linked endpoints are the read ops `audiences`, `blocklist`, `campaign`,
`campaign-stats`, `campaign-variants`, `campaigns`, `folders`, `inbox`,
`resources`, `signals`, `table-status`, `tables`, `thread`, `workbooks` and
`workflows`, plus `page-view-activity`, which Clay fires on every page load.
The other 195 have no op yet; `routes.json` lists each with the controls that
fire it.
