---
name: feedback_bulk_linkedin_lookup_engines
description: "Which search engines work for bulk LinkedIn URL matching on this Mac, measured 2026-10-28 on the 338-row OPTRA list; fan out WebSearch agents, never bulk the LinkedIn session"
metadata:
  type: feedback
---

Bulk "add a LinkedIn URL to every row" work (OPTRA list for the Justin Lin call, 338 rows,
2026-10-28) burned ten minutes probing engines before the one that worked. Measured that day:

- people store: 2,242 people carry a LinkedIn URL, but they're his own network. A prospect list
  matched one name, and it was a different William Li at a different company. Check it, expect nothing.
- `togari_exa_search`: "Exa is not configured" (no EXA_API_KEY).
- Perplexity Search API: 401 insufficient_quota.
- Brave public search over curl: one good page, then HTTP 429 on the next request.
- DuckDuckGo html and lite: bot "anomaly" page on the first request. Stop, never retry a challenge.
- Bing over curl: results render by script, zero links in the HTML.
- `chewbacca linkedin` / api-anything linkedin ops run on his own account. The 10/10 bulk HTTP
  run got two sessions revoked, and he asked for public pages only, so not for hundreds of rows.

**Why:** each dead engine cost a round trip, and a scraper loop against a 429 or a challenge
risks an IP block for every tab on the Mac.

**How to apply:** for more than ~20 rows, go straight to WebSearch fanned out across about 8
background agents, each owning one batch file and appending one JSON line per row
(url, match exact/likely/none, source, reason). Exact = name and company in the LinkedIn result
or the company site links the profile; blank beats a same-name stranger. Merge by row index
into a new file, never the original. Related: [[feedback_count_the_empties]].
