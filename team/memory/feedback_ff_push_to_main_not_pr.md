---
name: feedback_ff_push_to_main_not_pr
description: Firm Foundation site work goes straight to main, never a PR; Gavin always says push to main (Caleb 11/5)
metadata:
  type: feedback
---

Firm Foundation site changes go straight to main on calebnewtonusc/firm-foundation. Railway deploys that push. Don't open a PR for Gavin to review.

**Why:** Caleb, 2026-11-05, while the church website study was being readied as a PR: "NEVER PR Gav always says push to main".

**How to apply:** Build on a worktree from origin/main, run the site's tests and a production build, push to main, then confirm with curl on the live page. Anything uncertain goes on the page as a stated limit, since nobody reviews it before it's public. Related: [[reference_ff_site_deploys_railway]], [[project_ff_search_2026_11_05]].
