# Phase 2: the honest distance

Diagnosis under test: "everything in the kit is PULL." Phase 0 says that is
**right about behavior and wrong about cause.** The push machinery is largely
built already: what is missing is that it is unscheduled, nothing listens on
the socket, and two of the agents have been crash-looping since the code they
ran was deleted.

## A. What already exists and is not being used

The biggest bucket, as predicted, and the cheapest.

| Asset | State | What it would take |
| --- | --- | --- |
| **`bin/hud-watch`** | Complete proactive engine: dedup, worst-only, hourly cap across restarts, escalation gate, self-expiry. Verified working today, found a true finding. **Never scheduled.** | One launchd plist |
| **`bin/hud-listen`** | Exists, documented, pytest-covered. **Never run.** Nothing has ever been on the other end of a Button | One long-lived agent |
| **`ai.nova.brief`** | The only working push channel. Calls Claude daily at 08:00, produced a real brief today | Already works. Harden its rate limit |
| **Plynn + "Chewie" wake word** | On-device STT, running, verified `AX trusted: 1` | Already works. It is the input half of voice |
| **`/usr/bin/say`, 177 voices** | Present, used for exactly one fixed string | Deliberately leave mostly unused. See section C |
| **`people.db`, `chat.db`, coursework ledger, second-brain** | 3,349 people, 632,390 messages, live syllabus ledger, 4,072 notes | These are the sensors. Nothing polls them on a clock |

## B. What is genuinely missing

1. **A resident process that is not a terminal tab.** Everything agentic today
   dies when the tab closes. This is the actual architectural gap.
2. **A loop on the socket.** `hud-listen` exists; nothing runs it, so Button
   and Field are decorative.
3. **A written interrupt policy.** `hud-watch` has a budget but no grounded
   rule for what clears the bar. Phase 1 rules 7 to 13 are that rule.
4. **Outcome memory.** Nothing records whether Caleb acted on a surface or
   dismissed it, so rule 12 cannot be measured and the thing cannot improve.
5. **A kill switch that is one obvious move.** Required by rule 13.

## C. What he wants that the research says is a bad idea

**A proactive voice agent. Do not build it.** Rules 14 to 16. Voice is
transient, serial, unscannable and has command-line discoverability. It forces
every message into the center of attention, which is the exact thing rules 1
to 6 say to avoid, and it cannot be deferred, skimmed or re-read. Nielsen
Norman's own framing of the category is "poor usability, high adoption."

Plainly: **a talking ambient agent is the fastest way to build something that
gets muted within a week.** Speech out is justified in one narrow case, hands
and eyes busy plus a single short imperative, and status updates are never
that case. Caleb suspected this; the literature is harsher than his suspicion.

**A dense always-on HUD showing everything.** That is the JARVIS placebo
(rule 17) and it contradicts rules 1, 3 and 6. Five panels of live data is a
demo, not presence.

**Interrupting because something is relevant.** Rule 7. Relevance does not buy
an interruption. Only the budget governs.

## D. Impossible or not worth it on a Mac in 2026

| Want | Verdict |
| --- | --- |
| Free-air holograms | No haptics, arm fatigue, nothing to rest against. Movie affordance |
| Always-listening open mic with no wake word | Battery, privacy, and macOS will not allow silent continuous capture without obvious indicators. The wake word already solves it |
| Reading arbitrary app state without consent | TCC exists specifically to stop this, correctly |
| A model that never errs | Rule 13 is the design response. Plan for wrong, do not plan for perfect |
| Another scheduler | Explicitly out of scope. launchd already runs 18 agents |

## E. The ranking

Score = impact on presence (1-10) divided by effort in hours. Impact is
argued from a Phase 1 rule, not taste.

| # | Item | Impact | Effort (h) | Score | Grounded in |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | **Schedule `hud-watch`** | 9 | 0.5 | **18.0** | Rules 1-6, 9. The engine and its budget already exist |
| 2 | **Kill the 1.6M crash loop + dedupe linkedin agent** | 5 | 0.25 | **20.0** | Not presence, but it is 71MB and continuous CPU. Free |
| 3 | **Run `hud-listen`, wire one Button** | 8 | 2 | **4.0** | Rule 2: recentering must be possible, and rule 17: no placebo |
| 4 | **Outcome log: acted vs dismissed** | 7 | 2 | **3.5** | Rule 12. Without it nothing can improve |
| 5 | **Interrupt policy written into the engine** | 7 | 2 | **3.5** | Rules 7, 8, 13 |
| 6 | **Repair `claude-contacts-export`** | 3 | 1 | **3.0** | A dead sensor |
| 7 | **Resident supervisor process** | 9 | 6 | **1.5** | The real architectural gap |
| 8 | **Harden nova.brief rate limit** | 4 | 3 | **1.3** | It silently degraded today |
| 9 | **Unlink the 7 steipete skills** | 3 | 1 | **3.0** | Correctness and leak hygiene, not presence |
| 10 | **Speech out, narrow case only** | 2 | 3 | **0.7** | Rule 16. Low on purpose |

**Stage 1 is item 1**, and item 2 rides along because it is 15 minutes and
removes continuous waste. Item 2 scores higher on the raw math but is
housekeeping rather than presence, so it is bundled rather than headlined.
