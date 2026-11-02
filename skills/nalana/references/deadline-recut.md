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
