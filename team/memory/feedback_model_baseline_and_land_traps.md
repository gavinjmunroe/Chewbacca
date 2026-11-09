---
name: feedback_model_baseline_and_land_traps
description: "Traps hit building gtme next-move (2026-10-16): codex exec hangs on an open stdin and its review hook can replace its answer; claude -p shares the weekly limit; a cherry-pick land conflict goes through land --paths, then commit the local copies before merging main."
metadata:
  type: feedback
---

Hit on 2026-10-16 while building `gtme next-move`. Each one cost a retry.

- `codex exec` from a script waits forever when stdin is open. Pass `stdin=subprocess.DEVNULL` (or `< /dev/null`). Without it a one-line answer timed out at 300 s. With it, 17 s.
- Codex's own Stop hooks can replace its final message ("Work remains incomplete. Independent review has not cleared these changes."). When you need a machine-readable answer, write it with `-o FILE`, take the last line that matches the expected format, and retry once if nothing matches.
- `claude -p` draws on the same weekly limit as the session. All 5 baseline calls came back as "You've hit your weekly limit". Use codex for a model baseline, and never write an answer you didn't validate into a fixture.
- When `chewbacca land <sha>` says the cherry-pick is empty or doesn't apply (usually SHA256SUMS), `chewbacca land --paths <files> -m "<msg>"` lands the same content from a fresh main.
- `land --paths` leaves your local edits uncommitted. Commit them locally before the next `git merge origin/main`, or the merge refuses, and destructive-guard rightly blocks `git checkout --` on them.
- In-process `jev.evaluate()` used to need `"model"` in the payload. The CLI added it and Python callers didn't, so every call failed and next-move ranked on flat 0.5s. evaluate() defaults it now (tests/test_jev.py). Still print Jev's status next to any ranking, so a silent fallback shows up.
