---
name: feedback_guard_where_it_leaves
description: "A check a tool can make about itself lives in that tool or at the boundary where harm leaves, not in a guard reading every shell command; first move (suite-gate, 10/13) refused the same 4 real repeats and none of 22 misreads"
metadata:
  type: feedback
---

Before writing a PreToolUse guard that reads Bash text, ask where the harm
actually happens. If it happens inside a tool the kit owns (tests/run.sh, a
`chewbacca` front door, a sink that calls the send policy), put the check in
that tool. It then runs only when the thing really happens, from any shell,
script, job or agent runtime, and it never has to guess from command text.

Evidence, 2026-10-13 (Daniel's "guard where things leave", which Caleb liked
at 8:36am). suite-rerun-guard read every Bash call naming tests/run.sh: 689
runs at 281 ms in 32 hours, and over 7 days 26 refusals, of which 4 were real
repeat suite runs and 22 were grep, awk, sed, heredoc patches and pgrep loops
that only named the file. Moving it into run.sh (bin/lib/suite-gate.sh, landed
9cc22574) refuses the same 4, none of the 22, and adds runs started by
scripts and `chewbacca jobs`. Hook CPU on a command naming run.sh went 0.124 s
to 0.009 s for the dispatch.

**Why:** a shell-text guard is a parser, and every parser of shell has holes
in both directions (feedback_guard_precise_path_never_judges_less). The tool
itself has no parse to get wrong.
**How to apply:** a strangler move needs a 7-day replay showing the new gate
refuses every real harm the old guard caught (hookd_replay.py tool_events over
the week, real vs text-only refusals side by side), and the new gate may only
add cases. When the boundary is a third-party CLI (slackcli, gh, vercel, open),
the kit doesn't own it yet: keep the guard, and the long fix is owning the
boundary (the credential lives only in the kit's sink). Inventory and the
proposed boundary set: ~/.chewbacca/overnight/d1013/REPORT-boundary-guards.md.
Related: [[feedback_fix_the_core_not_a_guard]], [[feedback_guard_precise_path_never_judges_less]].
