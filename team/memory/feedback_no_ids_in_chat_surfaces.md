---
name: feedback_no_ids_in_chat_surfaces
description: Anything the group chat reads leads with words, never an internal id like CHW-155; "the # doesn't mean jack to the gc".
metadata:
  type: feedback
---

On 2026-10-09 the team-board bubble cover in the Amber iMessage app led with the task number, and Caleb said "LLM generated title would be nice too, the # doesn't mean jack to the gc." Build 63 replaced it with a Claude Haiku headline ("Finished the Zeutara reply loop, started reading Clay's terms") and a verdict badge. See a private note.

**Why:** the chat is friends glancing at a bubble. An id is a lookup key for the board and the CLI, and it carries no meaning to a reader.
**How to apply:** on any surface a non-builder reads (bubbles, notifications, texts, covers, digests), lead with what happened in plain words. Keep ids in the activity log, the web board and commit messages, where they link things. Pairs with a private note and [[feedback_the_screenshot_beat_the_code]].
