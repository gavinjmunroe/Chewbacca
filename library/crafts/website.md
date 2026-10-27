# Website, finished

Learned 2026-09-22 to 2026-10-03 rebuilding uselemma.ai to within pixels, from
their shipped bundle, their live page and our own measurements, and then
holding the replica to it. `web-ux.md` decides what a site should LOOK like
(stance, refusals, removal). This file is what separates a page that looks
right in a screenshot from a site that feels finished in a hand. Every rule
below cost a day to learn. `site-gate` enforces the mechanical half.

**Before any of this: `site-gate research <repo>`.** It refuses a site whose
repo lacks `research/INDEX.md` (every page of the source, pulled with
api-anything or the site's own API), `research/SOURCES.md` (naming
api-anything, brand-grab, ux-pick or ux-gen, this file and site-gate),
`research/STEAL.md` and `docs/COPY.md`. Added 2026-10-10 when a new site
started from three hand-read pages and Caleb had to name the tools again.
The `site-spec` skill has the step-zero list.

**No walls of text, ever.** Caleb, 2026-10-10, on Erik Fish's draft: "Chewbacca
should never make fat walls of text! Ever! ... IF ppl wanted to read a book they
would open a book." One idea per beat, a block of 45 words at most, a section
at 120 words of body copy at most. Long reading goes behind a link or inside
an `<article>` page. `site-gate check` fails both limits.

**No hard cutoffs.** Caleb, 2026-10-10, on a book mockup with a light wall
behind it masked into an oval on a dark section: "Fix chewb to NEVER have ugly
hard cutoffs!!!!!!" A picture whose own edge is bright on a dark ground draws a
line round itself, and a radial mask only turns the box into an oval. Cut the
subject out (Erik's cover was flattened from the mockup with a perspective
warp), use an asset whose edge is already dark, or feather it into the ground.
`site-gate check` fails a bright-edged image on a dark section.

**No unintentional animation.** Caleb, 2026-10-10, on captions that faded up
on every scroll step: "upfade upfade upfade bro it hurts my eyes" and "NEVER
makes annoying unintentional animations". Every motion has a job you can name;
the figure moves and the text holds. Text that changes in place swaps (or
crossfades without moving), never replays an entrance keyed to state, and a
page gets one rise entrance at most. `site-gate research` fails a keyed
entrance and a component with three or more rises.

**Ambient particles are light, not icons.** On Erik Fish's hero, drawn
dandelion seeds (stem plus filaments) drifting across his face read as
"tacky", and on every page they got "annoying". What worked: a dozen soft
glowing flecks in the sunlit photo only, stopped once the hero scrolls away. An
ambient layer stays in one place, never crosses a face, and reads as part of the
photo's own light.

## A site is four layers, and a screenshot shows one

1. Layout, meaning positions, sizes and type, the only layer a screenshot judges.
2. Choreography, meaning what happens on load, on scroll and on arrival.
3. Ambience, meaning what moves while nobody touches anything.
4. Response, meaning hover, focus, press, keyboard, and where every control goes.

The replica matched layer 1 for a week and still read as dead, because
layers 2 to 4 were missing. Plan all four before building any of them.

## Choreography: two clocks, never confused

**Timed and scrolled are different kinds of time.** A load entrance runs on a
clock from mount (theirs: 2200ms, plates wiping open top-down over 770ms each,
copy lines rising 12px over 400ms at staggered starts). A scroll scene runs on
one progress value. A sweep that plays once on entering a phase is timed even
though scroll triggers it. Write down which clock each motion runs on before
writing it.

**One progress value, mapped once.** Every scroll-linked layer reads the same
followed progress, computed once per frame. Two independent paths from input
to pixel produced six alignment bugs in one morning.

**Fixed distance per layer, one shared curve, is what reads as depth.** Six
plates leaving at 420, 500, 360, 240, 300 and 200px over the same window with
the same cubic ease-out finish together. Per-layer rates straggle.

**The easing is the feel.** The logo wall's exit used ease-out where theirs
uses a cubic ease-in on all four channels (rise, clip, row offset, fade). The
numbers at rest matched; mid-exit ours was half gone while theirs had barely
started. Check the curve at three points mid-transition, never only the ends.

**Where opacity is applied changes what you see.** Their intro fades the
wrapper AND each plate, so the visible value is the square. A group fade and
a per-element fade with the same number render differently whenever things
overlap.

**Reduced motion lands on the finished state**, never a blank one.

## Ambience: inventory it, do not guess it

A finished page has things moving at rest. The reference had six we lacked: an
orbiting loader in the hiring banner icon, a pulsing scroll cue across the
hero, a logo marquee, a figure in the trust section, a self-advancing
testimonial carousel, and a mesh gradient running at different speeds per use.
None show in a screenshot and none show in a DOM inventory.

**Find them with `site-gate idle`**: settle at each scroll position, list
infinite animations in view, and pixel-diff two frames 1.2s apart, which
catches the rAF and canvas loops the animation list cannot see. Run it on the
reference AND on yours, at the same positions, and compare in kind.

Every ambient loop pauses offscreen and on a hidden tab, banks elapsed time
so returning does not restart it, and holds still under reduced motion.

## Response: every control, three states, a keyboard, a destination

**Hover by actually hovering.** Effects are often group-triggered: hovering a
card moves an arrow or underline elsewhere in it. Reading CSS misses them.

**Every control needs hover, focus-visible and pressed**, each a computed
difference you can measure, plus keyboard reach in a sane order. A carousel
takes arrow keys; a pinned scene must be reachable without a mouse.

**Every control goes somewhere.** `href="#"` is a dead end a visitor finds in
their first ten seconds. Subpages, forms with validation and a success state,
a 404. A site with one page is a screenshot with a scrollbar.

## Copy is yours, and checks must fold the brand

Three feature leads shipped as the reference's sentences with the brand name
swapped, and an exact-match copy check passed them. Compare with brand names
folded to one token and flag any shared run of eight words.

## Measuring a living page

- **Read the source before fitting the output.** A curve fitted to scroll
  samples for days was a percentage of a 1480px box in their component. Two
  hours in the bundle beat the week of fitting. `clone-site` has the method.
- **Launch Chromium with Metal** (`--use-angle=metal --enable-gpu
--ignore-gpu-blocklist`). Heavy WebGL pages drop to 1fps headless with
  SwiftShader and screenshots time out; with Metal the same page ran 50 to
  61fps. A measurement taken at 1fps measures the test rig, not the page.
- **Settled values for scroll-linked things, step responses for feel.** Park,
  settle, read. Then one wheel step with an in-page rAF logger for the curve.
  A probe that costs a second per read on one page and 10ms on the other
  cannot compare timing.
- **Score data rows only.** A table header counted as a miss in every
  section for a week.
- **Your own hide script can fake a regression.** Hiding "banners and cookie
  cards" by class substring hid two figures, and the crop said they had
  vanished. Confirm a surprising frame without the probe.

## Ambition is measured too, because honest and dull still fails

On 2026-10-04 two rebuilt sites passed every check here, carried no false
claim, and Caleb called them "infinitely more ugly and boring" than the
reference. The brief had demanded honesty and restraint and never demanded
spectacle, so the builders produced well-sourced essays. `site-gate story`
measured the difference: the reference is 52% figure with motion on 19 of 19
screens; the essays were 4% and 0% figure, with motion on 8 and 0 screens.
Words per screen did not separate them.

So every site needs a **scroll narrative**: one set of objects that IS the
story and changes state as you scroll (theirs: a wall of runs, nine light up
as failures, the wall breaks into diamonds, they land on a lattice that
becomes the product). Plus parallax depth in the hero, a pinned section, and
a figure on most screens. `site-gate story` exits 1 under 0.35 figure share or
under 60% of screens with scroll-linked motion. A restraint rule never
overrides this; restraint applies to colour and claims, not to the craft.

**Spectacle is held by taste.** Caleb, the same night: "Be tasteful. Lemma had
the most tasteful site ever." What made it tasteful is checkable:

- one visual language, with every figure drawn from the same vocabulary and
  stroke family
- one accent with one meaning, on a calm ground
- motion only where it tells the story, never bouncing
- a lot of space
- no element that looks imported from a tool's default style (a 3Blue1Brown
  black box, stock three.js lighting)

More tools on the page is not more ambition. Pick the one that draws this
story best.

## What Lemma's design system teaches, measured

These come from Wave 2 of the replica (`lemma-replica/docs/waves/W2-design-system.md`),
where matching its design system took the score from 29% to 59%. They
transfer to any site.

- **Choose the face by measurement, not by name.** Figtree matched the
  reference's cap height and x-height exactly. Inter ran 4% and 9% large, and
  that size difference read as "heavier" more than the letterforms did.
  Self-host it. Use two or three faces in strict lanes: one sans for display
  and body, and mono only for small labels.
- **Light type, flat leading.**
  - Headings at weight 400 (bold is the amateur tell), 36/43.2, tracked
    -0.01em.
  - The lead at 18/28, in the same ink at 65% opacity, sitting 8px under the
    heading.
  - Few type tuples, and every one used on purpose.
- **Ink, not black.** A dark indigo ink, a muted version of the same ink, a
  warm off-white ground, and one accent.
- **Containers:**
  - two widths, a narrow 880 and a wide 1280, with padding inside the
    container
  - a 384 + 64 + 544 grid for copy beside a figure
  - one left edge that every heading shares (224 on all four feature blocks)
- **Figures are one family:**
  - hairline strokes (0.12 to 0.25 in a normalised 0 to 100 viewBox)
  - one accent
  - each figure sitting in a padded well inside a 1px frame
- **Repeated sets are neither uniform nor random.** Ten of the twelve on the
  reference were uniform. The other two used a four-value palette in a fixed
  sequence. Read which before you draw.
- **Where a value is applied matters.** Opacity on a group renders
  differently from opacity on its children whenever things overlap.
- **Controls are square-cornered and quiet:** a dark-ink primary, a light grey
  secondary, and hover, focus and pressed each measured. The effects are
  often group-triggered, so hover by hovering.
- **In CSS, last does not mean winning.** Specificity beat source order three
  times in that wave, and once more on 2026-10-04, when it blanked a live
  button.

## A second reference: Gavin Munroe's site

`calebnewtonusc/gavin-munroe`, which Caleb called "insanely creative" on
2026-10-04. Lemma shows restraint. This site shows invention. What carries
over:

- **A story as a journey through places.** Each chapter is a city, joined by
  a flight line drawn on a map, with a stop number and a coordinate readout.
  A narrative with geography beats a list of sections.
- **One bold colour block per chapter**, from a single sunset palette, with a
  dithered or pixel scene inside it. Limiting the palette per scene is what
  keeps a loud page from turning messy.
- **The x-ray.** Drag across a scene to see how it's made: skeletons, paths,
  live readouts. It shows the craft and invites play.
- **Working demos inside the page,** in OS-style windows, plus Cmd-K to jump
  anywhere.
- **`verified` flags on every claim,** with unverified ones hidden in
  production. That puts the honesty rule in code instead of in a review step.
- **`reference/STEAL.md`** records what was borrowed from which site and why,
  so taking inspiration stays deliberate and credited.

**Steal like an artist, and write it down.** Gavin's method, from his
`reference/STEAL.md`:

- Before building, study the practitioners: an Awwwards juror's criteria (art
  direction, directed motion, 60fps) and The Pudding's scrollytelling rules
  (one step, one visible change; reversible; never hijack the scroll).
- Take techniques from the best sites online, and record each one in a
  STEAL.md table: From, What, Why it is ours. Include a "Not stolen, on
  purpose" list.
- Use real data, such as real geography from openly licensed GeoJSON or
  topojson projected with d3-geo, with attribution where the licence asks
  for it.
- Self-host every library at a pinned version with sha256 sums, and never use
  a runtime CDN import.

Go online for all of this. The best reference is rarely on disk already.

**Copy answers the reader; the picture illustrates the answer.** On
2026-10-04 the T Combinator animation landed, and Caleb said the copy "makes
absolutely no sense to a yc company looking at this ... and it makes no
sense to a USC student". The captions had narrated the animation ("Your
neighborhood. 232", "One lit window") when they should have answered the
reader. Before writing a caption:

- Name each reader and the moment they arrive (here, a founder replying
  "more info" to a DM, and a student who heard about the club).
- List the questions they have, in order.
- Assign one question to each beat.

A metaphor stays scenery and never carries meaning on its own. Write the copy
as one document, `docs/COPY-<site>.md`, by one author, and have builders
implement it verbatim.

**No hard cuts between sections.** Caleb, 2026-10-04: "There's no creative
transitions between sections." Both sites had a beautiful pinned story, then
stacked the sections after it like slides. Lemma never cuts: its bricks
become diamonds, the diamonds the lattice, the lattice the mark. Gavin's site
keeps one camera and a flight line from city to city.

Every section hands off to the next through a shared object (a light trail
that becomes a list's spine, a ground grid that flattens into a page, a sun
that becomes a colour band). Each handoff is scroll-driven and reversible,
checked at three points (before, middle, after).

**No heading-plus-line grids.** Caleb, on a six-cell "Money / Cohort / Your
time / Paper / Leaving" grid: "Header, subheader X6 screams SO AI." Repeated
cards with a small label and one line, and stat tiles, are the most
recognisable generated-page pattern. Say it as a paragraph in the owner's
voice (here, his own DM), as a real figure, or as a real list.

**Smoothness is measured where people feel it.** On 2026-10-04 the TTS world
reported 60fps from headless scripted scrolling, and Caleb found it "so
jank". Measure in a headed browser with a performance trace
(chrome-devtools `performance_start_trace`) during a fast trackpad scroll, and
read it for long tasks, forced reflows and per-frame state updates. A
headless rAF count only measures the test rig.

**One idea per screen.** A five-card stat row plus a bar chart plus a table
plus a callout on one screen made the run "too hard to comprehend". Show one
number, one plain sentence and one figure per beat, driven by scroll, and put
the detail behind a link.

## Learned on tcombinator.org, 2026-10-05

**Text is quiet, the figure is loud.** Measured on uselemma.ai at 1440:
headings 36px at weight 400, the lead 18px, copy beside the figure on a
384 + 64 + 544 grid. T Combinator ran a 92px hero, 52px section heads and
148px numbers, each alone on a screen, and Caleb said it "reads like a
slide deck" with a "fried" hierarchy. Write one ladder (display, number,
h2, caption, lead, body, meta) before styling anything, and one primary
button per screen.

**Mono is a lane for data, never a kicker.** Coordinates, timestamps,
batch, status, sources: values a machine could have written. A mono label
over every heading is the median generated page.

**Blend modes stop at stacking contexts.** `mix-blend-mode: screen` on a
video showed black boxes, because every section had a z-index and the
blend only saw its own transparent section. Key it instead: draw the
video into WebGL, alpha is the brightest channel, colour divided by
alpha. Same for any canvas meant to add light over a sky.

**A sticky background with a negative margin escapes its container.**
The sky was `position: sticky; margin-bottom: -100vh`, and that margin let
it slide past `.tc-after` and paint over the unpositioned footer. The
required "Not affiliated" disclaimer was live and invisible. After any
full-bleed layer, screenshot the very bottom of the page.

**No button ever jumps** (Caleb: "NEVER have sudden jumps for any button
ever"). Intercept same-page anchors. Under 2.5 screens, one eased glide.
Past that, a glide moved 1.85 screens in one frame across a 13-screen pin,
which is a strobe; dissolve instead (drift and fade out, move under the
veil, glide the last 0.6 screen while fading in). Measure the worst visible
per-frame step with a rAF logger; 56px passed.

**Make the case for the reader's real alternative.** The copy said "bring
YC to LA" and never said why a founder should pick USC kids over Stanford
and Berkeley kids. Name the alternative the reader is weighing and answer
it with sourced specifics.

**Manim on a web page:** render light on pure black, re-encode with a
keyframe every 4 frames for scroll scrubbing, key the poster the same way,
and zoom by scaling the map, never the camera: Cairo scales stroke width
with the camera frame and a 20x zoom turned hairlines into ribbons.

## Scroll-scrubbed film

Learned on tcombinator.org, 2026-10-09, from four messages Caleb sent about a
rendered film scrubbed by scroll that had passed every gate: "so ass and so
blurry", "And so choppy", "It just looks 2d bruh", and a leftover student
page. Each rule names the measurement that would have caught it.

1. **Sharp at the screen's own pixels.** The film was 1280x720, about 6MB,
   stretched across a 1440 to 2880px retina viewport. Render every shot at
   2560x1440 at least (1440x2560 for the phone cut) and ship it at that size:
   an image sequence drawn to a canvas sized to `devicePixelRatio`, with a
   lower set for phones and loading by shot. Text and any live layer must be
   pixel-sharp at dpr 2. Check: a dpr 2 screenshot of every shot at 1440,
   zoomed to 100%, shows no upscale softness.
2. **Smooth: never seek a video per scroll tick.** Setting `currentTime` on
   an H.264 file stalls on every seek, and even an all-keyframe file decodes
   late. Draw frames to a canvas on rAF from one smoothed scroll value (the
   0.2 lerp), blending the two nearest frames so every rAF paints something
   new, and render enough frames that consecutive scroll positions never
   jump. Check: an rAF trace while scrolling at 1440 and 375 holds 60fps and
   no image is held longer than two frames.
3. **Depth: the camera moves through the scene.** Locked-off shots with a
   small push read as flat cards. Every shot needs a real move through
   layered geometry (dolly, crane, orbit, a fly-up between towers) so the
   foreground, midground and background slide against each other, with
   perspective on the architecture, light shafts and haze between planes,
   and rim light on silhouettes. Flat 2D only at the one graphic peak, on
   purpose. Check: overlay the first and last frame of each shot; the near
   plane must move several times farther than the far one.
4. **Every page is in the film's world.** A plain page after a cinematic one
   reads as a leftover even when its copy is right. Give it the same sky,
   type and sharpness, one clear action and a deliberate layout; a missing
   link stays a visible, finished-looking state, never a gap.
5. **Nothing over the film covers the thing it's about.** On usctts.com/way
   (2026-10-11) caption clouds placed by eye at 1440 sat on the typewriter
   at Caleb's window, twice: "Never block important things when they should
   be shown!", then "Bro ur literally covering the typewriter lmao check all
   placements". A camera that moves through a stage brings the subject into
   any fixed corner. Map where the subject is in every frame (TTS-Dev
   `scripts/caption-room.py`), place each overlay from that map at the
   reader's own window size, and let it step aside as the camera arrives.
   Check: read the film's own pixels under every overlay at 1100, 1280,
   1440, 1680, 1920, 390 and 430 wide, at each stage's start, middle and
   end, in Chromium and WebKit; subject pixels over 2% fail.
6. **The texture adds life, never takes it.** "It seems to be making things
   less vibrant, if anything it should be making them more", "looks like
   it's on a dusty screen", "The clouds look dead inside" (2026-10-11). A
   pastel render reads as dust, and grey grain laid over it greys it more.
   Blend grain soft-light, grade the film (saturate 1.28 and contrast 1.08
   held the grass and sand true; 1.4 went neon), and take rendered white
   props most of the way to white with sky colour in their shade. Check:
   mean saturation on screen never drops below the raw frame's.
7. **A prop takes the shape he describes, not the literal words.** "Flat
   bottom, flat front" meant gentle bumps, not a front cut flat: "I didn't
   mean the clouds are literally flat... It looks like you chopped the
   block". A set of props is a set of shapes: "Each cloud should be a
   slightly diff shape! Some taller, some rounder, some wider". Render a
   preview of every variant and look at it before wiring any in.

## Done means

`site-gate check <url>` and `site-gate story <url>` exit 0 at 1440 and 390: no console errors, no
horizontal scroll, no dead links, every control changes on hover or focus,
nothing infinite under reduced motion. `site-gate idle` shows the ambient
layer you planned. Every subpage you link exists. Then look at it beside the
thing you are matching or beating, frame by frame, because the pixels outrank
every number above.

## Every section names its reader (usctts.com, 2026-10-04)

Caleb, over a beat showing "388 open roles" as dots: "So many things on this
site provide value to NOONE looking at the site, especially a business that
doesn't know much abt ai but wants help." Internal stats, our own pipeline
numbers and curriculum diagrams were built for the builders, not the reader.

- Before building a section, write which reader it serves and what question
  of theirs it answers. If neither reader is served, it doesn't ship.
- Show a business owner a thing they recognize: an inbox, a spreadsheet, a
  list, a lesson. Abstract cubes read as decoration. The same beat lost
  badly to clay.com until it became a real-looking object.
- A gate passing is not the page being seen. A fixed background covered the
  whole bottom of that page while check, story and slop-check all passed;
  site-gate now fails a heading that paints nothing, and a reviewer that
  did not build the page looks at the screenshots before anything ships.

## Reworking a client's live site (bluemodernadvisory.com, 2026-10-10)

Caleb: "it looks so ai slop rn ... keep it professional maybe a little more
tts/lemma/firm foundation finesse but ultimately just more professional." It
was going to Sagar and Maggie, whose site it is.

- Never touch their prod. Branch it, and deploy the branch as its own service
  in their hosting project (`railway up --service <Name>` plus `railway domain`),
  so the owners compare two live URLs and merging stays their call.
- Leave prod secrets off the preview so test form submissions never reach the
  client's real pipeline, and say so when handing it over.
- The slop on a professional-services site was the template rather than any
  single element: stock hero photo, serif plus italic accent, an uppercase
  kicker over every heading, a logo marquee, three pillar cards, 01/02/03
  numbers, a rotating quote, a sticky CTA. Removing them did most of the work.
- Replace the stock photo with an object the buyer recognizes from the
  service itself (for a data firm, a live record queue), labeled as sample data,
  and build the scroll story from the client's own published case numbers,
  with a caption naming which engagement each number came from.

**Calm is not professional (BMA, 2026-10-10).** v1 cut every slop tell and
landed as hairline rows on one off-white ground at one heading size. Caleb:
"so chopped and boring and terrible visual heiarchy", "This is so shit lmao".
What fixed it came from usctts.com and lemma-replica, not from removing more:
a dark first screen with drawings of the client's own work in thin
mono-labelled windows around a centered headline with one accent phrase, a
paper sheet that rises over it and widens to the edges on scroll, tinted
rounded panels for sections, a number as the headline of each case, and a
type ladder with real jumps (88 / 48 / 72 figure / 17 body). Before a
professional rework, open the team's own best recent sites and name what
each does on its first screen.

**A section of copy is a wall; a professional site still needs the story
(BMA, 2026-10-10).** "So much of the site is just a fat wall of text no one is
tryna read we gotta tell a MOG story just like lemma" and the other reference
sites do. The fix was one pinned scene (640vh, canvas, one followed progress
value) where the client's own records change state per beat: messy wall,
flagged, gated into a grid, sprouting decision-makers, routed into lanes,
landing on the result. One headline line and one sub-line per beat, every
number from a case study with a footnote naming the engagement, and the
testimonial moved into the final beat so the big number appears once.
`src/story.jsx` in bluemodernadvisory/bma-website, branch Caleb-Rework, is the
reference build.

**Neighbouring sections never read as one (BMA, 2026-10-10).** The team row
and the FAQ sat on the same ground with the same heading-left split, and the
page read as one block that ran on. Caleb: "Never make sections that read as
the same section connected" and "Each section feels like 1 connected blob".
Each neighbour changes at least one of ground (paper, tint, navy) or layout
(split, centred, full-bleed figure). `site-gate check` now fails "twin
sections" mechanically.

**No section is ever boring (TTS, 2026-10-10).** Caleb: "Make sure no section
is ever boring. Chewb should ALWAYS ensure this", and "No more 3d stills
right? They're all fun videos???". A still render, however big, is a poster.
Every section moves on entry, at rest or with the scroll. `site-gate check`
now fails a section where none of the three happens. Calibrated that day: the
Lemma reference had 0 such sections, live usctts.com had 5.

**Every space is filled on purpose (TTS, 2026-10-10, that evening).** Three
more shipped past the first boring check: a still clay world in its card
("they need to be 3d animated videos like the clay site!!!!!!!! ALL OF
THEM"), a close that was one sentence on 1.3 screens of flat cardinal, and
advisor bands whose right half sat empty ("Chewb should ALWAYS be
intentional with how it chooses to fill EVERY space"). `site-gate check` now
also fails a still image over 20% of a section, a band under 15% content that
sits dead once it lands, and one empty block over 30% of a section. It is
stricter than the Lemma reference on purpose: Lemma's trust and newsletter
bands fail it too.

**The TTS night, every mistake and where it is caught now (2026-10-10).**
Caleb: "fix chewb to never make the mistakes we've made on this site ever
again". Each one below is either a `site-gate check` failure or a rule here.

- A section where nothing moves, a still 3D render, a dead slab of flat
  color, an empty block over 30% of a band: `boring section` lines.
- A progress point that bounces on every wheel notch, because it rode the page
  but read a smoothed copy of the scroll: `jitter` lines. Anything meant to
  hold still on screen reads the real scroll; the smoothed one is only for
  things that live in a fixed or pinned layer.
- A looping video whose baked background shows as a box on the paper:
  `seam` lines. Match the page at the edges or render with alpha.
- Logo pills louder than the person, a pill holding a bare number, the same
  mark twice: the person leads, credentials sit one tone at one height.
- A lone 3D object floating on paper: every loop comes with something, the
  line and the action it belongs to, in one composed band (the reference is a
  card whose video fills its whole half, edge to edge).
- Cards inset far from the edges with the figure a fifth of the card: use the
  width the content earns, and let the figure fill its half.
- A headline masked by a vignette: text stays fully readable at every scroll
  position of a scene.
- A gray void behind a 3D scene: every scene gets a world, sky, ground,
  props and small motion across the frame.
- A stale number: a valuation carries its date and source, and the newest
  confirmed figure wins; an unconfirmed round never goes on the page.

## Gift sites and the two things he shouldn't have to say (Meet Mrs. Shen, 2026-10-26)

- Before building, list the elements past sites already proved (Parker's ticket
  tear and Academy leader, Anchored's pinned scroll stage, a curtain theater)
  and say which ones fit this story and which don't. Caleb, mid-build: "Think of
  dope elements/animations/styles weve done before and if they could add to
  this, dont force anything tho. I should never have to ask this."
- READY means the deployed URL, not localhost, went through a few rounds of
  capture at 1440 and 390, site-gate, fix, redeploy. Nothing goes out to the
  person waiting on it before that. Caleb: "READY means we've iterated at
  least a few times on the deployed site and get it perfect."
- Railway: a push to a repo deployed by `railway up` doesn't redeploy. Check the
  live title after the push, and run `railway up --ci` if it's stale.
