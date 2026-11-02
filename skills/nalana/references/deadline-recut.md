# A deadline video: recut the render you have

From 2026-11-01. Colin's IYA video was due that night. Caleb called his 3:51 v1
"the slop version", and Colin's own handoff planned a full v2 rebuild at about
2 minutes of render per second of video on an M1 Air (5 hours for 2:30).
Caleb's ask: "move them around and make the story more succinct".

- When a build keys every event to a word cue, the timed script is the edit
  list. Cut the existing MP4 and the voice-only wav at the same timestamps,
  and render only the shots no existing frame covers.
- A baked final mix has music under the voice, so cut the voice-only track and
  lay one fresh music bed under the whole recut.
- A repo handed over from another Mac carries its owner's absolute paths
  (`/Users/<them>/...` in ROOT). Make them resolve from `__file__` before the
  first render.
- A handoff prompt that has Claude write the person's voiceover is the
  ghostwriting their kit bans. New lines come from them on the mic.

## Same night, after the first board

- A .blend saved on someone else's Mac renders every image texture pink: the
  paths point at their folders. Relink by basename against the repo's assets
  and run `make_paths_relative` before the first render (the-machine
  `build/fix_paths.py`). Scripts run through `exec(compile(...))` get no
  `__file__`, so pass it in the globals dict or the repo-relative ROOT breaks.
- A planning doc for two people on a call is the video itself, one row per
  moment: SAY, SEE, FROM (v1 timestamp or NEW shot). A four-part board w
  DECIDE columns got "how tf are Tyler and I supposed to use this???", and a
  plan that cut the childhood and Miso building got "we hv to include the
  building stuff from a young age... that ws tuff". Cut weak lines, never the
  origin story.
- Count a voiceover's words with `wc -w` before stating a runtime, and use
  the speaker's own measured pace (Colin's v1: 735 words over about 222s,
  3.3 words a second). A script called "about 450 words, 2:35" was 633 words
  and 3:10 when counted, after Caleb had already read the wrong number.

## Handing it off the same night

- Fold every numbered answer into the script before showing it. Caleb answered
  30 questions in one message, the next draft dropped the $100K cap, the chicken
  and egg line and the culture team, and he wrote "READ EVERY LINE IN THIS
  CHAT". Tick each answer against the draft before sending it back.
- Script lines go through slop-check like any copy. Two that got cut: "wasn't a
  job title, it was" (binary reveal) and "its memory, its context, its
  security" (a rhythm triplet).
- `mac messages send` exiting clean is not delivery. Two texts to Colin showed
  as sent while the thread showed "unsupported content", and Caleb said
  "messages aren't sending". For a handoff due tonight, build the one-file
  version from the start: one .md w every link and who does what at the top,
  then each doc in full, inside a Downloads folder w the repo zip and assets,
  ready to AirDrop.

## Helping someone else's deadline from the outside (2026-11-01, 9pm)

- Ship the drop-in first, research second. Caleb asked for something to stop
  Colin's Nalana shots reading as slop. Ten minutes of grepping fridge,
  Parker and TTS notes went by before any file existed, and he wrote "WHAT
  IS TAKING SO LONG", then "Don't waste time tho". The fix that landed was
  one script (the-machine `build/unslop.py`: bevel + weighted normals,
  roughness noise, micro bump, AgX) plus a one-page rules file, pushed and
  texted. Write that first, then mine old notes only to tune it.
- A test frame from a saved .blend may not move with the frame number when
  the animation is applied by script at render time. Aim a temporary camera
  at a named object (`Miso`, `Robot`) for the before/after instead.
- Never nudge the person on the clock. Suggesting an 11pm cutoff text drew
  "he's gonna finish when he finishes we don't hv to tell him bruh". Hand
  over tools and settings; the schedule is theirs.
- Running a repo's `fix_paths.py` on a cloned copy rewrites the tracked
  .blend to this Mac's paths. Never commit it; discard it before leaving.
- Files someone texts over (VO, music, screenshots) land in
  `~/Library/Messages/Attachments/` and `mac messages history --json` carries
  no attachment info. Find them with `find ... -type f -mmin -60`, check audio
  with `afinfo` (Colin's VO was a 190.6s m4a, matching the 3:10 script), and
  copy them into the project folder under a plain name. "VO + music incoming"
  delivered one audio file; say which one is missing instead of assuming.

## The 11pm rebuild: 4 parallel builders, then Caleb's notes (2026-11-01)

What worked: 4 background builders, one per shot group, each with its own frame
range (20000/30000/40000/50000) and out/ folder, a hard cutoff 50 min before
the deadline, and an auto-assemble (the-machine `build/edit_v2.py`) that drops
v1 footage into any missing shot, never a black frame. What Caleb still caught:

- "the audio does not at all line up with the video". The new shots were timed
  off whisper on Colin's VO, but v1 clips were picked off a 5s contact sheet.
  Pick v1 clips off whisper run on v1's OWN audio, then map line to line.
- "so silos entire mission repeated twice". Whisper silently drops a repeated
  take. A gap of more than 1s between words with no silence in an RMS energy
  trace is a hidden retake. Cut the first take at the energy dip, then
  re-transcribe the cut. The first try clipped "mission" into "issue".
- Builders invent on-screen numbers: a $14,200 earnings counter and a waitlist
  that counted to 635, both made up. Brief every builder: no number or text on
  screen that isn't in the script, and read every rendered frame for text.
- Reused v1 footage carried an Amber logo (firm names were locked out) and a
  selfie with Caleb in it ("DONT HV CALEB"). Scan every reused second for
  names, logos and faces before it ships.
- "the screw goes into the ground". Check hero-prop contact with the surface
  in a close frame. Raise by the head radius so nothing intersects.
- "u used the old slop silo WE LITERALLY MADE A BUNCH OF NEW ONES". Put the
  newest planned assets in (the Silo screens folder and its placement doc),
  never old footage of the same app.
- "slop 3d overlaps": a rising camera exposed where the set ends and houses
  intersected. Cut any shot where geometry visibly interpenetrates.
- "IT DOESNT HV TO BE 4k" and "11:30 is way too late". Finals at 720p and 8
  samples. Set the builder cutoff by the person's deadline, not the render
  estimate.
