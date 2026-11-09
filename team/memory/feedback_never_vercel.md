---
name: feedback_never_vercel
description: Never deploy, link or set up anything on Vercel; Railway is the host, and vercel-guard refuses it
metadata:
  type: feedback
---

Nothing goes on Vercel: no deploys, links, env, projects. Railway hosts every
site and service, on a clean `<name>.up.railway.app` from `railway-domain`.

**Why:** 2026-10-10, Erik Fish's redesign draft was deployed to Vercel because
the `site-spec` skill said to, and Caleb wrote "Bro never do anything on vercel
ever again." The skill now says Railway, and `.claude/hooks/vercel-guard.sh`
refuses any vercel command except tearing a project down.

**How to apply:** `railway init -n <name> -w "Caleb Newton's Projects"`,
`railway add --service web` (with `--repo` once the Railway GitHub app can see
the repo, so main auto-deploys), `railway up --service web --detach` otherwise,
the start script on `${PORT:-3000}`, then `railway-domain <name>`. Related:
[[feedback_railway_autodeploy]], [[feedback_railway_clean_domain]].
