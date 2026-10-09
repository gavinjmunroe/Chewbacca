---
name: video-edit
description: Edit and revise talking-head videos, Instagram reels, TikToks and Shorts, text-overlay skits, memes, reel recreations, demos and screen recordings from camera footage. Use for take selection, quiet-audio recovery, captions and subtitles, hook headlines, sourced b-roll, speed or color fixes, DaVinci Resolve or FFmpeg assembly, retention-minded cuts, and authorized publishing. Also use when an edit was already made and feels slow, unclear or wrong. Not for animation drawn in code (animated-video), scripting before filming (video-script), or product demo capture (demo).
---

# Video edit

Make the video's idea land for its style. A valid render is only one part of a
finished edit.

## Choose the style

Choose from the footage, the goal and any reference before planning the edit.
The [style library](references/styles.md) lists the styles this skill can make
(talking head, skits and meme cuts, lists, demos, explainers and more). It
describes each one by its layers (spine, structure, picture, text, sound,
effects) and explains how to fuse them: one spine per section, with borrowed
layers that fix a real weakness. Write the result into the brief as a style map.

The two most developed styles have full guides:

- **Talking head**: someone speaks to camera to tell a story or explain. Start
  with complete, camera-facing speech, then show the actual people, documents,
  products, and events being discussed. Follow steps 1-5 and the
  [default style](references/style.md).
- **Skit**: silent acting, one on-screen line carries the joke, a trending
  sound carries the energy, often with a meme cut. Follow the
  [skit guide](references/skit.md); for skit sections it replaces steps 2-3 and
  the default style's dialogue, coverage, dwell and caption-emphasis rules. Steps
  1, 4 and 5 still govern probing, color, rendering and verification.

To recreate a posted reel, [download and measure it](references/technical.md#measure-a-reference-reel)
first (cut times, duration, camera motion, text position, audio dips) and name its
styles before touching the footage.

## Set up

On a new machine, run `python3 SKILL_DIR/scripts/preflight.py --project PROJECT_DIR`.
For each missing tool, say what it is for and its install command, ask, and run it
only after the user agrees; then rerun preflight. Resolve is the preferred editor
([setup](references/resolve.md#set-up)); if it is missing or you cannot operate its
console or UI here, render with FFmpeg and say the result has no editable project.
Report missing browser or account access rather than claiming checks that did not run.

Read `~/.video-edit/profile.md` if it exists (creative defaults, project locations,
asset libraries, standing preferences). When the user marks an instruction as a
habit ("always", "as usual", "like before") or repeats one from an earlier brief,
offer then to record it there, so they don't have to say it again.

## Choose the task

- Read the current brief, accepted reference, and profile. Scope preferences to
  their intended projects instead of treating them as universal. Open the first
  reply with one line naming the stored defaults you are applying (takes, audio
  source, speed, sound), so the user can correct one instead of repeating them all.
- Without a brief, ask once: where the video will be posted, roughly how long,
  whether to add music, sound effects, or a hook headline, and for screenshots or
  recordings when claims concern the user's own data or product. Offer the
  [default style](references/style.md), which applies wherever brief and profile are silent.
- Verify platform length, caption, watermark, and ranking claims against current
  official sources when they affect the task; distinguish rules from creative choices.
- For Resolve assembly, speed changes, native rendering, or console recovery,
  read [Resolve workflow](references/resolve.md).
- For FFmpeg rendering, quiet-audio recovery, separate-audio sync, music extension,
  captions and timing checks, read [technical reference](references/technical.md).
- Publish or schedule only when requested, following [the publishing procedure](references/publish.md).
- For a requested reflection, follow [the reflection protocol](references/reflection.md): findings
  before unapproved instruction edits, and no new edit, render, or upload required.

Current user instructions override stored defaults. Honor staged boundaries:
restate the brief, wait for uploads, create a folder, preprocess, assemble dialogue
only, or collect assets first when that is the requested scope. Preserve originals
and prior deliverables; keep derived assets local until upload is authorized.

## 1. Recover the project and active brief

Inspect the existing directory format, source, manifests, scripts, and current
native timeline before building anything. Reuse preprocessing and checked assets.
Locate the user's project and available media tools from the workspace and brief.
Verify their availability. Do not start a server merely because it exists.

Keep one active brief in the project containing the latest requested version,
script/story beats, speed, aspect ratio, color treatment, visual rules, and
outstanding corrections. Track each correction as requested, implemented, or
verified, with a final-output interval. Later speed/ending requests replace older
ones while unrelated accepted edits remain in force. User timestamps identify a
region in the version they watched; locate the words, then map back to the source.
Carry rejected asset identities and treatments forward with the brief, so another
crop or later scene cannot silently reintroduce them. Use supplied replacements.

Check free space and source metadata before long encodes. Probe orientation,
frame rate/timebase, HDR/color tags, audio, and duration. Make a short portrait and
color sample before encoding the entire source. A low-resolution review copy is
for review, not a substitute for full-resolution camera media in the final edit.

Complete when the source, current version, active brief, tools, and storage are
known. Continue authorized work without adding a routine approval gate.

## 2. Build the dialogue from takes

Transcribe the source locally once and cache word timestamps. Survey all takes
against the supplied script. Mark each spoken rejection such as "cut that" or
"forget that" and the abandoned take it refers to. Exclude that rejected delivery
from every section, not just the location of the rejection words. Use surrounding
context to find the restart instead of deleting an arbitrary number of seconds.
Use Phonon-2 for English transcription, restart checks, and final audio QA on
Apple silicon. Use Whisper only for an unsupported language/host or a specific
failure that remains after Phonon retries; record that reason. Check older
project scripts before reuse so historical Whisper commands do not run by habit.
Review speech-gap flags before captioning; see
[transcription](references/technical.md#probe-and-transcribe).

Select the longest fluent, accurate delivery of each sentence or coherent passage.
When the user prefers the last take, start from the last complete successful take;
reorder it by script meaning rather than recording/file order. Check completeness;
if the source ends before the story does, report it and ask. A script is the story
outline, not a requirement to stitch every word verbatim. If the user says fluent
takes exist, search the remaining source before proposing omissions or pickups.
Keep required setup, transitions, attribution, and ending.

Review gaze and speech together at both ends of each selected take. Start on the
first complete intended word with camera contact; trim script-reading lead-ins
and tails. Preserve natural breaths and low-energy consonants. Prefer another
complete take over a chain of word-sized repairs. If the only usable audio has a
brief glance, use a checked moving split edit or, when the active layout brief
allows it, a relevant full-frame source insert over its entire visible interval. Preserve the original speech;
do not fabricate delivery or freeze a face to conceal a bad cut.

For every join, check the outgoing tail AND the incoming lead-in in context.
Long ASR can silently remove repeated words and stretch one timestamp over both.
When repetitions are reported, use overlapping short windows around the join,
then source windows and waveform/frame evidence. Whole-clip ASR merges restarts inside
a take: run `scripts/restart_scan.py AUDIO CUTLIST.json` before the first render. A clean transcript of one take cannot prove the next take does not repeat it. Listening is preferred when
available; do not claim it occurred if only ASR and frames were inspected.

Complete when every required beat has a selected non-rejected take and the
opening, joins, gaze, and ending have been checked. Keep the normal-speed cutlist
as the timing authority; treat playback speed as a separate setting.

## 3. Find and compose relevant visuals

Search by the claim or entity being spoken, not the broad topic. An essay opening
calls for its real title; an endorsement calls for the actual statement; a policy
calls for the relevant policy passage. Choose the visual medium from the current
brief and creative defaults, using primary sources. Generic AI/server stock rarely
explains a specific claim. Verify source context before using a visual as evidence.
For a comparison, show the actual compared category or named examples during
that clause, then clear them when the subject changes. Playfulness must preserve
the literal subject; an adjacent topic is not a substitute for the compared category.

Maintain a visual manifest with original identity, local file, URL/credit,
publication context, spoken cue, explanatory purpose, crop/highlight, layout, and
timing. Distinguish an existing policy from a new agreement and a risk scenario
from a confirmed event. Track selection/rejection separately from file existence;
index reusable visual, music and SFX assets with provenance and deduplication
evidence. Use an existing asset index or a project manifest as in the
[library procedure](references/technical.md#reusable-media-library).
Highlight only words actually present in the source.
Keep the research bibliography in notes and necessary qualifications readable.
Choose evidence when the viewer needs to inspect a claim; choose illustrative
imagery or a simple diagram when explaining a process. A mentioned repository
is not by itself a reason to show its interface. Check spoken numbers before
building graphics; distinguish tokens, cost, elapsed time, and code size. If the
user retains an inaccurate sentence, keep the explicit correction visible at
that sentence and check its caption text too.

If a visual-collection agent is requested, give it specific uncovered beats and
have it return downloaded candidates, provenance, exact cue, and why each fits.
Keep timeline mutation with one editor. Reject attractive but weak matches.
Stop searching when every scheduled beat has a strong usable asset.

For a new reference style, inspect a few representative clips in the requested
browser. Extract layout, caption, pacing, and entry/exit choices; do not reuse the
creator's footage. Make a short representative treatment while preparing other
assets. Reuse an accepted treatment without asking for approval again. For a new
brief, test one representative visual and audio passage before producing the
whole visual set. Include the hardest requested layout or gesture and the hook;
a clean easy frame cannot validate the whole treatment. This is an internal
check, not a mandatory approval stop.
When generation would explain a beat better, use the connected generation skill
for a bounded candidate and inspect it before extending the treatment.

Place visuals by the [placement guidance](references/style.md#placement).

Complete when every visual explains its spoken cue, has provenance, and meets
the active placement/reuse/dwell/coverage rules in final playback time.

## 4. Assemble, finish, and revise

Assemble and render in native Resolve when it is installed, with separate camera,
visual, caption, and mastered-audio tracks. Without Resolve, render with FFmpeg as
described in the technical reference. FFmpeg remains useful for audio, previews,
normalization, and QA. A flattened FFmpeg movie imported into Resolve does not
satisfy a request for a native editable composition.

Preserve natural camera color. Diagnose rotation/HDR/output transforms before
applying adjustments. Compare source, normalized sample, and exported frame;
use one technical HDR-to-SDR conversion when needed, avoiding a second transform.
Creative grading, brighter backgrounds, and blur are not automatic polish.

Before rendering captions, mark emphasis passages across the complete selected dialogue.
Record their words, timing, treatment and placement in existing caption data or the edit plan.
Test the hook, one later emphasis passage and a quiet passage against their actual visuals
before extending the treatment. Keep captions restrained when viewers need to read dense evidence.

Create short phrase captions from the selected speech with a checked name map.
Keep text clear of the face, visuals, and platform controls. Preserve editable
caption data and an SRT even if the rendered layers are images. Do not use caption
changes to hide incorrect spoken words. Separate hook copy from dialogue captions;
translate foreign-language speech for the intended audience without inventing
emotion or dialogue. Honor exact user-supplied headline wording.
Use speech-dominant audio with measured peak headroom; add music or effects only
when the brief supports them. When
requested, make their contribution perceptible in a short exported mix under
speech and in pauses. File presence and total-mix loudness do not establish
music or effect audibility. Plan attribution needs when choosing the track so
publishing does not unexpectedly expand a requested short caption.
Pick effects from the profile's libraries or files the user supplies. The upstream
28-clip effect pack is not bundled here because its rights are unverified.
Keep one cue sheet for the whole video, even when beats are built in parallel; count
uses per file before rendering and justify every repeat (per-beat quotas multiply into clutter).

For revisions, change the cutlist/manifest or native timeline instead of copying
an entire pipeline per version. Ripple all dependent layers after a cut. Apply
requested speed once to linked picture/audio and all timed layers, preserving
pitch. Derive final captions and visual intervals from the actual frame-rounded
timeline, clamp them to its end, and update both speed metadata and visible
playback-rate labels on sourced demos.
For a visual-only revision, duplicate the accepted native timeline and replace
only affected layers. Keep a stable audio mix when sound is unchanged; use the
[Resolve revision procedure](references/resolve.md#visual-only-revisions) and
prove preservation before reusing speech QA.

Complete when the requested corrections exist in the native project and the
actual export, with prior accepted work preserved.

## 5. Verify the exact deliverable

Keep editorial and technical evidence separate:

- Editorial review checks coherent story, complete words, fluent longer takes,
  camera contact, timely relevant visuals, readable captions, and a finished
  ending. Check that emphasis extends beyond the opening, each effect fits the sentence,
  and quieter passages provide contrast; identify automatic reuse of one treatment.
  Use contextual playback/listening when available. User feedback is
  stronger evidence of taste than a contact sheet or automated transcript.
- Technical review checks full decode, requested geometry, duration, linked speed,
  audio level/peaks, caption timing, all changed joins, and visual constraints.
  Use checks that test the reported defect; a similarity score with an arbitrary
  threshold is not a substitute for that check. Count original identities across
  renamed/cropped assets. Compute coverage from
  the union of visible intervals including the opening and ending; captions do
  not count as supporting visuals. Inspect the actual exported frames.

Re-transcribe final mixed audio after cut/speed/mix changes. Investigate changed
joins in overlapping short windows even when full ASR looks correct. Keep this QA
transcript separate from checked captions. Record a correction as verified only
when the check includes the defect's full context, including the next clip.

| Change | Necessary repeat checks |
| --- | --- |
| Visual only, audio proven unchanged | Changed visual intervals and neighbors; reuse audio evidence |
| Cut or speed | Changed joins, caption/visual retiming, final mixed audio, ending |
| Color | Matched source/sample/export frames; reuse speech evidence |
| Caption only | Changed text, timing, bounds, and visual overlap |
| Every delivery export | Full decode, metadata, intended version, actual file present |

Independent frame review may add bounded coverage alongside useful local work;
it does not establish taste or fluent playback. Avoid rerunning unchanged work.
Deliver one unmistakably named current file, native project when applicable, and
brief change summary. A DRP referencing local media is not a portable media archive.

## Maintain the skill

On a requested reflection, review corrections and artifacts and propose changes
to their authoritative files. Apply approved changes, keep session evidence in
the project or profile, and record untested improvements as experiments. Personal
creative preferences belong in `~/.video-edit/profile.md`, not in this skill. Use
the linked protocol. Skill maintenance does not authorize memory changes or publication.

## Related kit skills

- [video-script](../video-script/SKILL.md): hook, stakes and retention before filming; its retention-curve reader feeds post-edit lessons.
- [animated-video](../animated-video/SKILL.md): when the picture is drawn in code (Remotion) rather than filmed.
- [creative-video](../creative-video/SKILL.md): the short-form craft rules (first frame works muted, hook in three seconds) and the Higgsfield and Blender routes.
- [demo](../demo/SKILL.md) and the `cap-demo` skill: recording a product demo; this skill edits the footage afterward.
- [manim](../manim/SKILL.md): math explainers.

The upstream 28-clip sound-effect pack (rights unverified) was left out. Supply effects from the user's own files.
## Credits

Adapted from cstack by Charles Zheng (MIT), https://github.com/goodnight000/cstack
