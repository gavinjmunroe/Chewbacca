---
name: feedback_new_tools_never_reached_path
description: A tool added to bin/ after someone's install was "command not found" for them until setup reran, and nobody reruns it; 26 were missing on Caleb's Mac 2026-10-10, text-command among them. kit-autopull now links them.
metadata:
  type: feedback
---

setup.sh symlinks bin/ tools into ~/.local/bin, so fixes to existing tools land on pull, but a NEW tool gets no link until setup reruns. On 2026-10-10 Caleb's links dated from a 10/3 install: 26 tools setup links (gtme-reply, gtme-dedupe, gtme-signals, gtme-grade, text-command, ...) were on main and "command not found". kit-autopull had printed "run chewbacca setup" after every pull for weeks, and that message changed nothing.

**Why:** a reminder for a human is not a fix. Kyber runs text-command from ~/.local/bin, so a missing link is a broken feature, not a missing convenience.

**How to apply:**

- `tools/tools_link.py` reads setup.sh from origin/main, collects every name it passes to link_tool, and `apply` adds only the missing links. It never replaces or removes anything already there. kit-autopull runs it on every session start (since 2026-10-10).
- A new tool only needs its name in one of setup.sh's link_tool loops. `tests/test_tools_link.py` fails if setup links a name with no bin/ file behind it.
- When a skill tells the agent to run a tool, `chewbacca <tool>` works even without a link; bare `<tool>` needs the link.

Related: [[feedback_fix_the_product_not_your_machine]], [[project_chewbacca_installer_gutted_unresolved]], [[feedback_live_hooks_are_copies]].
