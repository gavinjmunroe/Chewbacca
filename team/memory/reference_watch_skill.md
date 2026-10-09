---
name: reference-watch-skill
description: "Watch Skill (oxbshw/watch-skill) is installed globally: video/screen perception + deterministic verification, 39 MCP tools, vision on local Ollama."
metadata:
  node_type: memory
  type: reference
  originSessionId: 0d64e110-8605-482f-95de-a314cfe35018
  modified: 2026-09-09T06:13:31.002Z
---

Installed 2026-09-08. `watch-skill` gives an agent eyes: it turns video, audio, and
screen recordings into timestamped, searchable evidence, and verifies work against a
deterministic contract instead of a model's opinion.

**Install shape.** `uv tool install --python /opt/homebrew/bin/python3.13
'watch-skill[standard,ocr,loop,api]'`. The system python is 3.14 and watch-skill only
supports 3.11 to 3.13, so it MUST be pinned to 3.13. Binary at `~/.local/bin/watch-skill`.
Playwright chromium installed for THE LOOP. `whisper` extra was skipped (multi-GB torch);
add it only if a source has no captions and local transcription is actually needed.

**Wired into Claude Code two ways:**

- MCP server `watch-skill` at user scope in `~/.claude.json`, 39 tools, vision env baked
  into the registration so it does not depend on shell state.
- 10 skills copied to `~/.claude/skills/`: watch, watching-videos, video-memory,
  asking-with-evidence, the-loop, extracting-structure, configuring-vision,
  learning-from-mistakes, recovering-from-errors, sharing-results.

**Vision runs on local Ollama**, model `qwen2.5vl:3b` (pulled by `setup-vision`). No cloud
key on this machine: the `ANTHROPIC_API_KEY` line in `.zshrc` is a commented placeholder.
`watch-skill setup-vision` writes a `.env` into the CURRENT DIRECTORY, which is per-project
and easy to lose, so the eight `WATCHSKILL_*` vars were appended to `~/.zshrc` instead
(backup at `~/.zshrc.bak.watchskill.20260908`).

**Verified working**, not just installed: local mp4 indexed and OCR'd, YouTube URL
downloaded through yt-dlp with 16 frames and a caption transcript, `ask` returning
`verified: true` with timestamps.

Two gotchas found: `watch-skill serve` exits on stdin EOF, so a piped MCP handshake test
returns only the init response and looks broken when it is not. And `npx skills add`
installs into the current directory, not globally, so run it from the right place or move
the result.

Related: a private note, a private note
