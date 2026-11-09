---
name: feedback_guard_fix_replays_real_commands
description: "A guard change lands only after old and new run over the 800 real commands in tests/fixtures/hookd-replay/bash.jsonl and every verdict change is read; on 2026-10-19 the first destructive-guard fix refused npm cache clean --force"
metadata:
  node_type: memory
  type: feedback
---

On 2026-10-19 a break-it pass reproduced 17 ways past destructive-guard (git -c alias.x=clean, eval "git restore .", checkout-index -f, read-tree --reset, stash -u, and a 192 KB heredoc that timed the hook out, which lets the command run). The fix passed all 17 new test cases on the first try.

Then old and new ran over the 800 real Bash commands in tests/fixtures/hookd-replay/bash.jsonl, from a dirty scratch repo. 4 verdicts changed, and 3 were wrong: `npm cache clean --force`, and two team comments saying "the fixed checkout this morning" and "restore". The new verbs got a prefix rule (git, a $var or a closing paren right before them), and the replay went to 1 change, `git stash -u` without -m, which is the guard's own rule.

How to apply: before landing any change to a refusing guard, run old and new over that fixture and read every changed verdict. New test cases show what the fix catches. The replay shows what it now breaks, and tests written by the person who wrote the fix never do.

Three more from the same night:

- A Stop-only check misses a long turn. thinking-dash-guard never ran during a 40 minute overnight turn, and 7 thinking dashes went out. It now runs on PostToolUse too, throttled.
- A test that prints SKIP and exits 0 counts as a pass. Ten did, test_send_policy among them. Skips exit 77 now.
- A credential scan has to match real token shapes. The brain mirror's scan matched placeholders like xoxb-your-token and blocked every backup for 8 days. It also never matched an Anthropic key, because the old sk- pattern stopped at the hyphen in sk-ant-.
