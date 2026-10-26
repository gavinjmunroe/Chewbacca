---
name: feedback_people_texts_lags_new_messages
description: people texts missed a doc link texted 3 min earlier; when he says "it's in the text" and the CLI shows nothing, read the newest chat.db rows once
metadata:
  type: feedback
---

On 2026-10-26 Colin texted his Activities List as a Google Doc link at 14:54. At 14:57
`people texts Colin` still ended at 14:41, and `people texts search` found nothing, so
the agent spent several calls on Drive, Gmail and attachment folders while Caleb said
"text". One `RAW_MESSAGES_OK=1` query of chat.db rows from the last 20 minutes showed
the link immediately.

**Why:** the people store reads Messages on its own schedule, so the newest few minutes
can be missing.

**How to apply:** when Caleb says something just arrived by text and `people texts`
doesn't show it, run one raw chat.db query for the last ~20 minutes before searching
anywhere else. Related: [[feedback_quiet_thread_is_not_broken_reader]] covers the
opposite case, where nothing new was sent.
