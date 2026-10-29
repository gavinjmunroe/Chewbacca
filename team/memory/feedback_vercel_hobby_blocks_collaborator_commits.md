---
name: feedback_vercel_hobby_blocks_collaborator_commits
description: A teammate's Vercel Hobby project silently skips deploys of Caleb's commits; fix with a GitHub Action that deploys main through the Vercel CLI (what Gavin did), never by paying or recommitting
metadata:
  type: feedback
---

On 2026-10-11 Gavin thought Caleb's Firm Foundation site changes were "on a diff branch" and that he had "to get vercel premium to merge the changes". All 8 commits were already on his main. Vercel Hobby skips deploys of commits whose author isn't on the account, so firmfoundation.tech kept serving the old site.

**Why:** the symptom looks like a git problem, so both people go chasing branches and money.

**How to apply:** when a teammate's domain shows an old site, first compare `git log origin/main` with what's live, and check `dig +short <domain>` for Vercel IPs (216.198.79.1, 64.29.17.1). If it's Vercel Hobby, the fix that stuck was Gavin's: a GitHub Action on push to main that runs the pinned Vercel CLI with his token, so anyone's commit deploys (`.github/workflows/deploy.yml` in gavinjmunroe/firm-foundation). Caleb ruled the site stays on Gavin's Vercel for now, so don't move a teammate's domain to Railway unasked: on 10/11 the Railway custom domains were added and then removed the same hour. Related: [[feedback_never_vercel]], [[project_firm_foundation_site]].

**Second failure mode (2026-10-29):** the Action itself can't run. GitHub refused every job on gavinjmunroe/firm-foundation with "recent account payments have failed or your spending limit needs to be increased", and every push to main failed this way from 10/28 on, so PR #3 (/team) merged but firmfoundation.tech/team stayed a 404. Neither Caleb nor an agent can fix it: Gavin fixes billing and re-runs the workflow, or hits Redeploy on the latest prod deploy in Vercel. After any merge to FF main, run `gh run list --branch main --limit 1` and `gh api repos/gavinjmunroe/firm-foundation/check-runs/<id>/annotations` (the job log is empty when billing blocks it), then curl the live page, before saying it shipped.
