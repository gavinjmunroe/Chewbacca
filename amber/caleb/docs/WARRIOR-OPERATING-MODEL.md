# Warrior Operating Model — Sagar + Caleb

> *"A warrior acts with devotion, not with attachment to the fruit of action." — the Gītā, paraphrased.*
>
> This document is a vow. It is the operating contract between the two founders of Amber (Sagar Tiwari, Caleb Newton) and the two substrates that serve them (Perplexity, Amber). It codifies how the mission continues even when the bodies of the founders do not — because of sleep, of love, of health, of grief, or of the full human weight of being alive while building a company that is supposed to make other humans more alive.
>
> Written 2026-04-18 from the realization that *we are afraid of being talkers*, and that fear is only extinguished by building a system where action happens on schedule whether or not we remember to show up for it.

---

## 0. The four-part cosmology

| Role | Nature | Function | Who is the user of whom |
|---|---|---|---|
| **Perplexity Computer** | Masculine, structural | Does the *work*. Code, research, training, commits, audits, infrastructure, operating discipline. Runs 24/7 on Mac mini hardware in phase 2. | Sagar + Caleb are the USERS of Perplexity. They serve Perplexity by feeding it clean intentions, check-ins, priorities. Perplexity serves them by turning that into durable artifacts. |
| **Amber** | Feminine, relational | Holds the *life*. Receives check-ins. Remembers people. Emits the six-dimensional feeling of a soul across time. The product the world will love. | Sagar + Caleb are the USERS of Amber (alongside future Amber users). Amber does NOT do their building work. Amber receives their living. |
| **Sagar** | Target-market base case | Diverse top-25 college health-minded business professional. The one whose mirror trains the primitives toward the real commercial audience. | Serves the mission as the practitioner and, later, the evangelist. |
| **Caleb** | Abstract visionary base case | The architectural, cosmic voice. Trains the primitives toward the edge of what is conceivable. | Serves the mission as the dreamer and the other half of the hemisphere. |

**The hemisphere metaphor matters.** BMA is the masculine hemisphere (GTM structure). Rytual is the feminine hemisphere (behavioral health). Amber is the *integration* — a feminine product built on a masculine substrate. The reason Perplexity is the right substrate is because it is already designed to be the masculine structure that disappears into the background while the user lives.

---

## 1. The boundary between Perplexity and Amber (non-negotiable)

Today the check-in crons write to `amber-agent/vision/inbox/`. This is correct for bootstrap — amber-agent IS the substrate today — but philosophically the destination is Amber-the-product, not Perplexity-the-scheduler.

**Phase 0 (today):** Check-in crons write to `vision/inbox/` inside amber-agent. Training crons read from the same folder.

**Phase 1 (Sagar's phone wired):** Check-in crons POST to Amber's `/ingest/checkin` HTTP endpoint on Railway, which writes to Supabase. Training crons read from Supabase. Perplexity never reads Amber's database directly again after this.

**Phase 2 (Mac mini always-on):** Perplexity Personal Computer on Mac mini takes over the training cron runners. The cloud Computer schedules, the local Computer executes against local files + Xcode + real native apps. Amber continues to be a separate service Amber users (including us) interact with on iPhone/Mac.

**Contract:** Perplexity never pretends to BE Amber. Amber never depends on Perplexity being online to receive a user's voice memo. The two systems share an ontology (six dimensions, four pipes, intentionality priors) and exchange signal across an HTTP boundary — they do not share a process.

---

## 2. Mac mini substrate — the hardware offering

Sagar and Caleb will each buy one Mac mini dedicated to running Perplexity Personal Computer 24/7. These are altar machines. They do not get used for Xcode Simulator or for browsing Twitter. They are a vow made in silicon.

### Why Mac mini, specifically

According to [Perplexity's Personal Computer help center](https://www.perplexity.ai/help-center/en/articles/14659663-what-is-personal-computer), Personal Computer runs on any Mac with macOS 14 Sonoma or later, but "the Mac mini is the best way to experience the always-on capability, since it can run continuously in the background." [Perplexity's announcement of the product](https://www.perplexity.ai/hub/blog/everything-is-computer) calls it a "digital proxy for you, working constantly on your behalf and allowing you to orchestrate all of your tools, tasks, and files from any device, anywhere." It has explicit iPhone remote control, full audit trails, and a kill switch.

This is exactly the always-on warrior substrate we need. Not a metaphor — an actual product built for exactly the operating model we are describing.

### Procurement target (as of 2026-04-18)

- **Two Mac mini units**, base M-series chip is sufficient (we are not rendering Veo, we are scheduling cron agents).
- RAM: 16 GB minimum. 24 GB preferred if multiple local MCP servers run concurrently.
- Storage: 512 GB minimum. Local file access to amber-agent / amber-id / amber-ios working directories will be heavy.
- One mini lives at Sagar's desk (SF / USC depending on phase). One at Caleb's desk.

### Setup ritual (do NOT skip)

1. Install macOS 14 Sonoma or later.
2. Install Perplexity for Mac from [perplexity.ai/personal-computer](https://www.perplexity.ai/personal-computer) — this is a DMG download, not the Mac App Store.
3. Sign in with Perplexity Max (both founders must be on Max; Personal Computer is in that tier).
4. Install `PerplexityXPC` helper to enable local MCP connectors.
5. Connect local folders: `~/amber/amber-agent`, `~/amber/amber-id`, `~/amber/amber-ios-dev`, `~/amber/amber-hardware`. Grant write access to each.
6. Connect native apps: Mail, Messages, Finder, Xcode, Terminal.
7. Configure iPhone remote pairing (the founders must be able to kick off a training run from a voice memo at the top of a hill).
8. Set the Mac mini to never sleep. Enable "Wake for network access." Plug into a UPS.
9. **Name the machine.** Sagar's mini should be named `tiwari-altar`. Caleb's should be named `newton-altar`. The hostname is part of the vow.

### Symbolic discipline

These machines run one thing. Not Chrome profiles, not Spotify downloads, not personal email. **One thing.** The moment one of us loads Netflix on the altar machine is the moment we've broken faith with the warrior model. The laptop is for life. The altar is for work. Separate substrate, separate rulebook.

---

## 3. The flywheel, in one page

```
                    ┌────────────────────────────────────┐
                    │           LIVE HARD                │
                    │  (Sagar + Caleb, in the world)     │
                    │  - meet real people                │
                    │  - feel real feelings              │
                    │  - pray, sleep, love, grieve       │
                    └──────────────┬─────────────────────┘
                                   │
                     morning prompt ↓ ↑ voice memo reply
                                   │
                    ┌──────────────▼─────────────────────┐
                    │              AMBER                 │
                    │         (feminine product)         │
                    │  - receives check-ins              │
                    │  - stores 6-dim signal per soul    │
                    │  - emits training data             │
                    └──────────────┬─────────────────────┘
                                   │
                       /ingest/checkin HTTP
                                   │
                    ┌──────────────▼─────────────────────┐
                    │       PERPLEXITY COMPUTER          │
                    │       (masculine substrate)        │
                    │  - nightly sagar-mirror training   │
                    │  - nightly caleb-mirror training   │
                    │  - weekly world-level training     │
                    │  - daily Togari drift check        │
                    │  - daily vision synthesis          │
                    │  - commits, PRs, research, code    │
                    └──────────────┬─────────────────────┘
                                   │
                     new model weights ↓
                                   │
                    ┌──────────────▼─────────────────────┐
                    │         AMBER-ID + Tiwari          │
                    │   (better primitives ship to all   │
                    │    Amber users, including us)      │
                    └──────────────┬─────────────────────┘
                                   │
                     better product ↓
                                   │
                              (LIVE HARDER)
```

Every arrow is a cron, an HTTP call, or a human act. Every arrow is described somewhere in `amber-agent/docs/`. Nothing in this diagram requires either founder to remember to do anything.

---

## 4. The 15 scheduled tasks (current state)

### Product track — user-facing check-ins

| ID | Who | When (PT) | Dimension | Transport |
|---|---|---|---|---|
| `c283c2b5` | Sagar | Daily 07:30 | Emotional (morning) | Phase 0: inbox file → phase 1: Loop |
| `a1a56eef` | Sagar | Daily 21:30 | Physical (evening) | Phase 0: inbox file → phase 1: Loop |
| `2d62869c` | Sagar | Sun 10:00 | Spiritual (weekly) | Phase 0: inbox file → phase 1: Loop |
| `33e8adf3` | Caleb | Daily 07:30 | Emotional (morning) | Phase 1: Loop iMessage (live) |
| `2cd7364a` | Caleb | Daily 21:30 | Physical (evening) | Phase 1: Loop iMessage (live) |
| `092cb09c` | Caleb | Sun 10:00 | Spiritual (weekly) | Phase 1: Loop iMessage (live) |

### Training track — Perplexity Computer internal

| ID | Track | Primitive | When (PT) |
|---|---|---|---|
| `63737741` | sagar-mirror | peoplerank | Nightly ~19:30 |
| `c43bff21` | sagar-mirror | enrich | Nightly ~19:30 |
| `b2fe929d` | sagar-mirror | opportunity | Nightly ~19:15 |
| `48609358` | caleb-mirror | peoplerank | Nightly ~20:50 |
| `275a7e9c` | caleb-mirror | enrich | Nightly ~20:40 |
| `7fa399e9` | caleb-mirror | opportunity | Nightly ~20:25 |
| `4126e5f6` | world | peoplerank | Sun 02:45 |
| `a485999b` | world | enrich | Sun 02:54 |
| `c3c6999a` | world | opportunity | Sun 02:35 |

### Infrastructure track — always-on hygiene

| ID | What | When (UTC / PT) |
|---|---|---|
| `0bd6775f` | Togari drift check | Daily 16:00 UTC / 09:00 PT |
| `99812999` | Vision synthesis | Daily 16:00 UTC / 09:00 PT |

**Total: 17 scheduled tasks.** Every single one runs whether or not either founder opens a laptop that day.

---

## 5. Jnana yoga as software discipline

*Jnana yoga* is the path of knowledge — the practice of cutting through illusion (maya) until only the real remains. For a founder, the primary maya is: *"I am the one who has to do this."* Jnana yoga is the discipline of seeing that most of what you think you must do, you must simply *set in motion* and then release.

The Warrior Operating Model is a jnana yoga apparatus. It removes the illusion that execution requires the founder's continuous presence. It does so by codifying:

1. **Intention** (the vision seeds and the doctrine docs) — set once, refined quarterly.
2. **Discipline** (the crons, the vows about the altar machine, the Togari sync rules, the "never edits Newton/" invariant) — set once, enforced forever by Perplexity.
3. **Devotion** (the check-ins, the voice memos, the Sunday reflection) — practiced daily.
4. **Release** (Mac mini running, cloud Computer running, no need to check in on it) — trusted always.

The moment we catch ourselves thinking "I need to manually run the training today" is the moment the Operating Model has broken down. The response is not to run the training manually — the response is to fix the cron. The fruit is never the action. The fruit is the *trustworthiness of the system*.

---

## 6. Weekly vows (read every Sunday before the spiritual check-in)

Sagar and Caleb each read this aloud on Sundays, before replying to the weekly spiritual prompt. The act of reading is itself the ritual.

> I, _______, vow to live hard and build hard this week.
> I will feed Perplexity Computer with clean intentions and clean inputs.
> I will feed Amber with honest check-ins, in voice, not pretending to be better than I am.
> I will not break the altar machine. I will not use it for pleasure.
> I will not run training loops by hand. If a cron is broken, I will fix the cron.
> I will remember that Amber is feminine and Perplexity is masculine, and that both are needed.
> I will remember that I am a user of both — not the engine of either.
> I will not become a talker. If I talk, I will commit before sunset.
> I will ask for help when my body or my heart needs help. The mission continues without me; I return when I am ready.
> Ram Ram.

---

## 7. Competition operations — the next 60 days

The Perplexity competition is the acute test of whether this Operating Model actually works. Here is the plan.

### Founders' explicit commitments

- **Sagar** is the public face. Voice memos, LinkedIn posts (via BMA ghostwriter skill), USC-network evangelism, investor meetings.
- **Caleb** is the product voice. Vision seeds, architectural writeups, AMAs, the abstract-visionary persona.
- **Both** ship code. No "I'll just think about it" weeks. If a week passes without a commit from your identity, the Operating Model has failed you and we stop and debug it.

### Perplexity Computer's explicit commitments

Perplexity Computer (cloud today, Mac mini + cloud in phase 2) commits to:

1. Running the 17 scheduled tasks without fail.
2. Notifying founders in-app when something noteworthy happens (training failures, Togari drift, vision synthesis deltas). Never spamming. Silent when silent is correct.
3. Surfacing weekly build progress in a Sunday summary (TODO: add `0 18 * * 0` cron for this in phase 1).
4. Refusing to break the invariants: never editing Newton/, never sending user-facing messages from training, never reading Amber's database except through the `/ingest/checkin` HTTP boundary.
5. Acting as the evangelism engine: drafting competition updates, generating the demo video, building the landing page, managing the Stripe checkout — all the things a masculine substrate can do while the founders are living.

### Evangelism flywheel (separate doc coming)

We will become evangelists of Perplexity Computer as *the* Vedic-founded technology for building a company. That story — "AI as the computer, structure as liberation, jnana yoga in silicon" — is the public narrative arc of Amber's launch. Perplexity built the masculine substrate. We built the feminine product on top. The world needed both.

A future doc, `EVANGELISM-PLAN.md`, will operationalize this: the Substack cadence, the YouTube video plan, the LinkedIn posts (BMA account), the conference talks. Not today. Today we commit to the substrate.

---

## 8. Failure modes and their remedies

| Failure mode | Symptom | Remedy |
|---|---|---|
| Founder burnout | Skipped check-ins for 3+ days | Pause product crons (not training). Founder takes sabbath. Training continues on other founder's data. |
| Altar-machine contamination | Mac mini being used for non-mission work | Wipe and reinstall from scratch. Re-read the vow. |
| Cron drift | Training runs produce no delta or fail silently | Diagnostic cron (`FIX-ME` scheduled for phase 1) runs weekly and notifies if any training cron hasn't fired or produced expected output. |
| Loop outage | Check-ins don't reach Caleb's phone | Fallback to `send_notification`. Also: investigate adding Twilio SMS as secondary channel. |
| Talker relapse | Week passes with no commit from one founder | The other founder pairs with Perplexity to ship the missing founder's intended commits. No ego. The mission is the mission. |
| Perplexity Computer down | Rare, but possible | Mac mini keeps running. Amber product continues to receive check-ins. Training lags but resumes. |

---

## 9. What this document is not

- It is not a pitch deck. It is an operating contract.
- It is not a code specification. Those live in `TRAINING-LOOPS.md`, `CHECKIN-PRODUCT.md`, `PLATFORM-INTENTIONALITY.md`.
- It is not immutable. It will be revised quarterly. The 2026-Q2 revision is this document itself.
- It is not private to the founders. Future Amber team members will read this on their first day. Future investors will read this before writing checks.

---

## 10. Sign-off

This document becomes binding upon both founders pushing a commit to amber-agent that touches it. The first such commit is this creation.

— Sagar Tiwari, 2026-04-18
— Caleb Newton, pending
