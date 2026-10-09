---
name: animated-video
description: Make animated videos in code with Remotion (React/SVG): character animation, cartoon stories, motion graphics, kinetic typography, animated infographics, explainers and animated Reels, from a script or voiceover, in any aspect ratio. Use when asked to animate a script, make an animated video, or build a Remotion project. Not for math with equations (manim), editing camera footage (video-edit), writing the script (video-script), or generated clips and Blender renders (creative-video).
---

# Animated video

Turn a brief into a finished animated video in which every image is drawn in code. Treat it as
a film production: agree the story, lock the format, build an audio spine, stand up a walking
skeleton, make recurring assets once, animate shots, then review renders through frames and
measurements. A film is finished when each line of the script is shown on screen, the opening
earns attention, and the review checks pass. A render that merely plays is not finished.

**Design fresh for each brief.** Choose style, characters, palette, type, structure and pacing
from the brief, the audience and the user's references. The references below record process
lessons; any creative specifics in them are one project's illustrations, not defaults.

**Recommend with every question.** Each question you ask the user carries your recommended
answer and a one-line reason, so "yes" or "your call" is a complete reply.

## Scale the production to the piece

- **Short and unnarrated (under about 60s):** one agent. Agree the story (step 1), write the
  storyboard, build scene by scene checking stills, render, then polish once by stepping through
  the render second by second. Skip the rig freeze, parallel animators and judge panel unless a
  review shows a problem only they fix.
- **Longer or narrated:** run the full production below.

## 1. Direct the story with the user

Whenever you invent or shape the story, act as its director before anything is drawn. Ask
the open intake questions in one message, pitch three different concepts, develop the chosen
one into a timed beat sheet, and run the director's checks: a protagonist who wants something
and chooses, an obstacle, a middle that escalates, a turn, an ending that answers the opening.
Then stop for the user's approval, for short pieces too. [Story process](references/story.md).

Done when: the user has approved the logline and beat sheet, or supplied a finished story.

## 2. Lock the format before building anything

"Make an animation" covers different productions (a character story, motion graphics, an
infographic, a motion comic, AI clips). One session built five versions of the wrong format.

- When the request already names the format and style ("a hand-drawn stop-motion about X",
  "motion graphics for our launch"), confirm it in one line instead of asking.
- Otherwise name the candidate formats in one question, with a line on what each would look
  like for this brief and the one you recommend.
- Ask about the production route and its cost. Drawn in code is free and gives exact
  consistency. AI video costs per clip and drifts between shots. Users may rule a route out.
- If a real person appears, ask where reference footage or photos live, and pull frames with
  ffmpeg instead of searching personal folders.
- Ask for a reference image: a screenshot of the character, or a frame from an animation they
  like; first look for ones they already chose (animations saved into their recent projects).
  It specifies style better than adjectives. Design from it; don't copy another creator's work.
- Show one style frame (a rendered still, or a few seconds of motion) before any full build: the
  cheapest point to hear "not what I wanted". Then wait for a reply unless the user already
  approved this look from an image; an approved written plan does not approve a look. Only a
  single short piece may keep building after showing its first still.
- Read `~/.animated-video/profile.md` if it exists: the user's preferences and past projects.

Done when: the user has confirmed the format, the route, and a style frame (a single short piece:
the first still has been shown).

## 3. Build the audio spine

Every beat times off the narration, so the audio comes first. Without narration, the music or
sound bed sets the timing: choose or build it first and cue beats to it.

1. VO: prefer the user's own recording. If you use TTS, you can't audition it, so choose by
   metadata (age, gender, pace) and say it's a stand-in.
2. Run `templates/remotion-film/align.py` to get word timestamps and a per-frame loudness
   envelope. Fix transcription mis-splits and keep those fixes as a script, because a re-align
   must re-apply them.
3. Derive every cue from words with `cue("phrase")`. A new VO then re-times the whole film.
4. Write caption chunks by hand as sense units, checked against the transcript.
5. Source music and effects in this order: the user's files; samples on disk (the
   user's own effects folder or the video-edit profile's libraries); sound synthesized in code (Web Audio or Python),
   labelled as synthetic because you can't audition it. Samples usually sound better.

Done when: the transcript matches the script word for word and each line's opening words resolve,
or, without narration, the sound bed is chosen and the beats are cued to it.

## 4. Walking skeleton

Turn the approved beat sheet into `STORYBOARD.md`: the logline, the recurring motif, and a
scene table of timing, picture, on-screen text and the transition into the next scene. List
uncertain facts in `NOTES.md` and leave them out of the film.

Copy the style-neutral infrastructure in `templates/remotion-film/` (timing lib, camera, the
still, render, contact-sheet and align scripts). Wire up acts, placeholder scenes, captions and
audio, and render stills across the whole timeline before any real art exists.
[Pipeline reference and gotchas](references/remotion-pipeline.md).

Done when: every act renders a placeholder with the right caption and audio, end to end.

## 5. Recurring assets: design, review, freeze

Build what appears in more than one shot first: characters, props, sets, camera language, FX,
and a scale constant for anything recurring. Design them for this brief's style.

- Characters: one parametric rig per character, documented conventions, and a model sheet
  checked against the references before any shot uses it.
  [Rig lessons](references/character-rig.md).
- Graphics: an explicit type scale, a palette with meaning assigned to each accent, and a small
  component kit. [Graphics lessons](references/motion-graphics.md).
- Plan every scale the story needs (wide, medium, close-up). A design that holds up in a wide
  shot can fall apart at 4x.

Done when: a showcase composition shows every recurring asset, and animators can use them from
an API summary without reading the source.

## 6. Animate the shots

- Write the art bible (the look, the colour script, the cast, staging and safe zones) and per-act briefs naming
  the line, the picture and the action before animators start.
- In the full production, run one animator per act in parallel, each owning its own files; the
  shared rig, kit, lib and film shell stay read-only. Others can storyboard while the rig owner
  finishes, gated on a ready file. Sound effects stay on the director's one cue sheet: per-act
  quotas multiply into repeated clutter. Throttle rendering on a shared machine.
- Every shot changes meaningfully every 1.5-3s and lands its action on its word within a few
  frames.
- Grow each transition out of the content: a morph, one object becoming the next, a camera
  push through an element, or particles that reform. Carry colour and momentum across the cut.
  Generic crossfades turn a film into a slideshow.
- Draw every frame as a function of the frame number, with seeded randomness, so stills and
  renders match. [Craft techniques](references/motion-graphics.md#craft-techniques) covers the
  handmade look, motion and on-screen text in detail.
- Watch for the recurring breakages: limbs lost when a shot is cropped, ghosting from opacity
  fades on characters, recurring entities changing scale, and a blurred or unstable final frame.

Done when: each act's contact sheet tells its beat with the sound off, and the typecheck is clean.

## 7. Review by frames and measurements

Agents can't watch or hear video. Review by extracting frames (contact sheets, plus dense
frames around cuts) and by measuring audio with ffmpeg. Use independent judges with different
lenses, route issues to their owners by time range, fix in parallel, re-render, and repeat.
[Review loop](references/review-loop.md).

- After each render, spot-check every flagged moment yourself. Fixers introduce regressions.
- When the brief names a reference video, put each act's frame beside the reference's frame for
  the same beat before delivering. Check finish (detail, depth, lighting, real interfaces), not
  only breakage. A cut that looks sparser than its reference is not ready.
- Stop when a round gains less than about half a point, or when the top issue needs the user
  (their likeness, their voice, a format decision). Say so and ask.
- Keep the open issues in `ISSUES.md` (time range, owner, severity, status) and update it after
  each render; it outlives compaction.
- On long runs, send progress at each stage boundary (latest contact sheet and an ETA) in the
  same message as your next action. Keep working unless the next step needs the user.

## 8. Deliver

Render the final (the template normalizes loudness for social). Check the first frame (it's
the cover), the last second (clean, and it loops if intended), and the loudness. Report the
path, the open issues, and anything synthetic or invented (voice, names, messages). Commit each
version in the project's local git repo.

When the user asks for a reflection, follow [the reflection protocol](references/reflection.md).

## Related kit skills

- [manim](../manim/SKILL.md): choose it instead when the video is equations, graphs or a proof.
- [creative-video](../creative-video/SKILL.md): AI-generated clips (Higgsfield) and headless Blender; it also owns the short-form craft rules this skill assumes (hook in three seconds, first frame works muted).
- [video-script](../video-script/SKILL.md): write and test the script before the story step here.
- [video-edit](../video-edit/SKILL.md): captions, sound and publishing conventions for finished footage; its caption timing script is reusable.
- [demo](../demo/SKILL.md): a product demo is recorded, not animated.
## Credits

Adapted from cstack by Charles Zheng (MIT), https://github.com/goodnight000/cstack
