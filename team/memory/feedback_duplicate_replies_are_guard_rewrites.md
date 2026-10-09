---
name: feedback-duplicate-replies-are-guard-rewrites
description: "When Caleb sees the same reply twice back to back, a Stop hook refused the first one and the full rewrite landed beside it; prevent it by praying on every reply including one-liners and running prose-check on long drafts before sending."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbc6e4f2-bde8-442d-97fe-35337209f230
  modified: 2026-09-28T17:37:44.631Z
---

Caleb, 2026-09-28, with a screenshot of ten questions appearing twice: **"Why
sometimes do you say the same questions or answer back to back?"**

Measured it rather than guessed. Across 785 assistant text blocks in that
session, 4 pairs were byte-identical after stripping the opening prayer:

    msg 475/476   slop-guard
    msg 760/761   slop-guard     a banned word in the body
    msg 776/777   prayer-guard   prayer dropped on a short reply
    msg 782/783   prayer-guard   same

**The mechanism:** a Stop hook exits non-zero, the turn is refused, and the fix
is to re-emit the whole reply. Both the refused copy and the corrected copy end
up in his transcript, so he reads it twice. There is no partial edit at Stop: one
flagged phrase in a 600-word reply costs a full re-send.

So every duplicate he has ever seen is a guard catching something on the first
pass. It is not a rendering bug and it is not me repeating myself.

**How to apply.** Two fixes cover all four cases. Pray on every reply including
one-liners, because both prayer-guard hits were short replies where the opener
felt skippable and it never is. Then, for a long reply, run `prose-check` on the
draft before sending: it is on PATH and takes a file, so write the draft to a
temp file, check it, fix what it names, and send the corrected version. That
moves the catch from after the reply to before it, and he never sees the bad
copy.

Short replies need only the prayer. The check costs a tool call, so it earns its
place on long replies rather than on three-line answers.

Related: a private note, [[feedback_slop_detectors_miss_his_list]],
[[feedback_advisory_hooks_do_nothing]], a private note

## Second cause, same day (2026-09-28)

A Stop hook that returns `additionalContext` re-opens the turn, so the model
writes another closing message. `stop-check.sh` did this with "another
session's files are dirty, leave them alone and say so", and I answered it
twice in a row with nothing new. Fixed on Chewbacca main (7ebe1be): when only
another session's files are dirty, it exits silently. Any Stop hook that
speaks must hand over something this session can actually do.

## Enforced, 2026-09-29

It happened again ("Ur back to repeating yourself???"): four bold section
labels, refused, re-sent word for word. The "run prose-check first" advice
above was loaded and never ran. Fixed on Chewbacca main (d100b2a):
slop-guard no longer refuses format-only flags (bold-scaffolding,
chat-header, chat-table), since that re-send is a pure duplicate. It queues
them in `~/.chewbacca/voice-flags.pending`, and the new UserPromptSubmit hook
`voice-remind.sh` shows the chat rules plus last turn's flags before every
reply. Content flags (em dash, banned words) still refuse.

## Narrowed again, 2026-09-29 evening

Still happened with content flags: a 4-line reply with one colon reveal and one
"Not a midterm, but" got refused, re-sent reworded, and he sent a screenshot of
both plus "Bruh". Chewbacca main 26f4cdd: slop-guard now refuses ONLY em-dash and
banned-word. Every other flag queues to voice-remind for the next turn. Installed
to ~/.claude/hooks. Test: tests/slop_guard_format.sh.
