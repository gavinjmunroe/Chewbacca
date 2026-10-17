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

Replayed on that day's transcripts, the hook alone refuses 5 of 15 false-done finishes and 2 of 21 clean ones. 8 of the 15 changed no code, which is open-work-guard's ground. Numbers and cases: tests/fixtures/break_it/REPLAY.md.
