---
name: reference_chewbacca_launch
description: chewbacca launch opens a new named, briefed tab in the Claude desktop app; how it works, the CLI limits it routes around, and how to find the right tab to message
metadata:
  type: reference
---

`chewbacca launch --name "<lane>" --prompt-file brief.md [--cwd DIR]` (bin/chewbacca-launch, 96015297, 2026-10-10) opens a real sidebar tab. It prints `desktop_id` (`local_<uuid>`). The seed turn only reads the brief and says what it owns. Work starts when the launching agent sends the kickoff to `desktop_id` with SendMessage / send_message.

Why it's built this way, measured on CLI 2.1.289:

- `claude --desktop` refuses a prompt ("doesn't take a prompt yet").
- `--desktop` exits on redirected output, so it runs under `script -q /dev/null`.
- A `claude --bg` session can't be handed to the desktop while it runs ("That session is running in the background").
- What works: `claude -p --session-id <uuid> --name <title>` creates it, and `claude --desktop --resume <uuid>` shows it as `local_<uuid>`, transcript intact.

The ccd tools here have no start_session, and spawn_task only makes a chip. Caleb saw the chip and wrote "Uhhh", so launch tabs with this tool instead.

Every launch sets `CHEWBACCA_LAUNCHED_BY` on the seed. On 10/10 a test launch's prompt was recorded by chat-approval.sh as Caleb's ok for Clay writes. Later turns arrive via send_message with no env marker, so the hook has to judge those separately (the GTM lane owns it).

Finding a tab to message: list_sessions titles get renamed and don't match the tab board's "started on" line. A message meant for the "Ask Karthik" tab went to "Response to Maggie", which only answered a Maggie question. Map them with `claude agents --json` (name plus sessionId) or ask the target to confirm before handing it work to land.

Related: [[feedback_too_many_tabs_one_goal]], [[reference_tab_board]], [[feedback_push_race_retry_loop]].
