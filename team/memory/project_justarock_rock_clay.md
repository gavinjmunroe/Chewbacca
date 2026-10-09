---
name: project_justarock_rock_clay
description: justarock.ai serves the Just-A-Rock floating-rock waitlist (Rytual Health Clay signup); deployed from medha-frontend Railway service
metadata:
  node_type: memory
  type: project
  originSessionId: b1136e51-3940-4c50-b1d7-53a987b285d6
---

On 2026-06-08 justarock.ai was reverted from the Medha trip-planning marketing site back to the floating-rock waitlist landing.

Topology: the `justarock.ai` + `www.justarock.ai` custom domains live on the **medha-frontend** Railway service (medha project, Blue Modern Advisory), git-connected to `amber-organization/medha-frontend` main (auto-deploy). To change justarock.ai, push to that repo.

What shipped: the entire medha-frontend repo working tree was replaced with the Just-A-Rock app (Next 16 + react-three-fiber rock + single email form). Waitlist signups POST to the Rytual Health Clay webhook (`CLAY_WEBHOOK_URL` env var set on the service; also hardcoded as fallback in app/api/waitlist/route.ts). Verified live: title "Just a rock.", rock.glb loads, POST /api/waitlist returns ok:true (502 if Clay rejects, so ok:true = Clay accepted).

The standalone rock repo is `amber-organization/Just-A-Rock` (also deployed to the Just-A-Rock service in the amber project at just-a-rock-production.up.railway.app); its waitlist route was also switched Postgres -> Clay.

IMPORTANT side effect: the medha-frontend service now serves the rock at ALL its domains, including medha-frontend-production.up.railway.app. The old Medha web frontend (sign-in / dashboard / onboarding) is preserved on branch `backup/medha-frontend-pre-rock` (commit d75719a) and in history, but is no longer live. Medha iOS onboarding that pointed unlinked users at www.justarock.ai now shows the rock. Redeploy the Medha frontend to its own service/domain if that web flow is needed again. Related: [[project_medha_inapp_auth]].
