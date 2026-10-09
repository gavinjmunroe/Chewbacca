---
name: reference_tab_board
description: "`tabs` is Chewbacca's shared board of live agent tabs across Claude Code, Codex and any other LLM; every tab sees the others' ask and files."
metadata:
  node_type: memory
  type: reference
  originSessionId: 83d162b2-443c-41c4-b42d-e52cf03ac259
  modified: 2026-10-09T08:51:15.344Z
---

`tabs` (tools/tabs.py, `chewbacca tabs`, ~/.chewbacca/tabs.sqlite) is the cross-runtime board of live agent sessions, built 2026-10-09 after Caleb ran five tabs at once and said "Fix chewbs so tabs always know what other tabs are doing even across llms".

- Claude Code: `~/.claude/hooks/tabs.sh` on SessionStart, UserPromptSubmit, PreToolUse (file tools) and SessionEnd. It injects every other live tab (runtime, repo, first and latest ask, recent files) and warns when another tab wrote the same file in the last 30 minutes.
- Codex: `tools/codex_hooks.py` calls the same functions with runtime `codex`.
- Anything else (Cursor, Gemini, scripts): `agent_context.py read` prints the board; join with `tabs register --session <id> --runtime <name> "<task>"`, update with `tabs note`.
- Recent files come only from write-log `edit` rows. `bash` rows are diff-inferred and on the first live run put one file under five sessions.
- Background-task prompts (`<task-notification>`) are filtered so they never become a tab's "ask".
- Privacy, from two security reviews the same night: token-shaped strings are redacted, markup tags are stripped and no angle bracket survives (nested `<sys<b>tem-reminder>` reassembled otherwise), the db and its WAL/shm are 0600, and `agent_context.py read --no-tabs` keeps the board out of the CHEWBACCA.md export that gets uploaded to browser apps.

Different from `bin/agents`, which is Claude-only and exists for the voice to pick a tab. Related: [[feedback_always_land_on_main]], [[project_chewbacca]].
