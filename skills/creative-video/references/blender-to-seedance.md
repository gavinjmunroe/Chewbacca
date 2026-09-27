# Blender into Seedance 2.5, and getting the most out of Higgsfield

Researched 2026-09-27. Sources and what each one covered are in the brain at
`research/higgsfield/SOURCES.md`. Prices were measured with
`higgsfield generate cost` on his Plus plan the same day. Everything marked
UNTESTED has not yet been run through a generation here.

## Why Blender belongs in the loop at all

Text cannot hold a camera. Every generation reinvents the path, the timing,
where each person stands and which side of the frame they are on, so a shot
that depends on any of those turns into a slot machine. A grey Blender
blockout answers exactly those questions, costs nothing to render, and
Seedance 2.5 reads it as a video reference.

**Use a blockout when** the shot needs a particular camera move, screen
geography that must survive a cut (who is frame-left), a scale relationship,
an exact path, or timing that has to land on a beat.
**Skip it when** the shot is a locked close-up, a performance, or anything
where the model's own choice of framing is fine. Most eye close-ups gain
nothing from a blockout.

Erika Taranto's report of the plugin workflow: with blocking, "the shot arrives
on the first or second generation". The 5,000-credit scene that never landed
without it is Higgsfield's claim, repeated in her post, not her measurement.

## The pipeline, headless

1. **Spec the shot** as JSON: proxies, their tints and roles, camera keys with
   lens, and cuts. Template: `blender/blockout/standoff.json`.
2. **Render the reference** without opening Blender:
   `blender -b --factory-startup -P blender/blockout_ref.py -- --spec shot.json --out DIR`.
   About 13 s for 5 s of 1920x822 on the M4 Pro. Look at a keyframe sheet
   first (`--frames 0,60,119 --scale 0.5`).
3. **Make the start frame.** Restyle `DIR/first.png` into the real look with an
   image model, holding composition: "Use the provided image as the
   composition and pose reference. Keep composition a 100% exact match."
   (Flick's pattern). Nano Banana 2 (`nano_banana_flash`, 1.5 credits) or
   Seedream 5.0 Pro (`seedream_v5_pro`, 2.5), so iterate here, not in video.
   `nano_banana_2` is not Nano Banana 2: it runs Pro and bills 2.
4. **Generate** with `seedance_2_5 --mode omni_reference`: the blockout as
   `--video-references`, character and location sheets as `--image-references`,
   the restyled frame as `--start-image`, and `--duration` equal to the
   blockout's length. Paste `DIR/roles.txt` at the top of the prompt.
5. **Draft at 480p** (15 credits for 5 s) until camera and blocking hold, then
   one 1080p pass (60 credits for 5 s). UNTESTED whether a 480p draft predicts
   the 1080p take; it has no seed control, so it tests the prompt, not the take.

## Rules for the blockout, and where each one came from

- **Say what the reference is for, and what it is not.** JSFILMZ attached a
  blockout without saying "camera only" and got low-poly asteroid facets in
  the final. ByteDance's coarse-blockout template (via O-Side Media's
  `MODE-PLAYBOOKS.md`) opens: "@Video 1 is a coarse blockout reference. It
  provides only <paths, blocking, camera...>. Do not use its blockout
  appearance, materials, or scene." `roles.txt` writes this for you.
  (The JSFILMZ runs cited here and under 3D assets have no recorded source;
  see the gaps in the brain's `research/higgsfield/SOURCES.md`.)
- **Map every proxy to its subject in words.** "The blue figure in @Video 1
  corresponds to the cowboy in the sky-blue bandana." That is why proxies get
  one tint each and nothing else.
- **Coarse or fine, decided first.** Coarse is grey shapes for paths, camera
  and cuts, with the look supplied by image references. Fine is a complete
  model to be re-rendered in new materials. The prompt differs for each.
- **No limbs in a coarse blockout** unless the whole action is animated. A
  partial limb sequence renders stiff (ByteDance, same source).
- **Render, never playblast with overlays.** Axes, path lines, rigs and camera
  frustums render as scene content. `blockout_ref.py` uses a Workbench render
  for this reason.
- **Duration equals the reference, 4 s minimum.** Longer and "the AI starts
  guessing" (Higgsfield's AI-vs-VFX build). Pad a short clip by freezing its
  last frame.
- **A blockout used for part of a clip says which part**, or it becomes the
  reference for the whole clip.
- **Budget:** 10 video references and 10 audio references per job, 30
  images, 50 items. The platform enforces the image and item caps, and
  Higgsfield's own help page gives the 10 and 10 ([How to use
  Seedance](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance),
  read 2026-09-27). The 30 s total across all video references is Dreamina's
  figure and still unverified on Higgsfield.
- **A blockout costs nothing extra.** Seedance 2.5 quotes 35 credits for 5 s
  at 720p with or without a video reference (`higgsfield generate cost`,
  2026-09-27).
- **No model takes depth, pose or a camera path as its own input.** A depth,
  normal or line pass goes in the same video-reference slot as a grey
  blockout, and whether a pass carries more than a plain render is untested.
- **Keep a blockout character coarse.** Higgsfield's own team saw a detailed
  Blender character copied as geometry over the character sheet, and subtle
  acting never came through. The blockout carries camera and timing; the
  sheet or Element carries the person.
- **Pause the Blender camera while anyone talks.** Dialogue and a blockout
  camera path fight each other (Dan Kieft; Mickmumpitz saw the same with
  control passes).
- **Colour by material for a start-frame restyle.** On image-edit models a
  blockout coloured by material and shaded with ambient occlusion restyles
  better than a clay render (CGwisdom). Single-tint proxies stay right for
  motion references.
- **A real person goes in through Soul ID to Element**, Higgsfield's stated
  route, not a sheet generated from a description, which casts a lookalike.
  Whether a raw selfie reference passes ByteDance's face filter on
  Higgsfield is untested.
- **Seedance 2.5 takes a start frame and references together.** Wan 3.0 and
  MiniMax H3 on Higgsfield refuse that combination.

## The Higgsfield Blender add-on, and why it is not the default here

Higgsfield for Blender (released 2026-08-20, Blender 5.1+) is a floating bar
in the viewport: Scene Builder, 3D Model (Meshy 5), Character Animation,
Image, Video (Seedance 2.5), Camera, and Asset. It also exposes an MCP bridge
at `bridge.higgsfield.ai/mcp` so an assistant can edit the open scene. It runs
on the same credits and shows the price on the button. Meshy 5 is what the
launch listed; the CLI catalog on 2026-09-27 has Meshy 7, Tripo H3.1,
Hunyuan3D v3 and SAM 3D Body, and which one the add-on calls now is unchecked.

It needs Blender's window open, and he works on this Mac, so the headless
route above is the default. Reach for the add-on for the two things headless
cannot do:

- **Phone camera.** Move an iPhone by hand and the add-on records it as the
  camera move. No hands-on account of it was found; UNTESTED.
- **3D Jutsu** (Scene Builder 3D): a Blender 5.2 scene hosted by Higgsfield and
  edited by Python through MCP. It imports curated catalog assets only, not a
  GLB you generated (O-Side Media, from the MCP schema).

Digital Production's review (2026-09-23) is the counterweight: meshes may need
"substantial work before deformation, subdivision or pipeline ingest",
generated footage "can mainly be accepted, rejected or regenerated", and on
standard plans your inputs and outputs may be used to train models. Only
Enterprise excludes them. Do not put anything confidential through it.

For a 3D asset through the CLI, `multi_image_to_3d` takes one to four views.
Feed it four (front three-quarter, rear three-quarter, side, top, flat lit):
from one view the reconstructor invents the back (JSFILMZ's run).

## Assets before video

A shot is only as good as the still it was built from.

- **One model per asset class** (AI-vs-VFX build): faces and fixes on Nano
  Banana 2, creatures on Seedream 5.0, clothing on GPT Image 2, locations on
  Soul Cinema. GPT Image yellows the colour.
- **Soul Cinema is the cheap idea generator:** 0.12 credits a job, measured.
  Batch locations and pick by light. "Bad light is why video generations come
  out as slop."
- **Character sheets on plain grey**, close-up plus full body front and back.
  Then **erase the face from the full-body panel** so there is one face to
  lock onto; with several, the face drifts a little each scene and "by scene
  five, our hero is a stranger" (Adil, Higgsfield).
- **Locations at a three-quarter angle.** It gives the camera depth to move
  through and a higher keep rate than head-on.
- **A size-reference frame** for any extreme scale (a rider on a dragon), saved
  as its own asset and attached to every shot. "If scale is uncertain, render
  smaller."
- **Name every asset once** and use that name as the Element name and in the
  prompt, so references auto-match.
- **Realism is imperfection.** Bags under the eyes, a bad hairline, some mess on
  the jacket. Say "do not recast, do not beautify" when a reference carries
  identity. Leave tiny props off a character sheet; the model warps them.

## Writing the Seedance 2.5 prompt

- **Structure it like paperwork, not prose.** ByteDance's sections:
  `[Generation Goal]`, `[Reference Material Roles]`, `[Event Script]`,
  `[Maintain Consistency]` (Theoretically Media). Higgsfield's own guide uses
  labelled blocks: global style, scene, characters, location, first frame and
  blocking, shot by shot, optics, physics, lighting, audio.
- **Every reference gets a role and an exclusion.** "@Images 1 through 4 define
  four characters" is the canonical failure. One line per subject.
- **Stage long clips.** One primary change per stage and a stated end state.
  Timestamps budget time; they are not frame-accurate.
- **Brackets for sound:** `{dialogue}`, `(music)`, `<sound effect>`,
  `【subtitle】`. A music suppression never goes inside `()`, where it reads as
  a music cue.
- **Act it, do not label it.** Two to four observable cues per emotion: "loses
  the smile, tightens the fingers, looks back slowly and reluctantly". For an
  accent, name the speaker, region, pace, energy, emotional state, then the
  exact line.
- **Motion is physics, not adjectives.** "Make it more natural" does nothing.
  Write what travels through the body, in what direction, at what rate.
- **Exclusions go at the end, short.** No negative-prompt field exists, but
  written exclusions work on Seedance and Kling (BytePlus's Seedance 2.5 guide,
  Kling's API docs). Only Nano Banana needs everything said positively.
- **"The camera does not move", never "locked camera", and never "slow".**
  Both lost in measured tests ([movie-gen](https://github.com/dawndrain/movie-gen)).
- **Turn off prompt enhancers.** They can make 2.5 worse (Theoretically Media).
- **Open mid-action.** A generated first second wants to be an establishing
  beat, which is dead air on a Reel.

## Iterating without burning credits

- **Run every job through `higgsfield-shot`.** It prices the job first, refuses
  one over 40 credits unless `--max` says otherwise, refuses to pay twice for
  a name, and prints one line instead of the job's JSON. `higgsfield-shot
  --ledger DIR --edit edit.json` gives the credits per finished second and
  names clips the cut never used. The Cowboy Cubans intro read 33 credits a
  finished second, with 7 of 13 clips unused.
- **Render at the size it plays.** A 21:9 site intro that plays at 1470 x 630
  is Seedance 2.5's 720p output exactly; 1080p costs 71% more for nothing seen.
- **A rerun at higher resolution is a new take.** No model here takes a seed,
  so a 480p draft proves the prompt, not the motion. Keep a good 480p take and
  upscale it, or rerun at 720p and expect different motion.
- **Stop at the first repeated defect.** The same flaw in every batch means the
  prompt or the source is wrong; more batches buy nothing. Four is a ceiling,
  not a target.
- **Draw it when words fail.** Adil sketched where the cannonball lands: "one
  drawing tells the model what 10 sentences can't". A blockout is the 3D
  version of that drawing.
- **Take the best part of each batch** and cut them together.
- **Plan an empty-frame pause** (1 to 1.5 s of location only) where two
  generations must join. It is a free cut point and a tension beat.

## Real footage plus AI (the format that reads as real)

The AI-vs-VFX build and Adil's five techniques. Film a plate on a phone with
room for the effect, then:

- Run it as `omni_reference` with the clip as `@Video 1`, declared master for
  "camera, framing, focus, motion, expression timing, background, lighting,
  grain and duration". Duration equals the clip, clip at least 4 s.
- **Lock what to keep first** (audio, movement, face, camera), then say what to
  add and when.
- Add an integration clause: grain, motion blur, focus falloff and colour
  "match @video1 so the replaced man is indistinguishable from originally
  shot footage".
- v2v cannot invent an action the plate has no anchor for. The dragon-jump
  failed four batches of four. Fall back to image-to-video from a frame of the
  plate and cut on an empty-frame pause.
- **Impossible camera moves:** two real clips (the radio, then the driver seen
  from the hood) become one continuous move when both go in with a start, a
  direction and an end described.

Adil's cost: 36 credits for 5 s, two tries for a keeper, about $4 to $6.

## Post, from the realism video (Zo8KaTs0l6k)

Trim any slow motion the model added. Push in from 100 to about 120 percent
across a shot to steer the eye. Add a little noise, which does the most, and a
slight edge blur. Letterbox 10 to 15 percent only on a 16:9 master; a Reel is
framed 9:16 from the start.

## Credits, measured 2026-09-27 on Plus

| Job                                      | Credits  |
| ---------------------------------------- | -------- |
| Seedance 2.5, 5 s at 480p                | 15       |
| Seedance 2.5, 5 s at 720p                | 35       |
| Seedance 2.5, 5 s at 1080p               | 60       |
| Seedance 2.5, 30 s at 1080p              | 360      |
| Seedance 2.5 omni with a video reference | same     |
| Cinema Studio 4.0, 5 s at 720p or 1080p  | 35 or 60 |
| Seedance 2.0, 5 s at 1080p               | 45       |
| Kling 3.0, 5 s                           | 10       |
| Kling 3.0 Turbo, 5 s                     | 7.5      |
| Soul Cinema still                        | 0.12     |
| Nano Banana 2 still (`nano_banana_flash`) | 1.5      |
| Seedream 5.0 Pro still                   | 2.5      |
| Seed Audio                               | 0.1      |

Cinema Studio 4.0 runs Seedance 2.5 with camera body, lens, aperture, era,
genre, pacing, light and palette controls at the same price
(`higgsfield model get cinematic_studio_video_4_0`). UNTESTED whether those
controls help or fight a blockout.

The Plus plan's 1,200 monthly credits buy about 100 s of 1080p Seedance 2.5.
They do not roll over.
