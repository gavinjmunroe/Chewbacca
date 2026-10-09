---
name: feedback_cross_agent_text_review_first
description: Anything that moves text between agent contexts gets the four injection/secret/export/permissions questions before its first commit, not one per security-review round.
metadata:
  type: feedback
---

The tab board (2026-10-09) shipped, then took five rounds of commit and push security review, one new finding each: markup posing as the reader's own framing, keys reaching another provider's tab, nested tags reassembling after a strip, the board leaking into the uploaded CHEWBACCA.md export, and sqlite WAL/shm files readable by group staff. Every one was answerable on the first read.

**Why:** five rounds is the "one audit, not five" failure; each round costs a commit, a merge race and a push.

**How to apply:** the four questions now sit in the security list of skills/reviewing-changes/SKILL.md. Ask them before committing any shared board, handoff, briefing or export. Related: [[reference_tab_board]], [[feedback_inferred_authorship_misfires]].
