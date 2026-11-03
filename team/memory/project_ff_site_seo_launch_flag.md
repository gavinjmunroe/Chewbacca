---
name: project_ff_site_seo_launch_flag
description: FF site search visibility is one flag, LAUNCHED in site/lib/launch.ts; firmfoundationtech.com is a different business
type: project
---

firmfoundation.tech's search visibility is one line: `LAUNCHED` in
`site/lib/launch.ts` in calebnewtonusc/firm-foundation. While it is false every page
sends noindex (meta and X-Robots-Tag) and robots.txt says `Disallow: /`, so Google
has nothing of ours to rank. The sitemap, llms.txt, canonicals and the Organization,
WebSite and Service schema shipped 2026-11-02 (23c8a90) and are live either way, built
only from `site/lib/content.ts` and checked by `site/lib/seo.test.ts`.

**Why:** On 2026-11-02 Caleb googled "firm foundation tech", saw
firmfoundationtech.com first and asked "Why don't we show up? ... we should by far be
#1". That domain is Firm Foundation Tech Solutions, a San Diego Wi-Fi and computer
repair shop (Apache, registered 2026-01-28), not us. It wins the brand search because
its domain is the query and ours is noindex.

**How to apply:** When someone asks why FF doesn't rank, check `curl -sI
https://firmfoundation.tech/ | grep -i x-robots` before touching copy or schema.
Never treat firmfoundationtech.com as ours. Flipping LAUNCHED waits on both founders
(SITE.md, "Before it comes off noindex"); after it flips, verify the domain in Google
Search Console, submit /sitemap.xml, and check `site:firmfoundation.tech` a week later.

**Logo:** the FF logo is the two back-to-back F's under one course, `MARK` in
`site/components/Wordmark.tsx` (Gavin, 2026-10-18). The files in `site/public/brand/`
still hold the old cross and stack marks, so never pull a social or press logo from
them. On 2026-11-02 a LinkedIn logo was rendered from `cornerstone-royal.svg` and
Caleb wrote "BRO the logo is the FF one". The approved renders are in
`~/Downloads/ff-social/` (logo 400px, LinkedIn banner 1128x191).

**Profiles (2026-11-02):** LinkedIn page linkedin.com/company/firmfoundationtech
(made under Caleb's account), in the site schema's `sameAs` (bed651c). Search Console
verified and the sitemap submitted under team@firmfoundation.tech.
