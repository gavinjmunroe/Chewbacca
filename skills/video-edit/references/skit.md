# Text-overlay skits and memes

A skit is a short silent-acting Reel where one line of on-screen text carries the
joke, the footage is the evidence, and a trending sound carries the energy. Nobody
talks to the camera. It is a different craft from the talking-head edit: the
dialogue, coverage, dwell and emphasis-caption rules do not apply. What matters is
recognition ("that's literally me"), a payoff the viewer gets in under a second,
and an ending that loops.

This guide covers the skit family of the [style library](styles.md). Its pieces
(boxed hook caption, meme cut, effects, borrowed camera) can be fused into other
styles there.

## Why they spread

- **In-group recognition.** The caption names a private, specific pain of one
  audience (founders who never market, vibe-coded code nobody understands, the
  startup mood swing). Specific beats general: "3 AM", "another feature",
  "how our code works". Viewers share it to tag the person it describes, and
  comments fill with confessions, which is why these get many saves and sends
  relative to their length.
- **Self-deprecation, not advice.** The narrator is the butt of the joke. The
  post caption can add a second, lightly provocative line ("Stop shipping a dark
  mode please") that invites replies.
- **Aspirational lo-fi setting.** Real rooms (a hacker house, a coworking loft,
  a group of friends around monitors) read as authentic and as a lifestyle at
  once. Phone footage, natural light, no grade.
- **Instant read, then loop.** 6-16 seconds. The text is on screen from frame one,
  so the joke lands before the viewer decides to scroll; the video ends on the
  payoff and restarts, so a second watch is nearly free.

## Patterns

| Pattern | Structure | Edit decisions |
| --- | --- | --- |
| Caption over one shot | A "Me at…"/"pov:" line over one held shot that shows the claim (the laptop open, the person typing, life going on behind them) | No cuts. The picture must prove the caption at a glance: screen visible, setting legible. Background action is a bonus |
| Setup → meme cut | Real footage performs the setup; the subject mirrors a famous meme gesture to camera; hard cut to the meme clip doing the same gesture | Leave the setup at the peak of the mirrored gesture, before the hand drops, on the sound's drop or beat. Setup about half the runtime. The caption stays on screen through the transition and the meme |
| Time-stamp contrast | Two labeled lines that flip the claim ("9AM: I can't wait till bedtime" / "10PM: I've always wanted to write my own operating system") over one shot of the second state, then a meme payoff | One take is enough; the second line is the joke and the footage shows it (locked in, typing). Both lines on screen from frame one as separate boxes so they read as two moments. The meme mirrors the action, not just a gesture (typing → a famous typing scene) |
| Numbered list | A persistent header ("5 phases of every startup") with one numbered line per shot; each shot a new location, lighting and mood | One 2.5-3.5 s static shot per item. Escalate, then break the pattern on the last item (drop the number, flip the mood) as the punchline |

Other common variants follow the same grammar: "nobody: / me:", a reaction cut-in,
before/after, or a dialogue-free "POV" with the camera as the other person.

## Text

Start from the platform's text-tool vocabulary (condensed grotesk, white, upper
third) and make it read instantly on a phone. Plain white outline text on a busy
background reads as unfinished and hard to read; add one deliberate element.

- Default treatment: black text on white rounded line boxes that merge into one
  shape (the in-app "background" style). That alone fixes readability. A colored
  highlight on the key phrase or a closing emoji is optional extra spice; add it
  when asked, with an accent that contrasts with the scene (blue on warm brick
  and skin, not red on red).
- Size: about 3.5% of frame height per line, lines no wider than about 80% of the
  frame. Centered, block center around 20-28% of height, above the subject's
  head. A list format adds the item line in the lower third (around 74%).
- On screen from the first frame. Change it only on a picture event: a list item
  swaps on its cut; an emoji or highlight can land on the meme cut. Keep the text
  in place when something is added (`--hang-emoji` with a `--hide-emoji` layer
  before the cut). No word-by-word subtitles or animated type.
- Wording: a recreation keeps the reference's words unless the user asks for new
  copy. New copy keeps the structure and gesture, aims at the user's own life
  with a concrete detail, and is compared as three or four options rendered on
  the actual frame. Break lines where the comic pause falls.

Render with `scripts/text_overlay.py` (`--style box`; `*key phrase*` and
`--accent` for a highlight) or Resolve Text+, and test the treatment on the hardest frame (busiest
background, the meme side of a cut) before building. Keep the copy in the build
script or edit plan so it can be changed.

## Sound

The sound is half the joke. Find out what the reference uses before choosing:
`uv run --with shazamio` against its extracted audio names commercial songs.
Edited meme sounds (a song cut into a clip's own audio) usually return nothing
or only the second half; then the reference's own track is the sound.

- Match the recreation's cut times and duration to the reference. Then the
  reference's sound lines up as-is, baked in or added in the app ("Use audio" on
  the reference, pick the export, original volume 0). In-app keeps the credit and
  the link to the trending sound; a baked-in copy is self-contained but may be
  muted or limited if the platform flags the music. Deliver both when asked for
  a finished post: a music-free version and a ready mix.
- Measure the reference's loudness envelope (RMS per 0.1 s). A fade into
  silence before a meme cut is the comic pause; keep it silent. Boosted room tone
  or typing must fade out when the on-screen action stops, or it fills the pause
  with hiss.
- Match the reference's loudness (about -14 LUFS) and measure the export. Limit
  with `alimiter` set to `level=0:latency=1` (technical.md); its auto-level default
  raises the whole mix to the ceiling.
- When the meme clip carries its own dialogue, the music plays under the setup
  and stops on the cut. Make the setup a whole number of bars so the cut lands
  on a downbeat, and level each half from its own measured loudness; a full-scale
  track next to raw film dialogue makes the punchline sound like a volume drop.
- When no sound is demonstrably trending for the format, say so and pick by
  meaning (for example the score from the meme's own film) rather than
  presenting a guess as a trend.
- Effects are rare in the references, but add them when the user asks. Keep each
  one tied to a picture beat:
  - Explosion: a fireball scaled until it fills the frame hides the cut. Time it so
    it erupts ~0.6 s before the cut and covers the frame on the cut frame, play it
    fast (2x) so it clears before the meme's first line, and shake the frame with a
    decaying shake.
  - Vine boom: a snap punch-in (~1.25x over two frames) on a reaction shot.
  - Key fire and other bright effects with `colorkey` (RGB distance).
    `chromakey` compares chroma only, so it leaves a white-hot core
    see-through, and `despill` turns it grey.
  - The effect's own sound fades out before the next line of dialogue.
- Otherwise effects are rare in this format. One that marks the cut (a short bass hit on
  the cut frame, slightly ahead of the sound's attack) earns its place; whooshes
  or meme sounds over a sound that already carries the beat compete with it.

## Camera, pace and effects

Measure the reference with `scripts/ref_motion.py` before adding any of this. The
three viral references measured on 2026-10-07 used no speed ramps, digital zoom
punches, shakes, flashes, glitches or transitions other than one dip to black.
Their energy comes from the people and a handheld phone:

- Real speed. Every shot plays at 1x; repeated frames came only from 30 fps sources
  in a 60 fps file or a dim shot's variable frame rate. Speed up only dead time the
  reference doesn't have, and keep the cut times when its sound is reused.
- Handheld, not locked off. The phone drifts slightly, pushes in about 6% over
  ~1.2 s as the subjects turn to the lens, and one list item is a walking pan. A
  tripod shot looks dead next to that. When the recreation matches the
  reference's length, lift its camera path frame for frame with
  `scripts/borrow_camera.py` (anchor on the evidence, such as the laptop screen).
  Otherwise add a slow 3-4 px drift and an eased 8-10% push toward the face on
  the turn-to-lens beat (technical.md, "Camera moves on still footage"). That is
  the one camera move; no punch-in on every beat.
- Setup → meme transition: a dip through black, not a hard cut. Fade out over
  ~0.25 s, about one black frame with the caption still showing, fade in over
  ~0.25 s, timed to the sound's pause and its drop.
- The meme fills the frame. Crop the clip (or scale the keyed subject) until the
  face sits just under the caption and the body runs off the bottom edge. Keep
  the source's own slow push and lower third; it looks like the real broadcast.
  A small cutout floating over a backdrop reads as a sticker.

## Footage

- Pick the take where the performance is committed: a deadpan face at the meme
  moment, the gesture fully extended, no laughing or glancing at the phone.
  Trim before any break of character.
- The performance holds for the whole window. A glance at the lens, a smile or
  a look away breaks a "locked in" or deadpan beat. Check gaze on an eye-region
  crop sheet at 2 fps and choose a window with none.
- Skit footage usually has no dialogue, so skip transcription; speech recognizers
  stall on room tone, typing and murmur. Choose takes from contact
  sheets at 4-5 fps around each gesture.
- Handheld is best; a tripod shot needs the drift and push above. Keep the
  camera's natural color; HDR still needs the technical SDR conversion.
- Meme clips: prefer a clean green-screen or original-broadcast copy; key it over
  a blurred frame from the original event rather than a flat color, framed as above
  with the gesture still in frame. Record its source in the manifest.
- Sourcing the meme scene: search for the studio's or official clip channel's
  upload (yt-dlp `ytsearch`), at least 720p, without burned-in captions. Find the
  lines by transcription, because the score usually runs under the scene and
  silencedetect finds nothing. Measure the letterbox and any channel watermark,
  and crop inside both. Use only shots whose faces sit below the caption block;
  an off-camera repeat of the line can replace an on-camera shot that the caption
  would cover. End the payoff on a line (a "Yes.") before the next action begins,
  unless that action is the joke.
- When the user's footage cannot support a pattern (a five-location list shot in
  one room), say what is missing and give a shot list instead of faking variety
  with crops.

## Check

Watch the export as a viewer: the joke reads in under a second, the text never
covers the face or the gesture, the cut lands on the gesture's peak, a frame
strip at the reference's times matches its framing and transition, any push is
smooth (`ref_motion.py` on the export shows steady zoom per frame), the
duration matches the reference when its sound will be reused, and the final
frame loops cleanly into the first.
