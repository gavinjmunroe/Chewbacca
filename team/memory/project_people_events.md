---
name: project-people-events
description: "people events scan turns Caleb's message archive into dated events on the relationship graph; built after he pointed out the first scan only extracted themes"
metadata:
  type: project
---

Built 2026-09-04, after Caleb said the first pass at his texts "left a lot of important things out": it mined **themes** and wrote prose, when what he wanted was **events logged on the days they happened**. "If I got in n out with someone that should be logged that I got in n out with them on that day."

```
people events scan --since 2025-01-01 --concurrency 8
people events list "Sagar"
```

**The design decision worth remembering:** the hard part is not finding "in n out", it is telling a plan from a memory. `"6pm in n out?"` and `"grabbing in n out now with Shirley"` are the same words about opposite facts. That distinction goes in `observations.modality` (`actual` / `planned` / `declined`), which Karthik's Amber schema already had for exactly this reason, and **only `actual` is written**, because a plan nobody confirmed is noise on a timeline of a life.

Two-stage funnel: a loose FTS lexicon picks which person-DAYS are worth reading (10,646 out of 501k messages, in 122ms), then Claude reads each day whole. Loose on purpose, since a day the filter misses is a day the model never sees.

**A full run is hours**, ordered newest-first and committing every batch, so an interruption costs only the batch in flight. Yield is about 10%: most days genuinely have no event, and that is the correct answer.

Related: [[project_amber_circles_architecture]], a private note, a private note.
