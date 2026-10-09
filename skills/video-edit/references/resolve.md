# Resolve workflow and recovery

Use this reference for native assembly, speed revisions, render automation, or
console failures. These observations come from Resolve 21.1 on macOS in
September 2026. Recheck the installed SDK when methods differ; this is not
a promise that every Resolve edition/version behaves identically.

## Set up

DaVinci Resolve is free from Blackmagic Design; the installer needs the user.
How scripts reach it depends on the edition:

- **Free Resolve** runs scripts only from inside the app: Workspace > Console, or
  the Workspace > Scripts menu. Observed in September 2026 on Resolve 21.1 for macOS
  (bundle named "DaVinci Resolve", the free edition): with the app running, the bundled `ResolvePython` and `fuscript` interpreters
  both got `None`/`nil` from the shell. Plan on driving the console as described in
  [Access the native application](#access-the-native-application).
- **Resolve Studio** can also accept scripts from the shell once the user sets
  Preferences > System > General > External scripting to Local (per the installed
  scripting README; not yet verified here). Then run scripts with the bundled
  `ResolvePython` (macOS `…/DaVinci Resolve.app/Contents/Applications/ResolvePython`,
  Windows `…\DaVinci Resolve\ResolvePython\ResolvePython.exe`, Linux
  `/opt/resolve/bin/ResolvePython`) and check that `scriptapp('Resolve')` is not `None`.

Scripts saved under the user's `Fusion/Scripts/Utility` folder appear in the
Workspace > Scripts menu after Resolve restarts (macOS: `~/Library/Application
Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts`; Linux:
`~/.local/share/DaVinciResolve/Fusion/Scripts`; Windows:
`%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts`).

## Establish one editable timeline

Keep the normal-speed cutlist in integer timeline frames. Keep original-source
in/out positions distinct from record positions and final playback times. The
source may be 60 fps while the timeline is 30 fps; use the timebase required by
the import format, not a blanket multiplication of all values.

Use native camera clips on V1, sourced visuals on V2, phrase captions on V3, and
a mastered PCM dialogue track. Mute original camera audio if a replacement mix
is present. Keep caption text/timing in JSON plus SRT even when transparent PNGs
are used for exact native compositing. PNG text is not natively editable text.

The successful session used a checked FCP7 XML template for exact clip positions
and durations, imported through `MediaPool:ImportTimelineFromFile`. Direct still
appends defaulted to five seconds despite supplied duration. Verify imported
start/end/duration and track counts before finishing. Save a fully layered
normal-speed XML and project before creating a speed-adjusted compound.

A compound keeps camera, overlays, and captions editable internally while allowing
one synchronized speed change. Remove duplicate source audio from the delivery
copy before creating it; a muted source track can become dangerous if regrouping
changes track enablement. Retain the pre-compound timeline/project for recovery.
After compounding, verify there is one intended picture item and one linked
master audio item, both audible/enabled as appropriate. If stem routing is
uncertain, retain the separate stems in the layered timeline and use an explicit
premix for delivery. Remove the duplicate stems from the delivery copy before
compounding. Check track enablement again afterward: the resulting audio item
may occupy a previously muted track. Verify the exported mix, not only names
or the count of audio items.

## Apply speed and ripple corrections

The verified native call on the complete compound was:

```lua
local c=t:GetItemListInTrack('video',1)[1]
assert(c:SetSpeed({Percentage=110.0,PitchCorrection=true,RippleTimeline=true}))
```

Set speed once relative to the normal-speed compound. Check audio linkage,
pitch correction, final picture/audio durations, and `GetSpeed().Percentage`
within tolerance, for example `math.abs(actual-110)<0.001`. Exact floating-point
equality failed even when printed values were 115.
Read the native duration after retiming before asserting the export length:
An observed 1988 frames at 115% became 1728, not the nearest-integer prediction of 1729.
Check picture/audio agreement and allow less than one frame of duration rounding;
use the observed end for sidecars. If a post-mutation assertion fails, inspect
`GetSpeed()` and duration, then resume verification/rendering from that state.

For a source trim, remove the interval on the normal-speed timeline and ripple
camera, audio, captions, and visuals together. Derive final times from the native
frame-rounded result, then clamp to its end. Check imported still in/out values
separately from timeline start/end. Keep asset identity and playback speed in
unambiguous authoritative fields; copied speed properties can silently go stale.

Avoid re-encoding a prior lossy final to change speed. Reuse the original camera
or normalized source windows and the editable normal-speed composition.

## Access the native application

Use the supported computer-use API for UI controls. On macOS, the SDK reference is commonly installed
under `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/`.
On other systems, locate the installed Resolve Developer/Scripting directory.
Read its README/type definitions before guessing methods. In this installation,
external Python `scriptapp('Resolve')` returned `None`; the internal Lua Console
worked with the built-in `resolve` object.

Open Workspace > Console using fresh UI state. Write a small inspected local Lua
file, then execute `dofile('/absolute/path/script.lua')` in that console. `io` was
unavailable there, while `dofile`, `print`, and `dump` worked. Explicitly focus the
console input and replace only your intended command. User typing and changing
focus can leave unrelated partial text in the input.

Verified method names included `Project:SetSettings` and `TimelineItem:SetProperties`.
Use installed docs for exact parameters. Two misleading behaviors need explicit
postcondition checks:

- `CreateCompoundClip` returned nil even though it created the compound. Check
  the resulting timeline on the next tool call before retrying the mutation.
- A native-pipe error sometimes arrived after a script completed. Inspect console
  output and timeline state before running it again.

Timeline import sometimes hid the Console and menu reopening had no effect.
After one failed reopen and a state check, the successful recovery was save the
project, quit Resolve normally, reopen it, select the project in Project Manager,
and reopen Workspace > Console. Keyboard selection worked when native window
coordinates failed. Use this only for the observed failure, after saving; do not
restart routinely or repeatedly click stale indices.

After project/page/menu changes, read fresh UI state and use the newly returned
control identity. Menu indices shifted after page changes; reusing a stale index opened
Fairlight or Fusion instead of the intended control. Do not discard the refreshed
state and then act on an old index. Once Console works, batch deterministic native
edits in one script with postcondition checks rather than repeated UI round trips.

## Visual-only revisions

Duplicate the accepted timeline; remove only the rejected/replaced visual clips
with `DeleteClips(items, false)` and append replacements at explicit integer frames.
Keep native camera, captions and audio separate. Assert actual start/end/counts
after append: a two-frame scene overlap has shifted an appended clip's start.
Deliberate image overlaps can live inside one transparent supporting-overlay clip;
preserve its source manifest. The camera must remain natively editable.

Use the approved PCM mix unchanged when sound/timing are unchanged, retaining
disabled editable source stems. If only the previous export preserves the accepted
mix, decode it once to PCM and document that lineage; prefer a lossless mix master
for future work. Trim to picture duration in samples, import at unity on one enabled
audio track, and verify track states. Avoid rebuilding pitch correction for an
imagery-only change: repeat native renders can differ in phase without new speech.
Compare exact decoded PCM when possible; otherwise check alignment, gain and local
windows, accounting for codec padding. This permits reusing prior speech QA without
pretending that correlation establishes listening quality.

## Render and verify

Explicitly set render format/codec after importing a timeline; the remembered
format was not reliably H.264. This recipe needs the current project, target path,
and output name supplied by the active brief:

```lua
assert(p:SetCurrentRenderFormatAndCodec('mp4','H264'))
assert(p:SetRenderSettings({
  SelectAllFrames=true, TargetDir=target, CustomName=name,
  FormatWidth=1080, FormatHeight=1920,
  ExportVideo=true, ExportAudio=true, VideoQuality=18000,
  AudioSampleRate=48000, NetworkOptimization=true
}))
assert(pm:SaveProject())
local job=p:AddRenderJob(); assert(job)
assert(p:StartRendering({job}))
```

Verify `GetRenderJobStatus(job)` says Complete, then check the file itself.
Inspect exact picture/audio duration and speed rather than trusting the timeline
name. Save/export the native project and leave its main Edit window open on the
current version. A DRP references local media unless separately archived.

FCP7 XML exported from the outer compound had an empty compound media path in
this session and could not fully recreate it on reimport. Preserve the fully
layered normal-speed XML as well as the DRP. Do not call an outer-compound XML a
portable edit without testing its reimport.

Reuse verified operations, not historical project names, frame counts, hardcoded
paths, or UI indices. The snippets above illustrate individual operations; they
are not a complete assembler. Verify the installed API and resulting timeline.
