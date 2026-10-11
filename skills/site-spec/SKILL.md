---
name: site-spec
description: Build a website for a real small business (food truck, restaurant, shop, trade, local service) out of what the business has already published, in its own brand, as a private draft the owner sees before anything goes live. Use when the user asks to build, redo or pitch a site for a named business, to make a spec or portfolio site, or to "blow the owner away". Also use when a site built for a business got its facts, hours or brand wrong.
---

# A site for a real business, from its own words

The job is not "make a nice restaurant site". It is to take everything this
owner has already said about the business, in their own colors and their own
voice, and hand it back better than they could have. A draft that could belong
to any food truck has failed, however good it looks.

## Step zero: the kit pass, before any design or code

Caleb, 2026-10-10, after Erik Fish's site was started from three pages and
none of these tools: "scrape everything from every page and use all the cool
stuff we've built ... I should NEVER have to say this again." Every item
lands on disk, and `site-gate research <repo>` exits 1 until it does.

1. **Every page, through api-anything.** Teach it the site, then pull the
   whole thing. A WordPress site answers `/wp-json/wp/v2/posts` and `/pages`
   (Erik's: 132 posts, 34 pages, 108k words, 367 images, 25 videos). Add
   ops like `searchPosts(q)`, `getPost(slug)`, `getPage(slug)` with
   `api-anything add`, run `api-anything verify <site>`, then write every page
   to `research/corpus/` and one line per page to `research/INDEX.md`.
2. **`brand-grab`** for fonts, colors, palettes off their own images and
   phone and desktop captures of the current site.
3. **Their other words.** A corpus already on disk (`~/code/corpora/`), the
   second brain's domain folder for that person, their books and talks.
4. **`library/crafts/website.md` and `web-ux.md`**, read before layout.
5. **`ux-pick` or `ux-gen`** for the stance and the refusals, written down.
6. **`research/STEAL.md`** (From | What | Why it is ours, plus what was not
   stolen on purpose) and **the site repo's docs/COPY.md**, one document, each line traced.
7. **`research/SOURCES.md`** names each tool above and what it produced.

Then `site-gate research .` must print `ok`. Finished means `site-gate
check`, `story` and `idle` also pass on every route.

## Order

1. **Find the owner before the brand.** Search the business name and the
   handles you were given. On 2026-09-26 the account handed over "for
   aesthetic" turned out to be the owner's personal one, which changed the
   whole brief: the owner is the brand, and his face is on every post.
2. **Read everything they published, once, with `brand-grab`.**
   ```bash
   brand-grab ~/scratch/<biz> --site <their site> --instagram <biz> --instagram <owner> --press <url> --press <url>
   ```
   Then read `BRIEF.md` and look at `sheet.png` and the screenshots. It saves
   the current site at desktop and phone size, fonts and colors off their CSS, a
   palette off their own graphics, the first page of each profile, and each
   press page, or marks it refused.
3. **A refused press page is not a dead end, and is never bypassed.** Local TV
   blocked both the scraper and the fetcher (an access-denied page and a
   press-and-hold bot check). The same station's segment on YouTube had the
   owner's own words: `yt-transcript <url>`. Syndicated copies (Yahoo, MSN,
   Hoodline) carried the rest.
4. **Write the facts down with their source before any design.** One data file
   (`lib/<biz>.ts` or similar) holds the menu, prices, hours, address, quotes
   and links, each with where it was read. The page reads from it, so a price
   change is one edit.
5. **Put every conflict in front of the owner.** The site said Monday to
   Friday; the pinned hours post, newer, said Monday to Saturday. Pick the newest
   dated source, comment it in the data file, and list it in the README under
   "confirm before launch". Never settle it silently.
6. Learn the genre before designing anything. For anywhere people eat, the rules
   below come first, and for any other trade, look its rules up the same way.
7. **Design from their assets, pushed further.** Colors are sampled from their
   own graphics (`palette` in `brand-grab`), type matches their wordmark, and
   the texture comes from their real surroundings. On that truck it was a
   sticker-bombed fridge door, vintage oil decals, and a blackletter logo on
   Key West blue. Amplify the identity they have. Never replace it with a
   template.
8. **Screenshot every section at 1440 and 390 before calling it done**, after
   scrolling, so reveal animations have fired. Read each shot.
9. Ship it as a private draft on **Railway, never Vercel** (Caleb,
   2026-10-10: "never do anything on vercel ever again"; `vercel-guard`
   refuses it). A private repo, `robots: noindex` until the owner says to
   swap, `railway init` in "Caleb Newton's Projects", a `web` service that
   auto-deploys from main (or `railway up` until the GitHub app can see the
   repo), the start script on `${PORT:-3000}`, then `railway-domain <name>`.

## Food and drink sites: what the practitioners agree on

- **Where and when come first.** Address, today's hours and an open-or-closed
  badge computed in the business's own timezone sit above the fold.
- **On a phone, directions and tap-to-call stay within one thumb**: a sticky
  bottom bar once the hero has scrolled away.
- **The menu is text, not a PDF or a photo of a board.** Prices come exactly as
  the owner lists them.
- **Their real food and their real face.** No stock images.
- **Press is proof, quoted verbatim, and links to the piece.**

## Lessons this was built from

- **The name was hidden.** A cutout photo placed over the wordmark hid the
  business name at both sizes. The name goes in front and the photo behind. At
  390 px, a blackletter at 31vw clipped the last letter, and 27.5vw fit.
- **Quotes go in word for word.** "Perfect amount of like everything" stays
  as it was said. A tidied first draft had dropped the "like".
- **Nothing gets invented to fill a gap.** "Park and walk up", "the crunch you
  hear on TikTok" and a made-up headline all got cut. Every line is the
  owner's, a press quote, or neutral.
- **Instagram photos are small.** Logged-out frames are 360 px reel covers. Use
  them small, as polaroids, and ask the owner for originals. The hero needs a
  large cutout from their site.
- **Brand icons are gone from Lucide.** Draw Instagram and TikTok as inline SVG.
- **A formatter reflows files between edits.** Patch by line number or re-read,
  and check that the count of changed lines matches.

## When they ask for an intro animation

The Cowboy Cubans draft got a five second duel on first load (two silhouettes,
pressed Cubans for guns, one drops). What made it work, and what nearly didn't:

- Drive every frame from one clock, `t` in milliseconds, with keyframe tracks
  and no chained timeouts. Then `?intro=<ms>` freezes any frame, and the
  screenshot pass can read a dozen frames at 1440 and at 390 like a storyboard.
  That pass caught the real bug: the loser fell backward, the action needed
  1150 units of width, and on a phone each man was 65 px tall.
- Stage it for the phone held upright. Pick the choreography so the whole
  action fits the narrowest frame. Falling forward instead of backward cut the
  width to 800 units and made both men about 40% bigger.
- Decide before the first paint whether it plays. A static head script skips it
  on a second visit in the tab and under reduced motion, a `noscript` style
  hides it without JavaScript, a CSS failsafe clears it if hydration never
  comes, and a load slower than four seconds goes straight to the site. Skip
  sits in the letterbox and Escape works.
- Hold the hero's entrance until the curtain opens, or it plays unseen under
  the overlay.
- Keep it in the site's palette with no comic lettering. A sentence of dialogue
  in the letterbox and one iris-out did more than any "BANG" would have.

## Hard line

**Never publish it as the business, or let it be indexed, before the owner says
yes.** The draft is `noindex`, the repo is private, and the owner's live site
stays live. Photos of other people, including the owner's own personal account,
are inspiration and never go on the page unless the owner picks them. The owner
decides what is theirs to show.
