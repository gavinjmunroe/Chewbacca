# Phase 0: what is actually on this machine

Verified 2026-09-20 on Caleb's Mac. Every number here was run, not recalled.
Where the brief's number was wrong, the correction is marked **CORRECTION**.

## Corrections to the brief

| Brief said | Actual | Note |
| --- | --- | --- |
| 19 launchd agents | **18** | `ls ~/Library/LaunchAgents/*.plist` |
| 30 chewbacca skills installed | **29 symlinked, 30 in the repo** | `skills/interface` was added today and is not linked yet |
| `~/.bob/hud.sock` running | **stale** | socket file exists from Sep 5; no process is bound to it |

Everything else in the brief matched.

## Q1: which launchd agents actually fire

Eight of the eighteen are Caleb's. Ten are vendor (Perplexity 4, Google 3,
Adobe, watchman, tailscale).

| Agent | Schedule | Last exit | Verdict |
| --- | --- | --- | --- |
| `ai.nova.brief` | daily 08:00 | **0** | **ALIVE.** Calls Claude. See Q2 |
| `com.calebnewton.people-sync` | 07:30 daily | **0** | **ALIVE.** Wrote a healthy report at 08:27 |
| `com.calebnewton.people-dashboard` | KeepAlive | running, prior `-9` | **ALIVE**, pid 93496 |
| `com.claude.mac-endpoint` | KeepAlive | **1** | **DEAD, and loud.** See below |
| `com.claude.telegram-relay` | KeepAlive | **1** | **DEAD, and loud.** See below |
| `com.calebnewton.claude-contacts-export` | every 6h | **126** | **DEAD.** `Operation not permitted` |
| `com.calebnewton.linkedin-clay-sync` | daily 08:00 | **78** | **DEAD.** Config error |
| `com.linkedin-clay-sync.daily` | daily 08:00 | **78** | **DEAD, and a DUPLICATE** of the row above. Same script, same time, same failure |

**Five of eight are dead. Two of them are the same job registered twice.**

### The loud ones

`com.claude.mac-endpoint` and `com.claude.telegram-relay` both have
`KeepAlive=true` and both fail instantly with `error: Module not found`. Their
`WorkingDirectory` is `~/Desktop/2026-Code/claude-telegram-relay`, and that
directory now contains exactly one thing: `logs/`. **The source was deleted and
the agents were left running.**

launchd has been restarting them ever since:

```
mac-endpoint.error.log    811,640 lines
telegram-relay.error.log  811,674 lines
combined                   71 MB
last written               today, 16:39
```

**1.6 million crash-restart cycles**, burning CPU continuously, writing to two
files nobody has ever opened. This is the single largest piece of waste found.

### Dead ones whose output nobody reads

`claude-contacts-export` writes `Operation not permitted` to
`~/Desktop/claude-contacts/agent.log` every six hours. launchd cannot execute a
script on the Desktop, because the Desktop is TCC-protected and launchd has no
grant for it. It has been failing silently for at least a day and probably far
longer.

## Q2: does anything call Claude without Caleb typing?

**Yes, exactly one thing, and it works.**

`ai.nova.brief`, daily at 08:00:

```
/bin/bash -lc cd ~/Desktop/2026-Code/projects/nova && claude -p "/brief" --dangerously-skip-permissions
```

Today's run produced a real brief and correctly concluded "no events today, WP1
is the day." It opened with a prayer, because the global rule reaches an
unattended agent too. It also hit `You're out of extra usage · resets 9am`,
which is a real reliability finding: **the one working push channel shares a
rate limit with interactive use and will silently degrade on a heavy day.**

`mac-endpoint` and `telegram-relay` were designed to be push channels and
deliver zero. They are the 1.6M crash loop above.

## Q3: is there a voice path?

| Direction | Status |
| --- | --- |
| **Speech in** | **Working.** Plynn, on-device Parakeet, running now. Verified end to end today: `launch-to-ready 0.566s`, `AX trusted: 1` |
| **Wake word** | **Working.** `ChewieRouter.swift` routes a dictation beginning "Chewie" or "Chewbacca" to Claude Code instead of pasting |
| **Speech out** | **Present, unused.** `/usr/bin/say` with 177 voices. The kit calls it in exactly one place: a Notification hook that says the fixed string "Claude Code task complete" |

So the input half of voice is genuinely built and the output half is a single
hardcoded sentence.

## Q4: does anything listen on the hud socket?

**Caleb's guess was right: zero.**

- `bin/hud-listen` exists, is documented in `skills/hud/SKILL.md`, and has a
  pytest suite
- No process is running it
- No launchd plist references the hud at all
- No hook references the hud at all
- `~/.bob/hud.sock` is a stale socket file from Sep 5 with nothing bound

`Button`, `Field`, `Select` and `Checkbox` can all send actions back up the
socket. **Nothing has ever been on the other end.** The glass is write-only in
practice, exactly as diagnosed.

## Q4b: the finding that changes the diagnosis

`bin/hud-watch` already exists, and its own docstring states the problem:

> Notice things, and say so. Sparingly. [...] proactive is easy to build badly.
> A thing that interrupts whenever it has an opinion gets muted within a day,
> and a muted assistant is worth less than none because you now believe you
> have one.

Its own docstring describes what it implements, and all of it is present:

- fingerprint-based dedup, so nothing is said twice
- only the single worst finding is surfaced
- a hard cap per hour, persisted across restarts
- silence unless a finding got worse or a day has passed
- self-expiring surfaces

Run today, it worked and found a true thing:

```
$ hud-watch --dry-run
would draw: coursework.soon (severity 2)
  WRIT 150 Writing Project 1 final draft   today Sun Sep 20
  WRIT 150 WP1 Self-Assessment             today Sun Sep 20
$ hud-watch --status
budget: 0 of 2 used this hour
1 finding(s) remembered:  357.4h ago
```

**It has never been scheduled.** The single remembered finding is from a manual
run 15 days ago. The proactive engine is built, disciplined, tested, and not
plugged into a clock.

## Q5: foreign skills audit

`~/.claude/skills` holds 106 skills, and **88 of them are symlinks**:

| Source | Count |
| --- | --- |
| `~/Projects/agent-scripts` (Peter Steinberger) | **53** |
| `~/Desktop/2026-Code/projects/chewbacca` | 29 |
| `~/Projects/anthropic-skills` | 6 |
| real directories | 18 |

**A naive `grep -r` over the skills directory finds nothing, because it does
not follow symlinks.** Any prior audit that reported clean was wrong for this
reason. `grep -R` is required.

### Skills containing `/Users/steipete` (27 occurrences across 7 skills)

| Skill | What leaks |
| --- | --- |
| **`speaking`** | **Worst.** Peter's private speaking strategy path, his standing decisions ("no TED, no paid talks"), his 2027 budget, and a live Google Sheets URL to `Peter Steinberger Inbounds` |
| `remote-mac` | His named machines |
| `codex-huge-context` | His hosts Sol / Terra / Luna |
| `clawsweeper-status` | His service's URLs and workers |
| `release-mac-app` | His release paths (2 files) |
| `npm` | His 1Password/tmux flow |
| `browser-use` | His Chrome plugin path |

None of these break Caleb's machine today, because they are read-on-demand and
he never invokes them. The real risks are two:

1. **`speaking` will fire on a plausible sentence.** Its description is
   "Speaking ops: invites, keynotes, panels" and Caleb gets speaking invitations.
   It would then read a strategy file that does not exist and act on another
   person's standing decisions.
2. **It is a third party's private business data sitting in Caleb's kit**,
   reachable by any agent with filesystem access.

This is upstream's skill pack working as designed, linked per skill by
`setup.sh`. The fix is selection, not a patch: link the generic ones, skip the
seven that encode one person's life.

## What Phase 0 changes about the diagnosis

The brief's diagnosis was "everything is PULL." That is right about behavior
and wrong about cause. The sharper version:

**The push machinery is largely already built. It is unscheduled, unlistened
to, and in two cases crash-looping.** The gap is mostly wiring, not
construction. That is good news and it sets Stage 1.
