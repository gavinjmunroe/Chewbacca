---
name: feedback_attack_before_done
description: chewbacca break-it is step one of finishing: attack the change (real example, garbage input, second client, rerun on main) before saying done; the break-it Stop hook refuses a done claim over a change it can still break (Caleb, 2026-10-16)
metadata:
  type: feedback
---

chewbacca break-it attacks the current change and writes a receipt bound to HEAD. Its Stop hook, break-it-guard.sh, runs in Claude Code and through tools/codex_hooks.py in Codex.

Caleb, 2026-10-16, 4:47 to 4:49pm: "I need you to see when a session is complete, bc often times it is a false positive there's more stuff to do and things that were broken that were missed". "When they build something and say it's done, chewbs should attack it from every angle trying to break it before it concludes anything!!!!!!!!!". "Fix chewbs".

How to finish now: record attacks with `chewbacca break-it attack -m "<what>" -- <command>` (the real example, garbage input with `--expect fail`, a second client file), then `chewbacca break-it run --transcript <path>`. Fix what broke, name what stays open.

What it caught that green tests didn't, that day: next_move.py landed with 20 passing tests and crashed on `plan -` fed "not json" (2f97a007, fixed in 045cb4b5); a launch-guard fix passed its tests while ~/.claude/hooks still held the old copy; "Saved today's Sabo lessons" went out uncommitted.

Replayed on that day's transcripts, the hook alone refuses 7 of 15 false-done finishes and 2 of 20 clean ones; with open-work-guard, 10 of 15 and 2 of 20. A done claim whose own reply says its work is still landing or unchecked is refused even with no code change. Numbers and cases: tests/fixtures/break_it/REPLAY.md.

Installed live in Claude Code on 2026-10-17 at 10:44am, on Caleb's own yes in chat ("Yes, install break-it-guard into ~/.claude/hooks and register it in settings.json, only that hook"). A manager tab had relayed his 10/16 ask as the yes an hour earlier; that was not taken as one. What the install taught:

- An installed hook has to find its tool in the kit runtime. `~/.claude/hooks/break-it-guard.sh` first looked in ~/code/chewbacca, which was behind main with no tools/break_it.py, so it would have exited 0 on every turn. It reads `~/.chewbacca/kit/current/tools/break_it.py` first since 402c712b.
- A live check needs a throwaway worktree under ~/code. break-it skips /tmp as scratch, so the first check there passed for the wrong reason.
- Verified live: a done claim over an uncommitted file was refused (exit 2), and passed after a commit, one `break-it attack` and `break-it run`.
- Codex still loads its hooks from ~/code/chewbacca/tools/codex_hooks.py, so Codex runs this only once that checkout catches up to main.
- ready-guard reads any "we're good" as a Zeutara launch claim. Name the exact thing that's done, and say Zeutara's state with its last `gtme ready` result.
