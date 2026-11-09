# Phase 3: architecture

## The shape

```
  SENSORS (already on disk)          JUDGE                  GLASS
  ───────────────────────            ─────                  ─────
  coursework ledger  ┐
  people.db          │        ┌──────────────┐        ┌──────────────┐
  chat.db            ├──────► │  hud-watch   │ ─────► │   Bob HUD    │
  calendar / mail    │        │              │  draw  │  (periphery) │
  git / repos        │        │  budget      │        └──────┬───────┘
  second-brain       ┘        │  dedup       │               │ Button
                              │  escalation  │               │ Field
                              │  expiry      │               ▼
                              └──────┬───────┘        ┌──────────────┐
                                     │                │  hud-listen  │
                                     │   outcome      │  (the loop)  │
                                     ◄────────────────┴──────┬───────┘
                                  acted / dismissed          │ act
                                                             ▼
                                                      ┌──────────────┐
                                                      │ claude -p    │
                                                      │ then REPORT  │
                                                      └──────────────┘
```

Three processes, all under launchd, none inside a terminal tab.

## Constraint by constraint

**Works with no Claude Code tab open.** All three are launchd agents. The
judge is plain Python and makes zero model calls. Only the act path invokes
`claude -p`, the same way `ai.nova.brief` already does and has proven works.

**Can initiate, and what earns it.** Grounded in Phase 1, not taste:

| Earns an interrupt | Does not |
| --- | --- |
| A deadline inside its own lead time that is not done | Anything merely relevant (rule 7) |
| A state that got **worse** since last shown (rule 9) | The same finding restated |
| A thing only actionable inside a closing window | A thing actionable any time |
| Something the user asked to be told | Something interesting |

Hard budget: **2 surfaces per hour, persisted across restarts.** Already
implemented in `hud-watch`. The budget, not the finding, is the governor.

**Acts and reports rather than only displaying.** A Button carries an action
id. `hud-listen` receives it, runs the act, then draws the result. Report after
the fact with an undo (rule 18); confirm first only for outward-facing or
irreversible acts.

**Bidirectional glass.** `hud-listen` is the missing half and it is already
written. Every surface carries at least a Dismiss, because dismissal is the
signal rule 12 requires.

**Degrades safely.** Designed explicitly, because this is what decides whether
it survives:

| Failure | Behavior |
| --- | --- |
| Model slow | Judge never calls a model. Surfaces still draw. Act path times out and says it timed out |
| Socket dead | `hud draw` fails, exit non-zero, logged, **no retry storm**. This is the mac-endpoint lesson: 1.6M restarts |
| Sensor lies | Every finding carries its source and is rendered with it. A wrong finding is dismissible in one click and the dismissal is recorded |
| It is simply wrong | Two dismissals of the same finding class suppress that class for 7 days, automatically |
| Everything | `presence off` writes a flag the judge checks first, and unloads the agents |

**Privacy, stated precisely.** I verified this rather than asserting it,
because this kit has published a wrong "nothing uploads" before.

- The judge (`hud-watch`) makes **zero network calls and zero model calls.**
  It reads local files and writes Bob Lines to a unix socket.
- `chat.db` and `people.db` are opened **read-only** and only aggregate counts
  or a single name reach a surface.
- The **act path does call Anthropic** via `claude -p`, and whatever the
  surface's action text contains goes with it. That is a real upload and it is
  the one to be careful about.
- Therefore: **no message body, no observation text, and no contact detail is
  ever placed in an action payload.** Actions carry ids, and the act
  re-reads locally.
- [NEED: confirm whether `claude -p` telemetry includes prompt text under
  Caleb's current plan before any act payload carries a person's name.]
