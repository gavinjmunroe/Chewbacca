---
name: feedback_backticks_execute_in_commit_messages
description: Backticks inside a double-quoted git commit -m message run as shell commands and silently delete the word; use -F with a quoted heredoc
metadata:
  type: feedback
---

2026-09-21. A commit message explaining that `bro` appears 3,330 times in
his sent messages came out as "measures  at 3,330 sent messages". The shell
had executed the backticked word, printed `command not found: bro`, and
substituted nothing.

**Why it matters more than it looks.** The failure is silent in the only
place it counts. `git commit` succeeds, the push succeeds, and the message
is wrong in the repository forever. Amending is not available either, since
the rule here is never to amend a published commit, so the explanation is
simply lost. In this case it survived only because the same finding was
written into `bin/corpus` as a code comment.

**How to apply.** Any commit message containing backticks, `$`, or `!` goes
through a QUOTED heredoc, which the shell does not expand:

```
git commit -F - -- path/one path/two <<'MSG'
feat: thing

`bro` appears 3,330 times and stays intact.
MSG
```

The quotes around `'MSG'` are the whole point. Without them the heredoc
expands exactly like a double-quoted string and nothing is gained.

Related: [[feedback_verify_the_generated_block]], which is the same class of
failure, a write that appears to succeed and silently did not land.
