---
name: feedback_granola_transcripts_page
description: Granola's MCP pages long transcripts (truncated, next_offset) and wraps them in {"meetings":[...]}; granola-import reads every page, readers never page by hand
metadata:
  type: feedback
---

Granola's `get_meeting_transcript` returns at most 40,000 characters a page by default (80,000 with `max_chars`), cut at an utterance boundary, and reports `truncated`, `offset`, `total_chars` and `next_offset`. The answer is wrapped as `{"meetings": [{... "transcript": "System audio: ...\n\nMicrophone: ..."}]}`, and `get_meetings` answers in tagged text with the summary inside `<summary>` and people in `<known_participants>`.

On 2026-10-30 the Andrew Laffoon call (60,064 chars) landed cut at 37,474, and every imported meeting had `summary: None` (44 of 119 had no lines), because the importer read one page and its `find` never looked inside lists. Agents downstream were paging transcripts by hand.

**Why:** a cut transcript reads as a finished one. Nothing errors, and the last third of a call (often the commitments) is just gone.

**How to apply:** fix import shapes in `bin/granola-import`, never in the readers of `~/.chewbacca/meetings/rc-*.json`. `granola-import run` heals truncated imports each run; `granola-import repair` refetches truncated and unanswered ones, `--offline` reparses saved raw answers only. A meeting whose raw transcript reads `final` (`no_transcript`, `transcript_deleted`) is never fetched again. The test is `tests/test_granola_import.py`, with a two-page fake MCP, and meeting memory reads the result ([[project_meeting_autopilot]]).
