# Kyber surfaces

Live panels on the HUD glass that stand in for the apps Caleb opens all day.
Every source is ingested into one typed graph, and every panel is a walk over
it, drawn by `bin/kyber-surfaces` with no model. The HUD's own wire format is
[hud/CLAUDE.md](../hud/CLAUDE.md); this page is what the surfaces daemon sends
and accepts on top of it.

## The pieces

| File                        | Job                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/lib/osgraph.py`        | The store (`~/.chewbacca/os-graph.sqlite`), the ontology with domain and range checks, and fusion through the people store                              |
| `bin/lib/osgraph_ingest.py` | One ingester per source: iMessage (chat.db, read only), Mail, coursework, Calendar, the backlog CSVs, people-store promises, Reminders, Claude sessions |
| `bin/lib/osgraph_walks.py`  | needs-you, today, person, space, tasks, people, conversations, and the competency questions                                                             |
| `bin/lib/osgraph_runs.py`   | Go: a task handed to `claude -p` in plan mode, and its real status                                                                                      |
| `bin/lib/surfaces/`         | The panels: walks.py for the graph walks, music.py and files.py as thin surfaces                                                                        |
| `bin/lib/surface_intent.py` | "Show my day", "show me Karthik": the no-model fast path in `hud-listen`                                                                                |
| `data/surfaces/apps.json`   | Each Mac app, what replaces it, and an honest status                                                                                                    |

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
| `v /<surface>/<pointer> <json>`                                                          | A Field or Select changed                                            |
| `x`                                                                                      | The person cleared the glass: everything is forgotten as closed      |

Every action is `ks-` prefixed; `hud-listen` ignores those instead of turning
the press into a model turn. `h` (speech) is never read by the daemon.

## What Go does, by node type

| Row                        | Go                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Thread (1:1) | sends the typed reply to the exact thread the picked row names, its handle read fresh from chat.db at the press; a pick that matches no single row, a thread gone from chat.db, or a thread whose people changed sends nothing and says why; then reads the thread back |
| Thread (group)             | opens the person; group replies are not done from the glass                                                                       |
| MailItem                   | `mac mail draft`, never a send                                                                                                    |
| Task from an agent session | brings its Terminal tab forward                                                                                                   |
| Any other Task | `claude -p --restricted --tools Read --strict-mcp-config --permission-mode plan` in its own directory; the prompt is fixed text plus the node id, the task's words are in `task.json` there, and the run can read only that directory and reach no network; Cooking while the process lives, Done on exit 0, Stuck otherwise |
| Person, Space              | opens its walk                                                                                                                    |

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

A reply typed on a person's panel goes to that person's thread only if, at the
press, chat.db still has the thread as one-to-one with that one handle and the
people store still says the handle is theirs.

## Networks

`person <name>` is one timeline across every network a message node came over,
each line tagged with its network, and one composer whose "Reply on" defaults
to the network that person used last. Only networks the person can actually
be reached on are offered, and the button says what it will do ("Send on
iMessage", "Draft in Mail").

| Network | Reads | Writes |
| --- | --- | --- |
| iMessage | live: chat.db, read only, `attributedBody` decoded | on a press, to the 1:1 thread resolved fresh, read back with `mac messages history` |
| Mail | live: unread mail from people via `mac mail unread` | drafts only |
| WhatsApp | not yet: `wacli doctor` on 2026-10-04 says not authenticated, 0 messages; it needs the QR scanned on his phone | not built until reads are verified |
| Slack | not yet: no Slack CLI on this Mac, and the Slack MCP is a connector an agent session holds, not something the daemon can call | not built |

A new network is an ingester that writes Message and Thread nodes with
`props.network` set, Persons fused through the people store, and nothing in
the surfaces changes.

## Measured

AWAITS_REPLY_FROM (does this thread really wait on Caleb?), hand-judged on his
own chat.db on 2026-10-04: the first rule was right on 6 of 30 threads; the
current rule was right on 8 of 12 held-out threads before its last fix, which
corrected the three automated misses on that sample after the fact. The
window stays at the 7-day pilot (`KYBER_SURFACES_DAYS` widens it). Details and
the misses each rule answers are at the top of `tests/test_osgraph.py`.

Built with Chewbacca
