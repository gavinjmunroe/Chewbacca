---
name: feedback_call_prep_checker_runs_by_default
description: A founder call doc is checked by call-prep-guard after every Google Doc write; a checker only counts once it runs without anyone remembering it
metadata:
  type: feedback
---

call-prep-guard (PostToolUse on Bash) runs `bin/lib/call_prep_check.py --doc <id> --only-call-tabs` after any `gws docs documents batchUpdate`, inline or inside a .py script, and hands every FAIL back to the agent. It checks: 450 words max per founder tab, one founder per tab, a speaker on every step, `--absent <name>` for someone not on the call, plus the Junto checks (channel question, service line, Claude answer, price or [NEED: price range], no shorthand or jargon).

**Why:** 2026-10-28. The checker landed in the afternoon, but a tab had to remember to run it. The Firebox script still went out too dense ("Bro its wayyy too dense speak english"), with Gavin left in a solo call ("bro gav cant make it") and three founders in one tab. Run by hand it found 10 FAILs in the Firebox tab, then caught a one-line fix that put Gavin back in and pushed it to 460 words. Caleb asked twice "Did u rlly learn everything or just blindly make a md".

**How to apply:** Leave the hook on. When it reports FAILs, fix the doc and rerun with `--tab` and `--absent`. A line telling the reader to avoid a word ("never", "don't", "avoid", "no jargon") may name it; "No jargon like MCP" was a false positive on the OPTRA tab, fixed 4ff7b405. Lessons that code can't catch (what kind of founder this is, whether a site claim is true on the live page) stay in skills/prospect-brief and skills/gtm-engineering.

Related: [[feedback_founder_call_find_their_working_channel_first]], [[feedback_founder_call_say_service_and_engagement]], [[feedback_call_prep_plain_english_for_gav]].
