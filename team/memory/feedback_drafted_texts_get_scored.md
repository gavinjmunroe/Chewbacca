---
name: feedback_drafted_texts_get_scored
description: Drafted texts for Caleb to send go in unlabeled fences, which slop-check used to blank; chat mode scores them now
metadata:
  type: feedback
---

A text drafted for Caleb to paste and send is prose, even inside a code block. slop-check blanked every fence, so on 2026-10-21 three drafts for a friend went out unscored, and the "doesn't just X, it Y" and "barely matters. It's HOW" contrasts in them scored 0 anyway. Caleb: "Not this, phrase, phrase" then "Bro did you break? What happend to the hooks/rules/tests?"

**Why:** a guard that never reads the text proves nothing ([[feedback_a_silent_guard_proves_nothing]]).

**How to apply:** `slop-check --chat` now scores unlabeled fences and still skips labeled code fences; tests in tests/test_slop_check_rules.py. Before handing over a drafted text, run it through `slop-check --chat --issues` yourself.
