---
name: feedback_ff_deploy_push_is_not_live
description: A push to firm-foundation main is not a deploy; the Vercel Action sat failing on GitHub billing for a day and nobody saw it
metadata:
  type: feedback
---

Firm Foundation's site deploys through `.github/workflows/deploy.yml` on gavinjmunroe/firm-foundation (see [[feedback_vercel_hobby_blocks_collaborator_commits]]). From 2026-10-28 17:35Z every run failed in 2 s with "The job was not started because recent account payments have failed or your spending limit needs to be increased". Eight pushes, including the /work quotes, the home work window and hero video v24, sat on main while firmfoundation.tech served the 10/28 03:22Z build. Found on 10/29 only because the v24 handoff said to check the live content-length.

**Why:** a 2 s failure with no logs looks like nothing happened. Each session pushed and moved on.

**How to apply:** after any push to firm-foundation main, run `gh run list --repo gavinjmunroe/firm-foundation --workflow=deploy.yml -L 1` and curl one changed asset or page before saying it's live. A billing annotation is Gavin's to fix (github.com/settings/billing on his account). Then `gh run rerun <id>`. Never try to get around it with a local `vercel` deploy.

**Update 2026-10-29 afternoon:** the repo moved to calebnewtonusc/firm-foundation and the site now deploys from its main on Railway (root /site); the Vercel Action and gavinjmunroe repo are retired. The rule holds: after a push, curl the changed file on firm-foundation.up.railway.app (or firmfoundation.tech once DNS points at Railway) and compare its size. `video/tools/web.sh` prints the size to expect.
