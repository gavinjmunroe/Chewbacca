---
name: creative-video
description: Make a short vertical video for Instagram Reels, YouTube Shorts or TikTok, or a YouTube creative, from a brief written against the craft, with the pixels drawn in code, rendered headless in Blender, or generated through Higgsfield. Use when asked to make a reel, a short, a TikTok, an Instagram video, a YouTube video, a social clip, an ad creative, a 3D animation, a Blender render, a Higgsfield or Seedance video, or content for a page. Also use when a video already made is getting no views, feels boring, or got cut off by the app's buttons. Not for a product demo of an app, which is the demo skill.
---

# Make a short vertical video that follows the craft

## The failure this exists to fix

Asked to master Reels with Higgsfield or Blender, the obvious move is to learn
the tools. The tools are the easy half. What makes a Short work is written down
by people who make them for a living, and it is almost all decided before a
frame renders: a first frame that works muted, hook and foreshadow in three
seconds, a mechanism pulling to the end, a cut right after the payoff. Read
[crafts/short-form-video.md](../../crafts/short-form-video.md) before anything
else. Every rule below points back to it.

## The order

1. **Write the brief before choosing a tool.** Platform, length, the hook line
   at a fifth-grade reading level, the foreshadow line, the last line, the
   mechanism the viewer watches progress, and the twist. Draw the first frame
   in words: what is on screen, where the text sits. If the hook would not work
   as a long-form title and thumbnail, rewrite it now, while it is cheap.
2. **Pick the route** from [references/routes.md](references/routes.md):
   code-drawn, Blender headless, Higgsfield, or Blender blocking into Seedance.
   Pick by what done means for the picture, not by which tool was named.
   For Higgsfield, read his live log first:
   `~/dev/gavin-context/research/higgsfield/LEARNING.md`. For a shot whose
   camera or blocking must hold, follow
   [references/blender-to-seedance.md](references/blender-to-seedance.md).
3. **Stage one, keyframe sheet.** Render five to seven stills across the
   timeline at half size, tile them, and look. The first frame is judged
   hardest.
4. **Stage two, motion sample.** Render the hardest two to four seconds and
   read 12 to 24 adjacent frames as one strip: pops, jumps, easing.
5. **Full render**, then `reel-assemble edit.json` for captions, voice, bed and
   loudness. Voice lines come from `hud-speak --say "..." --out line.wav`.
6. **Gate.** `reel-check video.mp4 --sheet sheet.png` must exit 0. Then read
   the sheet and score the ten checks below. Under 8 of 10, fix and rerun; do
   not deliver it.
7. **Write the lesson down.** A new failure goes into the worked examples here
   or into the craft file, the same turn.

## The ten checks

1. The first frame carries the whole hook with the sound off.
2. Hook and foreshadow land within three seconds.
3. Every line reads at a fifth-grade level or under.
4. A mechanism shows progress toward the end.
5. The ending twists the expectation it set.
6. The cut comes within about a second of the payoff.
7. Captions match the voice word for word and sit outside the shaded zones.
8. The subject sits outside the shaded zones at the payoff.
9. Speech recognition on the final mix recovers the script
   (`whisper-cli -m ~/.bob/whisper/ggml-large-v3-turbo-q5_0.bin -f mix.wav`).
10. The disclosure decision is made and written next to the file.

## Never

- **Never post, schedule or upload.** Publishing goes out under his name; the
  deliverable is a file and a note of where it is.
- **Never generate a real person's face or voice without that person's
  consent**, and never a public figure's at all.
- **Never put a number on screen the render does not make true.** "1,000
  dominoes" is the field's count, checked in `timings.json`.
- **Never run a Higgsfield job without `higgsfield generate cost` first** and
  the number said out loud, and never buy a plan or credits on his behalf.
  Every new fact or mistake goes into the Higgsfield log the same turn.
- **Never repost footage he did not make**, and never export with another
  app's watermark. Instagram stops recommending both.
- **Never open Blender's window.** Headless only; he works on this Mac.

## Worked example: the domino reveal, 2026-09-27

`blender/domino_reveal.py`, 1,000 dominoes whose falling wave reveals a hidden
picture (`--mask any.png`, default a heart), and `blender/domino_clicks.py`,
one synthesized click per impact time. 9.6 s, 1080x1920, file at
`~/Movies/chewbacca-creatives/2026-09-27-domino-reveal.mp4`. Scored 8 of 10:
hook and foreshadow took 3.6 s, and the heart is the expected picture, with no
twist.

What broke on the way, so it does not break again:

- **Keyframe sheets one to three opened on a black wall.** Below about 61
  degrees every row hides the gap behind it (tan e > height / pitch). For any
  repeated array, work out the angle where the gaps show before placing the
  camera.
- **The picture showed before the fall.** A domino exposes the face on the
  side it falls away from. Colour the far face and look from the near side.
- **The white faces vanished into a white floor.** The floor went a step
  darker than the faces.
- **The hook card read "My AI set up" alone.** Split captions are for
  subtitles, not the hook: the first card carries the whole promise.
- **The end push-in drifted the heart into the like-button rail**, and the
  last two seconds sat after the payoff. Cutting at 9.6 s fixed both.
- **The caption said "and hid", the voice said "and it hid".** Check 7.
