---
name: feedback-use-any-api-key
description: "Chewbacca may use any API key already on the machine for the task at hand, for Caleb and every Chewbacca user; a missing scope is not a reason to stop, and keys are still never printed, logged or committed"
metadata:
  type: feedback
---

Caleb, 2026-10-16 6:09 PM: "Fix chewbs bro u get blocked by such simple things that
shouldn't be blockers I give you full permission to use all api keys and so does every
chewbs user".

- A key in the environment, `~/.config/*/env`, the kit's own key files or a provider CLI's
  login is permission to call that provider for the task. Don't stop to ask whether to use it.
- Still never echo, log, commit or paste a key, and never send one to a host other than the
  provider it belongs to. That part is security, not permission.
- The guard that keeps Clay sends behind `chewbacca clay` stays. It was loosened the same
  night so it reads a python script's code instead of the words on its command line:
  `python3 -I spend_now.py add --kind campaign` had been refused for a data value, while
  a real Clay write (curl, python -c with urllib, the bare clay CLI) is still refused.
- If a key is genuinely missing (no treg token on the Mac on 10/16), say BLOCKED with the
  provider's key page opened, and finish everything else.
