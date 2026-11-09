---
name: project_chewbacca_welcome_onboarding
description: chewbacca welcome is the in-chat onboarding after install (five tappable questions that write a standing section into the person's brain); what it does, the rules it follows, and what is still not grandma-proof
metadata:
  type: project
---

`chewbacca welcome` (bin/chewbacca-welcome, skills/welcome, tests/welcome.sh) shipped 2026-10-10 after Caleb asked for onboarding that is "immaculate", "minimal clicks", and "my grandma should be able to use this".

What it does: start.sh's last step opens the agent on the welcome. Five questions, at most two per screen, clickable in Claude Code: name, goals (texts, appointments, writing, looking things up, or their own words), computer comfort, reply style, and the confirm-before-acting level. Every question can be skipped, and a skipped safety question means "always ask". The answers become a marked section at the top of YOU.md (or core/identity.md), which every session loads, so the next reply is already personalized. macOS permissions are asked only for the chosen goals (`chewbacca permissions guide --only` now takes a comma list).

Rules came from practitioner teardowns (Appcues on Headspace and Duolingo, RevenueCat on Noom, NN/g on older users). A daily check-in question was cut because nothing schedules one on a fresh Mac.

Same night: doctor stopped failing a personal install for git identity, gh, prettier and a brain folder with no git repo (tests/doctor_personal.sh). Those four red lines were the last thing a non-developer saw at the end of setup.

Still not grandma-proof, on purpose: installing needs a pasted Terminal command and the repo is private. Caleb's call, 2026-10-09: B2B first, so the repo install stays ([[project_chewbacca_refactor_waits_on_b2b_b2c]]). Permission cards follow [[feedback_onboarding_like_anarlog]].

Sixth question, 2026-10-10: "Are you a student?" (USC, another school, no) shares the safety screen. `detected.school` is `usc` when a Chrome profile has Brightspace cookies; a USC answer makes "I need to lock in on school" the first try, adds the free USC Codex line and a Keychain primer, and hands off to `chewbacca usc lockin`.
