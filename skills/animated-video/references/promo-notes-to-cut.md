# Turning a review call into the next cut (Firm Foundation hero v6, 2026-10-17)

Caleb and Gav reviewed v3 and v5 on a call and said "MAKE THE NEXT DRAFT". While v6 was
being built Caleb corrected the build a dozen times. Every one of these is a rule now.

## Before building

- Map every note in the transcript to a scene in a storyboard file first, with the speaker's
  words. Notes that contradict each other (Caleb wanted density, Gav wanted minimal for older
  viewers) get settled by who the viewer is, and the reply says which way it went.
- Mine the people's own records for their logos and history before drawing a placeholder:
  their resumes, the LinkedIn data export, their sites, the logo folders on disk. "We
  literally hv my linkedin and gavins liknedin and both of our resumes" came after a wall of
  "(X logo)" shapes. "bro both of us have so many more business logos", then "MORE LOGOS".
- When a photo or logo truly isn't on disk, draw a tinted shape that reads "(photo of X)"
  (Caleb: "just do a shape with (photo of X) in the middle of them"). Never borrow a photo
  from another scene to fill the gap.
- Ask the questions that change the build in one message at the start, and again whenever
  the user asks. "Ask me more questions bruh I hv a feeling nothing is close to perfect".

## Building

- Nothing sits on one plane. Every collage item gets its own depth: scale, blur at the
  extremes, z order and drift speed, with slight overlap between neighbours ("make sure
  things don't come across as 1 layer", "slight overlap and layering to make it cool 2d 3d
  like the lavalab parts").
- Items glide in from just outside where they rest and keep floating, the LavaLab grid's
  move ("the lil glide/animate in stuff from the lavalab waffle that make it feel alive").
- A shape made of photos must read as the shape: fill it edge to edge on a grid clipped by
  the shape's implicit curve, small tiles, centre out on the way in and edge in on the way
  out. Photos placed along an outline read as a blob ("It doesn't look enough like a heart",
  "The whole heart should be filled", "starting with one in the center", "disappear starting
  with the ones on the outside").
- A masked word means the word is the window: plain ground, the texture visible only through
  the letters ("white background and the text is a mask to the water background").
- Keep each kind of photo to the beat about it. Ministry photos only where the line is about
  ministry ("The ministry stuff shouldn't be until the we love Jesus part"). Don't show the
  client's own site when the brief is about the work you do for others ("Ideally we don't
  show the Firm Foundation site").
- When the user names something of theirs as "so tuff" (here, the site's voxel cross), port
  its real code into the video instead of approximating it.

## Reviewing

- Review the whole film as a tiled contact sheet at 3 fps from a low-res preview
  (`--scale=0.4`, `nice -n 19`, low concurrency on a busy Mac) before any full render.
- Read every tile for: tiny text a phone viewer can't read, empty frames between words,
  placeholders that dominate a composition, and anything the user already rejected.
- What the v6 frame review actually caught, so check these first next time: captions and
  labels at 11 to 22px (phone viewers can't read them; 30px captions, 18px labels is the
  floor at 1080p), a cut-out figure covering the faces it sits in front of, the cut-out's
  own rectangle edge showing once it moves, a watermark word nobody asked for, and a grid
  scaled up until it ran over its own sentence. Fix what the review finds before asking
  the user about it; ask only about taste calls.

## v7, the second call (2026-10-17 evening)

- Before calling a cut done, list every instruction from every call transcript and Caleb's messages and mark each built, in progress or not done. He asked "Did you implement every single thing Gavin and I said to do?" and the honest answer was no. Say so with the list.
- Re-use the matte that was already fixed. v6 swapped back to the raw cut-out and Caleb asked "Why did the tracing get worse???"
- A dot field never sits in a box ("shouldn't hv firm square boundaries"): fade the sampling weight on an ellipse and fill the frame with an ambient field that bends with the morph.
- Titles: offer a picker sheet of real alternatives (solid, chrome, glass slab, dither, misregistered) over the real ground instead of iterating one look. Puffy bevel reads as 2009; tinted glass letters read gray and unreadable; colour belongs only at edges if at all. He picked chrome with a light sweep.
- A transition never crossfades two grounds into grey, and never wipes with a hard circle over the title. Clear the title first, pour into the next beat's anchor, then cut.
- "Make it feel like data" means 1-bit pixels, not dots: a noise field thresholded on a 4x4 Bayer matrix, tiles that dissolve by coverage and turn into ASCII in flight (Gav's DITHERING-PHYSICS.md).
- Fan out per beat: split the composition into one file per beat first, so helpers never share a file.

## v8, Caleb's notes on v7 (2026-10-17 night)

- "Scraps" in a scrapbook look means cutouts: an object cut along its own silhouette (like the hand matte), or a clipping out of a newspaper or magazine with real print in it (headline type, halftone, column rules, a scissor edge). A square photo card with torn edges and tape is not a scrap. Caleb on v8's era cards: "Not just a square with some stuff on it that's so uncreative and not lit." Matte the object out before placing it.
- When a scrap travels side to side to change content, he calls it "polaroids jumping left and right". Scraps land once and stay put, and new ones layer on.
- A morph that transforms AND rotates the field is too much motion. Transform only.
- "Too obnoxious" on an intro meant too many simultaneous motions (a 9x zoom with blur, a swirl, a flicker and a traveling card). Cut motions, not just durations.
- A heart or grid filled by cycling a short media list repeats every image three or four times. Place each image once and fill the remaining cells with plain tiles.
- Check rolling digit reels in stills: a reel mid-roll read "10:99". Constrain each digit's pool to valid values.
- Run a repeated-image audit across every beat before render (grep every asset name, count uses, and check the same site or person isn't shown twice in different files).
