# Cutting footage to a song

For a montage: footage that already exists, shot or generated, cut to a track
in a style lifted from edits that work. Not for a single generated shot, which
is [routes.md](routes.md).

Two tools, both in `bin/`:

- **`edit-dna VIDEO_OR_URL ...`** measures how an edit is cut. For each input
  it writes a JSON summary with one row per shot, a contact sheet at two frames
  a second, and a chart of motion and loudness with cuts and beats marked.
  Public Instagram, YouTube and TikTok URLs are fetched with `yt-dlp`.
- **`edit-cut CLIPS --song track --style NAME`** cuts clips to the song in a
  measured style, writes the video and `NAME.edl.json` (every slot's source, in
  point, speed and flash), then prints what it planned, what `edit-dna`
  measured on the result, and the reference.

## The order

1. **Measure three references first.** `edit-dna` on each, then read the
   sheets and the energy charts. The numbers say how fast, how locked and how
   flashy; the sheet says what the shots are.
2. **Pick a style, or add one.** A new style goes into `STYLES` in
   `bin/edit-cut` with every number read off `edit-dna`, and the reel it came
   from in a comment. Never an adjective.
3. **Cut.** Read the three columns. Measured above planned means the source
   clips have cuts of their own inside them, or a shot split in render.
4. **Look.** Tile the result (`ffmpeg -i edit.mp4 -vf "fps=4,scale=200:-2,tile=10x8" -frames:v 1 sheet.jpg`)
   and read the drop at 12 fps. The card, the hero shot and the grade are
   judged by eye.
5. **Gate** with `reel-check`, as with any reel in this skill.

## The styles, and where their numbers come from

Measured 2026-09-27 with `edit-dna`. On-beat is the share of cuts within
50 ms of a beat, next to the share a random cut would score.

| Style        | Reference                                  | Cuts a second | Median shot | Flash shots                      | On beat vs chance |
| ------------ | ------------------------------------------ | ------------- | ----------- | -------------------------------- | ----------------- |
| `electric`   | Drew Cronin, ELECTRIC 2025 director's reel | 1.84          | 0.33 s      | 38: 31 footage, 6 white, 1 black | 34% vs 22%        |
| `bw-montage` | BlackShell, reel DSazJqtEkOj               | 1.57          | 0.27 s      | 2                                | 30% vs 23%        |
| `long-take`  | BlackShell, reel DRimmkSjLDS               | 0.14          | 7.93 s      | 0                                | 25% vs 13%        |

## What the measuring taught

- **Beat lock only means something against chance.** At 144 BPM a cut placed
  at random lands within 104 ms of a beat half the time, so a median of 102 ms
  first read as locked and was not. Six of Drew's pieces cut on the beat 1.5
  to 3.2 times as often as chance would, and one no more often than chance.
  The editing teardowns in the research say the same: put the action on the
  beat, and do not put every cut on the downbeat.
- **A flash is mostly a single frame of other footage**, not a white frame:
  106 of 135 flash shots across nine Drew pieces, against 26 white and 3 black.
- **Motion direction is rarely carried across a cut**: 12 to 46% of cuts
  between two moving shots, in every reference with eight or more of them.
  `edit-cut` does not try to match direction, because these editors do not.
- **The title card fills the frame.** Each line is stretched tall, capped at
  2.4 times taller than wide so 9:16 does not distort, and it is shown twice
  around a black beat so a 15-character title gets the 0.75 s that 20
  characters a second calls for.
- **Black and white is a channel mix weighted to red**, not saturation at
  zero, with crushed blacks and grain.
- **Tempo comes from the whole song.** The first 20 s of ELECTRIC's track, an
  ambient intro, read 112 BPM against 129 for the whole; a grid at the wrong
  tempo was off the beat within four bars. Beats are moved back to where their
  onset starts, about 50 ms earlier than the tracker puts them.

## What it does not do yet

- **Speed ramps.** The hero shot is a flat half speed. Ramping over 4 to 6
  frames and cutting before peak speed is the stated technique; not built.
- **Action on the beat.** Cuts land on the grid; the action lands wherever the
  footage has it. Choosing in points so a motion peak hits the beat is the next
  step.
- **Sound design.** No risers, hits or whooshes under the cuts; the song is the
  only track.
- **Overlays.** Film burns and light leaks go on in screen blend
  (`blend=all_mode=screen`); not built.
- **Instagram's in-app songs.** A song from Instagram's library cannot be
  attached from a file. Cut to the same song on desktop, start on a hard cut on
  beat 1, and slide the song's start in the app's picker by hand. Instagram's
  library is licensed for personal, non-commercial use; a brand post needs
  Meta's Sound Collection or a licence that covers client work.

## Never

- **Never publish a cut made from footage the user did not shoot or
  generate.** The references are for measuring; they live in the context
  repo, not in this one.
- **Never add a style without the reel it was measured from.**

The research behind this, with every source, is
`~/dev/<name>-context/research/edits/PRACTITIONERS.md`, and the measurements
are in `research/edits/dna/` beside it.
