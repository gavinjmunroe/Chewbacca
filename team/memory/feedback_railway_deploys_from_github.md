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

Related: [[feedback_railway_autodeploy]], [[feedback_railway_clean_domain]].
