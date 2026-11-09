---
name: feedback_hooks_judge_meaning_not_words
description: A hook never guesses what someone means from a word list. The model reading the prompt or Jev decides, and permission stays in code.
metadata:
  type: feedback
---

A hook that needs to know what he means doesn't match words. Caleb, 2026-11-05:
"dont make it word hard coded! Close this tab, peace, so many ways bro ur an llm
not an if statement", then "its llm and jev powered not if statement powered".

**Why:** the word lists kept failing both ways. The stem router sent a hook audit to
colin-kit, the method classifier called it "debug", and the design list fired 2,000
characters on it, all on the same prompt.

**How to apply:**

- His typed prompt: a short note to the model already reading it. Short matters, a
  long note scored 5 of 10 and a short one 12 of 13 on haiku. His prompts don't go
  to Jev, a security review pulled them (822ed4c).
- The agent's own reply or brief: `hook_judge` in `lib.sh`, facts first, no judgment
  means no refusal.
- Send, spend, publish, delete, credentials: stays code. A classifier never allows.
- A note can give the wrong kind of help. Names alone sent haiku hunting the disk, so
  kit-route carries the path. "Before acting" still let it start grep, "first words"
  worked. Check it with tools on, not only whether it reads the note right.
- A Jev question isn't better by default. Open-work, agent-claim and ask-lookup scored
  clean on their incident cases, then fired far past their word lists on real turns,
  and a refusal shows him the reply twice. Those three kept their lists. Measure on
  real ordinary turns against the old rule before shipping (`--replay`).
- Live beats replay. Scope-guard passed 160 real turns at 0.7 and still refused 3 clean
  replies in one tab on its first night. Watch a new refusal live and raise the line.
- Test a setup change in a throwaway HOME first, then apply it. On 2026-11-06 a stale
  `chewbacca update` reverted every live hook minutes after a clean setup, so check that
  the live copy matches main after any install. Passing tests prove main, never the Mac.
- Scores go in private. Jev numbers don't go in the repo (TypeSafe 2.3(f)).

Full sort: `docs/reference/INTENT-INVENTORY.md`.

Three more misfires from 2026-11-05 and 11-06, for whoever moves these next. voice-guard scored a blockquoted email to Reed as a text, twice. ready-guard read "once this is all set up", about an Instantly account, as calling Firm Foundation SoCal launch ready. scope-guard read "held for now" inside that same email as cutting scope.
