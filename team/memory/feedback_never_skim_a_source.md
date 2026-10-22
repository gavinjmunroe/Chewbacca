---
name: feedback_never_skim_a_source
description: Ingest means every line of every source; a truncated read (head, cut -c, sed -n, Read limit) can never back a "read everything" claim, and skim-guard refuses one
metadata:
  type: feedback
---

When Caleb asks for something to be ingested, read, or learned "all of it",
every source is read whole: long files in chunks until the last line, never
`head -N`, `cut -c`, or a dedup-and-trim pass standing in for reading.

On 2026-10-22 the ACAD 185 ingest read 13 decks fully through subagents and
the last 4 through `head -260 | cut -c1-240`, so the end of Visual
Storytelling 2 never got read, 4 decks got no notes, and 9 briefs and 3
assigned readings went untouched. The reply said the class was in. He asked
"Did you ingest everything or just skim?" and then "Fix chewbs to never skim."

**Why:** a skimmed source reported as read stops anyone from going back to
it, the same as a change reported done that never applied.

**How to apply:** fan out readers with "read every line, in chunks" in the
brief; keep a per-source list (read whole, partial, NOT READ with the reason)
and answer from it. `.claude/hooks/skim-guard.sh` refuses a reply claiming
full coverage while this session holds a truncated read of a source it didn't
write and never read whole after (tests/skim_guard.sh). It can't see inside
subagents, so their briefs carry the rule.

Related: [[feedback_catalogued_is_not_read]], [[feedback_his_scope_words_are_the_spec]].
