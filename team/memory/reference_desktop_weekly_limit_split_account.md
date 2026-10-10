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
