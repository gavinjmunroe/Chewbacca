---
name: feedback_find_christian_students_via_networks
description: To find Christian students or creators at a school, walk the network (fellowship IG followers, treg profile lookups), not web search; faith counts from bio OR post content
metadata:
  type: feedback
---

To find Christian students or student creators at a school, start from the networks they already sit in: the school's fellowship and church Instagram pages (Cru, InterVarsity, Chi Alpha, RUF, Christian Challenge, GenCollege, Catholic centers, ethnic fellowships), their followers, and the accounts strong hits follow. Score faith from the bio OR the last ~12 post captions, never the bio alone.

**Why:** On 2026-11-03 four web-search agents spent ~15 min each and found only 3 solid current students at T50 schools in the IG/YouTube lane, and missed the seed's school entirely. One treg profile call (`scrapecreators.instagram.user.profile`, ~$0.002) read her bio in seconds: "osu'28", Ohio State. Caleb: "you can tell bros a christian bc of his ig bio and his content that's how we're gonna get a lot of these", then "They don't hv to be outwardly christian in their bio, some of them hv it in their content", then the fellowship-followers idea: "went to every university christian fellowship/churches ... downloaded their followers, and then parsed through those".

**How to apply:**
- treg endpoints that worked 11/3: `tikhub.x.instagram-v2-fetch-user-followers` / `-following` (49 per page, pagination_token), `tikhub.x.instagram-v2-search-users` (finds pages by name), `scrapecreators.instagram.user.profile` (bio + ~12 captions + counts, param `handle`). treg returned 503 "pool saturated" often; retry with backoff and cache every response.
- The logged-out api-anything Instagram op and `chewbacca ig posts` both drifted on 11/3; use treg, never Caleb's own account.
- Find fellowships by crawling the org graph, not a hand list. Networks repeat across schools and follow each other: @generations_usc led to @generations_la ("part of @acts2college"), whose following list alone surfaced ~10 other college-church networks. Pull following, keep org accounts, recurse until no new orgs. Caleb, 11/3: "So many networks of fellowships that repeat at diff schools", "acts2 isn't the only one there are many!"
- Pilot one school before a T50 sweep, and keep raw follower lists private: following a Christian page is religion data the person never posted. Only outwardly Christian or opted-in people go in anything shared.
- Plan and day-one data: `~/Downloads/Christian campus network/` (Caleb's machine).
