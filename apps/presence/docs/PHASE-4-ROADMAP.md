# Phase 4: staged roadmap

Each stage ships alone, demos, and turns off.

## Stage 1, today: the judge gets a clock

**What.** Schedule `hud-watch` under launchd, every 20 minutes while logged
in. Plus: unload the two crash-looping agents and the duplicate linkedin
agent, and truncate 71MB of error log.

**Attention cost.** At most 2 surfaces per hour, each self-expiring. Realistic
rate from today's dry run: roughly 1 to 3 a day, because the escalation gate
suppresses anything that has not worsened.

**Kill it.** `launchctl unload ~/Library/LaunchAgents/com.calebnewton.presence-watch.plist`,
or `hud-watch --off`.

**Revert if.** More than 2 surfaces in an hour, or a surface for something
already done, or any surface Caleb dismisses twice.

## Stage 2: the glass answers

Run `hud-listen`. Give every surface a Dismiss and one real action. Log both.
First bidirectional moment in the kit's history.

**Revert if.** A Button fires the wrong action once.

## Stage 3: outcome memory

Persist acted-vs-dismissed per finding class. Auto-suppress a class at two
dismissals. This is what makes it improve instead of decay.

## Stage 4: the resident supervisor

One long-lived process owning judge, listener and act, with health and a
single kill. Replaces the per-agent sprawl.

## Stage 5, conditional: one spoken line

Only if Stages 1-3 show a dismissal rate under 20%. One imperative, only when
the screen is locked or Caleb is away from keyboard. Off by default. If the
data does not clear the bar, this stage is cancelled rather than shipped.
