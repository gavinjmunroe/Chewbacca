---
name: feedback_landing_a_railway_service
description: How to land a Railway service from tools/ without pre-push or land refusing it: name the Dockerfile *.Dockerfile, rebuild on fresh main when run.sh conflicts, and read a guard hit as a word match before acting on it (intro ledger, 2026-10-16)
metadata:
  type: feedback
---

Learned shipping the intro ledger (tools/creator_gtm/intro_ledger, main 1525a2bd) on 2026-10-16.

- Pre-push compiles every file under tools/ as Python, so a plain `Dockerfile` there fails with "SyntaxError: invalid syntax" on `FROM`. Name it `<service>.Dockerfile` and set the Railway variable `RAILWAY_DOCKERFILE_PATH=<service>.Dockerfile`. The redeploy keeps the volume and its data.
- `chewbacca land --paths` refuses when tests/run.sh changed on main "in the same lines". The line after test_table_graph.py was a hot spot that day, and two retries both lost to other tabs. The fix that landed: make a fresh worktree from origin/main, copy your new files in, insert your check line next to a quieter line, commit only your paths, then `chewbacca land <sha>`. destructive-guard refuses `git checkout origin/main -- <file>` even inside your own worktree.
- ready-guard matches the word "ready" in a reply, including "we're good" about other work and a relayed "don't call it ready until gtme ready prints READY". When it fires on a reply that claims nothing about a launch, say in one line what the reply was about and give the last real `gtme ready` result. Never run a launch to quiet it.
- A security review on the ledger caught 3 real bugs the first tests missed: an empty read token mapped to a client, CSV cells that run as formulas, and a negative Content-Length. Any small HTTP service we deploy needs those 3 checks before it ships (fixed in 51c6ed42 with tests).
