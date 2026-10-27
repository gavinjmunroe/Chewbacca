---
name: feedback_static_site_serves_whole_repo
description: A Railway static site with a Caddyfile rooted at /app serves every file in the repo, including SPEC.md with private sources; root it at /app/public
metadata:
  type: feedback
---

A Railway static deploy whose Caddyfile says `root * /app` serves every file
`railway up` uploaded, not just index.html. On 2026-10-26 the Mark hype page
(mark-hype.up.railway.app) served SPEC.md at /SPEC.md with 200: it listed a
roommate's dated text quotes as sources. `.git` was not served (404), the spec was.

**Why:** the methodical-build rule puts a SPEC.md next to the work, and the
spec carries sourcing that should never go public.

**How to apply:** put the page in `public/`, set `root * /app/public`, and after
deploy curl `/SPEC.md` and `/README.md` and expect 404. Related:
[[feedback_railpack_static_needs_no_cache]].
