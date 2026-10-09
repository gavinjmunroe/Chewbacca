---
name: feedback-slop-detectors-miss-his-list
description: ai-scan and slop-check score generic AI-isms and do not know Caleb's banned patterns; prose-check does, and prose-guard now checks files not just chat replies
metadata:
  type: feedback
---

**2026-09-16, his words: "I should NEVER have to tell chewbacca to stop the ai
slop tendencies! I thought we had already baked that in, wtf is happening?"**

He was right, and the cause was mechanical rather than a lapse of memory.

**Hole one, scope.** `slop-guard.sh` read only `.last_assistant_message`, so it
checked chat replies and never looked at files. A 1,434-word WRIT 150 essay went
straight to disk through the Write tool with nothing inspecting it. **His real
deliverables are files, and files were the unguarded surface.**

**Hole two, the detector.** `ai-scan` passed that essay with one low-severity
flag, and `slop-check` would have passed it too. Both score generic AI-writing
tells: delve, tapestry, robust, vocabulary diversity. **Neither knows what a
kicker is.** The draft carried six kickers, three not-X-but-Y constructions, two
announced turns ("Here's what I had backwards", "This is the part where I should
say why any of it matters") and two dramatic fragments, every one of them a named
ban in a private note.

**The fix, shipped, not just written down.**

- `bin/prose-check` in Chewbacca, symlinked to `~/.local/bin`, encodes voice.md
  and the fifteen 180DC corrections. Python, no model, no node.
- `~/.claude/hooks/prose-guard.sh`, a PostToolUse hook on `Write|Edit`, checks
  `.md` and `.txt` and hands what fired back to Claude. It skips `corpus/raw`,
  `archive`, `AI-LOG.md` and `EVIDENCE-*` so it never lints Caleb's own prose or
  machine-written records.
- `slop-guard.sh` now runs prose-check on chat replies as well.
- Registered in both `~/.claude/settings.json` and Chewbacca's shipped
  `settings/settings.json`, and added to the `link_tool` loop in `setup.sh` so a
  fresh install gets it.

Verified: 7 hits on the rejected draft, clean on the fixed one, 4 hits on a chat
reply built from his banned patterns.

**The transferable lesson.** A green light from a checker is only worth what the
checker knows. Before trusting any detector, confirm it tests the thing actually
being claimed. Checking the draft with `grep` for em dashes and emoji, and
calling that verified, was the same error in miniature.

See a private note, a private note,
a private note, [[reference_writing_toolchain]],
[[project_chewbacca]].
