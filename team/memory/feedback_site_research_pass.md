---
name: feedback_site_research_pass
description: Every site starts with the kit pass (api-anything pull of every page, brand-grab, ux-pick, crafts, STEAL, COPY); site-gate research refuses without it
metadata:
  type: feedback
---

Every website Chewbacca builds or rebuilds starts with the kit pass, and
`site-gate research <repo>` exits 1 until its receipt is on disk:
`research/INDEX.md` (every page of the source), `research/SOURCES.md`
(naming api-anything, brand-grab, ux-pick or ux-gen, website.md, site-gate),
`research/STEAL.md` and `docs/COPY.md`.

**Why:** 2026-10-10, Erik Fish's site was started from three hand-read pages
with none of the kit's tools. Caleb: "scrape everything from every page and use
all the cool stuff we've built like the ux scraper or wtv we used for lemma ...
especially api anything", then "make sure chewb actually learns. I should NEVER
have to say this again." The Lemma lessons were already in prose
([[feedback_website_four_layers]], [[feedback_read_the_bundle_before_measuring]])
and were skipped anyway, so the step is now a gate.

**How to apply:** follow step zero in `skills/site-spec/SKILL.md`. For a
WordPress source, teach api-anything `searchPosts`, `getPost`, `getPage` on
`/wp-json/wp/v2/*`, verify, then pull everything (erikfish.com: 132 posts, 34
pages, 108k words). Run `site-gate research .` before the first component.
