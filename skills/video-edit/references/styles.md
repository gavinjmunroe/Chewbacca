# Style library

A style is a bundle of choices on a few independent layers. Choose the layers
that serve this video's goal and footage, not one style wholesale. The detailed
craft for each layer lives in its home guide; this file is the map for choosing
and combining them.

## Layers

| Layer | The question it answers | Examples |
| --- | --- | --- |
| Spine | What clock runs the edit? | Speech (cut by phrase), a sound's beats and cut times, on-screen action, narration |
| Structure | How do the beats pay off? | Story, setup → payoff, list, contrast, before/after, demo steps |
| Picture | What is on screen and how does the camera behave? | Face to camera, held skit shot, meme clip, screen capture, sourced evidence; locked off, handheld drift, push-in |
| Text | What words are on screen? | Subtitles from speech, one boxed skit caption from frame one, list header and item lines, a hook headline |
| Sound | What carries the energy? | Dialogue, a trending or reference sound, a music bed, the meme's own audio |
| Effects | What lands on a picture beat? | Dip to black, explosion wipe, vine-boom punch-in, shake, speed change |

## Library

Status says how much to trust the defaults. "Measured" styles have reference
reels or past projects behind them. "Described" styles are a starting sketch:
measure a reference (`scripts/ref_motion.py`, technical.md) before relying on them,
then update the row.

| Style | Fits when | Spine | Signature moves | Guide · status |
| --- | --- | --- | --- | --- |
| Talking head | A person explains or tells a story to camera | Speech | Complete camera-facing sentences, sourced visuals of what is named, subtitles | [style.md](style.md) and SKILL steps 1-5 · measured |
| Caption over one shot | A relatable claim the footage can prove at a glance | One held shot plus the sound | "Me at…"/"pov:" boxed caption from frame one, evidence visible, handheld drift | [skit.md](skit.md) · measured |
| Setup → meme cut | The punchline is a famous reaction or gesture | The sound's drop or beat | Mirrored gesture or action, cut on the beat (dip to black or a wipe), the meme fills the frame | [skit.md](skit.md) · measured |
| Time-stamp contrast | One person, two states ("9AM… / 10PM…") | Caption pair, then the payoff | Two labeled boxes, a shot of the second state, a meme payoff that mirrors the action | [skit.md](skit.md) · measured once |
| Numbered list | Phases, types, or steps of a shared experience | A cut per item on the sound | Header plus a numbered line per shot, new location per item, the last item breaks the pattern | [skit.md](skit.md) · measured |
| Screen demo | The product or result is on a screen | On-screen action, with or without narration | Real capture of the user's product, cursor and result readable on a phone, cut dead time, speed labels on sped-up demos | SKILL step 3 · described |
| Voiceover explainer | The idea is better shown than said to camera | Narration | Visuals change with each claim, no face needed, subtitles | [style.md](style.md) visuals and captions · described |
| Commentary over a source | Reacting to a post, article, chart, or clip | Speech | The source fills the frame with the speaker cut out over it, the referenced line highlighted from the source itself | [style.md](style.md) · described |
| Montage / day in the life | A routine, an event, or a vibe | Music beats | Short shots cut on the beat, one line of context text, natural sound peeks | none yet · described |

## Fuse

1. Write the goal in one line: who it is for, what they should feel or get in the
   first second, and where it is posted.
2. List the material: speech, silent performance, screen capture, sourced
   clips, a reference reel to match.
3. Choose one spine for each section. A video can hand the spine over at a
   marked boundary (a silent skit hook hands off to speech at 0:03), but two clocks
   never run at once.
4. Borrow layers from other styles only where they fix a real weakness of the
   spine for this video (a slow hook, a flat shot, no payoff, an uncovered claim).
   Variety for its own sake doesn't count.
5. Resolve conflicts in this order: the brief and profile, then the section's spine, then
   the borrowed element's home rules inside its own interval. For example, a meme
   cut-in inside a talking head follows skit.md's crop and sound rules for its
   1-2 s, and counts as a visual toward style.md's coverage rule.
6. Write the result in the brief as a style map, one line per section:

   ```
   0.0-5.8   time-stamp contrast (caption spine) + handheld push-in
   5.2-6.5   effect: explosion wipe hides the cut
   5.8-10.0  meme payoff (The Social Network) + vine-boom punch-in at 8.8
   ```

7. Check each section with its home guide's checks, then check the seams: text
   treatment, loudness, color, and camera behavior change deliberately at each
   handover, never by accident.

Keep two text systems apart. When a hook caption and subtitles share a video,
give them different positions and treatments, and never stack them at the same height.
Each effect lands on one picture beat.

## Examples

- **9AM / 10PM (2026-10-07, built):** time-stamp contrast, setup → meme cut,
  effects (explosion wipe, vine-boom punch-in), and a talking-head-style
  push-in on a locked-off shot.
- **3 AM feature (2026-10-07, built):** caption over one shot, with the reference reel's
  handheld camera path borrowed through `scripts/borrow_camera.py`.
- **Talking head with a skit hook (untested):** 2-3 s of silent performance under one
  boxed caption, then speech takes over the spine and subtitles start with the
  first word.
- **Screen demo with a meme cut-in (untested):** the capture runs the spine, and a 1-2 s
  reaction clip lands when the surprising result appears.

## Add a style

When a project measures a reference whose structure isn't in the table, add a
row with the project path as evidence and mark it measured. Give a style its own
guide only when it needs more than a row and a few lines in an existing guide.
Personal taste (a creator's preferred caption look, length, effects) belongs in
`~/.video-edit/profile.md` or the files it links, not here.
