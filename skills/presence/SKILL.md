---
name: presence
description: "Make the agent ambient: notice things and surface them unprompted, inside a strict interruption budget. Use when asked to make Chewbacca proactive, notice things, tell me before I ask, run in the background, watch for X, or be more like JARVIS. Also use when tuning what earns an interruption, when a surface was wrong or annoying, and before adding any always-on or notifying behavior."
---

# Presence

Turning a kit that answers into one that notices. The research and the audit
are in `docs/`; this is how to work on it.

## The one rule everything else serves

**The budget governs, not the finding.** Two surfaces per hour, persisted
across restarts. A more important finding does not buy a third. Relevance does
not buy one either, because Mark 2008 showed same-context interruptions cost
exactly as much as unrelated ones.

If you are about to argue that something is important enough to exceed the
budget, you have found the failure mode, not an exception.

## Before changing what interrupts

Read [crafts/ambient-agent.md](../../crafts/ambient-agent.md), which holds
eighteen rules with a source next to each. The ones that get broken most:

- Rule 7: relevance does not earn an interrupt
- Rule 10: a correct alert is not a wanted alert. Clinical override rates
  exceed 85% on medically correct warnings
- Rule 13: a false positive costs trust across every future surface, a false
  negative costs one event. The threshold is not centered
- Rule 16: status is never the case for speech. A glance beats voice for
  anything re-readable
- Rule 17: no placebo surfaces. If the user cannot change the outcome from it,
  do not render it as though they can

## The pieces

| Piece | What it is | State |
| --- | --- | --- |
| `hud-watch` | The judge. Local only, no model calls | **Scheduled**, every 20 min |
| `hud-listen` | The loop that receives Button actions | Exists, **not yet run** (Stage 2) |
| `hud` | The glass | Working |
| `com.calebnewton.presence-watch` | The clock | Loaded |

## Turning it off

```
launchctl unload -w ~/Library/LaunchAgents/com.calebnewton.presence-watch.plist
```

One command, and nothing else in the kit changes. That is a requirement, not a
convenience: rule 13 says he will turn it off after two bad interrupts, so the
off switch has to be obvious and complete.

## Checking whether it is working

`hud-watch --status` shows the budget and every finding it remembers. The
metrics that actually decide are in `evals/evals.json`, and the one that
matters most is **dismissal rate**, not surface count. A system that shows a
lot and is dismissed a lot is failing loudly; a system that shows little and
is acted on is working.

## The hard line

**Do not add speech output.** It is Stage 5, it is conditional on three stages
of data showing a dismissal rate under 20%, and the literature says it is the
fastest route to being muted. If asked for it directly, say which rule it
breaks, build the glass version, and offer speech as an off-by-default mode
for the locked-screen case only.
