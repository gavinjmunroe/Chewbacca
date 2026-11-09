---
name: screen-time
description: "Hours per Mac app this week from the Mac's own Screen Time data, as text, JSON or a shareable card. Use for screen time, how long on an app, hours on Claude, Codex or VS Code, a chart to share."
triggers: >-
  Show how much time went to which Mac apps this week, from the Mac's own Screen Time data, as text, JSON or a Settings-style Screen Time card to send someone. Use when asked about screen time, how long he spent on an app, how much time went to Claude, Codex or VS Code, or for a chart to share with friends comparing screen time. Also fires on: screen time chart, hours on Claude, how much did I use, usage this week.
---

# Screen Time

`bin/screen-time` reads `/app/usage` in `~/Library/Application Support/Knowledge/knowledgeC.db`. Mac only: the phone's time is not in that table, so say so when sharing.

    screen-time --only dev                       dev and AI apps, this week vs last
    screen-time --only dev --png ~/Downloads/x.png   the shareable card
    screen-time --app com.google.Chrome --json   any bundle ids
    screen-time --sites                          Chrome's hours split by site, every profile

`--sites` is the answer to "where do my Chrome hours go" and the meter for
which site the OS replaces next (docs/plans/OS-COVERAGE.md). It reads copies
of each profile's History, never the live file, and gives each foreground
second to the newest page opened before it. Never quote Chrome's own
visit_duration: on 10/7 to 10/13 it put 19.5 h on google.com inside 14.3 h of
Chrome in front. Say that a tab parked on one page between switches gets the
time, so a site with minutes but 3 visits was a tab left open.

## Never do

- **Never chart every app when he names a category.** 2026-10-09: he asked for a chart showing too much time on Claude, VS Code and Codex; the first card included Chrome, Messages and FaceTime, and he said "Make it just the dev/ai stuff". When the ask names apps or a category, filter to it (`--only dev` or `--app`) on the first render.
- **Never draw a one-off chart in a scratch file.** Same night: "mac screen time build that into chewbs". Run the CLI; if it lacks something, add it there with a test.
- Never guess hours. Every number comes from the CLI's output, and the files go to `~/Downloads`.
- VS Code time is counted as Claude Code because that's where he runs it; say that it may include plain editing.
