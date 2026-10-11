---
name: feedback_vercel_hobby_blocks_collaborator_commits
description: A teammate's Vercel Hobby project silently skips deploys of Caleb's commits; the fix is a Railway custom domain + DNS swap, never paying for Vercel or recommitting
metadata:
  type: feedback
---

On 2026-10-11 Gavin thought Caleb's Firm Foundation site changes were "on a diff branch" and that he had "to get vercel premium to merge the changes". All 8 commits were already on his main. Vercel Hobby refuses to deploy commits whose author isn't on the account, so firmfoundation.tech kept serving the old site.

**Why:** the symptom looks like a git problem, so both people go chasing branches and money.

**How to apply:** when a teammate's domain shows an old site, first compare `git log origin/main` with what's live, and check `dig +short <domain>` for Vercel IPs (216.198.79.1, 64.29.17.1). If it's Vercel, add the domain on our Railway service (`railway domain <domain>`) and hand the owner the Porkbun records (ALIAS @, CNAME www) as a brief for their Chewbacca. Never Vercel, see [[feedback_never_vercel]]. Related: [[project_firm_foundation_site]].
