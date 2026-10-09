# Local media reference

Use the installed tools and existing project scripts before writing another helper.
For native Resolve assembly and final render, follow [Resolve](resolve.md);
FFmpeg cut/render recipes below support preprocessing, previews, or other briefs.
Examples below are recipes, not commands to run blindly: replace `IN`, `OUT`,
dimensions, paths, and range labels with the probed project values. Quote
paths, keep source files untouched, and overwrite only known derived outputs.

## Probe and transcribe

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,sample_aspect_ratio,pix_fmt,sample_rate,channel_layout:stream_tags=rotate:stream_side_data=rotation:format=duration -of json IN
ffmpeg -v error -i IN -vn -ac 1 -ar 16000 audio.wav
# English on Apple Silicon (replace SKILL_DIR with this skill's directory):
uv run "SKILL_DIR/scripts/transcribe.py" audio.wav --output-dir .
# Whisper exception: unsupported language or concrete failure after Phonon retries:
uvx --from mlx-whisper mlx_whisper audio.wav --model mlx-community/whisper-large-v3-turbo --word-timestamps True --condition-on-previous-text False --output-format json --output-dir . --verbose False
# Unsupported host for this Phonon helper (other macOS, Linux or Windows):
uvx whisper-ctranslate2 audio.wav --model large-v3-turbo --word_timestamps True --output_format json --output_dir . --verbose False
```

These write `segments[].words[].{word,start,end}` JSON, the input the caption
helper reads; `preflight.py` prints the default for this host. Phonon-2 runs
locally, batches inputs under one loaded model, and uses a speech detector plus
shorter re-decodes to repair suspected omissions. Unresolved gaps stop output;
review those windows with source audio and retry Phonon with useful context.
Use Phonon for routine final-audio QA and restart checks too. Invoke Whisper
only for unsupported input/host or a specific unresolved Phonon failure, and
record the reason. An independent QA transcript means a fresh decode of final
audio in a separate file; it does not require a second model. Preserve raw text separately
from caption spelling corrections. Existing outputs require `--force` with
Phonon; use another output directory for independent checks. Reuse model caches.
Probe rotation, color/HDR information when relevant, and displayed geometry;
encoded width/height alone may describe a rotated source incorrectly.

For silence candidates use `silencedetect=noise=-35dB:d=0.25` in an FFmpeg
audio filter and inspect its output. Adjust to the recording's noise floor.
Compare low-energy consonants with nearby waveform/frame evidence before
moving boundaries. The threshold is a search aid, not a rule to delete every pause.

ASR can suppress repeated words across adjacent takes, hallucinate over silence, miss weak onsets, absorb padding into
word timestamps, and misspell names. Keep the raw transcript and a separate
checked spelling map. Do not fix missing or incomplete spoken words by
changing captions. ASR recognition is not proof of an intact phoneme.

## Measure a reference reel

Public Instagram, TikTok and YouTube posts usually download without login. Keep
references in the project's `refs/` and do not pass browser cookies.

```bash
uvx yt-dlp -o "refs/%(id)s.%(ext)s" --write-info-json URL      # info.json has likes, comments, caption
ffmpeg -i REF -vf "select='gt(scene,0.25)',showinfo" -f null - 2>&1 | grep -o 'pts_time:[0-9.]*'   # hard cuts
ffmpeg -i REF -af silencedetect=noise=-40dB:d=0.3 -f null - 2>&1 | grep silence_   # audio dips before a drop
ffmpeg -i REF -vf "fps=2,scale=360:-1,tile=8x4" -frames:v 1 sheet.jpg   # tile n = n/2 seconds
```

Identify the music (unofficial Shazam client; needs network; try each half of an
edited meme sound separately):

```bash
ffmpeg -i REF -vn -ac 1 -ar 44100 ref.wav
uv run --with shazamio python -c "import asyncio,sys;from shazamio import Shazam;t=asyncio.run(Shazam().recognize(sys.argv[1])).get('track') or {};print(t.get('title'),'|',t.get('subtitle'))" ref.wav
```

Measure camera moves, speed changes and transitions before copying a style, so
the edit adds only what the reference does (`scripts/ref_motion.py REF`, run with
the `uv` line in its docstring). A dip to black shows as luma falling to near 0
over a few frames, and the shot table splits there.

Lower the scene threshold (0.05) when a known cut is missed. Measure text
position and size from one full-resolution frame. `drawtext` may be missing;
count tile positions instead of stamping timecodes.

## Camera moves on still footage

`zoompan` rounds its crop to whole pixels and jitters on slow moves. Use
`perspective` with `eval=frame` and cubic interpolation for subpixel push-ins and
drift. With zoom `Z(t)` toward point (ax, ay) on a WxH frame, the source corners are
`x0=ax*(1-1/Z)`, `y0=ay*(1-1/Z)`, `x1=x0+W/Z`, `y2=y0+H/Z`; time is `in/FPS`.
Quote each expression in the filtergraph (`x0='…'`) because they contain commas.
Ease with `u=clip((t-start)/dur,0,1)`, `u*u*(3-2*u)`. For handheld drift, add two
summed sines of 3-4 px at 0.3-0.8 Hz to x0 and y0, and start at zoom 1.02 so the
edges never show. To copy a reference reel's
handheld path instead, use `scripts/borrow_camera.py`.

## Shell gotchas in build scripts

- Caption copy with an apostrophe breaks `${TEXT:-I can't…}` in bash. Assign it
  first, `CAPTION="I can't…"; TEXT=${TEXT:-$CAPTION}`.
- In zsh, `"$k[out]"` is an array subscript. Write `"${k}[out]"` when a variable
  holding a filter sits right before a filtergraph label.
- `bc` prints `.70` without a leading zero. ffmpeg accepts it, but integer
  millisecond delays need `$(echo "$T*1000/1" | bc)`.
- Run full-length renders and transcription as background jobs and cap their
  parallelism (Remotion `--concurrency`, transcription in chunks). A job killed
  for memory (exit 137) in the foreground can end the agent session with it; the
  same job at lower load usually finishes.

## Quiet external audio and separate recordings

Measure channels independently before mixing or applying gain. A stereo file can
contain one silent channel and usable speech on the other. Inspect speech level,
noise and isolated peaks across early, middle and late passages. A single peak
near full scale does not mean speech is loud enough, and fixed gain can clip it.
Test extraction of the active channel, gentle filtering, adaptive gain/compression
and normalization on representative samples before processing the full recording.
Preserve originals and decoded timing. Measure the encoded listening copy as well
as the PCM master: AAC overshoot can require more headroom.
Usable recovered speech is a reason to test salvage before suggesting a retake;
signal checks cannot establish the original app/input-setting cause or listening quality.

With camera reference audio, locate a coarse offset using speech envelopes, then
refine on selected waveform windows. Check multiple positions per recording for
drift; do not infer a single offset across unrelated camera files. Account for
encoder/start timestamps separately from decoded sample positions. With silent
video, match distinctive mouth movements and reactions to the transcript and
audio, record the uncertainty, and seek a user anchor only if the available
evidence cannot resolve the alignment. Transcript similarity alone cannot prove sync.

## Preflight and source color

Estimate disk use before a long preview, source conversion, or installation.
Reuse completed transcripts and frame surveys after a storage failure. Resume
only the failed stage; do not delete original or unrelated files to make room.

Compare a short actual export against the source appearance before full finishing.
iPhone HLG/Dolby Vision can become washed out through the wrong transform.
One checked workflow normalized selected full-resolution source windows
with half-second handles, then used unmanaged Rec.709 in Resolve to avoid a
second HDR transform. This was technical normalization, not a creative grade.

The verified FFmpeg filter for that particular source was:

```text
zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:peak=10:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p
```

It was encoded at full upright 1080x1920/60fps with H.264 VideoToolbox at 40 Mbps,
tagged BT.709. Resolve used `davinciYRGB` with Rec.709 Gamma 2.4 timeline/output.
These values are a source-specific working example, not a universal iPhone LUT.
Some FFmpeg builds lack `zscale` (and `drawtext`); check `ffmpeg -filters`. On macOS,
`avconvert -s IN -p Preset1920x1080 -o OUT --start S --duration D` gave upright BT.709
SDR with Apple's tone mapping that matched the source by eye (one project, 2026-09).
Its trims land a few tens of milliseconds off: re-sync each window by audio
cross-correlation rather than trusting `--start`.
Probe each recording, inspect the sample, and retain original HDR media. Reuse
normalized windows for revisions whose source ranges remain within their handles.

## Cut and render

For simple synchronized cuts, write an FFmpeg filter file from the cutlist:

```text
[0:v]trim=start=A:end=B,setpts=PTS-STARTPTS[v0];
[0:a]atrim=start=A:end=B,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=DUR_MINUS_008:d=0.008[a0];
...
[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]
```

Snap `A` and `B` to frame boundaries (a multiple of 1/fps) so each segment's
picture and audio have the same length; `DUR_MINUS_008` is the segment duration
minus 0.008 s. Micro-fades reduce clicks; make them short enough to preserve consonants.
For independent picture/audio cuts, concatenate each track separately and
check matching total durations. Record the incoming pre-roll and picture
join explicitly. Do not create a frozen face to fill every missing handle.

Use a smaller, fast-encoded preview until the story and layout settle.
For final social delivery, these are starting settings, not platform mandates:

```bash
ffmpeg -i IN -/filter_complex filters.txt -map '[vout]' -map '[aout]' -c:v libx264 -crf 19 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart master.mp4
```

An upload copy can use CRF 23 and AAC 128k when it remains visually adequate.
Prefer generating final variants from the same high-quality source over
chaining unnecessary lossy transcodes. Match fps, dimensions, SAR, audio
layout, and sample rate across concatenated sources. Upscaling does not
restore detail in a low-resolution asset.

Apply tempo changes consistently to video, audio, captions, and overlays.
Do not use source seconds as output seconds after a speed change. Preserve
natural voice pitch with the available tempo filter and check delivery in context.

For audio, start near -14 LUFS with peak headroom, for example
`highpass=f=70,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000`, adapting to the
source and mix. On a quiet source whose true peak is already near the ceiling,
`loudnorm` cannot reach the target linearly and silently switches to dynamic mode;
measure first (`loudnorm=print_format=json`), and if so apply gentle compression
and a limiter (for example `acompressor`, then `volume`, then `alimiter`) before a
final linear pass. `alimiter` delays its output by its lookahead (5 ms by default)
unless `latency=1`; set it when the limited mix is muxed against picture. Its
`level` option defaults to auto-level, which raises the output after limiting;
set `level=0` for a plain ceiling. Measure the actual final export because encoding/mixing
can change loudness and peaks. Sparse sound effects should sit below speech.

Place effects on the speech track with `adelay` and mix without auto-normalizing:

```text
[1:a]volume=-10dB,adelay=500|500[s1];
[2:a]volume=-13dB,adelay=2400|2400[s2];
[speech][s1][s2]amix=inputs=3:normalize=0:duration=first[mix]
```

Delays are milliseconds in final output time; gains are starting points to adjust.
For a reported inaudible bed, compare the stem, intended mix, and exported mix
in matching speech and pause intervals. Stereo-side energy can be dominated by
camera ambience, so it does not reliably isolate music. Native pitch correction
may change PCM between renders; a hash mismatch alone does not identify a mix
fault. Use contextual audio review when available and report the limits of
signal measurements. For brief SFX, whole-clip RMS can conceal a strong transient:
compare short active windows with speech at the same instant as well as the whole
effect. Short windows, such as 50 ms, are a diagnostic, not an audibility threshold.
A positive effect-to-speech ratio during a speech pause does not establish masking.
Keep project-specific gain changes in the project.

## Captions

When overlays change position, inspect captions at entry/exit boundaries as well
as settled frames. A caption starting just before a layout boundary can continue
into the next visual and collide. Use a phrase-specific position override rather
than moving an entire caption track. Fit product crops with contain when the
whole silhouette matters; fill/crop can accidentally truncate the object.

For an FFmpeg/ASS caption path, reuse [make_captions.py](../scripts/make_captions.py); its docstring defines
the input schema. A minimal cutlist looks like:

```json
{
  "segments": [{"src_start": 25.29, "src_end": 28.77, "out_start": 0}],
  "fix": {"Alexx": "Alex"},
  "style": {"play_res": [1080, 1920], "font": "Arial", "size": 72,
            "margin_lr": 100, "margin_v": 350}
}
```

These sample margins are not a universal safe area. Measure the actual
face/content and account for the destination's interface.

```bash
python3 SKILL_DIR/scripts/make_captions.py audio.json cutlist.json captions.ass --expected expected.txt
```

The generator uses short chunks, punctuation/gap breaks, and caption timing
clamped against the next chunk. Require zero overlaps. Check captions against
the final duration and ensure the last selected word survives the cutlist's
boundary filter. Correct name spelling without changing the spoken meaning.
For speed changes, supply word timings in final output time or map them
explicitly; this generator's source-to-output offset alone does not scale time.

The helper expects checked local JSON and uses fixed phrase/timing heuristics.
It keeps words that reach at least 50 ms into a cut, clamps ones that start
before it, joins split numbers, lowercases mid-sentence segment capitals, and
adds caption padding that never starts before a clip or ends after the export.
Review every word it reports as clamped or lowercased. Emphasis styling is not
automatic: add ASS override tags to the chosen lines. Very close phrases can still overlap because of the minimum
display duration. The overlap warning does not produce a failing exit code;
inspect the reported count and repair timing before burning. Review caption text
containing ASS control characters before rendering it.

Run its dependency-free CLI check with:

```sh
python3 SKILL_DIR/scripts/test_make_captions.py
```

Burn with the ASS/subtitles filter from a working directory where its paths
resolve. Preserve the uncaptioned render when useful for later changes.

## Visual geometry and evidence

For punch-ins, derive even crop dimensions from the zoom factor and anchor
the crop to keep relevant content visible. Recalculate caption/overlay bounds
after cropping. Only add a zoom or end card when it serves the brief.

Extract a survey using an FFmpeg `fps`, `scale`, and `tile` filter; inspect
specific frames around each changed picture cut and overlay transition.
Use the actual picture join, not only the audio cut, for split edits. Check
the caption band at representative times throughout the edit, using the
configured caption location rather than assuming the bottom 260 pixels.

Check original asset identity across aliases/crops. Calculate the union of
visible overlay intervals, then measure its complement from time zero to
the final duration. Include fades conservatively; do not rely on an almost
transparent image to satisfy the active coverage limit.

For a reported freeze, compare consecutive frames around that transition
and inspect actual motion. For a reported pause, inspect audio around the
join. Combine these with contextual playback/listening when available;
duplicate-frame and silence tests alone cannot certify natural pacing.

## Delivery checks and caching

```bash
ffmpeg -v error -i OUT -f null -
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size -of json OUT
```

Extract final mixed audio for one independent local transcription and
compare substantive speech against the selected dialogue. Keep that QA
transcript separate from caption inputs so a new ASR error cannot silently
rewrite verified captions.

Reuse transcription and caption timing after a picture-only change only
when the audio and edit timeline remain unchanged. An unchanged audio
artifact, identical decoded PCM, or equivalent pipeline evidence can establish
reuse; a filename alone cannot. Recheck affected joins, speed/mix changes,
and the final ending when audio does change. Decode each delivered file.

Render only changed overlay scenes and reuse unchanged assets. Cache validity
depends on source identity, timing and layout inputs, not output-file existence:
invalidate the affected MOV after changing its manifest. Generate review sheets
after their full-frame images are ready; a stale thumbnail caused a false subtitle
report in a prior edit. Resolve a suspected defect against the current full-size frame
before rerendering. Sample each delayed layer entry and outgoing context, not only
one frame per scene. Static samples still do not prove animation or listening quality.

## Reusable media library

Use the project's existing asset index if one exists. Otherwise keep a small
manifest alongside the edit with original identity, local path, source URL,
source time range, credit or license requirements, selection status, spoken cue,
and where the asset was used. No separate catalog service is required.

Preserve original identity across renamed files and crops. Count source works
separately from useful variants, such as one music recording in source, extended,
and ducked forms. Exact hashes detect identical files; audio deduplication may
need aligned, gain-normalized waveform comparison and review of likely matches.
Similar whooshes are not automatically duplicates. Enforce any brief-specific
reuse limits against original identities rather than filenames.

For sound compilations, inspect each onset and tail for neighboring sounds or
truncation. Mark uncertain effects provisional and choose sounds for actual cues.
Keep rejected candidates out of active selections while preserving files used by
older projects. Source provenance is not publication permission.

## Extending a short music recording

Find a musically matching phrase return and crossfade it instead of blindly
restarting the track at its end. Preserve pitch if a small tempo fit is needed;
align intro/outro to the final timeline, duck under speech, and keep a requested
music-free hook silent in the music stem. Inspect loop boundaries in context when
listening is available. Loop length and crossfade duration depend on the recording;
numeric settings alone do not prove a seamless audible loop.

When ducking a bed with `sidechaincompress`, pad the speech key with `apad` and trim
the output to the final duration with `atrim`. The filter stops when the key ends,
silently dropping the bed's tail and any fade scheduled there. Before mixing, confirm
every stem (speech, music, effects) is as long as the picture.

## Repeated-speech checks

`scripts/restart_scan.py` automates the interior check below for a whole cutlist.
For a first survey of a long take-heavy recording, transcribe per speech island
(split at silences) with conditioning off: whole-file decoding with conditioning on
has looped one sentence for minutes, and chunked decoding still merged restarts.

Treat unexpectedly long word timestamps as a reason to inspect the underlying
audio. A recognizer can assign a single word a long interval containing repeated
speech. A long transcription and a short check ending at the previous take can
both miss it.

Decode each window separately. Phonon can batch files under one loaded model
while writing a separate JSON for each input. Treat words at clipped window
edges as suspect and include context. If a concrete failure justifies Whisper,
use separate input calls with previous-text conditioning off.

Inspect overlapping windows containing the outgoing phrase, the join, and the
first phrase of the incoming clip. Include the interior of a selected passage
when a word spans an implausibly long interval or the source contains restarts;
a repeat can survive entirely within one clip. Use tiny source windows to localize a suspect
repeat, then verify the combined final join again. Tiny-window ASR can also
hallucinate; reconcile conflicting results against source context, waveform, and
listening when available. An instruction to transcribe verbatim does not make
the recognizer reliable by itself.

## Cutting under a finished composition

When animation, cards and captions are already cued to the old timeline, removing a
span from the camera, cutout and dialogue can leave every layer untouched: map the
composition frame to the old ("story") frame (`story = f < CUT ? f : f + N`), pass that
to the layers, map effect cues back, and drop cues inside the removed span. Correct the
word timings ASR had merged across the removed span first. Check the join's picture as
well as its audio: elements whose entrances fell inside the span appear already in place.

## Frame-rounded timing

Keep source positions, normal-speed record frames, and final output frames
separate. Use integer frames for edits; round only at conversion boundaries.
After a removal, map every dependent layer through the same removed interval.
After a speed change, compare predicted duration with the native result.

For final manifests assert `0 <= start < end <= exported_duration`, caption
bounds/no unintended overlap, and matching picture/audio end frames. Calculate
visual coverage using merged intervals, not a sum of individual durations.
Read or derive one current speed, rather than carrying per-item values from a
previous version. Leave a small margin inside the current brief's timing limits.
