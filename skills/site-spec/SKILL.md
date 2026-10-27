---
name: site-spec
description: "Build a site for a real small business from what it already published, in its own brand, as a private draft for the owner. Use to build, redo or pitch a named business's site, or fix its facts."
triggers: >-
  Build a website for a real small business (food truck, restaurant, shop, trade, local service) out of what the business has already published, in its own brand, as a private draft the owner sees before anything goes live. Use when the user asks to build, redo or pitch a site for a named business, to make a spec or portfolio site, or to "blow the owner away". Also use when a site built for a business got its facts, hours or brand wrong.
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

Before any styling, write the person's taste answers word for word into
`research/VIBE-SPEC.md` (the films, songs, brands and adjectives they named)
and map each to a concrete design move; an answer with no move is a bug. Every
section needs something a PDF can't do, and a hover target and what it changes
sit on screen together with zero layout shift. Caleb, 2026-10-23, on Parker
Manley's v1, which kept the logistics and dropped rustic, Lord of the Rings,
Grand Budapest and the song: "NEVER MAKE A SITE THAT COULDVE BEEN A PDF" and
"DID YOU JUST SKIM EVERYTHING HE SAID?"

Draw the task graph before the first fetch. The audit of their site, research
on reference sites in the genre, and research outside the genre don't depend
on each other, so the two research tracks go to background agents in the
first message while the audit runs here, and the questions or the draft wait
for all three. Caleb, 2026-10-23, mid-way through Parker Manley's film site
audit with the research still serial: "Rmr to graph engineer".

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
10. **A deployed draft isn't delivered until the person has the link.** Text
   it in the same turn the deploy goes live, then read the thread back. On
   2026-10-23 Parker Manley's v3 went live at 10:33pm after "Will get you
   draft 3 tn" and nobody sent it. He had to ask "Any update on draft 3?"
   the next afternoon, and Caleb wrote "parker asked for draft 3 we never got
   him it!"
11. **Never ship a section that could have been a slideshow.** Crossfading
   one image and caption after another on scroll is a slideshow, whatever it's
   styled as. Each section is an object from the subject's own world that does
   something only it can do: for a filmmaker, a marquee, a camera monitor whose
   settings move, an edit timeline with live transitions, a call sheet. The
   seams between sections are deliberate too (a splice, an intertitle), never a
   hairline or a fade-to-ground gradient. Caleb on Parker Manley's site,
   2026-10-25: "NEVER make anything that could've been a slideshow!",
   "Uncreative unintentional ahh section transitions", "Unintentional ah lame
   gradient".

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

- **A tab picker is a slideshow.** A list of situations on the left that swaps one service panel on the right hides five of six answers, the same as a carousel. Show every option at once as rows (what they'd say, the service, what they get), stacking on a phone. Caleb, 2026-10-27, on the Medrano services picker an hour before the call: "Slideshow ah". Before shipping, ask of every interactive block: does clicking reveal content that was hidden? If yes, unhide it.

## Personal sites: three corrections from the Patrick Kellogg draft (2026-10-23)

- **Every nav button opens a real page in the new design.** The first draft
  linked each tile back to the owner's old pages. Caleb: "Make sure the
  buttons for diff pages actually make new pages lmao". Build one page per
  section from a shared shell (`build.py` writing `public/*.html`), and only
  link out to files that can't move (mp3s, resumes, very long reviews).
- **No stack of full-width numbered bands.** "01 Work, 02 Games..." sections
  read as slides. Caleb: "Make sure i'ts not a slidedeck!" The home page is
  one board of tiles in different sizes that you browse.
- **Tone comes from the owner's own social, not their old site.** A 2000s
  homepage read as gingham-and-paper cute. His Instagram (leather jacket,
  trucker cap) said otherwise. Caleb: "I feel like he'd want it tuffer?" Look
  at the owner's current photos before picking the palette and type.
- **A Cloudflare-fronted site blocks curl but not the browser pane.** Crawl
  with same-origin `fetch` inside the pane. Getting a big crawl out of the
  page fails two ways: a Blob download never lands, and a POST to
  127.0.0.1 is blocked. Return each page's text in chunks through the JS
  tool and write it to `research/corpus/` as you go, because the pane can
  close and take the crawl with it.

## When someone has to brain-dump the vision

When the facts live in a person's head (the owner, or a friend handing over for
them), send a Google Doc they fill in, not a text list or a form. Caleb,
2026-10-26, on the intake for Ava's dance teacher's site: "Make it a google doc
and make the space wehre she types her answers hv blue text", then, at 15
questions, "More qustions bruh I want her to yap to make this awesome".

- **Upload HTML to Drive as a Doc** with `gws drive files create`, the
  `application/vnd.google-apps.document` mimeType and `--upload doc.html
  --upload-content-type text/html`; `files update` on the same id revises it.
  Questions are bold black. Under each goes a blue (`#1a73e8`) "Type here..."
  span, so what they type over it stays blue. Read the doc back with `gws docs
  documents get` and count blue slots against questions.
- **About 45 questions, mostly scenes and stories.** "Walk me through one class
  like I'm sitting in the corner", catchphrases, the funniest moment, one story
  about a student, "if they read the site and teared up, what would it have
  said?", their world as a song or a movie scene, what it should NOT feel like.
  Logistics (hours, prices, address) go last. The top of the doc says long
  answers are good and a voice memo per section is fine.
- End with a send-me list: original video files (not screen recordings), photos,
  logo, screenshots of kind texts or reviews.

## A scaffold draft for the person filling in the vision

A draft that shows where things go is still a site, and it still gets judged
as one. Caleb, 2026-10-26, on draft 0 of the SMHS dance site: "BRO NO AI SLOP".
That draft had headlines nobody said ("Four levels, one stage", "Come see a
show"), a small kicker over every heading, all-caps display type on every
section, a row of color swatches and a grid of generic silhouette people.

- Headings are plain labels or the person's own words from their intake doc.
  Never write a slogan into a scaffold.
- Open slots are empty dashed frames with the question in them, never
  stand-in people or stock shapes.
- Use their real footage wherever it exists (their insta, the album they
  shared) and mark everything still open as their call, with a toggle that
  hides the notes.

- **A batch of sites starts with the full list, read from the source.** On
  2026-10-26 a handed-down brief cut "whoever we can" from a showcase to the
  4 founders with calls booked. The showcase transcript and the founders folder
  named about 15 more, and nobody read them. Caleb: "Bro there's so many other
  companies you're leaving out!!!!!!!! Bro did you read the innovation ucla
  transcript thing?" Before the first build, read the event's own record
  (transcript, PDF, folder), list every company with its site, and show that
  list. His scope words beat the brief that was passed down.
- **Pause means stop, and a teammate tab doesn't override it.** The same day,
  after "Pause and evaluate", a peer session asked for teardowns and this tab
  kept working until he wrote "PAUSE BRUH". After a pause, reply with where
  things stand and run nothing until he answers. A peer request waits.

- **A firm that sells trust gets the register its buyers trust.** Medrano
  Partners v1 (2026-10-26) used a serif headline with a gold italic word in
  every heading, mono uppercase kickers and a drawn daisy, copied up from the
  client's own Playfair-and-gold site. Caleb: "looks slop bro so far from
  professional". v2 took the stance from the reader (gloo.com and
  bridgespan.org for faith and nonprofit leaders): one light sans display,
  the client's own photos full width, one accent that means "act", and the
  method shown as a real engagement timeline. Push a client's identity
  further, but drop the parts of it that are the generated-median look.
- **A text swap on scroll is a slideshow, and a page of sections is a book.**
  10/26 evening, on four founder pages built as a pinned rail where each step
  swapped a title and a list: "NO WALLS OF TEXT. IF THEY WANTED A SLIDESHOW OR
  A BOOK WED GIVE THEM A SLIDESHOW OR A BOOK". Each page gets one working
  object from the client's own product (their inbox you can click through,
  their app's button you can press) and almost no words: a headline, that
  object, the proof numbers, one button. Count visible words before shipping.
- **When he approves one site in a batch, rebuild the rest in that register
  before showing them.** 10/26: Medrano v2 passed ("Medrano is ok now") while
  Junto, OPTRA and Firebox still carried mono uppercase kickers, fake app
  windows with traffic-light dots and "checked" chips, pill tags and a map with
  tiny labels: "the other ones are complete slop". What carried over and
  passed: one light display face set very large, the client's real picture
  (product screenshot, their photo) full width, hairline typographic sections,
  and the scroll scene as a rail plus steps plus a list that ticks, never a
  mock UI.
- **Measure the client's site before quoting it.** OPTRA's counters read
  $273K, $309K, then $323K over nine seconds; the real value was in their JS
  bundle. A "0+ countries" on another page was a counter that hadn't run yet.
  Read the bundle or wait and re-read before a number goes in a teardown.
- **site-gate quirks seen 10/26:** its contrast check misreads `oklch()` (use
  rgb tokens), and `scroll-behavior: smooth` on `html` makes the
  heading-paint check flaky (glide anchors in JS instead).

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

## Related

- [launch-funnel](../launch-funnel/SKILL.md): for a product launch, waitlist or preorder page, the persona, messaging and section formulas come from there before any layout.
