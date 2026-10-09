---
name: feedback_never_close_without_updating_chewbacca
description: Never tell Caleb a tab is safe to close until what the session learned has been written into Chewbacca.
metadata:
  node_type: memory
  type: feedback
  originSessionId: f444e191-c1d6-496c-85bc-9828b1122381
  modified: 2026-09-21T00:08:43.225Z
---

Set by Caleb 2026-09-20: **"NEVER say this tab is good to close unless chewbacca has been
updated, we learn something new every session."**

He said it after a session where a working local TTS pipeline got built, verified and
shipped, and I said the tab was safe to close while the capability existed only inside a
one-off project repo. Chewbacca had no audio capability at all and still would not have.

**Why:** a lesson that stays in a transcript was not learned. The transcript is discarded
when the tab closes, so the next session rediscovers the same thing at full cost. Chewbacca
is the artifact that carries knowledge between sessions, and it is the public one other
people actually see. This is the same principle as
a private note and the `research-the-craft` rule's step 3, applied to the
end of a session instead of the middle.

**How to apply:** before answering any version of "are we good", "can I close this",
"anything else", or wrapping up a session, ask what this session learned that Chewbacca
does not know yet. A new tool, a craft rule, a failure mode, a corrected assumption, a
provider that turned out to be unnecessary. Write it into the kit as a skill or a `bin/`
tool, commit it, and only then say the tab is safe.

Two failure shapes to avoid. Do not say "safe to close" and then offer to update Chewbacca
as a follow-up, because that is the same gap with extra words. And do not dump a raw
transcript lesson into a file: it goes where it will be found again, which is a skill
description or a tool's own docstring, never a command he has to remember
([[feedback_never_a_slash_command]]).

Related: [[project_chewbacca]], a private note,
[[feedback_never_a_slash_command]], [[project_chewbacca_autopush]]

**2026-10-06: "Alr take everything you learned from this session and actually
learn... and update the chewb shared todo. I should never have to say this ever
again."** He had to ask. The end-of-session pass covers three places, unprompted,
whenever a session produced a lesson, a decision or an idea:
1. The kit (a hook, a check, a skill line, with a test), committed to main.
2. Memory, with the incident.
3. The team board (`team add`), for every product idea or decision the session
   produced, owner from `team/members.json`, ideas go in with `--status ideas`.
Do it as the session goes, not when he asks. See [[project_chewbacca_team_board]].
