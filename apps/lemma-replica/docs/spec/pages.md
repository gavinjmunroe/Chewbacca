# Pages beyond the home page

Inventory and spec for every route the home page links to, written
2026-10-03. Their pages were crawled with Playwright (Chromium, metal ANGLE)
at 1440x900 and 390x844, every control's target resolved, the route chunks
read, and computed styles measured with `scratchpad/pages/meas.py`. Copy on
our pages is ours throughout; only layout, rhythm and mechanism are matched.

## 1. Every control on the home page

"Theirs" is where the control goes on uselemma.ai. "Ours" is the href or
behaviour on this replica, relative to the repo root.

| Control                                            | Theirs                                                        | Ours                                                                             | Who sets it                |
| -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| Header brand                                       | `/`                                                           | `#top`                                                                           | index.html (unchanged)     |
| Nav: Docs                                          | docs subdomain, new tab                                       | `pages/docs.html`                                                                | index.html                 |
| Nav: Blog                                          | `/blog`                                                       | `pages/blog.html`                                                                | index.html                 |
| Nav: Weekly                                        | `/weekly`                                                     | `pages/weekly.html`                                                              | index.html                 |
| Nav: Changelog                                     | docs subdomain `/changelog`, new tab                          | `pages/changelog.html`                                                           | index.html                 |
| Nav: Careers                                       | `/careers`                                                    | `pages/careers.html`                                                             | index.html                 |
| Login                                              | platform subdomain, new tab                                   | `pages/login.html`                                                               | index.html                 |
| Book a demo (header)                               | cal.com booking, new tab                                      | `pages/demo.html`                                                                | index.html                 |
| Mobile menu button                                 | opens a nav sheet                                             | not built; ours keeps Login + Book a demo at 390 (chrome.css)                    | n/a                        |
| Banner "hiring"                                    | `/careers`                                                    | `pages/careers.html`                                                             | index.html                 |
| Banner dismiss                                     | removes banner, page moves up 40px, stays dismissed on reload | same: removes banner, `--banner-h` to 0, `localStorage["sift.banner-dismissed"]` | src/pages/home.js          |
| Hero: Book a demo                                  | cal.com, new tab                                              | `pages/demo.html`                                                                | index.html                 |
| Hero: Read the docs                                | docs subdomain, new tab                                       | `pages/docs.html`                                                                | index.html                 |
| Logo wall (10 names)                               | each customer's own site, new tab                             | `href="#"`, rendered by hero-scene.js                                            | **lead decides**, see 5    |
| Feature panel CTA (cal.com link, "Resolve" button) | cal.com; button is decorative                                 | ours has neither control                                                         | n/a                        |
| Integration logos (12)                             | docs integration pages, new tab                               | ours are not links (lower.js glyphs, aria-hidden)                                | n/a                        |
| Copy prompt                                        | clipboard                                                     | clipboard (lower.js, already worked)                                             | lower.js                   |
| View trust center                                  | trust subdomain, new tab                                      | `pages/trust.html`                                                               | **lower.js, lead applies** |
| Testimonial cards                                  | each post on x.com, new tab                                   | not links; carousel arrows and dots work                                         | testimonials.js            |
| Weekly latest issue title                          | `/weekly/issue-003`                                           | `pages/weekly/issue-014.html`                                                    | **lower.js, lead applies** |
| Read the latest issue                              | `/weekly/issue-003`                                           | `pages/weekly/issue-014.html`                                                    | **lower.js, lead applies** |
| View all issues                                    | `/weekly`                                                     | `pages/weekly.html`                                                              | **lower.js, lead applies** |
| Newsletter form                                    | validates, POSTs `/api/weekly/subscribe`                      | validates, success state, sends nothing                                          | src/pages/home.js          |
| Closing CTA Book a demo                            | cal.com, new tab                                              | `pages/demo.html`                                                                | **lower.js, lead applies** |
| Footer links                                       | see 5                                                         | see 5                                                                            | **lower.js, lead applies** |
| Footer social (X, LinkedIn, Instagram)             | external                                                      | ours has About, Status, Contact instead                                          | lower.js                   |
| Cookie settings (footer)                           | reopens consent                                               | reopens the card (already worked)                                                | lower.js + app.js          |
| Cookie card Reject / Choose / Accept               | stores choice, hides                                          | stores choice, hides (already worked)                                            | app.js                     |
| Contact email                                      | `mailto:` their founder                                       | `mailto:hello@sift.example`                                                      | lower.js                   |

## 2. Their routes, and ours

| Theirs                           | Status                                  | Ours                                                                                                                                     |
| -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/blog`                          | 200, 2110 tall at 1440                  | `pages/blog.html`                                                                                                                        |
| `/blog/<slug>` (4 posts)         | 200, 10112 tall                         | `pages/blog/reading-a-run-backwards.html`, `introducing-sift.html`, `group-failures-by-cause.html`, `the-retry-that-looked-healthy.html` |
| `/weekly`                        | 200, 2462 tall                          | `pages/weekly.html`, plus `pages/weekly/feed.xml` for their RSS link                                                                     |
| `/weekly/issue-003` and 002, 001 | 200, 9066 tall                          | `pages/weekly/issue-014.html`, `issue-013.html`, `issue-012.html`                                                                        |
| `/careers`                       | 200, 1477 tall                          | `pages/careers.html`                                                                                                                     |
| careers job rows                 | YC job board, new tab                   | `pages/careers/product-engineer.html`, `pages/careers/applied-ml-engineer.html`, third row `mailto:`                                     |
| docs subdomain, `/changelog`     | external docs product                   | `pages/docs.html`, `pages/changelog.html`, in our chrome                                                                                 |
| trust subdomain                  | external trust-page product             | `pages/trust.html`, in our chrome                                                                                                        |
| platform subdomain (login)       | external app                            | `pages/login.html`                                                                                                                       |
| cal.com booking                  | external                                | `pages/demo.html`                                                                                                                        |
| any unknown path                 | 404 page, 900 tall, no header or footer | `404.html`                                                                                                                               |

## 3. Per page: layout, type, spacing, states

All measured at 1440. Their face is brittiSans; ours is Figtree at the same
sizes (see styles.css for why). Rails and rules are rgb(212,212,221).

### Shared frame

- A centred column with 1px left and right rails. 1152 wide on the blog index
  and posts (x=144), 1024 on Weekly, issues and careers (x=208).
- Horizontal rules run edge to edge between bands (the blog's at y=799 is
  1440 wide), or frame-wide inside the narrow frame (Weekly).
- Content starts at y=96: nav 56 plus banner 40. Banner in flow on theirs;
  dismissing it moves the h1 from 256 to 216.
- Eyebrows: IBM Plex Mono 10/15, uppercase, letter-spacing 1px, rgb(108,105,145).
- At 390 the rails go, side padding is 16 to 24, and every grid stacks.

### Blog index

- Featured block 703 tall: one card 711 wide (image 662x347 at 24px inset,
  category, title 48/55.2 -0.48), footer bar 65 tall with author and mono 12
  date; two stacked cards 439 wide (image 391x205, title 20/27.5).
- "All Articles" band: h2 24/32 at 32px inset, category chips 30 tall (14px,
  1px border; selected is ink fill, rgb(242,242,242) text), search 192x34 at
  the right.
- Rows 174 tall: 256x134 thumbnail, 24px gap, category, title 24/33,
  author in accent-deep 14px, mono 10 date right.
- States, from `app/blog/page-*.js`: chip filter and title search applied
  together, case-insensitive; empty state "No articles found." in muted 14px.
  Title hover turns accent. At 390 the featured block is not rendered.

### Post

- Header band 400 tall: back link (mono 10 caps with arrow), category,
  title ~56px, mono date. Byline bar: author, role, read time, COPY LINK
  ghost button.
- Body: contents rail at x~168, text column 721 wide at x=472.
  Lead 24/33, paragraphs 18/28.8 ink, h2 30/34.5, h3 24/27.6, figures in a
  white well with a 14/20 muted caption.
- States, from `app/blog/[slug]/page-*.js`: copy link writes location.href,
  label becomes "Copied!" for 2000ms. Contents rail marks the current
  section. At 390 the rail is hidden.

### Weekly

- Hero: eyebrow with RSS link, h1 60/63 -0.6 across 896, lead 18/29.25
  muted max 672. Bands at 116/96 vertical padding.
- Latest issue: labelled hairline rule, mono date and read time, h2 48/51.84,
  lead 18/29.25 max 768, author row with "Read the issue" arrow link.
- Archive: month label at 70% muted, rows 97 tall with a number column 120
  wide, h3 20/27.5, one-line ellipsed summary 14/22.75, mono date right.
- Sign-up: h2 30/36, input 46 tall white, button 46 ink, status line 14px.
- States, from `app/weekly/page-*.js`: empty input gives "Enter your email
  address.", a failed `^[^\s@]+@[^\s@]+\.[^\s@]+$` gives "Enter a valid
  email address.", input gets aria-invalid, the status paragraph is
  aria-live and takes focus on error or success. Ours uses our own wording.

### Issue

- Narrow frame. Header like a post, plus a lead paragraph. Body 768 wide at
  x=336, 18/32 in a greyer body colour (oklch .373 .034 259.7), section
  eyebrows mono 10, h2 30/34.5, aside boxes white at 50% with a border,
  h3 17 and 15/24 muted text. Then sign-up, related posts, previous issue.

### Careers

- No banner on this route. Three line-art plates with an accent border and a
  29px label bar (11px accent text), staggered: 213x209, 230x287, 320x296.
- h1 32/38.4, job rows 49 tall on rgb(232,232,232) with title 18/24.75 black
  and location 11px muted at the right; hover darkens the row.

### 404

- No header or footer. A 1024-wide plate with an accent border and a second
  rule 4px under the top, mono meta in three corners, a mono message centred
  at the top, outlined "404", an animated figure, then Return home (primary)
  and Read the docs (ghost) below.

### Ours only (their versions are third-party products)

Changelog, docs, trust, login and demo have no same-site counterpart, so they
use our frame and type scale: a dated two-column changelog with tag chips and
a filter; a docs page with a sticky sidebar and in-page sections; a trust page
with live status, tabbed controls, compliance and documents; a one-time-link
login; and a demo request form. Login and demo validate every field in place,
focus the first bad one, and swap to a success panel that repeats what was
entered. Nothing is sent anywhere.

## 4. Deliberate differences

- Docs, changelog, trust, login and demo open in the same tab. Theirs open
  external products in new tabs; ours are pages of this site.
- No mobile menu sheet. Our home header at 390 already shows Login and Book a
  demo instead of a menu button, and the subpages share that header.
- The 404 figure is ours: a run of spans with the requested page as the one
  missing span. Theirs is a different figure.
- The banner dismissal persists in localStorage. Theirs persists across a
  reload too; where it stores the flag was not identified.

## 5. Hrefs the lead applies to src/sections/lower.js

Relative to the repo root, as index.html resolves them. On the subpages,
`src/pages/chrome.js` resolves the same values against the root, so one set
works everywhere.

| Line in lower.js                            | Current                        | Apply                                                                              |
| ------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| FOOT_COLS Docs                              | `#`                            | `pages/docs.html`                                                                  |
| FOOT_COLS Blog                              | `#`                            | `pages/blog.html`                                                                  |
| FOOT_COLS Weekly                            | `#`                            | `pages/weekly.html`                                                                |
| FOOT_COLS Changelog                         | `#`                            | `pages/changelog.html`                                                             |
| FOOT_COLS Careers                           | `#careers` (with id `careers`) | `pages/careers.html` (the id is no longer a target; the banner link moved)         |
| FOOT_COLS Trust center                      | `#`                            | `pages/trust.html`                                                                 |
| FOOT_COLS About                             | `#`                            | `pages/blog/introducing-sift.html`                                                 |
| FOOT_COLS Status                            | `#`                            | `pages/trust.html#status`                                                          |
| FOOT_COLS Contact                           | `mailto:hello@sift.example`    | unchanged                                                                          |
| `.lw-foot-logo`                             | `#top`                         | `index.html` (on index, `#top` is also fine)                                       |
| View trust center (`.lw-trust-cta a`)       | `#`                            | `pages/trust.html`                                                                 |
| Issue title (`.lw-issue-t`)                 | `#`                            | `pages/weekly/issue-014.html`                                                      |
| Read the latest issue (`.lw-link-latest`)   | `#`                            | `pages/weekly/issue-014.html`                                                      |
| View all issues (`.lw-link-all`)            | `#`                            | `pages/weekly.html`                                                                |
| Closing CTA Book a demo (`.lw-cta a`)       | `#`                            | `pages/demo.html`                                                                  |
| Newsletter `<form onsubmit="return false">` | inline handler                 | can stay; src/pages/home.js handles submit. Dropping the inline handler is cleaner |
