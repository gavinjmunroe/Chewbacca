# Collage openers and drone-show morphs

Firm Foundation hero, 2026-10-17, v8 to v10. Caleb corrected the opener nine
times in one night. Each line below is one of those corrections and what fixed it.

## Scraps are cut, never rectangles

- "I want it to feel like it was cut out of a newspaper/magazine!!!!! No boring
  ah rectangles." Every piece is cut along its own edge. Cut an object along its
  silhouette (Vision lift, `tools/lift.swift`) and give it a 3px white paper rim
  plus a shadow. Use scissor polygons for clippings (a few long straight strokes)
  and torn polygons for pages, so the fibres show.
- "There's gotta be more types of creative scraps" and "check the lava vid
  again... a wide variety in the type of medium". One frame mixes media:
  a silhouette cutout, a newspaper clipping, a blackletter broadside, a page in
  offset strips, a film strip with sprockets, ransom-note magazine letters, a
  thermal receipt with zigzag teeth, masking tape. LavaLab's F26 reel mixes
  bitmaps, charts, logs, giant numbers, macro photos and detection boxes the
  same way.
- "I like things poking in from outside the screen like the vibe we had w the
  arms." Pieces slide in from the frame edge they stay cropped by. They never
  pop in at the centre.
- Use an entrance ease that doesn't dip below zero. An anticipation ease
  (2.4x^3 - 1.4x^2) sent late pieces further off screen first, so the last two
  never arrived before the exit.

## Depth is a camera, not a stack

- "layer things in the 3d space!!!!!!!!!! Rn it feels like the scraps are on top
  of an animated screen, not in the same universe." Give every layer a z and move
  all of them with one camera (a slow push plus a drift, scaled by z). Some
  pieces sit behind the moving figure, blurred and darker, and some float in
  front. The hero object (the arms) is nearest.

## A drone show only draws what reads at a glance

- "the drone show is pointless when used on things that aren't immediately
  recognizable! The cross is awesome, but you cannnotttt tell who else that is."
  Portraits as dots are noise. Use icons and silhouettes only (a cross, a
  church, a phone, a logo). People go into the collage as photo cutouts.
- "I want the drone show to have some purpose that coincides with the intro and
  isn't completely unrelated to the transcript." Each figure acts out the VO
  word it lands on: the name, then "churches", then "technology", then
  "ministry".
- "is there a tasteful way for that to coincide with the scrapbook futurism
  vibe?" The dots fly as lights, then land as halftone ink on a paper cutout of
  the figure's silhouette. That's one move that is both retro and future.

## Morph mechanics

- "a bunch of it is split into quadrants... It feels like sections that are
  folding apart." Pairing dot i to dot i along a Hilbert curve morphs the field
  block by block. Pair the dots between figures with an optimal assignment
  (`scipy.optimize.linear_sum_assignment` on squared distance) and move them all
  at once with a few frames of random jitter.
- Fit the morph inside the beat. 17 + 7 frames in a 22 frame era meant no figure
  ever finished forming. Morph plus sweep has to leave a hold of at least 6
  frames.

## Sections need different languages

- "There has to be a difference between the beginning and the waffle section!"
  The two navy scenes with things floating around a centre figure read as one
  section. The opener went analog (paper, scissors, tape, a warm charcoal ground)
  and the waffle stayed digital (hairline instruments, mono, navy). Don't lend one
  section's motifs to the other.

## Sound

- "it sounds like a tutorial video on a plane": a loop played flat under the
  whole cut. Gate the music stems on and off with the cuts, so a hit lands on a
  section start and the music drops out where a question should land in silence.
- A VO split at Whisper's word end clipped a trailing "s". Whisper's end time
  marks where the sibilant starts. Measure the waveform and cut in the silence
  after it.

## Later the same night (v11, v12)

- "the background music is terrible gav will handle that, keep the sound effects" and
  "the amount of sound effects is getting a lil obnoxious, only have them where it adds
  smth/fills space". Cut typing under every typed line, pops per element, blip floods
  and a paper slap per piece. Keep one sound per real moment (the spark, the name, a cut,
  a folder shut, a question landing) plus whatever fills a music-free gap.
- "The intro is too high cognitive overload". Ten scraps plus the title over every figure
  for 3s was too much. Use five pieces, and lift the title once its glint finishes.
- "Only use rectangles when that is the tuffest thing to do, most times it reads slideshow
  presentation". On an instrument scene, draw the artifacts straight onto the ground with
  no framed cards, one drawing per beat.
- "If stuart and [cliffe] get an iPhone, should the others get smth else?" One rule
  works better than one-offs: each person rises out of the medium of their age, a printed
  broadside, a 1950s TV, a phone. Put the person behind the object so the medium carries
  them in.
- Living people in an ad: ask before using their faces. Caleb got his Christian
  leadership's ok for the Knechtles, and Chase and Reagan gave theirs for their sites.

## What ahmed_fx3000 does (Lupa and ChatGPT reels, studied 2026-10-17)

- He carries one hero object the whole way. A photo goes from collage to UI to its own
  world, and the camera pushes into it at each cut.
- He puts the word behind the subject ("Elevated" sits behind the snowboarder), so type and
  image share depth.
- The key VO word punches in huge as its own cut.
- One motif keeps changing shape: [ ] shrinks to [•] and then opens into a window.
- He shows one thing at a time and leaves a lot of empty space.

## Fakeplastictree "Motion Graphic | Collage" (Caleb's reference, studied 2026-10-18)

- It builds one scene a piece at a time in reading order and then holds it. A building slides in from the edge, then a second, then two figures, then the sun, and every piece stays until the whole scene leaves together.
- The cut-outs move on twos (each pose held two frames) and the grain jumps every two frames, so it reads as handmade stop motion. Keep type and particle systems smooth.
- The ground is a black void, the cuts are clean with no rim, and scale is surreal (a giant sun over small people).

## v14 to v15 corrections

- "The scrap paper popping in and out out of nowhere in the intro is so bad... make the paper shapeshift instead". The paper is now a gooey mask drawn from the dots themselves, so it flows with every morph. It only forms once the first figure lands, because grown during the flight it read as blotches.
- "The light outline around the firm foundation text... making it pop less", "Line under the title also is not aura". The title is now just the silver letters.
- "'everything' 'else' should not be 2 separate quick things". A list should roll like a decelerating reel and land once, then hold.
- "once it scaled down it was still just a hard cut", "the book a call to the God's firm foundation one isn't even a transition". Every hand-off carries an object across: the screen scrolls into the next page, and the blueprint tips back into the foundation.

## v16 to v19 (2026-10-18, past 1 AM)

- Know who it's for. A church-staff video should look cool but still feel calm, clear and trustworthy, so judge every beat as an ops director would. Caleb: "rmr this is for church staff not for instagram".
- Keep it calm: "too much of it is fast", "none of the reels we've sent were overwhelming". Lengthen the morphs and holds, shrink the camera travel, and drop motion before adding any.
- Decide whether each transition is loud or quiet. A move that shifts the whole frame has to mean it ("if a transition is causing major motion of EVERYTHING it has to have an understanding if that is supposed to be loud or quiet"). The camera dive into a phone and back out was "so tasteless". An overshoot on a cut-out's entrance "adds nothing and looks rlly stupid".
- Let one thing move at the centre. v18 had the title, drone figures, paper and hands competing, and Caleb called it "a mess". The original reel holds one subject still (the hands) and lets everything else happen behind it: full-frame flashes every 2 to 3 frames, red construction lines and circles drawn over the subject, two pixel squares at the gap, one tiny caption. Read a reference frame by frame at 15 fps before claiming its structure. The 6 fps read missed the guide lines.
- Make the intro title big and centred, and keep it up the whole intro. Never put a halo, outline or floor line on it, and never set it over paper.
- Hold a beat long enough to read. At about 2 frames, the Cliffe and Stuart pop-out was "there for like 2 frames lmao".
- Pace a rolling list or an on-screen object to the words it illustrates. The nodes and the envelope drew too fast, and the fix was to start them together and end them as "everything else" finished. Small live details that prove the job help: an inbox badge counting up, kids checking into a floor plan.
- Make the intro name the still point. Put it big and centred in front and leave it still ("I don't think the firm foundation text should move"). Things can play behind it, which is why it sits front and centre ("Stuff can be behind the name!").
