---
name: feedback_org_hop_needs_ownership
description: "next-move org_hop pays for a people search only on an ownership sentence (site or about page) or found emails, never a bare link or a company the about page merely names; site reads keep script and CDN hosts out of links (2026-10-17)."
metadata:
  type: feedback
---

next-move's org_hop runs a 0.5-credit people search on a domain only when the evidence holds an ownership sentence (footer or about page) or emails already found at that domain. A bare link doesn't count, and neither does a company the about page just names.

Why: on 2026-10-17 the creator batch hopped Runna to therunbuddy.co.uk, website-files.com and marker.io, and hopped Zico to acsbapp.com, shopifysvc.com and shopifycdn.com. That's six searches, and none of them found anyone. Five of those hosts came from stylesheet, preconnect or script URLs. therunbuddy.co.uk was Runna's own blog, and its copyright line names "The Run Buddy LTD". A rule that accepted any company named on the about page was tried and dropped in review: "We sync with Strava and Garmin" matched it, and so did a sentence-initial "On".

How to apply:

- read_site splits `links` (anchor hrefs) from `asset_hosts` and reads up to 2 same-site about pages.
- `infra_domains` in references/next-move.json is the cross-check. Add a domain to it only when a replay shows it reaching a hop.
- A linked_only domain shows up in related_orgs for the record and is never searched.
- Tests: tests/test_next_move.py JunkHops, and tests/test_brand_buyer.py test_bare_link_is_never_searched.
