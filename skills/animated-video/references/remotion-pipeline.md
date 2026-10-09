# Remotion pipeline

## Template (`templates/remotion-film/`): style-neutral infrastructure
- `src/lib.ts`: `cue()`/`cueEnd()` (phrase to seconds), `f()` (seconds to frames), `prog()`
  (eased 0→1), `pop()` (spring), `voLevel(fr)` (VO loudness), `chunk()` (hand-authored caption
  lines checked against the transcript), and an `ACTS` table to fill in.
- `src/kit/camera.tsx`: keyframed pan, zoom and rotate, shake, handheld drift, and parallax layers.
- `align.py`: word timestamps (faster-whisper) and the per-frame VO envelope.
- `snap.sh <dir> <secs…>`: stills from a shared bundle, two at a time, plus a contact sheet.
- `render.sh <name>`: full MP4 with two-pass loudnorm (-14 LUFS, -1.5 dBTP, linear).
- `sheet.py`: contact sheets.
- Written per project: `src/index.ts`, `src/Root.tsx`, a film shell that switches acts and draws
  captions and audio, the scenes, and every visual asset.
- Setup: `npm i remotion @remotion/cli @remotion/google-fonts react react-dom typescript
  @types/react`, a tsconfig with `lib: ["ES2023","DOM"]`, a Python venv with `faster-whisper`,
  and `git init`.

## Before the VO exists
- To build ahead of a recording, generate `words.json` from the script at the speaker's measured
  pace (words per second of an earlier recording) and build every beat from `cue()` as usual.
  Label it a stand-in. After recording, align the real VO and re-render; a cue phrase the speaker
  changed throws by name. Unverified end to end: check that every cue resolves after alignment.

## Procedural drawing
- A `<canvas>` inside a Remotion component suits procedural art (grain, boil, particles). Redraw
  it from `useCurrentFrame()` and take randomness from Remotion's `random(seed)`, never
  `Math.random()`, so every render matches its stills.
- Other deterministic HTML-to-MP4 renderers exist, such as HyperFrames. This template targets
  Remotion; switch only if the user asks.

## Structural conventions that paid off
- Scene logic uses absolute frames (`fr`), with no nested `<Sequence>` offsets, so a cue means
  the same frame everywhere.
- Every time comes from `cue()`, so re-aligning a new VO re-times the film.
- Scenes export `Scene({fr})` plus a list of their SFX, and the film shell mixes them.
- Captions come from hand-authored sense-unit lines, verified against the transcript at load.
  Their look (font, stroke, highlight) is a per-project design choice.

## Platform facts (Instagram Reels 9:16, as of 2026-09; recheck)
- The top ~220px and bottom ~420px are covered by UI, and so is a right rail (x > 930 at
  y > 1100). Keep faces, key props and on-screen text inside the remaining area.
- Deliver around -14 LUFS integrated and under -1.5 dBTP.

## Audio mechanics
- Duck music by phrase (merge words less than 0.4s apart, ramp over about 0.2s). Per-word
  ducking pumps.
- Keep SFX off key spoken words. Place a hit 1-2 frames before the word it punctuates.
- Measure instead of guessing: `ffmpeg -af ebur128` for loudness and true peak; render a stem
  without the VO to get the VO-to-bed ratio in the 1-4 kHz band.

## Gotchas
- `rsync --exclude src` also strips `node_modules/*/src`. Copy projects without node_modules
  and reinstall.
- Parallel `remotion still` calls on the entry file race on the webpack cache. Bundle once,
  then render stills from the bundle.
- Many agents rendering on one machine starve each other, and a full render can be killed
  (exit 137). Throttle, and render final cuts when the machine is quiet.
- The last renderable frame is `TOTAL - 1`.
- To re-cut a finished composition from source-frame segments, offset with nested sequences
  (`<Sequence from={outStart} durationInFrames={len}><Sequence from={-sourceIn}>…`).
  `<Freeze frame={n}>` clamps n to the host composition's last frame, so it silently shows the
  wrong frame for any source frame past the output length.
- Full-frame SVG filters (turbulence grain) on every frame are slow.
- Whisper merges and splits words and hyphenations. Fix `words.json` with a kept script.
- TTS job JSON can hold a voice-preview URL as well as the output. Take the job's result URL.

## Checking without watching
- Stills: `./snap.sh out/check 0 1.5 3 …`, then Read the sheet.
- From a render: extract with `ffmpeg -vf fps=2,scale=360:-1` for the whole piece, or fps=10
  around cuts. Frame N at fps=2 is t=(N-1)/2.
