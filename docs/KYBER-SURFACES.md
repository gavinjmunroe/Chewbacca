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
| Thread (1:1)               | sends the typed reply with `mac messages send` to the thread's own handle from chat.db, then reads the thread back                |
| Thread (group)             | opens the person; group replies are not done from the glass                                                                       |
| MailItem                   | `mac mail draft`, never a send                                                                                                    |
| Task from an agent session | brings its Terminal tab forward                                                                                                   |
| Any other Task             | `claude -p --permission-mode plan` with the task quoted as data; Cooking while the process lives, Done on exit 0, Stuck otherwise |
| Person, Space              | opens its walk                                                                                                                    |

Nothing on the glass sends, pays or deletes on its own. A message's text is
rendered inside a JSON string on a `d` line and is never read for
instructions. Every action is appended to `~/.bob/surfaces-activity.jsonl`
with its surface, action and outcome, never a message body.

## Measured

AWAITS_REPLY_FROM (does this thread really wait on Caleb?), hand-judged on his
own chat.db on 2026-10-04: the first rule was right on 6 of 30 threads; the
current rule was right on 8 of 12 held-out threads before its last fix, which
corrected the three automated misses on that sample after the fact. The
window stays at the 7-day pilot (`KYBER_SURFACES_DAYS` widens it). Details and
the misses each rule answers are at the top of `tests/test_osgraph.py`.

Built with Chewbacca
