# Editing footage with an agent

The rules an agent follows when it cuts, trims or versions footage while he
keeps the creative calls. Adapted from Palmier Pro's agent playbook
(`Sources/PalmierPro/Agent/Tools/AgentInstructions.swift`, tag
`last-gpl-source` of palmier-io/palmier-pro, GPLv3), read 2026-09-27. Palmier
is a Swift editor that Claude drives over MCP; its playbook is the most
complete written account of this job we have found. The rules are restated
here, not copied.

## Look before you touch

- **Never describe footage from its filename.** Look coarse to fine: a
  storyboard of the whole clip first (`ffmpeg -vf fps=1/2,tile=3x4`), then the
  transcript, then frames around the moment in question.
- **To find a moment, search, then cut to the time range** the search returned.
  Reading every clip end to end is the fallback, not the method.

## Cutting

- **Tightening speech goes in this order:** silence and dead air first, then
  fillers and flubbed lines by word timestamps (`whisper-cli -ml 1 -sow -oj`
  writes one word per segment, with its times), then read the remaining
  transcript as prose. Catch orphaned
  half-thoughts, leftover retakes and jumps. A coherent spoken arc beats the
  shortest possible cut.
- **Cutting to music:** bar starts by default, every beat only for a fast
  montage. For a montage, [cutting-to-music.md](cutting-to-music.md) wins: our
  own measuring says not to put every cut on the downbeat.
- **A new version is a copy.** Never edit over a cut he approved. A vertical
  version starts from a copy of the wide, then gets reframed. With
  `reel-assemble`, that means a new `edit.json` per version.

## Asking and not asking

- **Edits are free and undoable, so make them and say what changed.** Do not
  ask permission for each one.
- **Generation costs money and cannot be undone.** Propose the prompt, model,
  length, aspect and cost, and wait for his yes. For Higgsfield,
  [../SKILL.md](../SKILL.md) also requires `higgsfield generate cost` first.
- **Anchor a generation on the real frame.** When a shot continues footage,
  pull the frame out of the clip with ffmpeg and pass that. Never generate a
  lookalike of a frame that already exists.
- **Review has three states:** open, then "review" once the edit is applied and
  checked, then "resolved" only when he says so. The agent never marks its own
  work resolved.

## When a tool falls short

When a capability is missing, a result is clearly wrong, or the tool keeps
getting in the way, write it down once per issue, in your own words, never his
verbatim. Palmier's agent files these as `missing_capability`, `wrong_result`
and `confusing_ux`. Here it goes in the worked examples in SKILL.md, or in the
Higgsfield log for a Higgsfield fault.

## Palmier itself

Its free tier is the full editor, the MCP connection
(`http://127.0.0.1:19789/mcp` while the app is open), local transcription and
FCPXML export, with generation paid separately. It needs macOS 26 on Apple
Silicon, and his Mac was on macOS 15.7 on 2026-09-27, so it is not a route yet.
