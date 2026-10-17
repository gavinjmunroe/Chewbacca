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
