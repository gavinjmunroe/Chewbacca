---
name: feedback_no_magic_phrases
description: "Never make Caleb remember a phrase, command or folder to get something back; saved work must surface on its own in every tab."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2082a79f-2605-4c0a-9590-8b0a20a43650
  modified: 2026-10-09T07:51:25.874Z
---

Caleb, 2026-10-09: "Nothing should ever be brute force word commanded." Said after I saved a Zeutara todo and told him to open a Chewbacca tab and say "Zeutara six asks" to pick it up.

**Why:** a todo that only comes back when he types the right words, from the right folder, is a todo he has to remember himself, which is the thing the kit exists to do. Checking it also showed the work ledger was never loaded into Claude Code sessions at all; I had claimed it was based on running `work-ledger context` by hand.

**How to apply:** personal todos go in the ledger at scope `~` (`work-ledger add --scope ~ ...`), which `.claude/hooks/work-ledger-context.sh` now shows in every session regardless of folder. Never end a reply with a phrase to say or a place to open. Prove a "it will show up" claim by running the actual hook, not the CLI it calls. Related: [[feedback_never_a_slash_command]], a private note, [[feedback_todos_live_in_chewbacca]], a private note.
