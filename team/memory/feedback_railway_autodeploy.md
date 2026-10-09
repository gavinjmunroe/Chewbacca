---
name: railway-autodeploy-prefer-git-push
description: "Caleb's Railway services auto-deploy on git push to main; don't run `railway up --ci` after a push, let the auto-deploy handle it."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

When deploying to Railway, prefer `git push origin main` over `railway up --ci`. Caleb's Railway services in the `medha` project (medha-imessage, medha-id, medha-frontend, medha-trip-planning) are configured to auto-deploy on push to main.

**Why:** On 2026-05-18 I kept running `railway up --ci` after every commit, sometimes after also pushing. Caleb interrupted with "Push to github it should auto deploy on railway." The CLI deploys are wasted work, slower, separate build, and they can race against the auto-deploy from the same commit.

**How to apply:**

- After `git push origin main`, stop. Don't reach for `railway up`.
- Verify by tailing `railway logs` or curling the service URL a minute or two later.
- Reserve `railway up` for cases where you can't push (uncommitted local changes you want to deploy without committing, fresh service that hasn't been linked to GitHub yet, debugging a build that's not getting picked up from the repo). Even then, mention you're using it and why.
- Env-var changes via `railway variables --set` should also trigger an auto-redeploy unless you pass `--skip-deploys`. Don't follow them with `railway up` either.
