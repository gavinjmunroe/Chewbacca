---
name: project_chewbacca_clay_history_fix
description: "Chewbacca's Clay search was silently returning current roles only; the one-line fix, and the 2,130-person work-history scrape that is paused at 162 and resumable."
metadata:
  node_type: memory
  type: project
  originSessionId: 9f35b1ad-d308-434c-88a5-7fb57849abdf
  modified: 2026-09-18T18:59:49.290Z
---

Opened 2026-09-18 out of a question Caleb asked about which of his contacts have
a Claude subscription.

## The bug, fixed and pushed

`clayCandidates` in `bin/people` asked Clay `select from people where full_name
= "X"`, and Clay answered with current roles only. Every past job was missing,
with no error and no empty field to notice it by. The comment directly under the
call claimed the opposite, that it was "a dated career history", and that
comment is what made me state twice, wrongly, that Clay could not return work
history at all.

One line fixed it: `and experiences.any(start_date >= "1900-01")`. Verified
live, 3 experiences before and 9 after. Commit `740becc` on `main`. The grammar
this rests on is at [[reference_clay_query_grammar]].

**There was no second bug.** I assumed throttling returned a 200 with an empty
body, which would make a rate-limited run write false "not found"s. It returns
429, and the existing retry already handled it. Checking beat patching.

## The scrape, paused not finished

Full work histories for all 2,130 LinkedIn connections. **Stopped at 162 on
2026-09-18 at Caleb's call**, to be finished another day.

Everything to resume is in `~/.chewbacca/clay-history/`: `cache.json` keyed by
name, `names.json` with all 2,130, and `scrape.py` already pointing at that
cache. Re-running skips what is cached. It is free, and the remaining ~1,970
people are about three hours at Clay's throttle.

The scraper requeues an empty result rather than caching it, after checking a
canary name known to exist, so a throttled run cannot write a lie into the
cache. That guard exists because five competing scraper processes were left
running earlier in the session and quietly rate-limited each other into
returning nothing.

## What the finished scrape is for

The Claude-subscription list at `~/Downloads/claude-subscribers-likely.csv` is
231 people and rests on current job titles plus what people said in his own
texts. The histories are what would catch the person whose LinkedIn row says
"USC student" today but who interned at an AI lab last summer. Three snapshot
diffs of his own exports already found 42 of those; Clay would find the rest.

Also unblocked by the same data: `location`, which
[[project_clay_enrichment_poc]] records as 0% filled and blocking four of
Karthik's five demo prompts. It comes back in the same free response.
