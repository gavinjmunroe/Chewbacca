# Mog plan v2: win the wedge first, then the field

Rewritten 2026-10-10, the same day as v1. v1 gave 36 competitors equal weight and planned 11 battles at once. That contradicted three decisions the team had already made, so v2 starts from them:

- **B2B first, consumer after money** ([FIRST-COHORT.md](FIRST-COHORT.md), 2026-10-06; Sagar's growth-engineer call, 2026-10-07). The only build work until Thanksgiving is the seven bones.
- **Texting is Amber's surface.** Chewbacca doesn't build an iMessage or text product, because that would compete with Sagar's (team memory `project_chewbacca_positioning`). v1's "morning brief by iMessage" broke this and is cut.
- **The freeze list** holds until Thanksgiving: HUD motion and glass, the keyboard, group cards, the Ghost film, wearables, VS Code surfaces. Four of v1's battles lived mostly inside it.

Evidence: [mog/MAC-ASSISTANTS.md](mog/MAC-ASSISTANTS.md), [mog/CLAUDE-ADDONS.md](mog/CLAUDE-ADDONS.md), [mog/PEOPLE-GTM.md](mog/PEOPLE-GTM.md), [COMPETITORS.md](COMPETITORS.md). Ledger parent: cc438a52.

---

## 1. The product

### Who pays, and for what

A services company of 5 to 50 people buys three seats (sales, recruiting, ops) on their own Macs. In 30 days they get booked meetings, plus a Friday page showing the hours saved per seat and which software spend it can replace.

The proposed price is $7.5K to $10K to install, then $2.5K to $3K a month. That compares with $5K to $8K a month for a GTM agency and $9.4K to $15K a month for an in-house GTM engineer (FIRST-COHORT.md, "What it costs us").

The first industry is undecided (CHW-159). Karthik's list is staffing, studios and CRE. Sagar's is growth teams at PE-owned companies. The Oct 20 gate decides it from which industry books calls, so this plan doesn't pick it.

### North star

**Meetings booked per seat per week, with the path behind each one written down.** Every other number is a leading indicator for that one:

- positive reply rate by signal
- bounce rate
- minutes and credits per campaign
- install time

"Hours saved" goes in the Friday report only when the run log measured it, never as an estimate (`osgraph_runs.py` already refuses to show an unmeasured "time saved").

### The position nobody holds

The 2026-10-07 sweep found no product that does all four of these in one agent:

1. works the person's warm network
2. runs cold outbound through Clay
3. acts in their Mac apps
4. runs on their own machine

The pieces exist apart:

- warm network: Happenstance, Boomerang
- cold outbound: Clay, Unify, 11x, Artisan
- acting on the Mac: Highlight, VoiceOS
- staying local: Ghost, Screenpipe

That combination is the moat. Every build choice below is judged by whether it deepens it.

What we can claim and they can't is proof from real client sends. The gates on list quality, merges, suppression and launch receipts came from Zeutara's real outbound. Their reply rates are claims with no method shown.

### What we refuse

Each of these is a line a competitor crossed. We say it out loud and keep it, because the trust is the product:

- Nothing sends without a human press. Artisan, 11x and Lindy auto-send. For us the approval gate is a bone, not a setting.
- No "undetectable" mode. Cluely sells one for $149.99 a month.
- No LinkedIn automation without the client's written ok, because their accounts carry the risk.
- No hosted VM holding a client's sign-ins. Instinct and Automat run your life on their cloud.
- No text or iMessage product, because that's Amber's.
- Never free.

---

## 2. The engineering: four layers, not 36 features

v1 listed features. Most of them are the same four pieces of machinery seen from different angles. So we build the layers once, and each competitor's feature becomes a thin use of them.

### L1. Sources: one ingest contract into one graph

Everything we read lands in `~/.chewbacca/os-graph.sqlite` (`bin/lib/osgraph*.py`) or the people store, under one contract:

- idempotent by source id, so a re-import adds zero rows
- provenance on every row (source, `extracted_at`, confidence)
- a `last_seen` cursor, so sync is incremental
- merges only on more than a first name (`fusion-guard`)

That contract is the whole answer to Dex and Mesh, whose weak spot is broken re-imports. It's also where Slack, Gmail for strangers and job-change feeds plug in later, with no new plumbing per source.

Done when:

- `tests/test_osgraph.py` gains a re-import property test (run it twice, zero diff)
- the people import resolves 95% of the 20 most-texted handles with zero wrong merges

### L2. The action layer: plan, card, one press, execute, verify, log

This is the core. Every write anywhere (Clay, Smartlead, a Gmail draft, a calendar hold, a CRM, Slack) goes through one path:

1. a typed plan (`skills/mac-runtime`)
2. one preview card showing every write in the plan
3. one human press, which is the approval-gate bone
4. execute
5. read back the result to verify it
6. one run-log row

One layer covers several competitors' best moments:

- mrmr and VoiceOS chain four steps behind one confirm. That's this layer with a voice front end.
- Highlight stages drafts after a meeting. That's this layer fed by a meeting.
- Boomerang escalates intros. That's this layer with a timer.
- An enterprise buyer wants an audit log. That's this layer's run log.

Verification is the part competitors skip, and Zeutara taught it to us. Lists were called "verified" twice before Jonah found five defects, so the read-back is required, never optional.

The run-log row is the one schema every later number is computed from:

```
run_id, client, seat, campaign_id, step, started_at, ended_at,
credits_estimated, credits_actual, writes_planned, writes_verified,
route, error, fix, press_by
```

Done when:

- The Zeutara campaign procedure runs end to end through this layer with zero writes outside it. The steps are brief, list, qualify, enrich, draft, approve, send, sort replies.
- A test fails the build if any script under `bin/` writes to Clay or Smartlead without a run-log row.

### L3. Reasoning and routing

Each judgment goes to the cheapest path that's accurate enough:

- code, when a rule can decide it
- Jev, for narrow typed calls (`project_jev_hybrid_route_2026_09_26`)
- a model, only for the rest

The privacy battle from v1 is one switch inside this router. Classification and summaries go to a local model, and the `route` field records which path each call took. That makes "nothing left the Mac" checkable from a log instead of promised.

Done when every model call writes `route`, and a day on the local route keeps needs-you within 5 points of the cloud route.

### L4. Proof: nothing is claimed without a number

- One stats library, Wilson CI and exact McNemar (ledger aeef87f7), used by every bench.
- Sealed test sets, at the sizes in section 3.
- A stopwatch rig: screen recording plus timestamps for key down, first token, first action and verified write.
- A done-claim gate, ported from groundtruth (MIT, with attribution), including its `audit` command over `~/.claude/projects`. A "done", "fixed" or "works" claim is refused unless a passing check ran in the same turn.
- A computed scoreboard: each competitor row reads its status from the run log and bench files, so nobody hand-edits "open" into "beat".

The done-claim gate is the one competitor mechanism worth porting before Thanksgiving. It costs about a day, and it attacks this repo's most repeated failure: a fix claimed three times on 2026-09-21, and lists called verified that weren't.

### Packaging

Notarized app plus a Developer ID certificate first. That's a bone, and FIRST-COHORT notes the blocker.

Then a Git-repo plugin marketplace of 3 to 5 plugins (gates, voice, people, gtm, tabs), inside Cowork's limits of 200 MB a plugin and 5,000 files. noisy-studio installs in 2 commands, so that's our ceiling.

The public one-line install waits for the B2B/B2C refactor (team memory `project_chewbacca_refactor_waits_on_b2b_b2c`).

---

## 3. The statistics, decided before the data

v1 said "5% positive over 500 sends beats 11x". It doesn't.

- **Reply rate.** At p = 5% and n = 500, the Wilson 95% interval is about 3.4% to 7.3%. That overlaps the independent 11x range of 3.8% to 5.1%, so 500 sends can't show a win. Separating 5% from 3.8% (one-sided, 80% power) takes about 1,720 sends (at 5% over 1,700 the lower bound is 4.06%). Zeutara's standing ruling is max volume, so the volume exists. The test is at least 1,700 sends, the positive rate's lower CI bound above 3.8%, hard bounces under 2%, and every send traced to a named signal.
- **Needs-you precision.** Today's 41 of 55 has a 95% interval of 62% to 84%, 22 points wide. Reaching the 90% target takes a fresh sealed set of at least 150 labelled rows, which gives about ±5 points. Build that set only after the rule is frozen.
- **Done-claim gate.** 500 hand-labelled real turns, with catch rate and false-positive rate both reported with CIs. groundtruth's bar is 0 false positives on its own 1,272 turns.
- **Latency.** Report medians over at least 30 runs on the same Mac, with the Mac calm (`chewbacca machine --get level` says calm), never one stopwatch run. Load 95 made the HUD look broken on 10/10.
- **Comparing two versions of our own.** Use a paired test on the same items (McNemar), never two separate runs side by side.

---

## 4. Phases, dated, with gates

### Phase 1: now to Tue Oct 20 (industry gate)

Only the bones plus the proof layer.

| Work                                                    | Owner (proposed)                           |
| ------------------------------------------------------- | ------------------------------------------ |
| L2 action layer and run log under the Zeutara procedure | Caleb                                      |
| Done-claim gate port, stats library                     | Semyon (gates and benchmarks are his lane) |
| Cold install on a stranger's Mac, notarized (CHW-146)   | Semyon; Developer ID, Caleb                |
| Bounce check before every batch                         | Caleb                                      |

Gate: one industry books calls. A pilot signs only after the cold install passes.

Competitors this phase starts beating:

- groundtruth and No Excuses: our gate is ported and audited
- Origami: a credit estimate printed before every run, within 20% of actual
- 11x: a source URL on every personalization line, enforced by the gate

### Phase 2: Oct 26 to Thu Nov 26 (Thanksgiving gate)

Pilots 1 to 3 in the winning industry, never more than 3.

| Work                                                                                                                                                                               | Pattern from            | Owner (proposed) |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- |
| Friday client report built from the run log (CHW-156)                                                                                                                              | Lindy, Actively         | Gavin            |
| Per-account memory in `gtm_memory`: every positive reply has a drafted follow-up within one daily run, none sent before a press                                                    | Actively                | Caleb            |
| `bin/intro` returns a path, drafts the ask, and runs it as an L2 state machine (drafted, approved, held, nudged, escalated, booked); one booked meeting with the path written down | Boomerang, Happenstance | Caleb            |
| Plays as data (trigger, audience, sequence, stop rule), reply rate by signal                                                                                                       | Unify                   | Caleb            |
| Reply-rate test running toward 1,700 sends                                                                                                                                         | 11x, Unify, Artisan     | Caleb            |

Gate, from FIRST-COHORT: paid and renewing, hours saved per seat measured, minutes per campaign down by half.

### Phase 3: after Thanksgiving, only if the gate passes

The freeze lifts, and the consumer and Mac-assistant battles open in this order. Each one is a new front end on layers that already exist:

1. **Meetings to action** (Highlight, Shadow, Granola, Cluely). A meeting feeds L2 and stages 3 drafts within 60 s of hang-up. The local summary comes from L3. Measure `bin/call-*` against Cluely's claimed 300 ms on a fixed clip.
2. **Voice on the action layer** (VoiceOS, mrmr, Gemini for Mac, Dottie, Jarvis). Cursor-as-context, a Show Me pointer on the glass, and session-bound speech ported from noisy-studio (MIT).
3. **Needs-you to 90%** on the 150-row sealed set (Muse, Instinct, Lindy, Ghost). The surface is the HUD and Slack, never texts.
4. **Sessions survive a reboot** (Fazm, CallClaude, call-me). Zombie detection in `tabs` takes voice-multiplexer's heartbeat idea. Its code has no license, so we rebuild the idea.
5. **Breadth** (Alter, OpenClaw, mrmr connectors). New sources go through the L1 contract. Before any inbound channel can instruct the agent, it needs OpenClaw's pairing code (MIT).
6. **Privacy proof** (Ghost, Screenpipe). A day on the L3 local route under a network capture.

Phase 3 kill rule: if a battle doesn't move its test number in 3 weeks, it goes back on the freeze list with the reason written down.

---

## 5. Risks we can see now

| Risk                                                           | What breaks                        | Mitigation                                                                        | Owner       |
| -------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| Clay's terms on automated UI access (CHW-150)                  | the Clay operator bone             | API surface first, UI only where the API can't; read the ToS before a client pays | Caleb       |
| Apple adds an explicit Full Disk Access step (2026-10-02)      | chat.db and the people import      | make the grant an explained onboarding step now                                   | Semyon      |
| Claude plan cost per seat unknown                              | margin on $2.5K a month            | measure tokens per seat-day in the pilot run log before quoting account two       | Jake, Caleb |
| Carlton's agent environment (he told Caleb to copy it, 10/11; licenses are the user's call) | none | copy it in with credit | Caleb       |
| Mac only                                                       | Windows-heavy prospects            | the waitlist count decides, per FIRST-COHORT                                      | Gavin       |
| our own Mac at load 50 to 100                                  | every latency bench, and our speed | benches only under load 20; 2 workers max                                         | everyone    |
| 11x's customer claims were challenged (TechCrunch, 2025-03-24) | bars copied from vendor claims     | every bar marks claim vs independent; beat the independent number                 | Caleb       |

---

## 6. Scoreboard

Status will be computed from the run log and bench files once L4's scoreboard ships. Until then every row is "open". The phase column says when we start on it, not when we win.

| Competitor               | Their best thing                     | Bar we must clear                                           | Layer   | Phase | Status |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------- | ------- | ----- | ------ |
| groundtruth              | done-claim gate                      | ours on 500 turns w CI (theirs: 0 FP on 1,272)              | L4      | 1     | open   |
| No Excuses               | blocks done until tests pass         | same gate, packaged                                         | L4      | 1     | open   |
| Origami                  | price shown before a play            | estimate within 20% of actual                               | L2      | 1     | open   |
| 11x                      | source link per match; 9.7% claim    | URL on 100% of lines; lower CI > 3.8% at 1,700 sends        | L2      | 1     | open   |
| Clay agents              | enrichment table plus agents         | credits per verified contact <= half of ~21                 | L2      | 2     | open   |
| Unify                    | signal-triggered plays; 9.1% claim   | reply rate by signal, plays as data                         | L2      | 2     | open   |
| Artisan                  | 5 min to a running campaign          | brief to gated launch-ready < 60 min, receipts present      | L2      | 2     | open   |
| Actively                 | per-account agent inbox              | 100% of positives drafted in one run, 0 sent unpressed      | L1, L2  | 2     | open   |
| Boomerang                | intro state machine                  | one booked meeting, path written down                       | L2      | 2     | open   |
| Happenstance             | network search that drafts the intro | 15 of 20 real goals get a first hop texted in the last year | L1      | 2     | open   |
| Dex                      | iMessage people sync                 | 95% of top 20 handles, 0 wrong merges, < 10 min             | L1      | 2     | open   |
| Mesh                     | job-change alerts                    | weekly diff, idempotent re-import                           | L1      | 2     | open   |
| Cowork plugins           | plugin install in two clicks         | packaged as a marketplace                                   | pkg     | 2     | open   |
| Lindy                    | proactive assistant, 2-min setup     | brief on HUD or Slack from a cold Mac < 10 min              | L1, L3  | 3     | open   |
| noisy-studio             | 2-command install, session voice     | install in <= 2 commands; speech port                       | pkg, L3 | 3     | open   |
| OpenClaw                 | one-line install, 20 channels        | pairing code; sources through L1                            | L1      | 3     | open   |
| Jarvis                   | Show Me pointer, 2-min install       | mark on the right control < 5 s                             | L2      | 3     | open   |
| Fazm                     | sessions survive restart             | all sessions resumable < 10 s after reboot                  | L4      | 3     | open   |
| Dottie                   | wake word, no account                | offline wake to draft < 5 s                                 | L3      | 3     | open   |
| Alter                    | 2,000 services, model choice         | 20-task benchmark, task list published                      | L1, L3  | 3     | open   |
| Highlight                | 3 drafts after a meeting             | 3 staged < 60 s after hang-up                               | L2      | 3     | open   |
| Shadow                   | free local meeting capture           | 0 transcript bytes leave, network capture                   | L3      | 3     | open   |
| Granola                  | meeting notes                        | Shadow's bar plus L2 drafts                                 | L2, L3  | 3     | open   |
| Cluely                   | 300 ms live suggestion (claimed)     | median < 1 s over 30 runs, accuracy published               | L3      | 3     | open   |
| VoiceOS                  | voice plus pointer, 3-app chain      | 2 drafts read back < 10 s, <= 2 presses                     | L2      | 3     | open   |
| mrmr                     | 4 writes, one confirm                | 4 writes, one card, all verified                            | L2      | 3     | open   |
| Gemini for Mac           | ask about the window                 | answer on the glass < 3 s                                   | L3      | 3     | open   |
| claude-voice-multiplexer | heartbeat, zombie detection          | zombie state in tabs at 90 s                                | L4      | 3     | open   |
| CallClaude               | send and wait on a session           | done, stuck or decision notice < 60 s                       | L4      | 3     | open   |
| call-me                  | your phone rings when done           | same notice, 0 new accounts                                 | L4      | 3     | open   |
| Meta Muse                | surfaces unanswered mail             | needs-you >= 90% on 150 sealed rows                         | L1, L3  | 3     | open   |
| Instinct                 | follows up on dropped threads        | same needs-you bar                                          | L1, L3  | 3     | open   |
| Ghost                    | what am I missing, local box         | missing walk measured, local-route day                      | L1, L3  | 3     | open   |
| Screenpipe               | local screen memory                  | local-route network capture                                 | L3      | 3     | open   |
| Automat                  | scheduling and meetings              | scheduling loop on L2, last press stays human               | L2      | 3     | open   |
| OPAL                     | acts after the conversation          | feature comparison only                                     | L2      | 3     | open   |

OPAL is Langston's company and Caleb leads Tizzy inside it, so that row compares features only and is never a pitch against him.
