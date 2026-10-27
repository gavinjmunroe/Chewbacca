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
