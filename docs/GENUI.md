# Generated surfaces on the HUD

`bin/kyber-genui` draws a panel for a request nobody built a panel for. The
fixed surfaces cover the questions somebody thought of in advance: what is
overdue, what is due soon, the week, who you owe a message. Anything else used
to get a sentence on the pill. Now it gets a layout a model composed from the
HUD's own components, filled with data the model never saw.

```
kyber-genui "compare my three classes' grades"          draws it on the HUD
kyber-genui "plan my Tuesday" --dry-run                  prints the ops instead
kyber-genui "what's due before my midterm" --pin exam    keeps the layout as a preset
kyber-genui preset exam                                  redraws it, fresh data, no model
kyber-genui fixed week --at topLeft                      draws a fixed exemplar layout
kyber-genui validate layout.kl                           checks lines as a generated surface
kyber-genui catalog --check                              catalog vs hud/CLAUDE.md vs renderer
kyber-genui queries                                      what the model may bind to
kyber-genui event genui-refresh s                        a press on a generated surface
kyber-genui bench [--only 1,5] [--out results.json]      the frozen 20-request eval
```

## What the field says separates useful generative UI from slop

Researched 2026-10-04 before building. The sources agree more than they
differ, and each rule below is one at least two of them state outright.

1. **A closed component catalog, and the model only picks from it.** A2UI's
   client keeps "a catalog of trusted, pre-approved UI components" and "the
   agent can only request to render components from that catalog." Vercel's
   json-render calls the result "constrained to components you define." OpenUI
   (Thesys C1's open successor) says "You define the components. The model
   decides how to combine them." Generating HTML instead is what Google's
   Generative UI does, and its own paper needed nine post-processors to repair
   it, including "JavaScript error detection/fixing" and "hallucinated asset
   removal."
2. **Data is bound by reference, never pasted into the layout.** A2UI
   "separates UI structure from application state": components bind JSON
   Pointer paths like `/user/name` and data arrives in its own
   `updateDataModel` message. json-render's `{"$state": "/state/key"}` and the
   Vercel AI SDK's tool-result-into-component pattern are the same idea. Here it
   matters twice over: a number the model typed is a number nobody read, and a
   model that never sees a message body cannot be steered by one.
3. **Actions come from an allowlist.** json-render: "Only declared actions are
   available to the model." A2UI routes a press as a named event with a context
   of data paths, not code. On this display an unknown Button action is worse
   than useless: `bin/hud-listen` hands any unrecognised `e <action>` to the
   answering agent, which has Bash.
4. **Stream the skeleton first.** A2UI: rendering "can begin once `root`
   component exists, with placeholders for missing data." AI SDK RSC's
   `streamUI` yields a loading component before the data, and OpenUI's
   "Renderer draws each component as its line arrives." hud/CLAUDE.md already
   says it for this display: send `r` as soon as the Screen exists.
5. **Validate before render, and hand the errors back.** A2UI describes a
   "Prompt, Generate, Validate" loop and a standard error with a path and a
   message ("Expected stringOrPath, got integer"). json-render validates each
   streamed chunk before rendering it. OpenUI ships "Autofix for repairing
   invalid output."
6. **Measure against a baseline, and count speed.** Google's PAGEN evaluation
   rated generated pages against expert-built sites, markdown and plain text by
   ELO (expert 1800, generative UI 1736, markdown 1438, text 1174) and was
   preferred over markdown 82.8% of the time, but it did so with "generation
   speed excluded," and its own stated limit is "often taking a minute or two."
   A heads-up display is glanced at, so latency is part of the score here, and
   the baseline is the fixed surface that already answers the nearest question.

Sources:

- [Google Research, Generative UI blog post (2025)](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)
- [Generative UI: LLMs are Effective UI Generators, arXiv 2604.09577](https://arxiv.org/html/2604.09577)
- [A2UI v0.9 specification](https://a2ui.org/specification/v0.9-a2ui/) and [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui)
- [AG-UI events](https://docs.ag-ui.com/concepts/events): `STATE_SNAPSHOT` replaces, `STATE_DELTA` is an RFC 6902 patch, tool calls stream as start, args, end
- [Vercel AI SDK, generative user interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces), and [AI SDK RSC streamUI](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components), which the page itself marks "currently experimental"
- [vercel-labs/json-render](https://github.com/vercel-labs/json-render)
- [OpenUI docs](https://www.openui.com/docs) (docs.thesys.dev now redirects there)

Coverage gap: the Google paper was read as its HTML version and summary, not
every appendix; AG-UI and C1 were read from their docs, not their code.

## How each rule is enforced here

| Rule                   | Where                                                                       | What it refuses                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Closed catalog         | `genui/catalog.json`, `check_component`                                     | an unknown component or prop, with the nearest real name                                                                                                                                                           |
| Catalog cannot drift   | `catalog_drift`, `kyber-genui catalog --check`, `tests/test_kyber_genui.py` | a component or prop in `hud/CLAUDE.md` or read by `SurfaceView.swift` that the catalog lacks, and the reverse                                                                                                      |
| Data by reference      | `check_literal`, `check_pointer`                                            | a literal on any data prop (`Metric.value`, `Table.rows`, `Events.items`, `Bars.rows`, `List.items`, `Sparkline.points`, `Ring.value`); a pointer to an unknown query, view or argument; a `d` line from the model |
| Actions allowlisted    | `genui/policy.json` `actions`                                               | any Button action but `genui-refresh` and `genui-close`                                                                                                                                                            |
| Skeleton first         | `generate`                                                                  | nothing: `- genui`, `@`, a Screen titled from the request, a "Building this view" line and `r s` go out before the model starts                                                                                    |
| Validate before render | `check_line` while streaming, `check_structure` at the end                  | a bad line never reaches the socket; orphans, missing children, too many rows or buttons fail the surface                                                                                                          |
| Repair, then fall back | `generate`                                                                  | one repair with the exact error list, then a Status panel that says no view was built and why                                                                                                                      |
| Baseline               | `kyber-genui bench`, `kyber-genui fixed`                                    | (measurement, below)                                                                                                                                                                                               |

The model runs as Claude Code with `--setting-sources local`, `--tools ""`, an
empty MCP config, `--no-session-persistence` and the generated system prompt,
from the home directory. That is `bin/hud-listen`'s lean profile minus Bash:
no session-briefing hooks, and no tools at all, because a layout needs none
and a model that cannot act cannot act on anything it was shown. The model is
the one in `~/.claude/settings.json` unless `GENUI_MODEL` says otherwise;
`GENUI_MODEL_CMD` (or `BOB_MODEL_CMD`) swaps the command, and a non-Claude
command gets the system prompt and request on stdin and answers on stdout.

## The query vocabulary

The model binds `@/q/<query>/<view>` or `@/q/<query>:<arg>/<view>`. The
resolver runs the query the moment a valid line names it, in parallel with the
rest of the stream, and sends one `d /q/<query:arg> {...}` holding every view.

| Query         | Source                                                             | Argument                      |
| ------------- | ------------------------------------------------------------------ | ----------------------------- |
| `due`         | `coursework due --json`                                            | days ahead, default 14        |
| `overdue`     | `coursework due --json`                                            | none                          |
| `exams`       | `coursework due --days 90`, filtered to exam, midterm, final, test | days                          |
| `before-exam` | the next exam first, then everything due before it                 | optional course code          |
| `course`      | one course's deadlines                                             | course code, no spaces        |
| `grades`      | `coursework grade --json`, plus an `average` value                 | none                          |
| `week`        | `coursework week --json` plus `mac calendar list --json`           | days, default 7               |
| `day`         | the same, one day                                                  | today, tomorrow, or a weekday |
| `calendar`    | `mac calendar list --json`                                         | days                          |
| `reconnect`   | `people reconnect`                                                 | how many                      |
| `tasks`       | `people tasks`                                                     | none                          |
| `unreplied`   | **no source yet**: the graph provider registers it                 | days                          |
| `campaign`    | **no source yet**: the graph provider registers it                 | name                          |

Views: `rows` (Table), `events` (Events), `list` (List), `bars` (Bars),
`count` (Metric), `series` (Sparkline), `note` (Text or Status: why it is
empty), plus any named value a query declares. Rows are capped per view
(`genui/policy.json` `row_caps`), `count` is the uncapped total, and `more` is
what the cap hid. A query that comes back empty or fails adds a Status line
under the panel with its note, so an empty panel always says why. Every string
a query returns has control characters stripped and is cut to 90 characters.

`GENUI_FIXTURES=<dir>` answers each query from `<dir>/<query>_<arg>.json` or
`<dir>/<query>.json` instead of running it, for tests and reproducible runs.

## Untrusted content

Message bodies, mail, calendar titles and notes are somebody else's text. Here
they only ever travel as JSON inside a `d` line, which the display renders as a
string. They never enter the model's prompt, because the model never sees data
at all, so an instruction inside one has nothing to talk to. The layout the
model writes is validated against the action allowlist before it is drawn, so
even a model that was somehow told to add `action=send-all` is refused.
`test_message_content_never_becomes_an_action` plants exactly that string in a
deadline's name and checks it reaches the glass only as data.

## Limits, and why each is this number

All in `genui/policy.json`.

- **9 rows per component, 6 per Events.** Miller's 7 plus or minus 2, already
  the house list limit in CLAUDE.md's UX check. Events is 6 because
  `bin/hud-watch` caps its overdue panel at 6 and that panel is the one people
  already read. Guessed for this display, never measured on it.
- **12 rows per surface.** In a screenshot on 2026-10-04 the "before the
  midterm" panel (a Metric and a 6-row Events) was about 350 points tall on a
  982-point screen, roughly 45 points a two-line row. Twelve such rows is about
  600 points, which still clears the menu bar and the pill. Half measured: one
  panel, one screen size. The rule refused 3 of 20 first attempts in the final bench,
  each one a second bound list, and every repair fixed it.
- **14 components, 2 Buttons, 1 primary, 2 Text, 140 characters a Text.** One
  primary is the Von Restorff rule in CLAUDE.md. 140 characters is the pill's
  limit in hud/CLAUDE.md, and prose longer than the pill on a panel is prose
  nobody reads. 14 and 2 are guessed, never measured.
- **Title 32 characters.** The Screen title is 13-point caps on a 400-point
  card. "DUE IN TWO WEEKS, BY CLASS" (26) fit on one line in the bench; 32 is
  that plus margin, guessed.
- **No File.** An editable File writes to disk on save, and a generated path
  is a path nobody chose.
- **80 characters for any other string** (captions, Status, Heading). Same
  reason as the Text limit; 80 is guessed.
- **Reserved ids: `sk`, `fb`, `qn0`, `qn1`, ...** are kyber-genui's skeleton,
  fallback and empty-state lines. A model that used `qn0` had its Metric
  replaced by a note (found in review, 2026-10-04).

## Known gaps

- **Literal prose can still carry a number.** `Text value="You have 3
  overdue"` validates. Refusing numerals in prose would also refuse "Due in 7
  days" and "BISC 101"; the prompt forbids it and the bench layouts did not do
  it, but nothing enforces it.
- **The validator checks shape, not relevance.** #20 in the bench bound a
  campaign query to a note-taking panel.
- **The drift check reads Swift with regexes.** It attributes reads to
  `case "X":` labels; a read in a `default:` branch counts for no type, and an
  inner switch's labels count as drawn types.

## Presets

`--pin NAME` stores the layout, never the data, in
`~/.bob/genui/presets/NAME.json`. `kyber-genui preset NAME` validates it again
and redraws it with fresh query results and no model call, so a generated
surface that proved useful becomes a fixed one for the cost of one word.
Presets are personal and live outside the repo.

## Integration: what the surfaces agent wires (bin/hud-listen, bin/hud-agent.md, surfaces/)

kyber-genui owns none of these files. These are the exact steps.

1. **Route to it from the voice path.** In `bin/hud-listen`, after the fixed
   surface router declines a request and before the request goes to the
   answering agent, run
   `kyber-genui "<request>" --json` (the surface name defaults to `genui`;
   pass `--surface <name>` to keep two). Exit 0 means a valid surface is on the
   glass; exit 2 means it fell back to a status panel, and the agent should
   still answer in words. Parse the JSON on stderr for `first_component_ms` and
   `complete_ms` if the turn log wants them. Run it in a thread: it paints its
   skeleton in under a millisecond and takes 3 to 8 seconds to finish.
2. **Give the answering agent the same door.** Add one line to
   `bin/hud-agent.md`: when no fixed surface fits and the answer is a shape,
   run `kyber-genui "<their words>"` instead of hand-writing Kyber Lines, and
   say one line pointing at the panel. The agent keeps its Bash and its
   judgment; kyber-genui keeps the catalog, the data binding and the allowlist.
3. **Handle its two actions.** In `bin/hud-listen`'s `e ` branch, before the
   generic "The user pressed ..." fallback, add:
   `elif action.startswith("genui-"): run kyber-genui event <action> <component> --surface <surface=>`
   and do not ask the model. The display now sends `surface=` with every
   control; pass it through so Refresh redraws the panel that was pressed,
   from that surface's last valid layout in `~/.bob/genui/layout-<surface>.json`.
   Without this branch, a press on Refresh becomes a model turn.
4. **Register the graph walks as queries.** Write `surfaces/genui-queries.json`
   (or point `GENUI_QUERIES` at any path list):

   ```json
   {
     "queries": [
       {
         "name": "unreplied",
         "description": "message threads where they wrote last and nobody answered, oldest first",
         "fields": ["who", "waiting", "channel", "last"],
         "views": ["rows", "events", "list", "bars", "count", "note"],
         "arg": {
           "kind": "int",
           "default": 7,
           "min": 1,
           "max": 60,
           "help": "days back"
         },
         "argv": [
           "kyber-surfaces",
           "walk",
           "unreplied",
           "--days",
           "{arg}",
           "--json"
         ]
       }
     ]
   }
   ```

   The command runs with no shell, `{arg}` substituted as one argv element, and
   must print `{"rows": [...], "note": "..."}`; optional `count`, `series`,
   `ratio` and `scalars`. A registered name replaces the built-in stub, so
   `unreplied` and `campaign` light up the day this file exists. Keep `last` to
   a timestamp or a sender, never a message body: rows reach the glass, and a
   body has no business on a panel somebody else can see over a shoulder.
   Events are built from `time`/`date`/`waiting` plus `what`/`task`/`name`/`who`;
   bars from `label`/`value`/`display` when the provider returns them under a
   `bars` key, else counted by the first of `course` or `day`.

5. **Fixed surfaces on the same pointers.** A fixed surface in `surfaces/`
   written with `@/q/...` pointers passes `kyber-genui validate <file>`, and
   saved as `{"lines": [...]}` in `~/.bob/genui/presets/<name>.json` it draws
   with `kyber-genui preset <name>`, fresh data and no model. Using the same
   pointers keeps a fixed surface and a generated one comparable in the bench.
6. **Row buttons.** Events, List and Table take `action=` for a button on every
   row (`e action <name> row=<id> surface=<surface>`). A generated surface may
   use one only after the same manifest names it, as
   `"row_actions": {"reply": "kyber-surfaces opens the thread"}`. Until then the
   validator refuses `action=` on rows and the prompt does not mention it.
   Rail, Segmented and Avatar stay out of generated surfaces; the reasons are
   in `genui/policy.json`.
7. **The lean profile still loads auto-memory.** `--setting-sources local`
   does not stop it: the same one-line question cost 8,319 prompt tokens with
   it and 615 with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (measured 2026-10-04).
   kyber-genui sets it. Whether `bin/hud-listen` should is that agent's call,
   since its answers use the brain on purpose.

## Integration: what the HUD agent should know (hud/Sources, hud/CLAUDE.md)

- **`bind=` on Field, Select and Checkbox draws a disabled control.**
  hud/CLAUDE.md shows `c n Field label="Note" bind=/draft/note`, but
  `SurfaceView.swift` reads `store.binding(element, "value")` and nothing reads
  a `bind` prop, so that exact example parses, draws, and cannot be typed into.
  The working form is `value=@/draft/note`. The catalog marks `bind` as
  `renderer: false` and the validator refuses it with that fix. Either the
  renderer should accept `bind`, or the generated reference (and its source,
  bob-the-builder's `src/hud/catalog.ts`) should show `value=@/...`.
- `kyber-genui catalog --check` compares the generated block in hud/CLAUDE.md
  and every `p["..."]` the renderer reads against `genui/catalog.json`. Run it
  after adding a component or a prop; it fails until the catalog has it.

## Measured

`kyber-genui bench`, 2026-10-04, the 20 frozen requests in
`genui/bench/requests.json`, Claude Code 2.1.278 with the model in the
person's settings (Opus 5.5), auto-memory off, live ledger data, `--dry-run`
sink so the socket is not in the timing. One run per request. Raw rows,
including every layout the model wrote, are in
`genui/bench/results-2026-10-04.json`. This is the third full run; the first
two (16/20 and 15/20 first try, both 20/20 after repair) used an earlier
validator and had auto-memory on, and are not the numbers below.

| | Result |
| --- | --- |
| Valid on the first try | **14 of 20** |
| Valid after one repair | **19 of 20** |
| Fell back to a status panel | 1 of 20 (#3) |
| Skeleton on the glass | 0.6 ms worst case, before the model is asked |
| First model component, median | 3,194 ms (range 2,347 to 6,084; none for #3) |
| Complete with data, median | 4,367 ms (range 3,202 to 99,249) |
| Complete, first-try valid only, median | 3,743 ms |
| Complete, repaired, median | 8,964 ms |

| # | Request | First try | After repair | First component ms | Complete ms | Queries bound | Why the first try was refused |
|---|---|---|---|---|---|---|---|
| 1 | compare my three classes' grades | no | yes | 3197 | 8273 | grades | the surface shows up to 18 rows; at most 12. Drop a list or bind a count instead |
| 2 | who have I not texted back this week | no | yes | 2848 | 8447 | unreplied:7 | line 1: only c, > and @ lines belong in a layout, not 's' |
| 3 | show my client's outbound campaign numbers | no | no | none | 16921 | none | line 3: campaign needs an argument: campaign or client name |
| 4 | plan my Tuesday | yes | yes | 2491 | 4021 | day:Tuesday, overdue |  |
| 5 | what's due before my midterm | yes | yes | 2347 | 3411 | before-exam |  |
| 6 | what's due this week | yes | yes | 2546 | 3798 | due:7, overdue |  |
| 7 | am I behind on anything | yes | yes | 3347 | 4655 | overdue, unreplied |  |
| 8 | how busy is my week, day by day | yes | yes | 2863 | 4418 | overdue, week:7 |  |
| 9 | who should I reach out to | no | yes | 2867 | 7533 | reconnect, unreplied | the surface shows up to 15 rows; at most 12. Drop a list or bind a count instead |
| 10 | what promises have I made to people | yes | yes | 3277 | 3323 | tasks |  |
| 11 | when are my exams | yes | yes | 2856 | 3245 | exams:90 |  |
| 12 | what do I have tomorrow | yes | yes | 3774 | 4316 | day:tomorrow |  |
| 13 | how does the HUD get data from a query onto the screen | yes | yes | 4338 | 5533 | none |  |
| 14 | show my BISC 101 deadlines | yes | yes | 3078 | 3687 | course:BISC101 |  |
| 15 | what's on my calendar this week | yes | yes | 3116 | 3202 | calendar:7 |  |
| 16 | how many things are due in the next two weeks, by class | yes | yes | 3194 | 3644 | due:14 |  |
| 17 | what's the plan for today | yes | yes | 3485 | 3608 | day:today |  |
| 18 | show me everything I owe anyone, school and people | no | yes | 6084 | 99249 | due:7, overdue, tasks, unreplied | line 9: Heading.level=3 must be between 1 and 2 |
| 19 | which class has the most work coming up | no | yes | 4128 | 9481 | due:14 | the surface shows up to 18 rows; at most 12. Drop a list or bind a count instead |
| 20 | give me a spot to jot a note about the Amber pitch | yes | yes | 5349 | 5730 | campaign:Amber |  |

What the failures say:

- **Three of six first-try refusals are the row budget**: a second bound list
  on one panel. Every repair fixed it by turning a list into a count. The
  others: a stray `s` (pill) line, `Heading level=3` with two undeclared
  children, and #3.
- **#3 fell back, correctly.** "My client's" names no client and `campaign`
  needs one, so the panel said it had no view. In an earlier run with
  auto-memory on, the same request bound a real client name out of the
  person's memory index, which is why memory is off.
- **#18 took 99 s.** The repair call itself took about 93 s; in the previous
  run the same request finished in 17.9 s and one request there took 34.7 s
  to its first component. Model latency has a long tail and one sample per
  request is too few to say more.
- **#20 bound `campaign:Amber` to a note field's panel.** Valid, and wrong:
  the validator checks shape, not relevance.

### Side by side with the nearest fixed surface

Eight requests drawn live at top right, with the nearest fixed layout
(`kyber-genui fixed <name>`, same queries, same data) at top left, captured
with `peekaboo image --mode screen` and closed after each. This pass ran
before the em dash rule and the memory switch, so its layouts differ from the
table above. The screenshots show the person's screen and stay out of the repo.

| #   | Request                          | Fixed                                        | Verdict from the screenshot                                                                                                                   |
| --- | -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | compare my three classes' grades | grades (an exemplar, not a shipping surface) | Fixed is cleaner. Generated added a Left column and a Bars over nothing, because no course is graded yet; the empty-view note now covers that |
| 4   | plan my Tuesday                  | week                                         | Generated answers the question: Tuesday only, with counts. The fixed week panel shows Monday first. Fixed panel did not paint in this capture |
| 5   | what's due before my midterm     | due-soon                                     | Generated is better: the exam (Oct 20) first and the 12 items before it. Due-soon shows two days and misses the exam entirely                 |
| 6   | what's due this week             | due-soon                                     | Tie. The same three deadlines plus two counts                                                                                                 |
| 7   | am I behind on anything          | overdue                                      | Tie. Both say nothing is overdue; generated adds due in 7 days                                                                                |
| 8   | how busy is my week, day by day  | week                                         | Generated is better: Bars of load per day, which the fixed week cannot show                                                                   |
| 9   | who should I reach out to        | people                                       | Tie on the data, the same nine people. Generated adds a count and says plainly that unreplied threads have no source yet                      |
| 12  | what do I have tomorrow          | week                                         | Generated fits better, one day instead of seven, but its caption had an em dash. That is now refused at validation                            |

Generated won 4, tied 3, lost 1. The two clear wins (#5, #8) came from a
query the fixed surfaces never asked (the next exam, load per day), and the
loss from a view drawn empty with no reason given, which the panel now states.
