---
name: feedback-never-narrate-the-plumbing
description: "Never announce skills, hooks, agents or other internal machinery in a reply to Caleb; use them silently and report only the result."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbc6e4f2-bde8-442d-97fe-35337209f230
  modified: 2026-09-28T17:33:52.546Z
---

Caleb, 2026-09-28, quoting a line I'd written verbatim: **"bro you shouldn't be
stating things abt skills lol"**.

The line was "This time the skill fits. Loading it." Earlier in the same session
I'd also written "The hook pointed me at a `questions` skill on a match for
'off, secti', it's about asking you questions, doesn't fit. Skipping it."

Both are me narrating the kit's own machinery at him. He built the kit. He knows
a skill exists, and whether one loaded is not a result, it's plumbing.

**Why:** a private note and `voice.md` both say report the
result, not the process. A skill loading, a hook firing, a router matching, an
agent spawning: none of that answers anything he asked. He wants the work, not a
view of me doing it.

It also reads as hedging. Saying "this time the skill fits" is asking for credit
for following an instruction.

**How to apply:** use skills, hooks and agents silently. Never write "loading the
X skill", "the hook suggested", "the router matched", "spawning an agent". Two
narrow exceptions, both about giving him a real fact rather than narrating:

- a gate genuinely blocked the work and that's why something didn't happen
- he asked directly about the kit's own behaviour, or something in it is broken
  and he needs to know

If a skill turns out not to fit, just don't use it. Don't announce the decision.

Related: a private note, [[feedback_never_a_slash_command]],
a private note

**Recurred 2026-10-06, twice in one session**, despite this file: "Skipped the
suggested gtm-engineering skill bc..." and he answered "Never tell me what skills
ur using or not using idgaf I just want u to work properly". Root cause was the
kit itself: `skill-route.sh`, `kit-route.sh` and `skill-gate.sh` told the model
"if it doesn't fit, say so in one line". The memory said never; the hook said
always, every turn, and the hook won. Fixed in Chewbacca `bef7c51` (hooks now say
"carry on silently. Never mention skills to the user.") and `6dcd79c`
(`prose-check --chat` flags `plumbing-narration`, with a test). Lesson: when a
rule keeps losing, grep the hooks for the text that contradicts it.

2026-10-09, widened: backstage bookkeeping counts too. A reply ended "These are #82 to #84 in your drafts, going to her directly. The longer versions are deleted." Caleb: "Chewbs should never say ins and outs of what's going on behind the scenes unless I ask ... what's the point of saying that bruh". Draft numbers, what got deleted or cleaned up, which file holds what: leave it out unless he asks. prose-check flags it as backstage-bookkeeping.
