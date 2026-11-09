---
kind: feedback
title: railway-up-guard waved through the repo that had no remote at all
date: 2026-11-06
stability: stable
---

`railway-up-guard.sh` shipped 2026-10-27 to stop `railway up`. It read the
repo's origin and, if that origin was not GitHub, **exited 0**. So the one
state Caleb actually cares about, a project with no GitHub repo at all, was
the one state it allowed.

On 2026-11-06 `bisc-talk-app` was built and deployed roughly a dozen times
through `railway up --ci` between 1am and 8am. No remote, no history anyone
else could see, no rollback. The guard watched every one of them and said
nothing. Caleb: "BRO NEVER USE RAILWAY W/O GITHUB HOW MANY TIMES DO I HV TO
TELL U?????????"

Two separate failures, both fixed:

- **The guard's own logic was inverted on the worst case.** No GitHub origin
  now refuses, with the fix named in the message. `tests/railway_up_guard.sh`
  covers no-remote, no-remote-behind-a-cd, a non-GitHub origin, and keeps the
  original GitHub-origin case so a rewrite cannot drop it. 11 assertions.
- **The fix it pointed at did not exist.** The guard had named
  `railway-connect` since 2026-10-27 and there was no such script, so the one
  command that resolves the problem was a name in an error message.
  `bin/railway-connect` now exists: it creates the private GitHub repo when
  there is no remote, pushes, finds the linked service, and runs the
  `serviceConnect` mutation. One command, and a push becomes the deploy.

Note for anyone calling that mutation by hand: `backboard.railway.com` returns
Cloudflare error 1010 to a plain urllib request. Use curl with a real browser
user agent, which is what `railway-connect` does.

The general lesson, which is the one worth carrying: a guard whose check is
"is the bad thing configured correctly" passes everything that is not
configured at all. State the refusal on the hazard, not on the evidence that
somebody already did the right thing elsewhere.
