# Mog plan: beating all 34, with a test for each

Written 2026-10-10 from three teardowns read that day ([mog/MAC-ASSISTANTS.md](mog/MAC-ASSISTANTS.md), [mog/CLAUDE-ADDONS.md](mog/CLAUDE-ADDONS.md), [mog/PEOPLE-GTM.md](mog/PEOPLE-GTM.md)) plus the personal-AI section of [COMPETITORS.md](COMPETITORS.md). Ledger parent: cc438a52.

A product counts as beaten only when its test below passes, on video or in a logged run, against a named number. Until then the row says "open". Most competitor numbers are their own claims with no method, so where a bar is "unmeasured" we set it, measure ourselves, and publish both.

## The order, and why

Battles run in this order because each one feeds the next. Nothing can be filmed until a stranger can install (B1), and nothing can be claimed until the measuring tools exist (B0).

- B0 Proof tools: everything else is measured with them
- B1 Stranger install under 5 minutes: 11 competitors win here today
- B2 "Done" means proven: cheapest win, MIT code to port
- B3 Waiting on you, and what am I missing: the daily habit Muse, Instinct and Lindy sell
- B4 Meetings to action, kept local
- B5 Voice that acts across apps with one confirm
- B6 Sessions that survive and ping you
- B7 The people graph that books a meeting
- B8 Outbound that beats the AI SDRs on real sends
- B9 Nothing leaves the Mac
- B10 Breadth of connectors
- Later: calls, finance, health (COMPETITORS.md jobs 8 to 10)

## B0. Proof tools

Nothing below can be claimed without these.

- Wilson CI and McNemar helper shared by every bench (ledger aeef87f7).
- A stopwatch rig: screen recording plus a timestamp log of key down, first token and first action, so every latency row is timed the same way.
- A stranger-install recording kit: a clean macOS user account, `cap` recording, and a checklist of each press.
- Done when: one existing number (voice first-words, 1.0 to 1.7 s) is re-measured through the rig with a CI.

## B1. Stranger install under 5 minutes

Competitors: Jarvis (about 2 min), Fazm, Alter and Dottie (download and open), Highlight and VoiceOS (signed .dmg), noisy-studio (2 commands), Cowork plugins (Customize, Install), OpenClaw (one curl line plus a wizard), Lindy (2 min claim), Artisan (running campaign in about 5 min).

- Package Chewbacca as a Git-repo plugin marketplace of 3 to 5 plugins (gates, voice, tabs, people, gtm) inside Cowork's limits: 200 MB a plugin, 5,000 files.
- Google sign-in for strangers: move the OAuth client out of Testing mode, or ship a path that needs no client of ours.
- The permission walk on the HUD (ledger 7f7f27f0), with Full Disk Access as an explained step before Apple forces one.
- `chewbacca welcome` answers land inside the same 5 minutes.
- Test: three people who've never seen it each install on their own Mac and get one useful answer from their own data in under 5 minutes, no help, filmed. Today: never passed.

## B2. "Done" means proven

Competitors: groundtruth (8 claim patterns, 21 exclusions, 80+ verifier commands, tuned on 1,272 turns, 0 false positives on that set), No Excuses (6 hooks, blocks done until tests pass).

- Port groundtruth's Stop gate with attribution (MIT): a "done", "fixed" or "works" claim is refused unless a passing check ran in the same turn.
- Port its `audit` command over ~/.claude/projects to measure our false-positive rate on Caleb's real turns.
- Package the gates as one named plugin (B1).
- Test: on 500 of Caleb's real past turns, the gate catches at least 90% of hand-labelled unproven done claims with a false-positive rate under 2%, both with CIs.

## B3. Waiting on you, and what am I missing

Competitors: Meta Muse, Instinct, Lindy (morning brief by text), Actively (agent inbox), Ghost (what am I missing), Automat.

- Needs-you precision from 75% (41 of 55, 72-hour label) to 90% on a fresh sealed set.
- Wire Slack and WhatsApp so a hole doesn't read as "nothing pending".
- The `missing` walk gets a measured conflict catch and a purchase or order source.
- A morning brief by iMessage, Lindy-style, built from the same walks.
- Test: cold install on a second Mac, first brief naming at least 3 real items from the user's own calendar, mail and texts in under 10 minutes, then cut to under 5.

## B4. Meetings to action, kept local

Competitors: Highlight (3 drafts staged after a call), Shadow (free, local, no bot), Granola, Cluely (300 ms claimed live suggestion, 95% accuracy), OPAL, Ghost.

- After hang-up, stage 3 drafts (email, message, task) behind one review, in under 60 s.
- Local summary model so the transcript never leaves the Mac (ties to B9).
- Measure `bin/call-*`: play one fixed 60 s sales clip, median time from end of question to suggestion, word accuracy against a reference transcript.
- Never copy Cluely's "undetectable" tier.
- Tests: 3 drafts in under 60 s from a real 30-minute call on a stranger's laptop; live suggestion median under 1 s with accuracy published; a network capture shows zero transcript bytes leaving.

## B5. Voice that acts across apps with one confirm

Competitors: VoiceOS (cursor as context, 3-app chain), mrmr (14 connectors, one confirm), Gemini for Mac (Option+Space, ask about the window), Dottie (wake word, no account), Jarvis (Show Me pointer), noisy-studio (speech bound to a session).

- Cursor as context: "reply to him" resolves from what's under the pointer.
- One confirm card for a 4-write chain, every write verified afterward (mac-runtime plans).
- Show Me: a Kyber mark lands on the right control, no model in the draw.
- Ask-about-this-window on the glass in under 3 s.
- Session-bound speech with fail-open hooks (port noisy-studio, MIT).
- Tests: one sentence on a Mail thread gives a reply draft plus a calendar hold, read back, in under 10 s with at most 2 presses; a 4-action command with one confirm, all verified; the Show Me mark on the right System Settings control in under 5 s.

## B6. Sessions that survive and ping you

Competitors: Fazm (sessions survive restart, 40 windows, phone remote), CallClaude (send and wait by tailing session JSONL), call-me (2,645 stars for "walk away, your watch rings"), claude-voice-multiplexer (heartbeat and zombie detection).

- After a reboot, every Claude session listed and resumable with history.
- Three notify events, done, stuck and needs a decision, by iMessage to your own number with no new accounts. call-me needs 3 accounts and 7 env vars.
- Zombie state in `tabs`: process alive, no heartbeat for 90 s.
- Tests: reboot to all sessions resumable in under 10 s, filmed; a stuck session texts you within 60 s of stalling.

## B7. The people graph that books a meeting

Competitors: Dex (iMessage sync, last message only), Mesh (many sources, job-change alerts), Happenstance (search over up to 7 accounts, drafts the intro), Boomerang (intro as a state machine with escalation).

- Full-history import resolves 95% of the 20 most-texted handles with zero wrong-person merges, in under 10 minutes cold. Dex keeps one message a contact.
- Idempotent re-import: zero duplicates after two runs.
- Weekly job-change diff against the LinkedIn match.
- `intro` returns a path and drafts the ask; the ask becomes a ledger state machine (drafted, approved, held, nudged, escalated, booked) with connector limits as rows.
- Tests: on 20 real goal queries, a path whose first hop he's texted in the last year for 15 of 20, with Caleb confirming 10 of 20 are real; one intro that ends in a booked meeting with the path written down.

## B8. Outbound that beats the AI SDRs

Competitors: Clay (Claygent, Sculptor, about 21 credits a row), Unify (9.1% positive reply claim on usage signals), 11x (9.7% reply claim, 3.8 to 5.1% in one independent test), Origami (credit price printed before a play), Artisan (0.098% positive replies per email in its own case study).

All of this runs under Zeutara's standing rulings: max volume, strongest fits first, never cut a list.

- A source URL on every personalization line, and the pre-send gate refuses a row without one. 11x shows this as UX, and Jonah's review demanded it.
- Credit estimate printed before any Clay run, checked against actual.
- Each playbook as a named Play (trigger, audience, sequence, stop rule) stored as data.
- Positive reply rate by signal type on a dashboard.
- Reasoning trace stored per agent-filled cell.
- Tests: over 500 Zeutara sends, positive reply rate at least 5% with every send traced to a signal and hard bounces under 2%; Clay credits per verified contact at most half the 21-a-row Claygent baseline; estimate within 20% of actual.

## B9. Nothing leaves the Mac

Competitors: Ghost (nothing leaves the home, $3,499 box), Screenpipe (local by default), Shadow, Alter (local models), Dottie (local model option).

- A local model route for classification and summaries on Apple Silicon, so the film can say nothing leaves.
- Test: a full day of normal use with a network capture shows no transcript, message or mail text leaving, and needs-you precision stays within 5 points of the cloud route.

## B10. Breadth of connectors

Competitors: Alter (2,000+ services, 80+ actions), mrmr (14 live connectors), OpenClaw (20+ channels, pairing-code approval), Jarvis (30+ OAuth connectors).

- Slack, Gmail, Calendar, Linear and Notion working for a stranger, not just Caleb.
- OpenClaw's pairing code: any inbound channel must be approved before it can instruct the agent (MIT).
- Test: a fixed 20-task Mac benchmark, same Mac, Chewbacca vs Alter, median time to a correct result, task list published.

## Scoreboard

One row per competitor. "Open" until its test passes.

| Competitor               | Their best thing                     | Battle  | Status |
| ------------------------ | ------------------------------------ | ------- | ------ |
| Highlight                | 3 drafts staged after a meeting      | B4      | open   |
| Shadow                   | free local meeting capture           | B4, B9  | open   |
| VoiceOS                  | voice plus pointer, 3-app chain      | B5      | open   |
| Gemini for Mac           | ask about the window                 | B5      | open   |
| Cluely                   | 300 ms live suggestion (claimed)     | B4      | open   |
| mrmr                     | 4-step chain, one confirm            | B5, B10 | open   |
| Jarvis                   | Show Me pointer, 2-min install       | B1, B5  | open   |
| Fazm                     | restart-proof Claude sessions        | B1, B6  | open   |
| Dottie                   | wake word, no account                | B5, B9  | open   |
| Alter                    | 2,000 services, model choice         | B10     | open   |
| noisy-studio             | 2-command install, session voice     | B1, B5  | open   |
| claude-voice-multiplexer | heartbeat and zombie detection       | B6      | open   |
| CallClaude               | send and wait on a session           | B6      | open   |
| call-me                  | your phone rings when done           | B6      | open   |
| groundtruth              | done-claim gate, 0 FP on 1,272 turns | B2      | open   |
| No Excuses               | blocks done until tests pass         | B2      | open   |
| OpenClaw                 | one-line install, 20 channels        | B1, B10 | open   |
| Cowork plugins           | plugin install in two clicks         | B1      | open   |
| Dex                      | iMessage people sync                 | B7      | open   |
| Mesh                     | job-change alerts                    | B7      | open   |
| Happenstance             | network search that drafts the intro | B7      | open   |
| Boomerang                | intro state machine                  | B7      | open   |
| Clay                     | enrichment table plus agents         | B8      | open   |
| Unify                    | signal-triggered plays               | B8      | open   |
| 11x                      | source link per match                | B8      | open   |
| Origami                  | price shown before a play            | B8      | open   |
| Artisan                  | 5-min running campaign               | B1, B8  | open   |
| Lindy                    | morning brief by text                | B3      | open   |
| Actively                 | per-account agent inbox              | B3, B8  | open   |
| Ghost                    | what am I missing, local box         | B3, B9  | open   |
| Instinct                 | follows up on dropped threads        | B3      | open   |
| Meta Muse                | surfaces unanswered mail, drafts     | B3      | open   |
| Automat                  | meetings and scheduling              | B3, B4  | open   |
| Screenpipe               | local screen memory                  | B9      | open   |
| Granola                  | meeting notes                        | B4      | open   |
| OPAL                     | acts after the conversation          | B4      | open   |

OPAL is Langston's company and Caleb leads Tizzy inside it, so that row is about the feature only, never a pitch against him.
