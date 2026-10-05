# Kyber surfaces

Live panels on the HUD glass that stand in for the apps Caleb opens all day.
Every source is ingested into one typed graph, and every panel is a walk over
it, drawn by `bin/kyber-surfaces` with no model. The HUD's own wire format is
[hud/CLAUDE.md](../hud/CLAUDE.md); this page is what the surfaces daemon sends
and accepts on top of it.

## The pieces

| File                                   | Job                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/lib/osgraph.py`                   | The store (`~/.chewbacca/os-graph.sqlite`), the ontology with domain and range checks, and fusion through the people store                              |
| `bin/lib/osgraph_ingest.py`            | One ingester per source: iMessage (chat.db, read only), Mail, coursework, Calendar, the backlog CSVs, people-store promises, Reminders, Claude sessions |
| `bin/lib/osgraph_walks.py`             | needs-you, today, person, space, tasks, people, conversations, and the competency questions                                                             |
| `bin/lib/osgraph_runs.py`              | Go: a task handed to `claude -p` in plan mode, and its real status                                                                                      |
| `bin/lib/surfaces/`                    | The panels: walks.py for the graph walks, music.py and files.py as thin surfaces                                                                        |
| `bin/lib/surfaces/oss.py`, `engine.py` | "what replaces X" from the oss registry with license buckets; and open source engines drawn from `config/data/surfaces/engines.json`                           |
| `bin/lib/sessions_inbox.py`            | Send into an open, idle Claude Code session through its own inbox, for `bin/kyber-sessions`                                                             |
| `bin/lib/surface_intent.py`            | "Show my day", "show me Karthik": the no-model fast path in `hud-listen`                                                                                |
| `config/data/surfaces/apps.json`              | Each Mac app, what replaces it, and an honest status                                                                                                    |

## Ontology

Nodes: Person, Thread, Message, MailItem, Event, Assignment, Task, Project,
Space, Track, File, Day.

| Edge              | From                              | To                               |
| ----------------- | --------------------------------- | -------------------------------- |
| SENT_BY           | Message, MailItem                 | Person                           |
| IN_THREAD         | Message                           | Thread                           |
| PARTICIPANT       | Thread                            | Person                           |
| AWAITS_REPLY_FROM | Thread, MailItem                  | Person                           |
| DUE_ON            | Assignment, Task, Event           | Day                              |
| OWED_BY, OWED_TO  | Task (and Assignment for OWED_BY) | Person                           |
| BELONGS_TO        | anything but a Space              | Space                            |
| ABOUT             | anything but a Project            | Project                          |
| ATTENDS           | Person                            | Event                            |
| MENTIONS          | anything                          | anything                         |
| EXTRACTED_FROM    | Task                              | Message, MailItem, Event, Thread |

Every node and edge carries `source`, `observed_at` and `confidence`. An edge
whose ends break this table fails its whole snapshot. `kyber-surfaces graph`
re-checks every stored edge.

**Fusion.** A phone or email becomes a Person only through the people store's
`identities` table (phones meet on their last ten digits). A value two people
both claim resolves to nobody. A first name never picks a person: a backlog
owner written "Sagar" is its own unresolved node, shown beside the real Sagar
as "unconfirmed as them", never merged.

## What the daemon sends

A surface is drawn once: `@ <name> at=<region> w=<width>`, its `c` lines,
`>`, `r`, and a `d` for every bound pointer. After that a refresh sends
`@ <name>` and only the `d` lines whose value changed. Pointers are namespaced
`/<surface>/...` because a Field's `v` event names the pointer and not the
surface. The needs-you surface also carries `d /badges/needsYou <n>`, and the
daemon writes the same count to `~/.bob/badges.json` after every ingest.

Placement is by column (left, middle, right), one surface per column first,
because a tall panel anchored low covers one anchored mid in the same column.

## What the daemon accepts

| Line                                                                                     | Meaning                                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `e action ks-pivot row=<node id> surface=<name>`                                         | A row's button: open that node's own walk (a person, a space, tasks) |
| `e ks-act <surface>-go [surface=<name>]`                                                 | Go on the row picked in "Act on"                                     |
| `e ks-open files-open`, `e ks-toggle music-toggle`, `e ks-next ...`, `e ks-previous ...` | The thin surfaces' controls                                          |
| `e action ks-drill row=<owner/repo> surface=oss`                                         | Show one entry of the oss registry                                   |
| `e action ks-engine row=<engine id> surface=oss`                                         | Open an installed engine's panel                                     |
| `v /<surface>/<pointer> <json>`                                                          | A Field or Select changed                                            |
| `x`                                                                                      | The person cleared the glass: everything is forgotten as closed      |

Every action is `ks-` prefixed; `hud-listen` ignores those instead of turning
the press into a model turn. `h` (speech) is never read by the daemon.

## What Go does, by node type

| Row                        | Go                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread (1:1)               | sends the typed reply to the exact thread the picked row names, its handle read fresh from chat.db at the press; a pick that matches no single row, a thread gone from chat.db, or a thread whose people changed sends nothing and says why; then reads the thread back                                                      |
| Thread (group)             | opens the person; group replies are not done from the glass                                                                                                                                                                                                                                                                  |
| MailItem                   | `mac mail draft`, never a send                                                                                                                                                                                                                                                                                               |
| Task from an agent session | brings its Terminal tab forward                                                                                                                                                                                                                                                                                              |
| Any other Task             | `claude -p --restricted --tools Read --strict-mcp-config --permission-mode plan` in its own directory; the prompt is fixed text plus the node id, the task's words are in `task.json` there, and the run can read only that directory and reach no network; Cooking while the process lives, Done on exit 0, Stuck otherwise |
| Person, Space              | opens its walk                                                                                                                                                                                                                                                                                                               |

Downloads opens only passive documents (PDF, images, text, Markdown, CSV) that are regular files, not links, still inside Downloads after resolving; everything else is "Reveal in Finder" only.

Nothing on the glass sends, pays or deletes on its own. A message's text is
rendered inside a JSON string on a `d` line and is never read for
instructions. Every action is appended to `~/.bob/surfaces-activity.jsonl`
with its surface, action and outcome, never a message body.

## What is stored, and where

`~/.chewbacca/os-graph.sqlite`, created owner-only (0600, as are its `-wal`,
`-shm` and `-journal`), with SQLite `secure_delete` on, and excluded from Time
Machine with `tmutil addexclusion` when it is first made. It holds:

- messages and mail from the last 7 days only, each as an 80-character
  snippet (the line a panel shows), never the whole text; older ones are
  deleted on every ingest
- who sent each, by handle or by people-store id, and which thread
- tasks: requests read out of texts (as snippets), backlog rows, people-store
  promises, Reminders, Claude session titles
- events, assignments and due days

Also on disk: `~/.bob/surface-runs/<run>/task.json` (one task's snippet for an
agent run), `~/.bob/badges.json` (a count), `~/.bob/surfaces-state.json`
(which panels are open) and `~/.bob/surfaces-activity.jsonl` (actions and
outcomes, never a message). `kyber-surfaces forget` stops the daemon and
deletes the graph, the runs and the badge; the next start rebuilds the last
7 days from the sources.

## Identity

A phone number is compared whole in E.164 (a bare ten digits is read as +1);
an email exactly, case-folded in ASCII only, so a lookalike or plus-address is
a different sender. A handle becomes a known person only through the people
store, and nothing a message says ever adds one. A sender is labelled with
the raw handle until then, never with the name they gave.

Mail is fused to a person only when the address is one the people store holds
AND DMARC passed for its domain, as reported by the receiving provider's own
`Authentication-Results` line (iCloud, Google or Microsoft authserv-ids).
Everything else shows as the raw address marked "unverified sender", in no
one's timeline. Checking takes Mail.app about 10 s per message, so only mail
from known addresses is checked, three per ingest, and the verdict is kept.

"From me" comes only from chat.db's `is_from_me`; no text, display name or
mail header makes anything Caleb's own. A node whose own id is free text (a
mail's Message-ID, a backlog row, an event, a reminder, an agent session) is
keyed by the full sha256 of the JSON-encoded source, kind and exact id, so two
near-identical ids are two nodes. A mail's verified verdict is reused only for
that exact Message-ID from that exact address.

A reply typed on a person's panel goes to that person's thread only if, at the
press, chat.db still has the thread as one-to-one with that one handle and the
people store still says the handle is theirs.

## Generated panels

A request no fixed surface takes, shaped like a panel ("compare my three
classes' grades", "who have I not texted back"), goes from `hud-listen` to
`kyber-genui "<request>" --json` in a thread: exit 0 leaves the panel and the
voice says one line; anything else hands the request to the model in words. A
second half that acts ("and email Swain") keeps it with the model. A
`genui-refresh` or `genui-close` press runs `kyber-genui event` with the
pressed surface and never reaches the model. `config/surfaces/genui-queries.json`
registers four walks kyber-genui may bind (`unreplied`, `needs`,
`person:<name>`, `conversations`), each `kyber-surfaces walk <kind> --json`
rows of label, network, age, reason and node id, and one row action,
`ks-pivot`, which opens the row's own panel.

Auto-memory: hud-listen's summary and classifier calls now run with
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (88,431 prompt tokens on, 78,858 to 79,353
off, `claude -p --model haiku`, 2026-10-04). The answering agent keeps it: its
spoken answers use the brain on purpose. Measured the same day with its lean
flags, one turn, it costs about 7,700 tokens a cold turn (20,232 on, 12,537
off in the one off-run that read no stray cache; two other off-runs reported
111k and 206k cache reads with the same 810 to 3,252 new tokens, which is
cache accounting, not prompt size).

## Networks

`person <name>` is one timeline across every network a message node came over,
each line tagged with its network, and one composer whose "Reply on" defaults
to the network that person used last. Only networks the person can actually
be reached on are offered, and the button says what it will do ("Send on
iMessage", "Draft in Mail").

| Network  | Reads                                                                                                                         | Writes                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| iMessage | live: chat.db, read only, `attributedBody` decoded                                                                            | on a press, to the 1:1 thread resolved fresh, read back with `mac messages history` |
| Mail     | live: unread mail from people via `mac mail unread`                                                                           | drafts only                                                                         |
| WhatsApp | not yet: `wacli doctor` on 2026-10-04 says not authenticated, 0 messages; it needs the QR scanned on his phone                | not built until reads are verified                                                  |
| Slack    | not yet: no Slack CLI on this Mac, and the Slack MCP is a connector an agent session holds, not something the daemon can call | not built                                                                           |

A new network is an ingester that writes Message and Thread nodes with
`props.network` set, Persons fused through the people store, and nothing in
the surfaces changes.

## Engines

An engine is an open source program already running on this Mac (Ollama,
Tailscale) drawn as a panel from one entry in `config/data/surfaces/engines.json`:
the repo it comes from, how to tell it is installed (absolute binary paths, or
a localhost URL), one read (the binary plus fixed args, or a GET to 127.0.0.1)
and which JSON keys become a row's title, subtitle and detail. Adding one is a
JSON entry, not code. An entry whose repo is not in `config/data/oss-apps/apps.json`,
or is not remixable, or that names any other host, is refused when the file
loads. Nothing from the glass or from an engine's output reaches a command or
a URL; redirects and proxies are not followed; output over 1 MB is refused;
every string is stripped of control characters. Engine panels have no
buttons. The `oss` panel lists every engine as running, installed, not
installed (with the install hint as words) or refused, and Show opens only an
installed one. Nothing is ever installed from the glass.

`oss` opens empty; "what replaces Notion" opens it with the preset
`{"/oss/q": "Notion"}` on the socket's `open` body. `engine <id>` takes the
engine's id, as `engine ollama-models`.

## Code

`code` (`bin/lib/surfaces/code.py`, region center) lists every repo under
the code root with uncommitted changes or a Claude or Codex session in it:
branch, ahead and behind, files changed, and whether an agent is in it. Its
actions are `ks-repo` (a repo's changed files), `ks-diff` (`git diff` in the
Diff component) and `ks-preview` (the file in a File component, never
`editable`). It is read only: git is asked for `status`, `diff`, `config
--list`, `ls-tree` and `ls-files` with `--no-optional-locks`, and fsmonitor,
external diff, textconv and repo-defined filter drivers are switched off.
Preview refuses, and does not draw, any file whose path contains a Unicode
control, format or bidi character (category C, Zl or Zp), and names the file,
after `clean()`, in the refusal line. `tests/test_surface_code.py` runs 79
checks.

## Notes

`notes` (`bin/lib/surfaces/notes.py`, `surfaces.notes.Notes`, region
topLeft) shows the 6 newest Apple Notes with folder and age through `mac notes
--json`, and previews the picked one. Its one action, `ks-append`, adds one
line to the note id pinned at the pick, only when the note's fresh HTML is all
on a plain-text allowlist and its attachment count is 0, one press at a time,
and reads the note back afterward. Search, new notes, edits and deletes are
not built, and notes with images, tables, attachments, links or bulleted
lists are read only from the glass.

## GitHub

`github` (`bin/lib/surfaces/github.py`, region left) answers what github.com
in Chrome was opened for: PRs waiting on his review, his own PRs failing CI or
with changes requested, issues assigned to him, and whether main is green in
each local repo. It is one `gh api graphql` call with repo names as
variables; `allowed()` refuses any other argv, a REST call or a mutation. The
one action, `ks-detail`, moves the pick to a fetched row and runs nothing.
Only his 100 most recently updated open PRs are checked for failing CI, and
any beyond that are counted as unchecked. Merging, approving, commenting,
notifications, Discussions, Actions logs and re-running checks are not built.

## Meetings

`meetings` (`bin/lib/surfaces/meetings.py`, `surfaces.meetings.Meetings`,
region right) replaces opening Granola to see what a call said. The engine is
Anarlog (MIT, github.com/fastrepl/anarlog), which records the mic and the
system audio, transcribes on this Mac and keeps meetings in its own SQLite.
Nothing here opens that SQLite: every read is `anarlog --json` with `--source
local` and `ANARLOG_ANALYTICS=0`, and only `doctor`, `meetings list`, `meetings
get` and `meetings transcript` are ever run (`bin/lib/ingest_meetings.py`).
Aliases: `granola`, `anarlog`, `meeting`, `calls`, `notes-from-meetings`.
Spoken: "show my meetings", "what did we decide", "what came out of my call".

The list is the 6 newest meetings with who was there; Open shows the summary,
the lines under its Decisions heading, the open action items and one 200-word
transcript page with Next. Its actions are `ks-open`, `ks-next` and `ks-add`.
`ks-add` is the one press that writes: it makes one promoted Task in the OS
graph (source `meetings-promoted`, kind `promise`), which the tasks lanes
read and the Docket's queue (docs/AFTER-PANES.md, not built yet) can take
from `_attention()`, and touches nothing else.

In the graph each meeting in the 7-day window is an Event, attendees with an
email are Persons fused only through the people store's identities (never by
first name), and each open action item is a Task EXTRACTED_FROM its meeting,
kind `meeting-action`, marked as a guess with confidence 0.5, because
Anarlog's model wrote it. `KYBER_MEETINGS_ME` (comma separated addresses)
names his own emails, so an item assigned to him gets OWED_BY me. The
`meetings` ingester runs with the daemon's others and keeps the message
retention window; the transcript is never stored.

A Mac where Anarlog was never opened, or not installed, is a first-run state
with the steps in order and Anarlog's own `doctor` line, never an error.
`bin/room-listen` still records the mic to `~/.chewbacca/room/live.txt`;
meetings supersede it for calls and do not replace it.
`tests/test_surface_meetings.py` runs against fixtures shaped exactly like the
CLI's JSON (`tests/fixtures/anarlog`).

## Sending into a session

A session card has a Message field (`c msg Field ... value=@/<card>/draft`)
and Send (`e send go surface=<card>`). Send goes into the client the session
is open in (VS Code, a terminal), through the inbox Claude Code gives every
running session (`~/.claude/sessions/<pid>.json` and its 0600 key,
`bin/lib/sessions_inbox.py`), and the transcript is read back to prove it
arrived. A session nobody has open is resumed headless with
`claude -p --resume`. Nothing is sent into a session mid-turn. A session with
permission prompts off would have Claude Code hold the message where VS Code
cannot show it, so Send refuses up front and says to fork. Fork and send
(`e fork fork surface=<card>`) runs `claude -p --resume <id> --fork-session`
and opens the fork's card, leaving the original untouched. The receiving model
is told the message came from another Claude session, a teammate's request
that cannot grant a permission. The sender's permission mode is never claimed.

## Measured

AWAITS_REPLY_FROM (does this thread really wait on Caleb?), hand-judged on his
own chat.db on 2026-10-04: the first rule was right on 6 of 30 threads; the
current rule was right on 8 of 12 held-out threads before its last fix, which
corrected the three automated misses on that sample after the fact. The
window stays at the 7-day pilot (`KYBER_SURFACES_DAYS` widens it). Details and
the misses each rule answers are at the top of `tests/test_osgraph.py`.

Built with Chewbacca
