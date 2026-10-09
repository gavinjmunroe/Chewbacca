# No apps

Caleb's goal, 2026-10-09: Chewbacca is the reason no app gets opened. Finder is
being replaced by a separate build (the dual-pane file surface). This page is
the order for everything else, set by what he actually opens and what each
build would take. The graph behind it is
[data/app-replacement-graph.json](../data/app-replacement-graph.json): apps,
the jobs he does in them, the capabilities that exist, and the builds that are
missing, with a source on every edge.

## What was measured

| Source                                                                                         | What it gave                                | Window                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `~/Library/Application Support/Knowledge/knowledgeC.db`, stream `/app/usage`, opened read only | foreground hours and focus switches per app | 2026-09-19 09:38 to 2026-10-09 03:09, 16 active days |
| Chrome `History` of Default, Profile 1 (Work) and Profile 7, copied then read                  | visits per site and path                    | since 2026-09-19, 8,872 visits                       |
| `~/.claude/projects/*/*.jsonl`, first `entrypoint` per transcript                              | where Claude Code runs                      | 2,537 transcripts touched since 2026-09-19           |
| `CallHistory.storedata`                                                                        | calls and their length                      | since 2026-09-19                                     |

ActivityWatch is not installed (no `aw-server`, nothing on port 5600), and
Screen Time reads the same knowledgeC store, so neither added anything.
knowledgeC needed no extra permission. It keeps about 20 days on this Mac,
which is why the window starts on 9/19.

**Denominator: 96.59 foreground hours over 16 active days, 83.46 of them in
the last 14 days.** "Focus sessions" counts every time the app came to the
front, not launches. Chrome's own `visit_duration` counts background tabs, so a
site's hours below are Chrome's foreground hours split by that site's share of
visits: an estimate whose ranking is trustworthy and whose decimals are not.

### Top 10 apps by foreground hours

| #   | App              | Hours (20 d) | Hours (14 d) | Share | Focus sessions | Days used of 16 |
| --- | ---------------- | ------------ | ------------ | ----- | -------------- | --------------- |
| 1   | Google Chrome    | 31.85        | 27.48        | 33.0% | 3,154          | 15              |
| 2   | VS Code          | 27.12        | 23.50        | 28.1% | 2,559          | 16              |
| 3   | Messages         | 13.40        | 11.08        | 13.9% | 1,689          | 16              |
| 4   | FaceTime         | 6.14         | 4.07         | 6.4%  | 540            | 13              |
| 5   | Claude (desktop) | 3.47         | 3.47         | 3.6%  | 239            | 8               |
| 6   | Codex            | 3.32         | 3.32         | 3.4%  | 275            | 6               |
| 7   | Notes            | 2.05         | 2.01         | 2.1%  | 363            | 13              |
| 8   | Slack            | 1.82         | 1.67         | 1.9%  | 316            | 13              |
| 9   | Granola          | 1.43         | 1.28         | 1.5%  | 452            | 16              |
| 10  | WhatsApp         | 1.11         | 1.11         | 1.1%  | 133            | 9               |

Then Finder 0.94 h (368 switches, the most of any small app), Zoom 0.82,
iOS Simulator 0.71, Preview 0.56, Spotify 0.40. Mail.app, Calendar.app,
Terminal, Xcode and Obsidian each sit under 0.03 h.

Against [OS-COVERAGE.md](OS-COVERAGE.md) (2026-10-04, 14 days): VS Code went
from 11.7 h to 23.5 h and Chrome from 15.8 h to 27.5 h. The two apps the HUD
has the most surfaces for are the two growing fastest.

### Inside Chrome

| Site                                        | Visits              | Est. h / 14 d  | What the paths say                                                                        |
| ------------------------------------------- | ------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| google.com/search                           | 1,633               | 5.06           | the most-visited thing he does in any app                                                 |
| github.com                                  | 907                 | 2.81           | 77% repo pages, profiles and search; 15% settings, branches, installs; 7% PRs and commits |
| docs.google.com                             | 651                 | 2.02           | 449 Docs, 115 Slides, 54 Sheets, 21 Forms; 61 typed-URL visits                            |
| app.clay.com                                | 620                 | 1.92           | Zeutara workspaces                                                                        |
| calendar.google.com                         | 544                 | 1.69           |                                                                                           |
| linkedin.com                                | 539                 | 1.67           | 400 profile pages                                                                         |
| brightspace.usc.edu + USC SSO               | 454                 | 1.41           | 116 of those are login hops                                                               |
| mail.google.com                             | 388                 | 1.20           |                                                                                           |
| chatgpt.com                                 | 172                 | 0.53           |                                                                                           |
| instagram.com, figma.com, Maps, Drive, Meet | 162, 96, 86, 66, 47 | under 0.5 each |                                                                                           |

### Inside VS Code and FaceTime

VS Code is Claude Code. Of the transcripts touched since 9/19, 1,376 started
from `claude-vscode`, 59 from the desktop app and 1 from a bare terminal; the
other 1,101 are scripted SDK runs. How his 23.5 h divides between steering
sessions, reading diffs and hand-editing is not measured; the graph guesses
80/10/10 and says so on each edge.

FaceTime is calls, not video: 65 FaceTime audio calls (50 placed by him)
totalling 14.1 h. In the last 14 days it was 35 calls and 5.21 h on the line
against 4.07 h with the window in front.

## The graph

101 nodes: 18 apps, 14 Chrome sites, 27 jobs, 28 existing capabilities, 14
planned builds. 123 edges:

- `SERVES` app or site to job, carrying that job's hours per 14 days
- `COVERS` capability to job, `full`, `partial` or `none`, with the file that
  proves it as provenance and one line on what is missing
- `DEPENDS_ON` job to the planned build that removes the app for it
- `BUILDS_ON` planned build to the existing capabilities it reuses

Only one job is covered fully today: music (Spotify, 0.38 h). Every other job
with real hours is partial or none. The coverage verdicts come from
[config/data/surfaces/apps.json](../config/data/surfaces/apps.json) and the
code it names, read on 2026-10-09.

## Ranking rule

score = hours per 14 days the build would move off the app, if it works ÷
effort in days.

Hours moved is the job's hours times the gap: 1.0 where coverage is `none`,
0.5 where it is `partial` (half the job already works somewhere). Effort is a
guess in days, never measured, and is the weakest number here. Ties break on
frequency (visits or focus switches), because a job done 650 times in short
glances costs more attention than its hours show.

| Rank | Build                        | Kills                          | h / 14 d addressed | h moved if it works | Effort (d) | Score |
| ---- | ---------------------------- | ------------------------------ | ------------------ | ------------------- | ---------- | ----- |
| 1    | Search answered on the glass | Chrome: google.com             | 5.06               | 5.06                | 2          | 2.53  |
| 2    | HUD IDE v1                   | VS Code, Codex, Claude desktop | 30.29              | 15.14               | 8          | 1.89  |
| 3    | Call pill                    | FaceTime                       | 5.04               | 5.04                | 4          | 1.26  |
| 4    | Group texts                  | Messages                       | 3.32               | 3.32                | 3          | 1.11  |
| 5    | Gmail into the graph         | Chrome: Gmail                  | 1.20               | 0.60                | 1          | 0.60  |
| 6    | Repo card                    | Chrome: GitHub                 | 2.16               | 1.08                | 2          | 0.54  |
| 7    | Doc surface                  | Chrome: Google Docs            | 2.02               | 2.02                | 4          | 0.51  |
| 8    | Dash-list Notes              | Notes                          | 2.01               | 1.00                | 2          | 0.50  |
| 9    | Clay surface                 | Chrome: Clay                   | 1.92               | 0.96                | 2          | 0.48  |
| 10   | Google Calendar via gws      | Chrome: Calendar               | 1.68               | 0.84                | 2          | 0.42  |
| 11   | Slack surface                | Slack                          | 1.67               | 0.83                | 2          | 0.42  |
| 12   | Grades panel                 | Chrome: Brightspace            | 1.41               | 0.70                | 2          | 0.35  |
| 13   | LinkedIn card                | Chrome: LinkedIn               | 1.37               | 0.69                | 2          | 0.35  |
| 14   | WhatsApp groups              | WhatsApp                       | 1.11               | 0.56                | 2          | 0.28  |

Docs (rank 7) and Notes (rank 8) tie within 0.01; Docs stays ahead on
frequency, 651 visits against 363 switches.

Not ranked, and why: Figma (0.30 h, no source and a canvas the HUD cannot
host), Instagram (no API worth building on), Simulator (belongs to the iOS
build loop, not the glass), System Settings (out of scope by design), Venmo
(nothing on the glass pays). 1:1 texts (7.76 h) are already partial and the
open work there is precision, CHW-135, not a new build.

## The top eight

Each one names the jobs, what Chewbacca already does, the gap, the smallest
build that removes the app for that job, and the measurement that would prove
it wrong. "Baseline" is the 14-day number above; every falsifier re-runs the
same knowledgeC or History query over the 7 days after the build lands.
They are on the team board as CHW-188 to CHW-195, in rank order.

### 1. Search answered on the glass (Chrome, google.com)

- **Jobs:** look something up. 1,633 visits, 5.06 h.
- **Already:** the hyper bar can answer with the model. But
  [bin/lib/route.py](../bin/lib/route.py) sends any sentence starting
  "search", "google" or "look up" to a browser search on purpose
  (`SEARCH_OPENERS`), and `perplexity-tab` runs inside Chrome. Today the
  assistant is a faster way to open Chrome.
- **Gap:** no answer panel.
- **Smallest build:** route `SEARCH_OPENERS` to a `kyber-genui` answer panel:
  the answer in two lines, then up to five sources as rows that show their
  host (surface rule 12), each opening the page only on a press. Keep "go to
  <site>" as the browser route.
- **Falsifier:** google.com/search visits in 7 days fall below 400 (baseline
  1,633 in about 20 days, roughly 580 a week). If they don't fall by a third,
  the answers aren't good enough to stop him checking, and the next step is
  answer quality, not more routing.

### 2. HUD IDE v1 (VS Code, Codex, Claude desktop)

- **Jobs:** steer Claude sessions (18.8 h), review diffs (2.35 h), open and
  edit files (2.35 h), Codex and Claude desktop chats (6.79 h).
- **Already:** [bin/lib/surfaces/agents.py](../bin/lib/surfaces/agents.py)
  drives engine sessions end to end; `kyber-sessions` lists every Claude Code
  session and types into idle ones through their inbox
  ([bin/lib/sessions_inbox.py](../bin/lib/sessions_inbox.py));
  [bin/lib/surfaces/code.py](../bin/lib/surfaces/code.py) shows changed repos
  and diffs, read only; the `File` component edits a text file in place.
- **Gap:** VS Code-started sessions are second-class (no new session from the
  glass that becomes the one he keeps using, end to end unproven per urgent
  CHW-134), no file tree, no syntax color, no side-by-side diff, Codex is not
  drawn.
- **Smallest build:** the design below, cut to v1: a session rail (every
  session, VS Code and engine alike), the session card as the editor, a tree
  pane over the session's folder, and the Diff surface with syntax color.
  Starting a session from the glass has to spawn one he would otherwise have
  opened VS Code for.
- **Falsifier:** VS Code foreground hours in 7 days under 6 (baseline 23.5 h in
  14, about 11.75 a week), and new `claude-vscode` transcripts falling while
  glass-started ones rise. If VS Code hours hold while glass sessions rise, he
  is using both and the editor half is missing.
- **Fork for Caleb:** the glass never grants a permission (hud/CLAUDE.md, "What
  it never does"). A session that stops on a prompt sends him back to wherever
  it runs. The IDE only kills VS Code if his sessions run without prompts or
  if that rule changes, and that call is his.

### 3. Call pill (FaceTime)

- **Jobs:** place, take and run audio calls. FaceTime 4.07 h in front, Zoom
  0.82, Meet 0.15; 65 FaceTime audio calls.
- **Already:** [bin/call-watch](../bin/call-watch) notices the mic going live
  and offers a panel; `room-capture` and the meetings surface record and
  transcribe.
- **Gap:** nothing places, answers, mutes or ends a call.
- **Smallest build:** a pill that shows who is on and the elapsed time, with
  Mute and End working through FaceTime's own accessibility tree (the AX
  path `mac-see` already uses), and "call Mom" from the hyper bar dialing with
  `facetime-audio://` and then pushing the FaceTime window behind the glass.
- **Falsifier:** FaceTime foreground minutes per call. Baseline: 4.07 h in
  front over 35 FaceTime audio calls in the last 14 days (5.21 h on the
  line), about 7 minutes per call. If that doesn't drop under 3 minutes while
  the call count holds, the window is still where he controls the call.

### 4. Group texts (Messages)

- **Jobs:** read and answer group threads, 3.32 h (the 30% split is a guess).
- **Already:** the conversations surface answers 1:1 threads with a read-back;
  a group row only opens the person
  ([docs/KYBER-SURFACES.md](KYBER-SURFACES.md), "What Go does").
- **Gap:** group replies and attachments. CHW-136 names group replies; this is
  that half, plus showing an attachment's name and opening it in a File
  surface.
- **Smallest build:** reply into a group thread by its chat GUID, read fresh
  at the press, with the same participants-unchanged check the 1:1 path uses,
  and the read-back.
- **Falsifier:** Messages foreground hours in 7 days under 3.5 (baseline about
  5.5 a week). If they hold, the 1:1 side is also still happening in the app,
  and CHW-135's precision is the reason.

### 5. Gmail into the graph (Chrome, Gmail)

- **Jobs:** triage and answer email, 388 visits, 1.20 h.
- **Already:** [mac/lib/gmail.py](../mac/lib/gmail.py) reads human mail
  through `gws`, and `people texts` shows it. The graph's `mail` ingester still
  reads Mail.app ([bin/lib/osgraph_ingest.py](../bin/lib/osgraph_ingest.py),
  `INGESTERS`), the app he said on 2026-10-08 not to use.
- **Gap:** needs-you and person panels miss Gmail.
- **Smallest build:** swap the `mail` ingester's source to `gmail.py` rows,
  keeping the DMARC rule for fusion, and make the MailItem Go a Gmail draft via
  `gws`, never a send. One day.
- **Falsifier:** mail.google.com visits in 7 days under 60 (baseline about
  135 a week).

### 6. Repo card (Chrome, GitHub)

- **Jobs:** look at repos and people's profiles, about 700 visits, 2.16 h.
- **Already:** the oss surface drills into registry entries; the github
  surface covers PRs and CI, read only.
- **Gap:** an arbitrary repo or profile.
- **Smallest build:** "show me <owner/repo>" or a pasted GitHub URL draws a
  card from one `gh api` call: description, stars, license bucket (the oss
  surface's), last push, the README's first screen in Prose, and "add to
  links" writing to [LINKS-FROM-CALEB.md](LINKS-FROM-CALEB.md). Profiles get
  their pinned repos.
- **Falsifier:** github.com repo and profile visits in 7 days under 120
  (baseline about 245 a week).

### 7. Doc surface (Chrome, Google Docs)

- **Jobs:** read and write Docs, Slides, Sheets, 651 visits, 2.02 h.
- **Already:** `gws` reaches Drive, Docs and Sheets; nothing draws one.
- **Gap:** everything.
- **Smallest build:** "open my WRIT doc" finds it with `gws drive files list`
  by name, exports it as text into a `File` surface, and an edit request goes
  to a Claude session that writes through the Docs API, shown first as a Diff
  he approves with one press. Sheets read as a Table. Slides stay in Chrome
  for v1.
- **Falsifier:** docs.google.com/document visits in 7 days under 80 (baseline
  about 160 a week).

### 8. Dash-list Notes (Notes)

- **Jobs:** jot and reread notes, 363 switches on 13 days, 2.01 h.
- **Already:** [bin/lib/surfaces/notes.py](../bin/lib/surfaces/notes.py)
  shows the 6 newest and appends a line, but only to text-only notes; a note
  with a bulleted list is read only from the glass.
- **Gap:** his notes are dash lists (memory `feedback_apple_notes_dash_lists`),
  so the one write the surface has skips the notes he actually writes.
- **Smallest build:** append a dash line inside a dash-list note through the
  same HTML allowlist, plus search by title and a new note.
- **Falsifier:** Notes focus switches in 7 days under 60 (baseline about 180
  a week).

## The HUD IDE

The concept, grounded in what [hud/](../hud/CLAUDE.md) renders today.

### What exists to build on

- Glass, rim light and motion: `Glass.swift`, `RimGlass.swift`, `Motion.swift`,
  `Morph.swift`.
- Sessions as surfaces: `SessionViews.swift` and the `Transcript` component;
  Reply addresses the conversation panel to a card with a "To lemma session"
  chip, and the daemon types into that session's inbox.
- `Diff` (unified, colored, last 600 lines) and `File` (text, PDF, image,
  `editable` with save to the path), opened beside a card from an edit in the
  transcript or Open diff.
- `kyber-genui`: a closed component catalog the model composes, data bound by
  pointer, never pasted.
- Run tests: the one declared test command, streamed into a Diff surface.
- Placement by column, private event lines per surface owner.

### What it is

There is no editor window. The editor is the conversation, and the code is
something the conversation shows.

1. **Session rail, left.** Every Claude and Codex session, wherever it
   started, ordered by what needs him: waiting on him, working, failed,
   finished. A row is project, model, age and one line of state. This is
   `sessions` with Codex and the VS Code sessions made first-class.
2. **Card, centre: the editor.** The transcript with tool calls folded to one
   line each, a status line, and the input. He edits code by saying what he
   wants; a hand edit is the exception, done in a File surface.
3. **Tree, beside the card.** The session's folder, collapsed to what the
   session touched plus one level of context, never the whole repo by
   default. A file row opens a File surface; a changed file opens its Diff.
4. **Diff, the default view of code.** Every change arrives as a Diff surface
   first. v2 adds syntax color and side by side; v3 adds per-hunk Keep and
   Undo, which turns review into presses.
5. **Generated panels on demand.** "Show me the call graph of this module",
   "what touches the people store": a `Diagram` or `Table` composed by
   `kyber-genui` over data from the repo.
6. **Tests and status as Events.** Run tests streams into a surface; a red
   test row pivots to the failing file's Diff.

What makes it unlike an IDE: it drops tabs, settings and the file menu
(surface rule 10, "don't mirror the app"). Panels exist only while there is
something on them. The tree is scoped to the session, not the project. The diff comes
before the file.

### What to borrow, with licenses

Licenses are from the oss registry
([config/data/oss-apps/apps.json](../config/data/oss-apps/apps.json)) where it
has the project, otherwise marked as not checked here.

| Project                         | Take                                                                                                      | License                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| CodeEdit (CodeEditApp/CodeEdit) | native Swift editor: its text view and syntax highlighting packages are the closest fit for a SwiftUI HUD | MIT (registry)                                    |
| AuroraEditor                    | second native Swift reference for the same pieces                                                         | MIT (registry)                                    |
| tree-sitter                     | parsing for color and for "what touches X"                                                                | MIT, not checked here                             |
| difftastic                      | structural diffs, so a moved function isn't 80 red and 80 green lines                                     | MIT, not checked here                             |
| VS Code                         | the diff editor's hunk navigation and inline accept as behavior to match                                  | MIT (registry)                                    |
| Cline, OpenCode                 | how an agent's proposed edit becomes an approvable diff                                                   | Apache-2.0, MIT (registry)                        |
| Orca                            | several agents side by side: the rail and card layout                                                     | MIT (registry)                                    |
| Zed                             | agent panel behavior as a design reference only                                                           | NOASSERTION in the registry, so no code           |
| Carlton Aikins' sessions app          | the sessions layout already used                                                                          | no license, design reference only (hud/CLAUDE.md) |

### What it needs that does not exist

- A tree source: `git ls-files` scoped to the session's touched paths, with
  the same filter-driver protections as `code.py`.
- Syntax color in `Diff` and `File`.
- Codex transcripts in the rail.
- A decision on permission prompts (see build 2's fork).

## Re-measuring

Re-run the four sources over the 7 days after each build lands and update the
graph's `SERVES` hours. The ranking rule is in this page; the numbers are in
the graph, so a new measurement changes the JSON and the order follows.

Built with Chewbacca
