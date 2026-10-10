---
name: feedback_railway_clean_domain
description: Every Railway deploy gets a clean <project>.up.railway.app name before the URL goes to anyone; railway-domain does it, railway-domain-guard enforces it
metadata:
  type: feedback
---

A Railway deploy is not done until its public domain reads like the project. Railway generates names like `web-production-331de.up.railway.app`, and that is the URL that gets texted to people.

**Why:** on 2026-10-10 the Holy Spirit prayer tool shipped as `web-production-331de.up.railway.app` and Caleb wrote "Bro ALWAYS clean up the domain on railway deploys fix chewbs". It's now `askforthefire.up.railway.app`.

**How to apply:** after `railway domain`, `railway add` or the first deploy, run `railway-domain <name>` from the linked directory (it renames the service domain through the Railway API, creates one if missing, and tries `<name>-app` / `<name>-site` if taken). `railway-domain --check` exits 1 on a generated name. The PostToolUse hook `railway-domain-guard.sh` refuses any railway command whose output carries a generated domain, with `RAILWAY_DOMAIN_OK='<reason>'` as the escape. Related: [[feedback_railway_autodeploy]].
