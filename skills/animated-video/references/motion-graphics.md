# Motion graphics, kinetic type and animated infographics

Process lessons from one graphics-led attempt. It was technically sound but was the wrong format
for its brief. The specifics it used (typefaces, accent colour, particular gags) belong to that
piece; choose fresh per brief.

## Principles that held
- **System before components:** set the type scale, spacing ramp and palette first, and give
  each accent colour a single meaning.
- **Frame 0 is the cover.** It must be legible at phone size and already in motion. The first
  event lands within about a second.
- **Carry the central tension through the middle.** Feature sections turn into ads unless the
  story thread is called back.
- **Endings can reply to the opening,** so the video loops on replay.
- **Concrete beats abstract.** Diegetic UI and objects (a phone, a message, a to-do list) read
  faster than symbolic shapes.
- **Vary the visual vocabulary from beat to beat.** Repeating one motif through the climax read
  as the flattest part of the piece.

## Pitfalls
- Raster art scaled above its native size goes soft. Opaque backgrounds on product photos can't
  be keyed cleanly; get transparent assets or plan around them.
- Music ducked word by word pumps audibly. Duck by phrase.
- For a personal story, graphics alone plateaued: every judge named "no human on screen" as the
  ceiling. When the subject is a person, surface this as a format question in step 2.

## Craft techniques

Techniques from widely shared code-drawn Opus 5.5 animations (X, September 2026). They are
tools, not a house style: a brief can call for clean vector work instead.

- **Handmade texture:** procedural paper grain and slightly uneven tone, torn or deckled edges,
  cut-paper layers with soft shadows, shapes and outlines that are a little irregular. Render the
  grain once and reuse it; recomputing a full-frame texture every frame is slow.
- **Line boil for a stop-motion feel:** re-jitter outlines with seeded noise and hold each
  drawing for 2-3 frames.
- **Avoid the generic looks:** SaaS illustration, flat corporate icons, neon glow, stock-looking
  gradients, and photorealism unless the brief asks for it.
- **Motion:** easing or springs, never linear. Squash and stretch, anticipation and secondary
  motion make even simple shapes feel alive.
- **On-screen text:** picture first. Cover the words: if a beat stops reading, redesign the
  picture instead of adding labels. Keep words for real names, numbers and quotes the picture
  can't carry: at most about 8 at once, each line visible for at least 2.5s. One display face,
  plus a monospace face if something is "machine output".
- **Recurring motif:** one character or object that travels through every scene and changes
  with the story (a single glowing word gaining senses and hands, a jar collecting phrases). It
  holds a long piece together better than a narrator.
- **Pacing:** alternate dense and calm moments, and give the key beat room to breathe.
- **Details reward replay:** real paper titles, tiny UI touches, plausible outputs. Keep them
  accurate or leave them out.

## Using a reference video: take its mechanics, not its look (2026-10-17)

The Firm Foundation hero (30s, Remotion, cut to a voiceover by Whisper word timings) went
through three corrections in one day.

**Never** build a deck. v1 was eight beats of type landing on flat paper backgrounds with a few
photo cards and a phone. Every technical check passed. Caleb: "It's not epic or creative enough
also take into acct the other video we had downloaded it was an ig link gav sent". The reference
reel had been studied the day before, but v1 borrowed only its surface (white space, one line of
type) and skipped its mechanics. Slides of type landing on word timestamps read as a deck, not a
film.

**Do** read the reference at full frame rate (25 fps) and write down its mechanics before
designing: what is held fixed, what changes, how often in frames, how each shot hands off to the
next, and the scale contrast. The reel (ahmed_fx3000) held a cut-out hero subject (Creation of
Adam hands) LOCKED while the world behind it swapped every 4 to 6 frames, each new world opening
as a small rectangle near the subject and growing to full frame. It added hairline guides, tiny
marks and a tiny bottom caption, then a match cut: the subject collapses to a circle, the circle
to a dot, the dot becomes a typing bullet, then an orb, then a product shot. The held image is huge and the type is tiny.

**Carry one object through every beat.** v2's spine was the spark gap between the fingers: it
becomes the royal dot, types the lines, routes an inquiry to a staff member, becomes the prompt
cursor, and drops into the center of the cross at the end.

**Matching a brand's site.** Caleb asked for the house site's style, then: "It shouldn't be a
carbon copy of the site! Just same style". Take the texture and type language (mesh glow,
halftone, hairline frames with mono ids, palette). Do not take its sections, layouts or content blocks.

Sourcing for this build:
- Public domain art from Wikimedia Commons through the API. Use the `thumburl` the imageinfo API
  returns; hand-built thumb widths return an HTML error page.
- Cut subjects out with Apple Vision `VNGenerateForegroundInstanceMaskRequest` from a small Swift
  script, no rembg install. A fresco with two subjects needs each half lifted separately, then
  merged.

**Fan out the parts that don't share files.** Caleb: "Graph engineer bruh". Skill lessons and a
separate-context judge that compares rendered frames to the reference's frames run in parallel.
The one CPU-heavy render stays serial.
