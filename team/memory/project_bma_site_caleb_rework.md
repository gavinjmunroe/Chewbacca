---
name: project_bma_site_caleb_rework
description: Caleb-Rework is Caleb's redesign of bluemodernadvisory.com, live as its own Railway service beside prod; not merged to main
metadata:
  type: project
---

Caleb-Rework is a redesign of the BMA marketing site (repo
bluemodernadvisory/bma-website, Vite + React + Express, Railway auto-deploys
main to www.bluemodernadvisory.com). Built 2026-10-10 because Caleb said the
live site "looks so ai slop".

- Branch `Caleb-Rework` (commit 9b7daad), pushed, no PR opened.
- Deployed with `railway up` (not GitHub-linked) as service **Caleb-Rework**
  in Sagar's `bluemodernadvisory` Railway project, at
  https://caleb-rework-production.up.railway.app. Prod service `bma-website`
  untouched. Redeploy: `railway up --service Caleb-Rework` from the repo.
- The preview service has none of prod's env vars (ICP webhook, Togari key),
  so its forms don't reach the real pipeline. Intentional for a preview.
- Design: Figtree + JetBrains Mono for data only, weight 400 headings, square
  controls, accent means "press". Refusals and why are at the top of
  `src/rework.css`. Hero figure is a live sample verification queue
  (`src/figures.jsx`); process section is a scroll-driven dot figure using the
  real case-study numbers.

**Why:** Caleb plans to show it to Sagar and Maggie as the alternative to the
current site; merging to main is their call.

**How to apply:** iterate on the branch and redeploy the Caleb-Rework service;
never push it to main without Sagar or Maggie saying so. See
[[feedback_tasteful_editorial_is_the_new_slop]], [[feedback_website_four_layers]].
