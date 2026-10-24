---
name: reference_desktop_weekly_limit_split_account
description: When several tabs suddenly stop, check for "weekly limit" in their transcripts and which app/account they ran in; Claude Desktop can be on a different account than VS Code
metadata:
  type: reference
---

On 2026-10-10 Caleb said "a bunch of tabs suddenly stopped" after running out of weekly usage in the Claude app on a different account. Every tab that died was a Claude Desktop session (`"entrypoint":"claude-desktop"` in its transcript), all failing with "You've hit your weekly limit · resets Oct 16 at 7am". The VS Code tab (`claude-vscode`, Max account per `claude auth status`) kept working. Nudging the dead Desktop tabs over SendMessage just hit the limit again, so it wasted a turn.

How to diagnose in one pass:
- `claude auth status` shows the CLI/VS Code account.
- grep the last two hours of `~/.claude/projects/**/*.jsonl` (skip `subagents/`) for `weekly limit`, and read each hit's `entrypoint` and last user ask.
- Separate tabs that died mid-work from tabs that finished before the limit (read the final assistant text).

Fix: move unfinished work to VS Code. Give him one paste prompt per dead tab that points the new tab at the old transcript path and the repo to check, so it resumes instead of redoing. Don't resend to Desktop tabs on the exhausted account. Related: [[feedback_never_route_his_tabs]].

Enforced since 2026-10-10: `tab-rescue` finds tabs whose last reply is a limit error and prints a paste prompt per tab, and the `tab-rescue.sh` UserPromptSubmit hook tells the next tab he talks to (once per death, plus a macOS notification). The same hook runs `sim-reap`, which shuts down simulators booted with nothing driving them.

## All the tabs vanished from the sidebar

On 2026-10-23 at 10:50pm Caleb wrote "I can't see the session I had ... I had like 50 tabs open before". Nothing had been deleted: the Claude app got signed into a different account between 10:36 and 10:49, and the sidebar only lists the signed-in account's sessions. `list_sessions` (archived included) showed just 4 old ones.

Diagnose in one pass, before saying anything:
- `ls ~/Library/Application\ Support/Claude/claude-code-sessions/*/*/` holds one folder per account/org pair. Count `local_*.json` per folder and read the newest mtime. His real tabs were 173 files under org `1cd2cd3f` (caleb@bluemodernadvisory.com's Organization, same as `claude auth status`), newest 22:36; the current session sat in a different pair with 7.
- The transcripts in `~/.claude/projects/**/*.jsonl` survive either way.

The fix is his sign-in, so reply once with `BLOCKED:` naming it and which routes don't reach it: clicking sign out kills the current tab and still stops at a login screen, and entering his login is never an agent's job. Don't hand it over before checking those, and don't write "it's on you" (a handoff-guard trips on it).
