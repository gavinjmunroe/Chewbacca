---
name: feedback-help-flag-can-run-the-tool
description: "`--help` isn't safe to send blind: `people distill --help` ran a real distill over the message store (backlog 26 audit, 2026-10-16); check the tool parses --help before sending it"
metadata:
  type: feedback
---

During the backlog 26 skills audit on 2026-10-16, a script sent `--help` to the first command each skill names. `people distill --help` ignored the flag and started a real distill: it read the message store and began model calls, until the 20 second timeout killed it. Nothing was written (no quick_facts or distilled_at updates, watermark unchanged), but it could have been.

**Why:** bin/people's dispatcher handled `people --help` but passed `people <cmd> --help` straight to the command, and only `texts` read its own help. Plenty of bin/ scripts parse argv by hand and treat an unknown flag as nothing.

**How to apply:** before you send `--help` to a tool you didn't write, confirm it parses help (argparse, a usage branch), or read its source. In audits, run help only against tools that do. bin/people now prints a subcommand's usage on `--help` and `-h`, with a test in the people group that fails if the store gets opened.
