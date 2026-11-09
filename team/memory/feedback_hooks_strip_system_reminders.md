---
name: feedback_hooks_strip_system_reminders
description: A hook that reads the user's last message from a Claude Code transcript must strip system-reminder blocks first, because real transcripts put them inside the prompt string
metadata:
  type: feedback
---

On 2026-11-03, building the Stop hooks for the public AI playbook kit (scope-cut-check, no-homework and the rest share one load_turn() parser), every fixture test passed. Running the parser on a real Claude Code transcript showed the user prompt string also carried system-reminder blocks: hook context, the date, other tabs' notes. A hook matching words like "every" or "how do I" in that string would fire on text the person never typed.

**Why:** Fixtures were written by hand from what the payload should look like, so they had no reminders in them. Only a live transcript showed the real shape.

**How to apply:** Any hook or tool that reads "the user's last message" from a transcript strips `<system-reminder>...</system-reminder>` (and similar injected tags) before matching. Test a new transcript parser against one real transcript from `~/.claude/projects/`, not only fixtures. The kit's version is load_turn() in ai-playbook kit/hooks.
