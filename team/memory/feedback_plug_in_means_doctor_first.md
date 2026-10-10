---
name: feedback_plug_in_means_doctor_first
description: "Plug into Chewbacca" means run chewbacca doctor and chewbacca skills search before building; on 9/27 jev was never linked, so it could never fire.
metadata:
  type: feedback
---

On 2026-09-27, mid Origin Weekend build, Caleb said "plug tf into chewbacca" four
times, then "fix chewbacca so you're never not plugged in and that the
hooks/gates are ALWAYS intact."

What was actually disconnected, found by `chewbacca doctor`, not guessed:
`jev`, `jev-browse` and `gtm-engineering` existed in the repo and were never
linked into `~/.claude/skills`, so Jev could never fire no matter how often he
asked for it. The prayer opener was prose in CLAUDE.md with no gate, and it
decayed ("UR NOT PRAYIN" twice). Fixed: skills linked, and `prayer-guard.sh`
(Chewbacca 4f02d63) refuses a reply whose opening lacks "Amen", inert unless
`~/.chewbacca/opener-marker` exists.

The other half was behaviour: I kept answering skill-router suggestions with
"doesn't fit" and researching from scratch while Chewbacca already had the
answer (docs/reference/VOICE-DESIGN.md for voice UX, bin/people for Amber's memory model,
ux-engine systems/vercel for the v0 look).

**Why:** a capability that is not wired never runs (a private note),
and a rule that depends on remembering decays ([[feedback_enforce_dont_document]]).

**How to apply:** at the start of any build, run `chewbacca doctor` and fix what
it flags, then `chewbacca skills search <topic>` for each part of the job and
read what it returns before inventing anything. Treat a router suggestion as
the default, and skip it only with a one-line reason.

**Codex update 2026-10-01 (Caleb):** Keep Chewbacca connected across sessions through shared skills, private context, and supported tools. Caleb explicitly authorized targeted lifecycle-hook repair and live verification on 2026-10-01. This supersedes the earlier prohibition on starting repairs, but is not evidence that hooks work. Preserve the selected model/runtime, permissions, unrelated plugins, and independent authorization for publication. Do not copy Claude hook health claims into Codex verification.

**Repair evidence 2026-10-01:** Five Codex lifecycle definitions restored and
trusted via native hooks/list plus config/batchWrite. Fresh native CLI sessions
ran all five events, allowed a local printf, rejected a harmless curl --version
probe with submission-shaped arguments before execution, and matched native
structured exit codes (0 then 1) to the correct calls. The MCP whats_due call also
succeeded in the desktop task. Ordinary-status correction false positives,
shell-edit self-verification, Stop prompt provenance, and hidden hook failures
were repaired. Per-event audit files live in ~/.codex/chewbacca-hook-events.
The existing desktop task's reload is unverified (computer-use denies access to
Codex). Ephemeral native hook payloads lack a transcript and exit code, so their
success status remains unknown. No clean original-checkout closeout or retained
learning is claimed; no publication was performed. See the 2026-10-01 task's
outputs/hook-repair.md for the scoped evidence and validation.
