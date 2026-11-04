---
name: interface
description: "Build any interface from a preset: dashboards, tables, forms, settings, wizards, feeds, HUD panels, landing pages. Use to build, lay out or redesign UI, or when it looks generic, ugly or like slop."
triggers: >-
  Build any interface by loading a preset instead of re-deriving one: dashboards, tables, forms, detail views, settings, wizards, feeds, HUD panels, landing pages. Use when asked to build, show, visualize, lay out or mock up a screen, dashboard, chart, UI or app, when the user wants to see data rather than be told it, and before generating any UI from a data source. Also fires on: looks bad, looks generic, ai slop, slop, ugly, redesign, restyle, make it look, landing page, hero section, component, layout, typography, spacing, visual design.
---

# Interface

Build it by loading, not by inventing.

The problem this exists for, in Caleb's words: **"right now it's laggy because
it's needed to every time recalibrate how to make something."** The cost of
generating a UI is not rendering. It is the model re-deciding, per request,
what a dashboard is, what spacing to use, what a good table looks like and
where the data comes from. All four of those are written down here, once.

## The order, every time

1. **Name the template.** `references/taxonomy.md` has ten. The request is
   almost always one of them, and the one most people mean is Dashboard.
2. **Name the organisms it holds**, from the same file. Stop here if you are
   about to invent a component that already has a name.
3. **Find the data** in `references/data-loaders.md`, and when it is not there
   use `references/discover-data.md` to go find it, appending what you learn
   back into the loaders file so the next session does not repeat the search.
4. **Apply the system**, from [library/crafts/interface.md](../../library/crafts/interface.md):
   grayscale first, the constrained scale, hierarchy by size and weight and
   color, too much whitespace then remove, details last.
5. **Build the three states.** Loading, empty, error. This is the step that
   gets skipped, because the prompt only ever describes the happy path.

6. **Verify the rendered result.** Use the project's existing capture tools,
   then inspect desktop, narrow, reduced-motion, and transition frames. When
   ux-engine is available, run `design-gate <url> --shots 8`; treat capture
   failure as unverified, and inspect reported defects before delivery. Keep
   quality judgments separate from source lint and descriptive motion metrics.
   For a continuous morph, verify element identity through the transition,
   including reverse scroll. An opacity sum of one does not prevent collisions.
   Refresh the actual preview the user is viewing before claiming a fix. Test
   its current viewport too; a desktop screenshot does not prove that a narrow
   rule preserved the figures or controls the user cares about. Run the
   Verify list, Refuse list and countable checks in
   `references/craft-floor.md` against the same render.

   A page built by another session gets the same bar in its brief: a named
   reference (an apple.com product page unless the user names one), the
   simple-motion rules, `design-gate`, and before and after screenshots. A
   demo whose tests pass is not done until it looks like the real product it
   imitates: a fake text thread looks like the real iMessage or WhatsApp. On
   2026-11-03 the Kyber page, briefed this way, came back good, while the
   Baptize text-signup demo, briefed only on function, came back as a gray
   form in a box with a 5-line subhead and an empty side panel. Caleb: "The
   demo is so slop bro", then "I thought we had fixed chwebs to not produce
   slop???"

   For a narrative page, review the whole journey before polishing individual
   sections. At each handoff, name what persists, what changes, and what the
   change tells the viewer. Reference studies must produce a concrete change
   to this journey. Inspect adjacent frames before calling an effect a morph:
   a prepared match cut can carry continuity too. Do not equate creative motion
   with complexity, prohibit all cuts, or use motion metrics as taste scores.
   Study scroll references between endpoints in both directions. Record the
   order of detail removal, resizing, rotation, relocation, and reveal before
   reducing them to an interpolation. Check held-scroll behavior separately
   so timed loops are not mistaken for scroll-driven transitions.

   **Leave a pixel receipt before calling it done.** After the last edit, run
   `ui-proof capture <url of the running page>`. It writes 1440x900 and
   375x812 screenshots, every console error and uncaught exception, and
   `receipt.json` with their hashes and the capture time to
   `<git root>/.ui-proof/`, and exits 1 if the page errored or answered 4xx/5xx.
   Open both screenshots and look at them. `ui-proof check` is what a gate
   runs: exit 0 only for a passing receipt taken after the newest UI file
   changed (`--files` narrows that to the files this turn touched), with
   both widths present and hashes intact. Exit 3 means no browser started,
   which is unverified, never green. An edit after the capture makes the
   receipt stale, so capture last.
   Every screenshot browser runs headless: no window, no tab, nothing on
   his screen. Caleb, 2026-10-11, after the Playwright MCP opened a visible
   Chrome over his work: "it should do that in the background without it
   taking over the screen or even pulling up a tab!!!" Both browser MCPs
   default to headed, so `PLAYWRIGHT_MCP_HEADLESS=true` lives in
   `~/.claude/settings.json` env and chrome-devtools gets `--headless`. A
   session started before that keeps a headed server, so use a script with
   `chromium.launch({ headless: true, channel: "chrome" })` instead.

7. **For a website, run `site-gate check <every page url>` and get exit 0.**
   It refuses console errors, horizontal scroll at 390, dead links, controls
   with no hover or focus state, and loops that run under reduced motion.
   For a pinned scroll scene, `site-gate scrub <url> --run <selector>` after
   every round of changes, then read both contact sheets it writes. It fails a
   console error or text inside the 16px gutter at 1440 or 390, and found a
   label cut off on a phone the day a round skipped the phone (FF hero, 11/1).
   Then `site-gate slideshow <url>` (nothing that could have been a
   slideshow), and `site-gate idle <url>` and confirm the ambient layer you planned is
   moving. The four layers a site needs (layout, choreography, ambience,
   response) are in [library/crafts/website.md](../../library/crafts/website.md); read it
   before building, because three of the four never show in a screenshot.

Steps 1 to 3 are lookups and should cost almost nothing. That is the point.

## A deck handed over means the product the deck promises

2026-10-26, SoundCheck: Caleb dropped his team's pitch deck and said "COOK".
The first build was a demo-grade quiz, and four corrections followed in an
hour: "MATCH EXACT VIBE OF THE SLIDESHOW", "we're making an actual product
not just an MVP", "Did u include EVERYTHING talked abt on the slides???",
then "ready for me to send to diff groups of friends and they will use it
consistently not just once". Every one was knowable from the deck on minute one.

- Before code, write the slide-by-slide checklist: every feature, mode, card,
  "what comes next" item and architecture logo becomes a line, and the build
  isn't done until each line is built or named as not built.
- Pull the deck's colors from its pixels and its type from its slides; each
  screen is one of its slides (cover, how-it-works, the product mock).
- "Product" means it survives a second use: persistence, a link that keeps
  working, saved identity, no repeated content, a share path, a home-screen
  install, a link preview.
- Screenshot every screen at 390, 768, 1024, 1280, 1440 and 1920 before
  calling a UI done. SoundCheck, 2026-10-26: after checks at only 390 and 1440,
  Caleb's own window showed the room code running into the form and every
  option grayed out ("Bro you did NOT audit the ui ux lmao"). Never disable a
  choice to force an earlier field; let the tap point at what's missing.
- Check the platform's real limits first. Spotify Development Mode allows 5
  signed-in accounts and Extended Quota needs a business with 250k MAU
  (developer docs, read 2026-10-26); found an hour in, it forced a second
  data path (catalog-search quick picks, export upload).

## A product demo plays itself on one real device

Anchored's Baptize The World sign-up demo, 2026-11-03: a 5-line subhead, a
generic rounded phone with gray "starter" cards labeled by language, a fake
+1 555 number in the header, a half-empty "what the team sees" card ("Waiting
for a first text / None yet") and two paragraphs of disclaimers. Caleb: "The
demo is so slop bro." What replaced it (anchored d411ffc):

- One device, centered, in the real app's chrome: iOS status bar and Dynamic
  Island, the iMessage blue/gray bubbles with tails or WhatsApp's wallpaper,
  white and light-green bubbles, time and ticks. Pickers (channel, language)
  sit under the device as small words, never as cards inside the thread.
- It autoplays on load through the real engine: text types into the compose
  field, sends, typing dots grow into the reply (one bubble morphing, not a
  second one popping in). Touching the field hands control to the visitor.
- A second panel appears only once it has data and fills row by row. A panel
  that reads "none yet" on load is dead space.
- One line of honesty at the bottom ("Demo with test data. Nothing is sent.").
  Build caveats (who wrote the translations) go in the repo docs.
- Never show a placeholder phone number in a demo's UI.

## A tool someone practises with is a session, never a page of cards

2026-10-11, a guitar midterm study app the night before the exam: five tabs
(plan, performance, note finder, quiz, cheat sheet) over grids of cards,
tables and colored-stripe tips. Every check passed and Caleb said "Terrible ux
bro ru serious a flat html grid?". The interface skill had been named for the
prompt and never loaded, so nobody chose a template; the page defaulted to a
dashboard of everything.

The rebuild that worked: a setlist home (one loud line, one button, the five
pieces as rows with a progress ring each), then one piece at a time full
screen around a drawn guitar neck that lights the note being played, a staff
strip that scrolls under a playhead, one round play button, a count-in, and a
rating sheet after each run that moves the ring. The written review used the
same neck as the answer surface: tap where the note lives.

- Name the template before writing markup. Study, drill and rehearse requests
  are **Practice session** in references/taxonomy.md.
- Show the content as itself. The instrument, not a table about the
  instrument. One object carried through every screen.
- One thing on screen at a time. Reference material belongs inside the step
  that needs it, never on its own tab.
- `interface-first.sh` refuses a 150+ line UI page written before this skill
  is loaded.

## Pick the stance from the reader, not from taste

On 2026-09-27 Amber Circles passed ux-lint, axe, layout-check and design-gate
in the editorial stance (serif display, one gold italic phrase, an uppercase
kicker over every heading, outline buttons) and Caleb called it AI slop. It
was: that look is now the median "tasteful" generated page, and every gate
scores the absence of the old tells, not this one.

The fix that landed was choosing the stance from who reads it. The users were
older people opening links from texts, so it became signage (ux-engine
`material`) in Atkinson Hyperlegible, the Braille Institute's face for low
vision. Two rules came out of it:

- **Give the accent exactly one meaning** ("you can tap this") and write a
  test that fails when it fills anything else. The first signage landing had
  four amber things above the fold and design-gate read it LOUD at ink 0.52.
- **Show the content as itself.** The text a group actually receives, each
  tool as a live thumbnail the way Docs shows pages, faces instead of counts.
  A description of the product is the generated move.

**Name the mode before the stance.** The mode says what success looks like for
the person on the surface. Choose it from the surface, not the product: a
tool's landing page is still Persuade, a docs index is still Read.

| Mode           | The visitor                                                 | Surfaces                                     |
| -------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **Persuade**   | decides and acts; the design is the product                 | landing, marketing, campaigns, pricing       |
| **Operate**    | completes a task; scanability and native expectations first | app UI, dashboards, editors, admin, settings |
| **Read**       | understands something; structure for comprehension first    | docs, articles, guides, help, changelogs     |
| **Experience** | is inside the work; the interface recedes                   | portfolios, galleries, case studies          |

Most templates in the taxonomy are Operate. The Amber Circles landing was
Persuade, in the signage stance: mode and stance are separate calls.
_Modes from pbakaus/impeccable `skill/SKILL.src.md`, Apache-2.0, at `e103efe`._

**On Persuade and Experience, declare the ambition before building.** Three
dials, 1 to 10, decided once per surface like the theme: `DESIGN_VARIANCE`
(symmetry to asymmetry), `MOTION_INTENSITY` (static to cinematic),
`VISUAL_DENSITY` (gallery to cockpit). Operate and Read take no dials; their
motion follows how often the interaction is seen
([library/crafts/web-ux.md](../../library/crafts/web-ux.md), "Motion").

| Use case                      | Variance | Motion | Density |
| ----------------------------- | -------- | ------ | ------- |
| Landing, SaaS                 | 7        | 6      | 4       |
| Landing, agency or creative   | 9        | 8      | 3       |
| Landing, premium consumer     | 7        | 6      | 3       |
| Portfolio, designer or studio | 8        | 7      | 3       |
| Portfolio, developer          | 6        | 5      | 4       |
| Editorial or blog             | 6        | 4      | 3       |
| Public-sector service         | 3        | 2      | 5       |

**Motion claimed, motion shown.** Above motion 4 the page has to move. A static
page that claims `MOTION_INTENSITY: 7` is broken. If working motion will not fit
the scope, drop the dial to 3 and ship a clean static page; never half-build
motion that breaks. On 2026-09-23 a page shipped at 3 animations against a
reference's 214 and the linter returned clean, because nothing scored ambition.
_Dials and rule from `Leonxlnx/taste-skill/skills/taste-skill/SKILL.md` §1.B
and §5, MIT, at `ce26fc2`. Its "at minimum" list (hero entrance, scroll-reveal
on key sections, CTA hover physics) is left out: step 6 already refuses to
equate motion with quantity._

## One theme, never re-chosen

Caleb: "keep it the same theme." Tokens are defined once per surface and
referenced everywhere. A generator that picks a fresh accent color per artifact
produces a pile of demos rather than a product, and the tell is obvious the
moment two of them sit side by side.

## Where the thing renders

| Surface         | Use                                       | Reach it with                              |
| --------------- | ----------------------------------------- | ------------------------------------------ |
| **HUD**         | Ambient, live, over other apps, no window | `hud` and the `hud` skill                  |
| **Local page**  | Something to click through or keep open   | an HTML file, opened                       |
| **In the repo** | Part of a product being built             | the project's own stack, per `stack-rules` |

Pick the surface before the layout. An overlay HUD and a settings page are
different templates, and building the second one into the first is the common
mistake.

## Social images come from the product's own drawing code

Banners, profile pictures, share cards (og.png) and video thumbnails are rendered from
the code that draws the brand: the site's figure modules, the video's Remotion scenes,
the wordmark component. Never crop a frame grab, screenshot the site, or reuse files in
a `public/brand/` folder without checking they match the live mark. Firm Foundation keeps
them as stills in `video/src/Brand.tsx` (`npx remotion still OgCard|LinkedInBanner|
YouTubeBanner|YouTubeThumb`). On 2026-11-02 Caleb said all of these to one tab:
"BRO the logo is the FF one" (a stale brand file had the old cross), "Bro ur so lazy to
photoshop in the image I gave you", then "U HAVE THE SOURCE CODE".

Per platform, checked that night:

- LinkedIn's page logo covers the banner's bottom left, and the name sits right under it.
  Leave the lockup off the banner, keep the art clear of the logo, and center the main
  thing so phones, which crop the sides, still show it.
- YouTube channel art is 2560 x 1440. Every device shows only the center 1546 x 423, so
  the key art goes there and the extra pieces go in the band's ends.
- Profile pictures crop to a circle on YouTube. Keep the mark inside about 70% of the square.
- White backgrounds, never dull paper ("make it white not dull"). Grain also blurs once a
  platform recompresses the image.
- Render at 2x, then look at the live page in member view before calling it done.
- A link preview of linkedin.com always uses LinkedIn's own 200 x 200 logo JPEG. To
  share the company, send the site link, since its og card is ours.

## Reference files

- [references/taxonomy.md](references/taxonomy.md): every component and
  template, named, grouped by the job it does. Read at steps 1 and 2.
- [references/data-loaders.md](references/data-loaders.md): every data source
  already reachable on this machine, and the four shapes any new one arrives
  in. Read at step 3.
- [references/discover-data.md](references/discover-data.md): the procedure for
  a source nothing covers yet, cheapest method first, ending in pixels only as
  a last resort. Read when step 3 misses.
- [references/craft-floor.md](references/craft-floor.md): what to check on
  the built result, what to refuse, and what a script can count. Read at
  step 6.
- [library/crafts/interface.md](../../library/crafts/interface.md): the researched rules, from
  Refactoring UI and Atomic Design. Read at step 4.
- [library/crafts/motion-film.md](../../library/crafts/motion-film.md): editor-grade motion (text reveals, morphs, whips, parallax lag, slop tells), with copyable code in `apps/ux-engine/motion/primitives/motion.ts`. Read before animating anything.

## Ask what it is made of before drawing it

Caleb, 2026-10-07, on the same fridge: "Make sure pencil and pen look like
pencil and pen, and make sure based on the surface they are on they actually
look like that surface. Whenever you make smth, ask the questions that will
lead you to concluding things like this."

Before making any object that stands in for a real one, answer these, and let
the answers set the rendering:

- What made the mark? Ballpoint is thin, even, a little gloopy where a stroke
  starts, and skips. Pencil is grey graphite that catches only the tops of the
  paper grain and shines slightly. A Sharpie is flat black and bleeds on
  paper but not on plastic. Crayon is waxy and leaves the grain showing.
- What is it on? Notebook paper takes ink, a sticky note is thin and slightly
  translucent, a polaroid border is smooth and slick, coated cardstock makes a
  ballpoint skip.
- Who made it, and in what hurry? A grocery list is fast and slanting. A card
  for a wedding is slow. A kid presses hard.
- How old is it, and what has happened to it since? Sun fade, a fold, tape
  that yellowed, a magnet that has been moved twice.
- How is it lit, and does its shadow agree with the room it sits in?

An answer nobody wrote down is a default, and defaults are what read as made
by a machine.

## Handwriting is never perfect

A handwriting font set straight onto a page repeats the same "e" every time,
sits exactly on the ruling, and reads as generated at a glance. Caleb, on the
Amber fridge notes, 2026-10-06: "The handwriting is too perfect bruh" and then
"Never make perfect handwriting." Draw it glyph by glyph instead: its own
rotation, size, ink density and pressure for each letter, a baseline that
wanders as a smooth random walk rather than per-letter noise, a slight blur
for ink bleed, and lines that start at different indents. The working
implementation is `scrawl()` in `amber-website/scratch-render/make_items.py`.

## Every element proves something no other element does

Caleb on the Amber fridge, 2026-10-07: "Basic af each element has the same
ux", then, after eight different animations were proposed: "Wtf is the point
of diff ux if they're all emphasizing the same thing". Varying the motion is
not variety. Before designing any set of elements, write one line per element:
the one thing it proves that no other element proves, and why its interaction
IS that thing working. Two elements with the same line means one of them goes.

On a brand or waitlist site built for aura (teameigen.com is the reference),
"what it proves" is never a product capability. Caleb, 2026-10-07: "Bro don't
show the product. Eigen aura farmed by not showing the product." There, each
element reveals a different true thing about the people and what they
believe, and the product stays a mystery.

## On a rendered scene, nothing physical is drawn in CSS

Amber fridge, 2026-10-07: the wall clock, the journal's pen, its ribbon and
its leather cover were each drawn in CSS or SVG over a Cycles render, and
Caleb called every one fake within the hour ("The clock looks so fake lmao",
"the bookmark and pen look so fake bruh", "doesn't look like real leather").
Next to rendered light and shadow, drawn objects always lose. Render every
physical thing in the scene, or as its own registered layer with matching
light, and keep the DOM to hit areas, motion and the visitor's own ink. Until
the render exists, show nothing there.

## Nobody sees it before every state is screenshotted

The same night he opened the draft himself and said "Most of this site looks
terrible", on a join card with double ruled lines, a rejected font and stock
buttons that one screenshot would have caught. Before any UI goes in front of
him: screenshot every state (default, each open item, each form, success,
error) at 1440 and 390, read each image against the stance above, and fix or
list what is wrong first.

## A site starts from the UX engine and the house stack, never a CDN HTML file

Caleb on the Kyber landing page, 2026-10-27, in order: "Bro it looks so ai
slop html/css", "HTML CSS is so buns bruh", "Haven't we learned so much abt
designing great things? Don't we literally have a UX engine?", "Fix chewbs to
never do that again", and "Bro make the iPhone actually look like an iPhone
with real iMessage and a real looking iMessage app!!!!!!!!!!!!!". The page was
a hand-written `public/index.html` on the Tailwind CDN with an eyebrow over
every heading, 3-card grids, tick lists and a small CSS phone.

The rule: every landing page or site starts with `apps/ux-engine/bin/ux-pick
"<brief>"`, then the house stack (Next.js + `motion` + `lenis`, as in
TTS-Dev's `package.json`), then `site-gate research`. Never a
`cdn.tailwindcss.com` HTML file. `site-stack-gate.sh` refuses the Write of a
150+ line site page until ux-pick has run and the repo has the stack or a
`research/INDEX.md`. Utility pages (a vote page, a 404, `taste.html`) pass.

A phone mock of iMessage looks like real iOS, every part of it:

- Device frame with the Dynamic Island, real corner radius and side buttons
- Status bar with the real glyphs: time on the left, signal, Wi-Fi and battery on the right
- iMessage nav header: back chevron, the contact's round avatar (a group shows stacked avatars), name under it, FaceTime camera icon
- Bubbles with the iOS tail on the last bubble of a run, blue for sent, gray for received
- "Delivered" receipt under the last sent bubble
- An iMessage app extension card in its real shape: image on top, title and subtitle below, inside a rounded bubble
- Compose bar with the + button, the rounded "iMessage" field and the mic glyph
- Home indicator bar at the bottom

## A startup page for investors: premium first, and built from everything said

2026-10-28, Anchored's landing page for the YC and speedrun apps. v1 passed every
gate (paper ground, a pinned phone scene, hairline tables) and Caleb wrote "Its ok
but could be way better LOCK IN", then "MAKE IT LOOK AND FEEL LUXURIOUS AND REAL",
"MAKE IT PROFESSIONAL", and "take into account all our crazy ideas and what Dad
said ... search search think thinkkkkk dont be stupid be resourceful!" What landed:

- Open on a lit dark stage (near-black green, one soft radial light behind the
  device), never a flat paper page. One centered statement at 70px+ hands off to
  the device as the first scroll, the Apple product-page move.
- Devices look manufactured: a titanium rim (1.5px lit ring, dark gap, falloff
  shadow), a glass sheen, real iOS and macOS chrome, typing dots before a reply.
- Numbers are the visual: one giant numeral per claim (71% at 200px+), competitor
  figures at 88px, never a table of small text.
- Alternate grounds (dark scene, paper argument, dark scene, paper, dark ask) so
  every edge carries something, and fade between them over 28vh.
- Before writing a word, mine every idea source on disk: the repo's idea and
  ecosystem docs, family and mentor call notes in memory/, hackathon transcripts in
  raw/, and the event org's own repo and site (a subagent can read those). The
  strongest scenes came from Dad's asks: a debrief after a meeting that confronts
  and gives a verse for courage, "text this number" outreach, and "a Christian is
  never an individual user".
- Every vision scene is tagged planned, and every moment card names the context it
  needed ("Calendar", "Your small group") so the OS claim is shown, not asserted.
- Paint lighting on the one-screen sticky layer, never on the tall scroll section.
  On 2026-10-28 Caleb opened the page on his phone and wrote "It crashed bruh". The
  server was fine. The page had radial gradients across sections 420 to 470vh tall,
  plus backdrop-filter on the nav, the notifications and the menubar. Fix: a solid
  color on the tall section, the gradient on the sticky's ::before, and no
  backdrop-filter at phone width. Headless WebKit never crashes, so it can't prove
  this is fixed. Only a real iPhone can.

## Landing pages: the verdicts already paid for

Caleb on usctts.com, all on 2026-10-09. Each line is a build he rejected.
Read them before drafting any club or startup landing page.

- "So lame... nowhere near as cool as the clay site": a white sheet of
  plain sections under a cool opener. Plain is not professional, it's dead.
- "The transition feels so abrupt": an opaque panel arriving at a hard edge
  over a live scene. On clay.com the sheet is already peeking up from the
  bottom of the first screen at load, inset and rounded, and it grows to
  full width on scroll. Nothing should arrive from nowhere.
- "Ts so lame. I want Clay meets lemma... it should tell a story while still
  being professional": rounded bento cards and tabs on their own are still
  lame. It needs Lemma's intro event and a scroll story told by one object
  changing state, on top of Clay's structure and real artifacts.
- "The opening scroll&time animation is so chopped": measure frame times
  against the reference on the same machine (Chromium `--use-angle=metal`)
  before shipping any intro.
- "Repeating things is low aura": no image, clip, headline idea or CTA
  appears twice on a page.
- "What the fuck disgusting ai slop I wanna throw up never do this shit ever
  again" (2026-10-11, at a card with a 3px pink `borderLeft` on his site): no
  colored side stripe on a card or callout, no colored bar beside a heading,
  no pink-to-purple gradient card. Separate with a hairline or space.
- A chatbot that speaks for him on a site talks in his voice from
  `core/voice.md`, is fed the site's own data so it can't contradict it, and
  strips em dashes in code before the reply ships (2026-10-11: "it literally
  said em dashes"). A prompt rule alone leaked them.
- "DO NOT USE THE AI GENERATED TEAM": never put an AI-generated group or
  team photo on a real org's site, even when it's sitting in the repo. Real
  headshots only.
- "Nothing on either the sites should be unintentional": write an intent
  list of every visible element (what it's for, who it serves) before
  calling a page done. Anything on screen that isn't on the list is a bug,
  so cut it: leftover classes, inherited styles, stray borders, accidental
  gradients, defaults.
- "So blurry", "so choppy", "it just looks 2d" (tcombinator.org,
  2026-10-10): a 1280x720 film stretched across a retina screen, scrubbed by
  seeking a long-GOP H.264 file, made of flat cards with no camera move.
  Scroll-scrubbed footage needs display-resolution frames at dpr 2 (an image
  sequence on canvas, or all-intra video), one smoothed scroll value, and
  real camera motion through depth. Measure fps and held frames live
  before calling it done.
- "Ours is so lame the clay one is YAYYYYYY" (usctts.com vs clay.com,
  2026-10-10): a pale, flat-lit render floating small in an empty frame
  on a white page reads as dead. Clay's joy comes from saturated clay
  materials with grain, one soft key light with strong contact shadows,
  one hero object filling a tinted rounded frame per section, a colored
  pill kicker and a two-tone headline. Build that in your own palette.
- "Why are we repeating the same thing 3x???" (2026-10-10): the same render
  reused as the about image, a card and the film still repeats, even when
  each crop differs. One scene, one place. List every image and video with
  its source file before shipping, and check that none appears twice.
- "Bro it reads like a giant wall of text with an annoying moving fire"
  (askforthefire, 2026-10-10): a WebGL fire fixed behind the whole page, plus
  eight sections of paragraphs and an FAQ wall. A figure that follows you
  everywhere is wallpaper, and it carries no beat. What fixed it was one
  pinned scene where the product plays as itself (a phone running the real
  session, with lines from a real test run), the figure living only inside
  that object, one big line and one small line per beat, and the FAQ moved
  to its own page. Never ship a page-wide ambient layer as the story.
- A WebGL canvas that fails to start paints white on some browsers. On
  2026-10-10 the live prayer screen showed a white box with a broken-image
  icon in headless Chromium. Every shader figure needs a CSS fallback that
  swaps in when compile or link fails, and you have to screenshot that path
  with the GPU off before shipping.
- Bring the best of earlier versions forward. Before a rebuild, inventory
  what past commits built and what he praised (`git log --diff-filter=D`,
  plus the verdicts in docs/). A rebuild that drops the parts he loved
  reads as a downgrade.
- "Holy fucking wall of text with each section feeling combined... never
  make smth this shitty ever again" (2026-10-10, after "No sections should
  read as combined, that diminishes both of their power"). Every section
  owns one full screen and its own band, with a designed handoff to the
  next and never a flat color seam or shared space. Body copy stays under
  about 25 words per section; a list or table becomes a visual (a map, an
  animated artifact). Enforce it in code: tools/section-check.mjs in
  TTS-Dev fails a push on over 40 words, a shared background, a short
  section, a repeated image or a still render in a hero slot.
- "NEVER MAKE 3d STILLS" (2026-10-10, after asking at 10:29 for looping
  videos "like the clay site" and still seeing stills at 12:44). Every clay
  scene ships as a 4 to 8 second loop whose last frame meets its first, poster only under reduced
  motion. A render job stuck behind a paused one is the same failure, so
  check `chewbacca jobs list` and free the slot.
- "These aren't immediately perceived as interactive": headline-sized text
  that's secretly a link is not a door. Doors are big cards or buttons with
  an arrow, an action label and visible hover and press states.
- "I don't like everything getting dimm": hovering one item lifts it and
  leaves the rest at full strength.
- "The footer shouldn't have anything the header has": the footer carries
  only what the nav lacks.
- "TS NOT EPIC ENOUGH" on three small team cards in half a screen: a team
  or climax section owns the viewport with full-bleed portraits.
- "It feels like this is talking in lowercase": a credibility fact (who you
  build with, valuations) is the loudest moment on the page, made huge and
  given its own band, and stays exactly as true as the source.
- "The boring alumni layout lame af get creative" and "Would it be tuff to
  show an actual map?" (2026-10-10): a grid of logo cards is never the
  answer for a network or a client list. Use one idea the page already owns
  (lines of light from the home dot to each person; real land-mask dots
  with pins at true coordinates). Every dot means a place or a person.
- "Why do we have a people tab? All that info is on the main page": a nav
  item whose content already lives on home is a duplicate. Remove it and
  redirect the route to the home anchor.
- Glass text (Caleb asked, 2026-10-10): only on one or two numbers, only
  over a dark band with something moving behind to refract, solid fallback
  without backdrop-filter. On a light page it reads washed out.
- Logos (2026-10-10, "clayXperplexityXusc... keep it simple tho... still
  3d!"): borrow the feel, never the mark. A recolored copy of another
  brand's logo (Clay's stacked arch) is out. Build the mark from the org's
  own symbols, fewest pieces, render it in clay, and look at the still
  before animating it.
- Firm Foundation, 2026-10-10, after a text cut: "It reads like a slide
  deck bro", "so 1 dimensional unlike the lemma site", "this doesn't even fit
  in 1 section", "we don't need 2 start sections". Cutting words is not the
  fix. Never stack eyebrow + giant heading + boxed drawing section after
  section. Pin a scene (sticky h-screen inside a tall run) and swap steps on
  scroll, scale each drawing to fit the held screen, and merge any two
  sections that ask for the same next step. Display headings stop around
  3rem inside a scene; 5rem made one section taller than a laptop screen.
- A demo of a site or a phone inside the page gets solid colour and a real
  device frame (bezel, rounded screen, real bubbles and buttons), so a reader
  can tell it is the product and not part of the line drawing ("make the
  colors solid so they can tell it represents a demo site", 2026-10-10).
- Every tool or vendor name on a page needs a usage source in the repo's
  research folder before it ships. A name said on a call ("Church Connect or
  Churchly or whatever") is a research task, not copy (2026-10-10: "go look
  for what churches actually use").
- Every page, not only Home (Firm Foundation, 2026-10-10: "The trust page is
  so lame bro it's a wall of text, CHEWBS SHOULD NEVER MAKE A WALL OF TEXT",
  "the free website page is overwhelming and 1 dimensional"). A promises page
  is a few big lines on a band plus open items as chips; a form page shows a
  sample of what the visitor gets back beside the form, and optional fields
  start closed. Write it from the reader's seat (church staff who clicked an
  email), never from ours.
- A phone mock shows the real app it stands for: Safari with a URL pill on a
  site, Mail compose with To and Subject, an inbox with other mail in it,
  Messages with the contact header and input bar. A blue bar with the app's
  name over grey text was "lazy ahh" (2026-10-10).
- The phone is never the lesser version (Firm Foundation, 2026-10-10: "So
  much of the mobile version is 10x lamer than the desktop version, make sure
  that never happens again"). A pinned scene stays pinned on a phone in a
  compact layout; a drawing that is the point stays on the first screen (three
  hero plates, not one); a two-sided demo shows its main side with the other
  as one line. Before shipping, `site-gate parity <url>` must pass: phone
  figure share and screens with motion at 75% of desktop's or more, and no
  desktop pinned scene lost.
- Section to section is never a deck (2026-10-10: "Chewbacca should never
  make section to section feel 1 dimensional like a pitch deck!"). Never
  three sections in a row with one shape (same heading spot and size, same
  ground, one framed box under it), and at least a third of section edges
  carry something across: a sheet that overlaps, a figure that spans, or a
  change of ground. `site-gate deck <url>` must pass.
- Every screen has one place for the eye (2026-10-10: "cognitive overload
  mainly bc there is no visual heirachy of where to direct your attention all
  the text looks the same"). One element is loud (the biggest text at 1.6x
  the usual size or more, or the one royal thing), everything around it is
  small and muted; a data figure inside a story is the quiet version with one
  callout, never the full clickable tool. No control offers more than four
  choices: three paths times a Before/After toggle was "6 diff options". Show
  the before where the pain is told and the after where the build is.
  `site-gate focus <url>` must pass.
- An upgrade draft of someone else's site wears THEIR brand, never the
  register of the last site we liked (2026-10-28, Junto: "bro our site
  SUCKS", then "NEVER MAKE SMTH 1 DIMENSIONAL VISUALLY" and "NEVER MAKE A
  PDF"). v2 reused the Medrano register: dark plum slabs, a green button
  juntoai.com never uses, a blurry cropped product screenshot, and the
  ticket story as gray text rows. What fixed it: pull colors from their
  site's own CSS (research/brand), rebuild their product UI in HTML so it's
  crisp and alive (their demo ticket running its pipeline in a window at
  depth, layered chips and an approval card, cursor tilt), and carry that
  same ticket through a pinned scene where the object itself changes per
  step. Never invent an id or number to dress a mock (ticket numbers for
  "earlier crashes" were cut). Check short phones in headless WebKit too:
  iPhone 13 Safari is about 664px tall, and the scene overlapped there
  while 844px Chromium looked fine.
- A promises or mission page is drawn, not listed ("the trust page is 1
  dimensional"): each promise gets a small drawing and a few words, the big
  ones hang across a band's edge, and a why reads as beats on one line.
- A site is one story, and every section is a part of it that builds on the
  last (2026-10-11: "Sections should feel like different parts in a story
  that build on each other! This should be true for everything chewb
  makes"). Before building, write the parts as a chain where each one names
  what the part before it left behind: the guest the website brought in is
  the one Monday's brief is about, and the close returns to where part one
  began. Number them as parts, carry one object or person through them, and
  never let a section stand alone as its own slide ("chewbs should never
  make slide decks when we're trying to make websites").
- Say each thing once on the whole site ("ur repeating the same stuff nuh uh
  bro"). A promise lives on the page that owns it and the others link there;
  two pages never close on the same box. `site-gate repeat <url>...` fails a
  sentence of five words or more shown twice. It only catches literal
  repeats, so reread for the same promise reworded.
- Never make anything that could have been a slideshow (Caleb, 2026-10-25,
  on the Parker Manley site: "NEVER make anything that could've been a
  slideshow! Fix chewbs"). If a section's content could be exported as N
  stills and clicked through with nothing lost, it's a slideshow: a pinned
  stage that holds still and swaps a card, a plate or a caption every screen
  of scroll, a carousel, a row of slides with dots. Every section is a thing
  happening, a film playing, a camera rolling, an edit session, where
  something moves on every step of scroll and one object carries from start
  to end. Before building a scene, say what moves between its beats; if the
  answer is "the next image fades in", redesign it. `site-gate slideshow
<url>` must pass, and `site-gate research` refuses carousel libraries and
  slide markup in source.
- One object changing beats three side by side. A why told as three drawings
  on a rule, or promises as three cards, read as slides; one drawing whose
  parts move between beats, or one signed sheet with the promises as its
  lines, read as a page.
- No flashes, no whiplash on a phone ("some of the mobile
  animations/transitions are literal whiplash and flashbangs"). `site-gate
flash <url>` must pass. A bar that hides on scroll turns on travel (24px
  down, 64px up) and ignores the rubber band; turning on every 8px delta
  flipped it several times a second under momentum scroll.
- Interactive Playwright on clay.com trips the outbound send guard, which
  reads the word as a campaign. Screenshot it, or drive it from a
  standalone script.

## A team or advisor page is faces first, and every line has a source

Firm Foundation /team, 2026-10-29, Caleb's verdicts in order: "it looks like a
funeral pdf and u didn't even try to add logos or descriptions and you didn't
stress the christian leadership enough", "no black and white thats a funeral and
you can have more things pop out when you hover over us", then "The team page
isn't the best visually" at twelve uniform text cards on a navy band.

- Faces lead. Each person is a big colour portrait (4:5) with the name on the
  photo; never grayscale, never small circles beside a paragraph.
- Say what matters to this reader about each person in one line under the photo.
  For a church audience that is their walk with Jesus (pastor's kid, Praxis
  Fellow, leads FaithTech OC), marked with a small cross, only where a source says it.
- Where they've built is a row of real logos (`logo-fetch`, which refuses the 16px
  placeholders), with one line on what each place is behind the hover.
- The bio and the org lines rise over the photo on hover, and on tap on a phone;
  the card itself stays short. The lead person gets a split card with everything
  shown and one real quote of theirs.
- No row holds one card. Size each group's grid to its count, and fill a gap with
  real content (the partnership card), never a placeholder.
- Every fact on the page names its source in a comment beside it: their LinkedIn as
  pasted, their own site, a podcast or sermon they gave. Never infer a parent, a
  school or a faith from a name, a handle or where a photo was taken; ask, and keep
  asking until each card is filled. A portrait from their own published page counts.
- A person's photo stack never repeats a shot, even at another crop, and every
  photo in it is checked to be them. FF 2026-10-30: Caleb's headshot sat in his own
  stack twice and the "Caltech" photo was Taylan Kargin ("Bruh"). FF's
  `lib/photos.test.ts` refuses a repeat by thumbnail difference.
- Hover shows more, never less: the headshot stays full size and the other photos
  pop out beside it. A 2x2 grid that shrank his face got "Bruh".
- Family sits next to family in a crowd of faces (Jim Munroe beside Gavin, his son).
  A crowd stays one line: the oval version was "buns" (2026-10-30).
- Copy about a founder on a professional site never says student or school, and
  never abbreviates.

## A photo never ends on a hard line, and no band is left empty

Kyber landing, 2026-11-03: a generated group photo sat in a rounded box under a
headline, the box's top edge cut straight across the restaurant lights, and a
160px dark band sat under it before the light pricing section. Caleb: "Fix
chewbs to never make disgusting hard line cutoffs like this", then
"unintentional ahh blank space".

- A photo placed on a page (not a card the reader taps) feathers into the
  ground on every edge: a CSS mask of two linear gradients (top/bottom and
  left/right) composited with `mask-composite: intersect`. No box, no radius.
- Where a dark section meets a light one under a photo, the photo's fade and a
  ground fade (transparent, canvas, then the next ground over about 22 to 30vh,
  pulled up under the photo with a negative margin) are one continuous move.
- After the last element in a section, the padding is the gap to the next
  section's first element, never a band of plain ground. Screenshot the seam
  at 1280 and 375; on a phone a wide photo gets cropped taller
  (`object-cover`) so it doesn't leave the fade hanging under empty dark.

## Neighbouring sections differ in ground and in shape

Firm Foundation Home, 2026-10-30: a night app window, then a night "Work we've
done" window, then a night centred crowd read as one section three times ("the 2
sections being pretty similar feels 1 dimensional"). A plain paper /team hero was
"Boring monotone", and a one-colour /audit page was "so 1 dimensional and kinda
overwhelming bc of how monotone it is".

- Screenshot each section next to the one above and below at 1440 and 390. If two
  in a row share a ground (night, paper, mesh) and a layout (centred, window,
  split), change one.
- Where a dark section meets a light one, fade between them. A hard line with the
  heading jammed against it drew "Bruh".
- A diagram with more than two kinds of thing gets a colour per kind, a mark per
  kind left of the label at about half the item's height, and a key. The key sits
  where it can never overlap the diagram at any viewport ("Overlap is doodoo if
  unintentional"). Problems get their own colour, never the brand colour.

## A page for one person is built from that person, then turned all the way up

2026-10-26, a hype page for Caleb's roommate walking in from a late night of
studying. The first draft was written in one go from two facts, and Caleb
interrupted with "Don't 1 shot it be methodical!!!!!!!". The rebuild started
from what was actually on disk. The contact name ("Mark Lin Interdimensional
Portal Holy Spirit Slam Dunk"), a second contact called "MARK LIN FLIP PHONE",
and his own texts ("i'm running jesus burgers", his 6:44 mile, praying for
Caleb before his midterm) carried the whole page. After it shipped, his next
message was "MORE OBNOXIOUS".

- Before markup, run `people brief "<name>"` and read the whole text thread,
  check Contacts for a photo, and write SPEC.md listing every line of copy
  with the date it came from. Anything private (family, health, exes, other
  threads) goes on a "left out on purpose" list, because the URL is public.
- Render the gate, the entrance, the running state and the full page at 1440
  and 390 before deploying. Here the first render caught a full-screen beat
  word sitting on top of his name.
- A hype or party page starts at maximum loudness, with each addition hitting
  a different sense: sound (air horn, crowd roar, a spoken announcer through
  speechSynthesis), motion (slamming stamps, shake), touch (a confetti mouse
  trail, every key a horn), the tab (title flips, a drawn favicon) and
  persistence (idle heckles, a beforeunload prompt). Request fullscreen on
  the first key so nobody has to set it up.
- The loud parts never cover the name for longer than about a second.
- A static page goes in `public/` and gets served from there.
  `root * /app` served SPEC.md, with his dated quotes, at a public URL.

## The hard line

**Never invent a component that has a name in the taxonomy.** A bespoke variant
of a table is the recalibration this skill exists to prevent, it will not match
the next one generated, and nobody asked for it.

## A team deciding taste together gets a live vote page, never a doc

Kyber landing, 2026-10-27, mid-class: "Let's break it down into a bunch of mcqs for us to decide tastewise for the site tgt rn while we're still in class!!!!!!" and then "NO AI SLOP". What worked: a `/taste.html` page on the same deployed site, one question per screen, each option showing a rendered preview (the headline in each font, the swatch, the button), a free-text "something else", name-keyed ballots (latest wins) and a results view that refreshes every 4s. Ship it deployed within minutes, run `slop-check --stdin` on every label and "why" line first, and clear your own test ballots before sharing the link.

- Questions live in a plain data file (`taste.js`) so a teammate adds one without touching the flow.
- Preview fonts with named CSS classes. Tailwind CDN arbitrary `font-[Nunito]` classes in injected HTML rendered as the body font in the first capture.
- A loader that may finish before the next script runs sets a flag as well as firing its event (`window.copyReady`). The Kyber hero shipped once with the raw `dinner|the Airbnb|...` list showing, because `copy:ready` fired before `app.js` added its listener.

## A rotating word never changes the line count

Kyber hero, 2026-10-27: "Bro the cycling shouldnt change the number of rows since that moves the heigt and position of so much stuff". "dinner" fit on one line and "concert tickets" wrapped to two, so everything below jumped every 2.2s. Size the swapping word for the longest option (`text-[min(1em,11.4cqi)]` inside a `container-type:inline-size` headline), `whitespace-nowrap`, then measure the headline height for every word at 320, 390, 768 and 1440 and confirm it never changes.

## A site that sells a kid to parents leads with trust, and never goes quiet

Joshua Newton Baseball, 2026-10-29, a 15-year-old's lesson site sent to Little
League parents. Mid-build Caleb wrote "Keep in mind that parents will be seeing
this site, we need to impress them", then asked for the parents' blurb, the
family Dodger selfie, his own senior day photo and a photo of Josh coaching his
sister. Every one of those was a trust signal the first draft should have asked
for. Later a 100s sleep plus a foreground deploy poll got "Bro what is taking so
long???????" then "BRO?".

- For a minor's business, ask on minute one for the family photo, what the
  parents do and how they're involved, and any proof he's already coached
  someone. Parents book the family as much as the kid.
- Never put a made-up quote or a fake sender in a mock (a "Karen M." review
  was cut before push); show the real share text instead.
- Strip EXIF (GPS) from every family photo before it ships.
- Push, then reply with the live URL right away. Deploy waits run in the
  background and get one follow-up line, never a silent sleep in the
  foreground.
- Display type never sits on the person the page is about. Joshua Newton
  Baseball, 2026-10-29: a 15vw name over a full-bleed portrait covered his
  face and hit the nav at Caleb's short laptop window ("Bro its so slop and
  unintentional"). Give the photo its own column or band, size hero type by
  min(vw, svh), and screenshot at a short window (1000x560) before pushing.
- No novelty widget where a plain fact block works. Same site, same night: a
  split-flap scoreboard (one dark tile per letter, "E V E R Y Y E A R"), an
  empty "video coming soon" board half a screen tall, and a 6rem two-tone
  headline at 0.86 leading whose comma hit the next line drew "Slop design
  bro". What held up: a box score of four big values with small labels under
  the photo, headings capped near 4.4rem with 0.92+ leading, and empty media
  slots hidden until the media exists.
- Uppercase condensed display type needs line-height near 1.0 when a line can
  end in a comma or apostrophe. At 0.92 the comma in "NOT LONG AGO," still
  touched "LITTLE" below ("overlap is blehhhhhh", 2026-10-29). Screenshot every
  .display element on its own at 1440, 1000 and 390 before pushing.
- Sports sites borrow broadcast graphics, built from the subject's own photo.
  Joshua Newton Baseball, 2026-10-29, after Caleb sent MLB and ESPN graphics:
  the move that landed was cutting the player out with Apple Vision
  (VNGenerateForegroundInstanceMaskRequest, macOS 14+, a 40-line swift tool,
  no install), layering photo, giant name, cutout in one frame with one
  object-position so they align, and putting the name on the head line at
  every width. Then a sticky score bug that tracks sections as innings, a
  broadcast stat bar, and a lineup of white tags. Erode the mask 2px or the
  cap shows a halo on a darkened background.
- Hero parallax on a layered cutout: move the photo and the cutout as ONE
  layer (one wrapper) so they never split, and sink only the name. On a 390
  phone a name sinking 60% of the hero height slid under the copy block at
  30% scroll (Joshua Newton Baseball, 2026-10-30); 30% travel with a fade to 0
  by 35% scroll kept it clear. Screenshot 0, 0.3 and 0.6 of a screen down.
- "Reads SO slideshow pdf", "SOOOO 1 dimensional", "SCREAM baseball"
  (Joshua Newton Baseball, 2026-10-30): heading, paragraph, photo grid and
  separate photo bands read as a deck. The fix was turning content into
  objects from the sport that do something on scroll: every print dealt onto
  infield dirt (chalk foul line across it) one by one, ending with his own
  trading card landing on top; the price became a ballpark ticket whose stub
  tears at the gate. Ask of every section: what object from this world could
  this content BE, and what does it do as you scroll.
- A cutout of a person must be clean at the edge ("The cutout is so sloppy
  bro", 2026-10-30). Cut from the full-res original, never the resized web
  photo; threshold Vision's soft mask at 0.5, fill holes, open 2px, choke
  ~3px, feather ~1px, then recolor only the rim from interior pixels
  (scipy normalized blur) so no sky or grass rides along. Blurring the whole
  matte or decontaminating where alpha<0.999 smears the face. Inspect a 2x
  crop of cap, face and glove on navy before shipping.
- A flip card or any 3D-transformed face must be checked in WebKit, not only
  Chromium. Joshua Newton Baseball, 2026-10-30: iPhone Safari ignored
  backface-visibility inside nested transforms and showed the card back
  mirrored over the front; a card laid out at 300px then squeezed to a 60%
  slot reflowed its text into a mess. Fix: each face also hides itself at the
  flip midpoint (opacity with a 0.3s step), and a fixed-size object scales as
  a picture (FitScale) instead of reflowing. `npx playwright install webkit`.
- Never end a turn on an ETA unless the work is already running. On
  2026-10-29 at 1:33am the reply said "abt 30 to 45 min" and the turn ended
  with nothing started; at 9am Caleb asked "How'd it go" and nothing had
  happened on his brother's birthday. Either keep working in the turn, or
  start a background job and say its id.

## Tailwind v4: a default in plain CSS beats every utility

Tailwind v4 puts utilities in `@layer utilities`, and any unlayered rule
wins over every layer. So a default like `.iphone { --pw: 360px }` in
globals.css silently cancels `[--pw:...]` or `md:[--pw:...]` on the same
element. On 2026-11-02 the Kyber landing page's fit-to-screen phone sizing
never applied: every phone rendered 753px tall and covered the headlines,
and Caleb called the page "slop". Put component defaults in `@layer base`,
then check the computed value in the browser
(`getComputedStyle(el).getPropertyValue('--pw')`). Don't trust the class name.

## Check the in-between width, not just phone and big desktop

A laptop browser window that isn't full screen often runs 850 to 1000 CSS px,
which is below Tailwind's `lg` (1024). On 2026-11-02 every Kyber section went
two-column only at `lg:`, so in Caleb's window the text stacked over a big
empty right side and the phones slid under the headlines ("Bruh u lazy ahh").
Split columns at `md:` (768) unless the content truly needs more width, and
screenshot at 375, about 940, and 1440 before calling it done.

## Every section pops a different way, and the way comes from its job

Firm Foundation home, 11/2. Write the spec first: one row per section with its job,
what the reader should feel in three seconds, and one pop technique no other section
uses (motion, the product as the brightest object, real photography, faces, the payoff
shape). The site's signature background lives in one section only ("now ur spamming
the wavy background"). Gradients and glows used as filler read as slop. A grid of
same-color rounded boxes inside a bigger box is the worst offender ("SO SLOP I am
disgusted"): put steps in one line of type with arrows, quotes on a flat card, and let
a full-bleed solid ground carry the close. Text that must be read gets its own weight
and a halo off the image behind it, so it never blends into the art. Parallax is
small (speed 0.06 to 0.08) and off for reduced motion and touch. Props drawn into a
3D scene use that scene's own medium (its faces, dots and palette), or they look
pasted on; six passes of stroked instruments got "desmos" and "awful" and were parked.
