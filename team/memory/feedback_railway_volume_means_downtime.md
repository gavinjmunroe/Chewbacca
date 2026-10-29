---
name: feedback_railway_volume_means_downtime
description: A Railway service with a volume attached stops the old container before the new one starts, so every deploy drops the site for about a minute; keep web services volume-free and put state in Postgres
metadata:
  type: feedback
---

Caleb, 2026-10-28, on the Anchored landing page: "WHY DOES IT KEEP CRASHING". Nothing in the app crashed. A volume had been attached at /data to store the church request form, and a volume can only mount on one container. So every deploy stopped the old server before starting the new one. Probing every 2 s through one deploy showed 9 straight failures, about 60 s of 502s. The "npm error signal SIGTERM" lines in the Railway log were just the old container being shut down. That night 15+ pushes, some docs-only from other tabs, each took the site down.

**Why:** with a volume, deploys can't overlap. Without one, Railway starts the new container and cuts over once it's healthy.

**How to apply:**
- Keep web services volume-free. Put form rows or state in a Railway Postgres service (`railway add -d postgres`, then set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the web service).
- Add railway.json with `watchPatterns` for app code only, a `healthcheckPath`, and `startCommand` running `next start` directly, not through npm.
- Measure it, don't assume it: curl the root every 2 s through `railway redeploy -y`. Anchored went from 9 failures to 0 of 75.

Related: [[feedback_railway_deploys_from_github]].
