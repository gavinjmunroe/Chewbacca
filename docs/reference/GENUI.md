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
kyber-genui bench --requests config/genui/bench/sealed-2026-10-10.json   the sealed 32
kyber-genui bench --requests config/genui/bench/sealed-2026-10-10b.json  the labelled 30, graded for wrong sources
kyber-genui bench --requests config/genui/bench/sealed-2026-10-10c.json  the open-answer 30, graded by path
kyber-genui bench --requests <labelled set> --regrade results.json      grade a saved run, no model
kyber-genui keep [NAME]                                  the last model-written surface becomes a candidate
kyber-genui promote NAME                                 checks a candidate against the sealed requests
GENUI_TIERS=0,1 kyber-genui "..." --dry-run --json       no model: which tier answered, and why
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

## Tiers: the model is the last resort

Added 2026-10-10 (CHW-203). On 10/04 every request paid a model call, and the
median panel took 4.4 s. Most requests are one of a few shapes over one of a
dozen sources, and neither choice needs a generative model. Each tier answers
only when the cheaper one could not, and every layout any tier makes goes
through the same validator and policy as a model's.

| Tier | What answers                                                                                                                                                        | Typical time                    | Code                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| 0    | An exemplar, a pinned preset or a promoted framework whose request matches near-exactly (content-word Jaccard of 0.75 or more, slots like a course code abstracted) | under 100 ms                    | `tiers.tier0`                                   |
| 1    | Jev picks an archetype and a source in one call; code reads the course, day and window; the queries run; a math step picks the components from the data's shape     | 100 to 400 ms on the frozen set | `tiers.classify`, `tiers.plan`, `tiers.compose` |
| 2    | The model, given the catalog, the queries and now the frameworks, in whichever runtime the HUD answers with (`hud-accounts list`)                                   | seconds                         | `stream_model`                                  |

**Archetypes**, in `config/genui/frameworks.json`: count, compare, timeline,
act, entity, plan, breakdown, before-after, connections. Each has the
description Jev reads and the components a model is told it usually takes.
`connections` always goes to the model: no query returns relationships, so a
Diagram's parts would have to be written, and only the model writes.

**The math step** (`tiers.features`, `tiers.compose`) measures the answer
and never copies a value into a line: count, number of groups in the bars
view and whether they differ, whether a non-constant series of three or more
exists, whether a ratio exists, whether rows carry a time, and which fields
vary across rows. Then:

- a source that failed or has none (count is null): a warning Status bound to
  its note, never a zero (surface rule 8);
- nothing came back: one Status bound to the note, no Metric over it (rule 6);
- one number asked for: a Metric, then a Sparkline if the series moves, else
  Bars if two or more groups differ (rule 2: the glance, then the longer look);
- compare or breakdown: a Ring only for a ratio, Bars for two or more groups,
  a Table when there is no magnitude but several fields vary, else a Metric;
- timed rows: Events, with a Metric count above when more than six (the
  Events cap) or when the archetype is before-after or one entity;
- untimed multi-field rows: a Table of at most three varying columns (a
  400-point card), a Metric count when more than nine;
- a companion count (overdue beside due) only when it is non-zero.

One row-bearing component per panel at most: Events (6) plus Bars (9) is over
the 12-row budget, and rule 3 says one source never takes all the rows anyway.

**Slots are code, not Jev.** Course codes (three to five letters and three
digits, minus "next 100" and its kind), weekdays and today/tonight/tomorrow,
"before Friday", "next 10 days", "two weeks", "this month", and a capitalised
name for `campaign` and `person`. Jev's own skill says exact matching stays in
code, and a regex is free. A named course moves due or overdue to `course`;
a named day moves week or calendar to `day`.

**Head start.** The graph provider's walks took 480 to 750 ms on
2026-10-10, which is longer than Jev takes to answer. So the one source whose description shares the
most words with the request starts running while Jev decides, and its answer
is used only if Jev picks the same source.

**Glance.** Every generated surface sends `glance <surface>` after its `@`
line, so a click off the cards takes it down. A pinned preset is drawn
without it, because a pin is meant to stay.

**Learning loop.** `kyber-genui keep [NAME]` (and `--pin` on a model-written
surface) distills the layout into `~/.bob/genui/candidates/`: pointer
arguments that equal a slot in the request become `{course}`, `{day}`,
`{days}` or `{name}`, and the trigger gets the same slots. Tier 0 never reads
a candidate. `kyber-genui promote NAME` checks it against every
`config/genui/bench/sealed-*.json` request: it must match its own request,
and every sealed request it would take from the existing entries must
validate when filled. Only then does it move to `~/.bob/genui/promoted/`.
The check is shape, not relevance; the relevance gate below runs when a
promoted layout is drawn, but promotion itself does not consult it.

## Relevance gate

The validator checks shape. On the first sealed run the model, sent a
request no query covers, bound one anyway: "what's the weather tomorrow" drew
`day:tomorrow`, "what's Nvidia stock at" drew `campaign:Nvidia`. Each panel
said it had no data, about the wrong thing. The gate asks a second question
before anything bound to a source reaches the glass: can this source answer
what the request is about?

**Every query declares what it covers**, in `config/genui/covers.json`:
`entities` (assignment, lab, meeting, thread) and `measures` (due, overdue,
standing, waiting), written from each query's own description plus the
synonyms a person says for it. A provider can declare `covers` in its own
manifest entry, which wins. The test fails if a built-in query declares
nothing.

**Code decides first** (`tiers.relevance`). The request's subject words are
its content words minus slots (course, day, window, name), question words and
the `generic` list in covers.json, plural-stemmed. Then:

- a subject word in the source's declaration: yes;
- no subject words at all, and the source takes the slot the request named
  ("what do I have tomorrow" and `day`): yes;
- subject words that land only on other queries' declarations: no, and the
  query they land on is named (`other`);
- subject words no query declares: undecided.

**Jev only where code cannot decide**: one typed yes/no
(`tiers.ask_relevance`, a `choice` question with criteria yes and no),
cached per source, at the same 1.5 s timeout as Tier 1. It runs only when
Tier 1 is enabled, because Jev is Tier 1's tool; with `GENUI_TIERS=2` the
gate is code alone. An unanswered Jev call lets the source through, which is
the behaviour before the gate existed.

**Where it runs:**

1. **Before the model.** Tier 1's Jev call already answers "which source",
   with `none` as a choice. When Jev says `none` at or above the source
   threshold, the archetype is not `connections` (a drawing), and code finds
   no request word in any declaration, no model is asked: the run answers on
   the pill. When Jev picks a source that needs an argument the request never
   said (`campaign` with no client), the pill asks for it ("Which campaign?
   Say the client's name.") instead of letting the model bind a neighbour.
2. **On Tier 1's pick.** Code alone. A no sends the request to the model,
   behind the same gate, since the words belong to another query.
3. **On the model's bindings, while it streams.** A line binding a source the
   gate refuses is held back. A line binding a source it accepts anchors the
   panel and releases what was held, so "am I behind" can show owed replies
   beside the overdue list. A layout with held lines and no anchor never
   reaches the glass. The repaired layout is judged the same way.

**What the person sees.** An answer, never a refusal (next section). The one
exception is a request that is a query's but lacks its argument ("pull up the
outbound numbers"): the pill asks for it ("Which campaign? Say the client's
name."), and only when the no rests on two or more of the request's words.
`kyber-genui --json` reports `no_source`, `say`, the `gate` verdict with its
`path`, and `answer`; hud-listen speaks `say` instead of "It's on the glass."
A no-source answer is never pinned, refreshed, or kept as a framework
candidate.

**A weak no goes to Jev.** A code no that rests on one word (`Verdict.weak`)
is not final when Jev is on: Jev's typed yes/no confirms or overrules it, on
Tier 1's pick and on the model's bindings. "pull up that thing Sagar sent"
was refused for `person` because `sent` is a campaign measure. Without Jev
the code no stands. A weak no never produces a clarifying question.

## Open answers: the HUD always answers

Added 2026-10-10. Caleb, on "I don't have weather on this Mac" with a Search
the web button: "it shouldn't be retarded like siri bro it's literally llm
powered." When the gate finds no local source, `bin/lib/glass_answer.py`
answers on the glass with no press. It picks a path by rule
(`glass_answer.route`), and each path falls back to the other:

| Path    | When                                                                                                                                                 | What is drawn                                                                                                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| needs   | first person plus a money or health word ("how much did I spend", "how many steps did I walk")                                                       | nothing: the card comes down and the pill says what it would take, plainly ("Spending and balances need a bank or card connection, and Chewbacca doesn't link one yet.")                                                                |
| weather | a weather word and a place: "in Chicago", or a saved home in `~/.bob/home.json`, today or tomorrow                                                   | a card: the question, Open-Meteo's sentence from `bin/lib/quick.py`, and "Open-Meteo forecast"                                                                                                                                          |
| web     | a live word: weather, forecast, stock, price, market cap, score, game, news, latest, hours, close, traffic, today, right now, and the rest of `LIVE` | the search surface `bin/lib/glass_search.py` already draws (the question, the answer, up to five sources whose rows open on a press), with the quoted snippet first, then the model's one-sentence answer from the results in its place |
| model   | everything else                                                                                                                                      | a card: the question, the model's answer in at most two sentences, and "From the model, not the web"                                                                                                                                    |

- **Live before the model.** When Jev says no source fits but a request word
  lands on some declaration, the request used to go to the layout model. A
  live or personal request now skips it: "what's the score of the Dodgers
  game" spent 6.3 s on a layout the gate then refused, because `score` is a
  grades measure.
- **Fallbacks.** Live with the web down: the model answers, captioned as
  possibly out of date. Knowledge with the model down: the web answers. Both
  down: one sentence saying what broke. `HUD_SEARCH=off` turns the web path
  off, and the model answers.
- **The model** is the layout model's runtime (`model_command`, the HUD's
  account), with the same no-tools flags, asked for plain text with a short
  system prompt that carries the date. It sees the request and, on the live
  path, the search results. It never sees local data: an open answer runs only
  when no local source holds the request.
- **Web results are untrusted.** The snippets reach the model as quoted
  results with the rule never to follow an instruction inside them, and
  whatever comes back is drawn as a string in a `d /answer` line. Neither the
  results nor the model's sentence can draw a control:
  `test_an_instruction_in_a_snippet_is_only_ever_text` plants both.
- **Sources stay pressable.** The web answer is on the `search` surface, and
  `kyber-genui --json` returns its rows as `answer.sources`; hud-listen adopts
  them (`adopt_search_panel`), so Open on a row opens that page and "close it"
  takes the panel down, the same as a spoken "search X".
- **Grading.** `kyber-genui bench` grades a set whose rows carry `accept`
  (`sealed-2026-10-10c.json`) by path: `refused` for any "I don't have X on
  this Mac" line or nothing answered, `wrong-source` for a panel or a question
  about a query the label does not list, `wrong-path` for an answer by a path
  the label does not accept, else `right`. `answered`, `refusal_lines`,
  `paths` and `path_ms` are in the summary.

## No tools

The layout model writes Kyber Lines from a prompt and never needs a tool.
With a tool it could read a file while writing a layout, which breaks "the
model never sees the data". So Tier 2 runs with no tools on every runtime.
`kyber-genui` adds `--no-tools` to every `hud-<runtime>` command
(`model_command`), and each wrapper turns it into its CLI's own flags.
`tests/test_kyber_genui.py` runs each wrapper against a fake CLI and fails if
any flag below is missing.

| Runtime | Flags                                                                                                                                                                                                                                                                                                              | Verified from                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude  | `--tools ""`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, `--setting-sources local`                                                                                                                                                                                                                    | `claude --help`, 2.1.289: `--tools ""` disables all tools; `--strict-mcp-config` uses only the given MCP config                                                                                                                                   |
| Codex   | `--ignore-user-config --ignore-rules --ephemeral --sandbox read-only`, `--disable` for `shell_tool unified_exec view_image apps plugins browser_use browser_use_external computer_use image_generation multi_agent code_mode_host hooks tool_suggest skill_search`, `-c web_search="disabled"`, `--cd <empty dir>` | `codex exec --help` and `codex features list`, codex-cli 0.155.0-alpha.16.3. Run live 2026-10-10: asked to `cat /etc/hosts`, the voice's flags ran it (a `command_execution` event); these answered that it had no tool, with no tool event       |
| Gemini  | `--admin-policy config/runtimes/gemini-no-tools.toml` (deny `*` at priority 999), `--allowed-mcp-server-names none`, `--extensions none`                                                                                                                                                                           | `gemini --help`, gemini-cli 0.46.0, and its bundled `policies/*.toml` for the rule format (`yolo.toml` allows `*` the same way). **Not run live**: Google refused the only Gemini account here on 2026-10-10 ("migrate to the Antigravity suite") |
| Ollama  | none: `ollama run MODEL`, nothing else                                                                                                                                                                                                                                                                             | `ollama help run`, ollama 0.35.1: no tool flag exists. Tools live on the HTTP API when a caller sends them, and on `ollama launch`; the test holds the wrapper to `run`                                                                           |

`--ignore-user-config` also drops the Codex model and reasoning settings in
`~/.codex/config.toml`, so Tier 2 on Codex runs Codex's default model unless
the HUD switcher picked one (`-m`). On the nine requests that went to Codex
both before and after, every one got faster: 5.5 to 12.4 s after against
8.3 to 21.5 s before (Measured, below). Nothing here separates the dropped
config from the missing tools. A hand-written `GENUI_MODEL_CMD` that is
not a `hud-<runtime>` wrapper or `claude` runs as written.

## How each rule is enforced here

| Rule                   | Where                                                                       | What it refuses                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Closed catalog         | `config/genui/catalog.json`, `check_component`                              | an unknown component or prop, with the nearest real name                                                                                                                                                           |
| Catalog cannot drift   | `catalog_drift`, `kyber-genui catalog --check`, `tests/test_kyber_genui.py` | a component or prop in `hud/CLAUDE.md` or read by `SurfaceView.swift` that the catalog lacks, and the reverse                                                                                                      |
| Data by reference      | `check_literal`, `check_pointer`                                            | a literal on any data prop (`Metric.value`, `Table.rows`, `Events.items`, `Bars.rows`, `List.items`, `Sparkline.points`, `Ring.value`); a pointer to an unknown query, view or argument; a `d` line from the model |
| Actions allowlisted    | `config/genui/policy.json` `actions`                                        | any Button action but `genui-refresh` and `genui-close`                                                                                                                                                            |
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
(`config/genui/policy.json` `row_caps`), `count` is the uncapped total, and `more` is
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

All in `config/genui/policy.json`.

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
- **A web answer is often a quote, not the number.** On the open-answer
  sealed run, 5 of 8 web answers ended with the search snippet on the card
  and the pill only naming its site: DuckDuckGo's snippets for a stock, a
  coin, a score, an exchange rate or a league table describe the page, not
  the value, and the model correctly said the results did not hold it.
  "Who won the Lakers game" had "Warriors 112, Lakers 120: Final score" in a
  source title and the model still declined, since nothing dated it. The
  sources are on the card and open on a press, but the glance does not carry
  the number. Keyless quote endpoints (Yahoo's chart API for tickers,
  CoinGecko, ESPN's scoreboard, frankfurter.app for currencies) or an
  `EXA_API_KEY` are the next change to measure, on a new sealed set.
- **Live is a word list.** `glass_answer.LIVE` decides web versus model
  after the gate has ruled out every local source. A live fact phrased with
  none of its words goes to the model, which says when it cannot see live
  data; a knowledge question carrying one ("who won the 1998 World Cup") goes
  to the web, which answers it too. Either way something answers.
- **Weather needs a place.** With no `~/.bob/home.json`, "the weather this
  weekend" goes to the web, whose snippets carry no forecast numbers either.
- **The model sees web snippets.** They are quoted with the rule not to obey
  them, the model has no tools, and its sentence is drawn as a string, so the
  worst a planted instruction can do is put wrong words on the card.
- **A drawing for a knowledge question is slow.** Jev called "how does
  photosynthesis work" and "explain what a p-value is" `connections`, so the
  layout model drew a diagram in 16.5 and 10.3 s where a sentence takes 4 to
  6 s. Both count as the model answering.
- **Gemini's no-tools flags were never run live.** They are from its help and
  its bundled policy format; the account here was refused.
- **Slots are rules.** "This month" is the days left in the month, a name is
  the first capitalised word that is not a weekday, month or course, and a
  course is letters plus three digits. A misread shows on the glass, because
  every Tier 1 caption names the window and source it understood (surface
  rule 13), but nothing refuses it.
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
4. **Register the graph walks as queries.** `bin/kyber-surfaces walk <kind>`
   (landed 2026-10-04) prints rows as text; give it a `--json` that prints
   `{"rows": [...]}` with the same row dicts, then write
   `config/surfaces/genui-queries.json` (or point `GENUI_QUERIES` at any path list):

   ```json
   {
     "queries": [
       {
         "name": "unreplied",
         "description": "threads and decisions waiting on you, oldest first",
         "argv": ["kyber-surfaces", "walk", "needs-you", "--json"],
         "rename": { "label": "who", "app": "channel", "why": "waiting" },
         "fields": ["who", "channel", "waiting"],
         "views": ["rows", "events", "list", "count", "note"]
       }
     ],
     "row_actions": {}
   }
   ```

   The command runs with no shell, `{arg}` (when the query declares an `arg`)
   substituted as one argv element, and must print
   `{"rows": [...], "note": "..."}`; optional `count`, `series`, `ratio`,
   `bars` and `scalars`. `rename` maps the provider's field names onto the
   ones the views read. A registered name replaces the built-in stub, so
   `unreplied` and `campaign` light up the day this file exists. Rows reach
   the glass: keep them to labels, senders and times, never a message body.
   Events are built from `time`/`date`/`waiting` plus
   `what`/`task`/`name`/`who`; bars from a provider's own `bars`, else counted
   by the first of `course` or `day`.

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
   in `config/genui/policy.json`.
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
  and every `p["..."]` the renderer reads against `config/genui/catalog.json`. Run it
  after adding a component or a prop; it fails until the catalog has it.

## Measured

### 2026-10-10, evening: open answers

A third sealed set, `sealed-2026-10-10c.json`, committed (b6d8f9ea) before
any answer code: 10 live facts, 8 knowledge, 8 local-source and 4 tricky
(the two gaps above, a spending question, and "score" about a class). Live
data, `--dry-run` sink, Jev `jev-latest`, Claude on the HUD account with the
model from settings, DuckDuckGo (no `EXA_API_KEY`), no `~/.bob/home.json`.
One run per request, with the raw rows in `results-2026-10-10c.json`.

|                          | Open-answer 30 |
| ------------------------ | -------------- |
| Answered                 | **30 of 30**   |
| "I don't have ..." lines | **0**          |
| Wrong-source panels      | **0**          |
| Wrong path / refused     | 0 / 0          |
| Valid, final / first try | 30 / 30        |
| Layout model calls       | 3              |

| Path    | n   | Median    | p90       | Max       |
| ------- | --- | --------- | --------- | --------- |
| panel   | 11  | 223 ms    | 517 ms    | 6,322 ms  |
| needs   | 1   | 128 ms    | 128 ms    | 128 ms    |
| weather | 2   | 1,447 ms  | 2,159 ms  | 2,159 ms  |
| web     | 8   | 5,707 ms  | 7,243 ms  | 7,243 ms  |
| model   | 6   | 4,533 ms  | 14,221 ms | 14,221 ms |
| drawing | 2   | 10,297 ms | 16,550 ms | 16,550 ms |

On the web path the search itself took 709 to 1,039 ms and the quote was
on the glass then; the rest is the model's sentence (3.7 to 6.1 s). Both
gaps are closed on their new cases: "pull up that thing Karthik sent" drew
`conversations` at Tier 1 in 517 ms, and "Zeutara bounce rate" bound
`campaign:Zeutara`. One bug was found on this run and fixed after it: row
2's model wrote "No actual forecast values in results. NONE" and that
reached the glass, because only a bare NONE was caught (`said_none`).

**The regression check.** The frozen 20 with open answers
(`results-2026-10-10-frozen-open.json`): 20 of 20 valid, all first try, 2
layout model calls, 18 with no model under 1 s, median 253 ms. 19 of 20 bound
the same queries as the gate run. #20 "give me a spot to jot a note about
the Amber pitch" drew a note Field last time; this time the layout model
bound `campaign:Amber`, Jev refused it at 0.05, and the open answer put the
model's one-line tip on the card instead of the Field, which told the person
to run `mkdir` and `open` themselves.

### 2026-10-10, later: the relevance gate and no-tools Tier 2

The first sealed set and the frozen 20 had been read while building, so a new
set of 30 was written and committed (2e8472b4) before any gate code, each
request labelled with the queries that answer it: 16 one source answers, 11
no source on this Mac answers, 2 drawings, 1 vague. `kyber-genui bench`
grades each row against its label: **wrong-source** is a panel bound to a
query the label does not list, **refused** is a no-source answer to a request
a listed query answers. The before run is the CHW-203 code on the same
morning. Live data, `--dry-run` sink, Jev `jev-latest`, Tier 2 on Codex
(`hud-accounts list`: Claude at its limit). One run per request. Raw rows:
`config/genui/bench/results-2026-10-10b-before.json` and `-after.json`;
`--regrade` reproduces the grades from either.

|                                    | Labelled 30, before         | Labelled 30, after              |
| ---------------------------------- | --------------------------- | ------------------------------- |
| Wrong-source panels                | **11 of 30**                | **0 of 30**                     |
| ... of the 11 no-source requests   | 11                          | 0                               |
| Refused a request a source answers | 0                           | 1                               |
| Valid, final / first try           | 30 / 30                     | 30 / 30                         |
| Answered by Tier 0 / 1 / 2         | 0 / 15 / 15                 | 0 / 25 / 5                      |
| No-source answers on the pill      | 0                           | 13 (11 before any model)        |
| Model calls                        | 15                          | 5                               |
| No model and under 1 s             | 15                          | 25 (14 panels, 11 pill answers) |
| Complete, median / p90 (all)       | 775 / 14,620 ms             | 238 / 8,281 ms                  |
| Tier 1 median / p90 / max          | 451 / 718 / 775 ms          | 144 / 425 / 612 ms              |
| Tier 2 median / p90 / max          | 11,132 / 16,545 / 21,454 ms | 8,348 / 12,404 / 12,404 ms      |

Every one of the 11 no-source requests drew a panel before, bound to
`day:today`, `needs`, `calendar`, `week:7`, `conversations` or
`campaign:Tesla`. After, 10 were answered before any model (Jev said `none`
at 0.92 to 1.00 and no request word is in any declaration) and one
("what's the score of the Dodgers game") went to the model because `score`
is a grades measure, and the gate refused the model's `calendar` binding.

**The regression check.** Both earlier sets, rerun with the gate:

|                         | Frozen 20, CHW-203 | Frozen 20, gate | Sealed 32, CHW-203 | Sealed 32, gate |
| ----------------------- | ------------------ | --------------- | ------------------ | --------------- |
| Valid, final            | 20                 | 20              | 32                 | 32              |
| Valid first try         | 19                 | 20              | 32                 | 32              |
| Same bindings as before |                    | 19 of 20        |                    | 28 of 32        |
| Model calls             | 4                  | 2               | 8                  | 4               |
| No model and under 1 s  | 16                 | 18              | 24                 | 28              |
| Complete, median        | 226 ms             | 191 ms          | 199 ms             | 174 ms          |

The five that changed are the five the CHW-203 notes called wrong: frozen #3
and sealed #24 (a campaign with no client, which had bound `needs`) now ask
"Which campaign? Say the client's name.", and sealed #29, #30 and #32
(weather, Nvidia, money) now say so on the pill. No panel that was right
changed. Raw rows: `results-2026-10-10-frozen-gate.json` and
`results-2026-10-10-sealed-gate.json`.

The two misfires on the labelled 30 are under Known gaps: #10 "Zeutara
reply rate" (the first-word name rule left `campaign` without a client, so
the pill asked for one) and #30 "pull up that thing Sagar sent" (graded right
by its vague label, but refused on the single word `sent`).

**No tools.** Run live on Codex once each way before the change (see "No
tools" above): the voice's flags ran `cat /etc/hosts`, the no-tools flags
did not. The nine requests that reached Codex both before and after, on the
same Mac the same morning, all got faster: frozen #13 12.0 to 7.5 s, #20 8.3
to 5.5 s; sealed #25 to #28 15.2, 12.7, 20.4, 15.3 to 8.8, 7.5, 9.1, 10.3 s;
labelled #15, #28, #29 12.1, 14.6, 21.5 to 8.3, 8.3, 12.4 s.

### 2026-10-10: the tiers (CHW-203)

`kyber-genui bench` on the frozen 20 and on a sealed set of 32 written and
committed (9c85dc91) before any tier code existed. Live ledger and graph
data, `--dry-run` sink, Jev `jev-latest`, Tier 2 on Codex through
`bin/hud-codex` because the HUD's Claude account was at its weekly limit.
One run per request. Raw rows, with every layout, Jev's choice and the math
step's measured features: `config/genui/bench/results-2026-10-10-frozen.json`
and `results-2026-10-10-sealed.json`.

|                             | Frozen 20 (10/04 baseline) | Frozen 20 (tiers)  | Sealed 32 (tiers)  |
| --------------------------- | -------------------------- | ------------------ | ------------------ |
| Valid, final                | 19 of 20                   | **20 of 20**       | **32 of 32**       |
| Valid first try             | 14 of 20                   | 19 of 20           | 32 of 32           |
| Fell back to a status panel | 1                          | 0                  | 0                  |
| Answered by Tier 0 / 1 / 2  | 0 / 0 / 20                 | 1 / 16 / 3         | 0 / 24 / 8         |
| No model and under 1 s      | 0                          | **16 of 20 (80%)** | **24 of 32 (75%)** |
| Model calls                 | 26                         | 4                  | 8                  |
| Complete, median (all)      | 4,367 ms                   | 226 ms             | 199 ms             |

Latency per tier, complete with data, nearest-rank percentiles:

| Tier | Set    | n   | Median    | p90       | Max       | Jev median / max |
| ---- | ------ | --- | --------- | --------- | --------- | ---------------- |
| 0    | frozen | 1   | 59 ms     | 59 ms     | 59 ms     | none             |
| 1    | frozen | 16  | 202 ms    | 375 ms    | 1,152 ms  | 122 / 1,148 ms   |
| 1    | sealed | 24  | 178 ms    | 273 ms    | 381 ms    | 125 / 173 ms     |
| 2    | frozen | 3   | 12,006 ms | 31,013 ms | 31,013 ms | 121 / 123 ms     |
| 2    | sealed | 8   | 12,696 ms | 20,442 ms | 20,442 ms | 127 / 169 ms     |

**The falsifier passed**: on the sealed set 100% valid (bar: 95%) and 75%
answered with no generative model in under a second (bar: 60%).

What the numbers do not say, read off the layouts:

- **Valid is shape, not relevance, and the model is where relevance broke.**
  Sealed #29 "what's the weather tomorrow" bound `day:tomorrow`, #30 "what's
  Nvidia stock at" bound `campaign:Nvidia`, #32 "how much money did I spend"
  bound `needs`, and frozen #3 bound `needs` under a campaign Field. Each
  panel says plainly it has no data, but it says it about the wrong source.
  The prompt should tell the model that a request no query covers gets one
  Status line, with a validator rule refusing a pointer whose query shares no
  word with the request.
- **Tier 1 wrong on 1 of 24 sealed, guessing on 1.** #8 "which of my classes
  is hitting me hardest" went to `week:14` (Jev 0.56), so the Bars group by
  day, not class. #31 "show me the thing from earlier" drew this week's
  conversations at 0.58: a guess on a request with no referent. Both sit just
  over the 0.5 source threshold; raising it to 0.6 would have sent both to
  the model and kept 22 of 32 (69%) under the bar. Not changed, because the
  threshold was set before the sealed run and moving it after would be tuning
  on the test.
- **Tier 2 is slower than the baseline**: Codex took 8 to 31 s where Claude
  took 3 to 9 s on 10/04. Every Tier 2 request on the sealed set was a drawing
  or out of scope, which is the set the model should get.
- **The one Tier 1 run over a second** (frozen #12, 1,152 ms) was a single Jev
  call that took 1,148 ms; the next slowest of the 51 Jev calls was 189 ms.
- **The sealed set is held out by commit order, not blind.** A second agent
  was meant to write it unseen and the subagent limit refused it, so the
  author wrote it before building. Nothing was tuned after the sealed run.
- **No sealed request hit Tier 0.** The exemplars are six requests; Tier 0
  earns its keep once presets and promoted frameworks accumulate.

### 2026-10-04: the model only (baseline)

`kyber-genui bench`, 2026-10-04, the 20 frozen requests in
`config/genui/bench/requests.json`, Claude Code 2.1.278 with the model in the
person's settings (Opus 5.5), auto-memory off, live ledger data, `--dry-run`
sink so the socket is not in the timing. One run per request. Raw rows,
including every layout the model wrote, are in
`config/genui/bench/results-2026-10-04.json`. This is the third full run; the first
two (16/20 and 15/20 first try, both 20/20 after repair) used an earlier
validator and had auto-memory on, and are not the numbers below.

|                                        | Result                                       |
| -------------------------------------- | -------------------------------------------- |
| Valid on the first try                 | **14 of 20**                                 |
| Valid after one repair                 | **19 of 20**                                 |
| Fell back to a status panel            | 1 of 20 (#3)                                 |
| Skeleton on the glass                  | 0.6 ms worst case, before the model is asked |
| First model component, median          | 3,194 ms (range 2,347 to 6,084; none for #3) |
| Complete with data, median             | 4,367 ms (range 3,202 to 99,249)             |
| Complete, first-try valid only, median | 3,743 ms                                     |
| Complete, repaired, median             | 8,964 ms                                     |

| #   | Request                                                 | First try | After repair | First component ms | Complete ms | Queries bound                    | Why the first try was refused                                                    |
| --- | ------------------------------------------------------- | --------- | ------------ | ------------------ | ----------- | -------------------------------- | -------------------------------------------------------------------------------- |
| 1   | compare my three classes' grades                        | no        | yes          | 3197               | 8273        | grades                           | the surface shows up to 18 rows; at most 12. Drop a list or bind a count instead |
| 2   | who have I not texted back this week                    | no        | yes          | 2848               | 8447        | unreplied:7                      | line 1: only c, > and @ lines belong in a layout, not 's'                        |
| 3   | show my client's outbound campaign numbers              | no        | no           | none               | 16921       | none                             | line 3: campaign needs an argument: campaign or client name                      |
| 4   | plan my Tuesday                                         | yes       | yes          | 2491               | 4021        | day:Tuesday, overdue             |                                                                                  |
| 5   | what's due before my midterm                            | yes       | yes          | 2347               | 3411        | before-exam                      |                                                                                  |
| 6   | what's due this week                                    | yes       | yes          | 2546               | 3798        | due:7, overdue                   |                                                                                  |
| 7   | am I behind on anything                                 | yes       | yes          | 3347               | 4655        | overdue, unreplied               |                                                                                  |
| 8   | how busy is my week, day by day                         | yes       | yes          | 2863               | 4418        | overdue, week:7                  |                                                                                  |
| 9   | who should I reach out to                               | no        | yes          | 2867               | 7533        | reconnect, unreplied             | the surface shows up to 15 rows; at most 12. Drop a list or bind a count instead |
| 10  | what promises have I made to people                     | yes       | yes          | 3277               | 3323        | tasks                            |                                                                                  |
| 11  | when are my exams                                       | yes       | yes          | 2856               | 3245        | exams:90                         |                                                                                  |
| 12  | what do I have tomorrow                                 | yes       | yes          | 3774               | 4316        | day:tomorrow                     |                                                                                  |
| 13  | how does the HUD get data from a query onto the screen  | yes       | yes          | 4338               | 5533        | none                             |                                                                                  |
| 14  | show my BISC 101 deadlines                              | yes       | yes          | 3078               | 3687        | course:BISC101                   |                                                                                  |
| 15  | what's on my calendar this week                         | yes       | yes          | 3116               | 3202        | calendar:7                       |                                                                                  |
| 16  | how many things are due in the next two weeks, by class | yes       | yes          | 3194               | 3644        | due:14                           |                                                                                  |
| 17  | what's the plan for today                               | yes       | yes          | 3485               | 3608        | day:today                        |                                                                                  |
| 18  | show me everything I owe anyone, school and people      | no        | yes          | 6084               | 99249       | due:7, overdue, tasks, unreplied | line 9: Heading.level=3 must be between 1 and 2                                  |
| 19  | which class has the most work coming up                 | no        | yes          | 4128               | 9481        | due:14                           | the surface shows up to 18 rows; at most 12. Drop a list or bind a count instead |
| 20  | give me a spot to jot a note about the Amber pitch      | yes       | yes          | 5349               | 5730        | campaign:Amber                   |                                                                                  |

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
