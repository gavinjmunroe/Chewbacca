---
name: feedback_railway_deploys_from_github
description: Every Railway service deploys from its GitHub repo on push to main; a service created by `railway up` has no repo attached and silently ignores pushes. Connect it with serviceConnect.
metadata:
  type: feedback
---

Caleb, 2026-10-27, after a pushed fix to the Kyber vote page sat undeployed for 10 minutes: "Bro ALWAYS make a github repo and deploy through there never dont use github!!!!!!!!!"

What happened: the kyber-landing Railway service was created and fed with `railway up`, so its source was empty (`repoTriggers` []). A `git push` to main deployed nothing, and the live site only changed when another tab ran `railway up` again.

How to apply:
- New Railway service: create the GitHub repo first, then connect the service to it (dashboard, or GraphQL `serviceConnect(id, input:{repo:"owner/name", branch:"main"})` with the token in ~/.railway/config.json and a `railway-cli` User-Agent, since a bare urllib request gets a Cloudflare 403).
- Before trusting "Railway auto-deploys on push", check `service.repoTriggers` is non-empty, or that `railway deployment list --json` rows carry a `commitHash`.
- Never `railway up` a service that has a repo; push instead. Connecting immediately builds the latest main.

Repeat, 2026-10-28: Caleb wrote "NEVER GO DIRECTLY TAO RAILWAY ALWAYS USE GITHUB" after a session ran `railway up` three times for the Firebox upgrade. railway-up-guard.sh was already installed in ~/.claude/hooks but was not in settings.json, so it never ran. A guard file on disk is not a guard: grep settings.json for its name, then send it one refused command through the real hook. It is now registered in the PreToolUse Bash dispatch next to vercel-guard, and firebox-upgrade's service shows a repoTrigger for main.

Related: [[feedback_railway_autodeploy]], [[feedback_railway_clean_domain]].

2026-10-28, OPTRA: the optra-upgrade service was also a `railway up` service, so three pushes sat undeployed. It got connected with serviceConnect, which was right. Then, during Railway's "deployments stuck in initializing" outage, a session canceled the stuck deploy and fired `serviceInstanceDeployV2` straight at the API, which skips GitHub just like `railway up` does, and railway-up-guard can't see it. Caleb: "Bro NEVER deploy direectly to railway, alwasy usse github". A git push to main is the ONLY deploy trigger: no `railway up`, `railway redeploy`, or deploy or redeploy mutations through the API. If Railway's queue is stuck, check status.railway.com, wait it out, and push an empty commit to retrigger once they recover.

Enforced since 2026-10-28: railway-up-guard also refuses `railway redeploy` and deploy or redeploy mutations sent to backboard.railway.com (tests/railway_up_guard.sh). Reads and serviceConnect still pass.
