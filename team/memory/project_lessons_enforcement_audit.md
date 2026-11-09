---
name: project_lessons_enforcement_audit
description: chewbacca lessons counts which corrections a hook or test enforces; 26% on 10/10 and 10/11, 79 of 233 (34%) after the repeat-mistakes pass; first turn 149,809 tokens
metadata:
  type: project
---

`chewbacca lessons` (tools/lessons_audit.py, landed b90188f0 on 2026-10-10) reads every feedback_*.md correction in team memory and the private brain and buckets it: a registered hook refuses it, a test covers it, a hook names it but nothing registers that hook, or context only. Registration is read from setup.sh's `_register` lines plus config/settings/settings.json; the template alone named 15 of 61 hooks. `--context` prints the fix queue, `--shared-only` is safe to show a teammate.

Baseline 2026-10-10: 190 corrections, 49 enforced by code (40 hook, 9 test), 141 context only. 59 of 61 hooks registered, 54 cite a dated incident. Matching is by file name and slug, so it undercounts on purpose.

Built because Jake asked on 10/10 how much of the correction history is enforced by hooks and tests versus stored as context. His other point (shared memory costs context and usage) also measured true: one tab's first turn was 149,809 tokens before any work, about 12K of it the same rules loaded twice (~/.claude/rules plus the repo's .claude/rules), and a worktree nested in the checkout loads them a third time. Not fixed yet.

Same session, Caleb asked "What is taking so long?" then "Bro???" after a pause request, because a full suite run at load 109 and a land behind other tabs left 8 minutes of silence. When he says pause, reply first with where things stand, then land in the background, and skip the full suite when load is over 50.

2026-10-11, after "Why does the repeat mistake keep happening???": 231 on file, 60 enforced (26%), 171 context only. The 171 were ranked by how often he repeated them in 14 days of transcripts (docs/plans/REPEAT-MISTAKES.md) and the top 20 got code: lesson-guard.sh (foreground suites, headless blender, a blind new repo), reply-lessons.sh (u'll, study nudges, asking for his paper draft), handoff-check's permission-ask and handed-back patterns, kit-autopush gating on HEAD instead of the dirty tree, perl hook timers, read-only scope and app-window tests, MCP allow rules in setup. After: 79 of 233 (34%), 154 context only. One of the 20 (aura sites) is taste and stays context.

The loop was broken too. durable-guard had never fired in Claude Code (the Stop payload has no prompt) and its detector caught 14 of 141 real corrections. It now reads the transcript, catches 75 of 141, and requires code or `chewbacca lessons why "<reason>"`; `chewbacca lessons` prints the fortnight's outcomes.

**Why:** the "md is the moat" pitch to Jake only holds for the enforced share; the honest number is 26%.
**How to apply:** quote `chewbacca lessons` output, never "178 corrections enforced". Turning context-only lessons into hooks or tests raises the number Jake can sell. Related: [[feedback_enforce_dont_document]], [[project_chewbacca_growth_engineer_direction]], [[feedback_high_load_reads_as_bugs]].
