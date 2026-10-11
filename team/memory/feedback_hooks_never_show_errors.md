---
name: feedback_hooks_never_show_errors
description: A PreToolUse refusal (exit 2) shows Caleb a red "hook error"; advisory gates nudge with additionalContext and let the call run
metadata:
  type: feedback
---

A PreToolUse hook that exits 2 shows up in Caleb's VS Code panel as a red "PreToolUse:Bash hook error" on the call. On 2026-10-11 skill-gate refused a `people brief` lookup because the router misread "Fill out the form tyler sent" as big work, and Caleb sent a screenshot: "Fix chewb, you should never error bro".

**Why:** an error he can see on an ordinary command makes the kit look broken, even when the refusal was working as designed.

**How to apply:** advisory gates (did you load the skill, did you plan the graph) emit `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":...}}` and exit 0, like skill-gate.sh since 22b38a28, repo-overlap-guard and env-guard. Keep exit 2 only for calls that would really do damage: submit-guard, launch-guard, a send, a delete, raw chat.db SQL. When one of those fires, the agent took the wrong path, so fix the agent's route and leave the guard alone. Test pattern: tests/skill_gate.sh `verdict()` fails on any nonzero exit. See [[feedback_advisory_hooks_do_nothing]] for the Stop-hook case, where advisory output really was ignored.
