---
name: project_chewbacca_usc_stack_wedge
description: Covering the whole USC stack (Brightspace, reg, classes, dining, fees, Handshake...) for any student is how Chewbacca gets USC students to pay
metadata:
  type: project
---

Caleb, 2026-10-10: "Making it cover the USC stack is a key way we're gonna get USC students to pay for chewbs when the time comes." Same day: "Chewb has to transform the life of EVERY usc student that uses it, fire enough that ppl are like holy shit id pay for that."

**Why:** Every campus tool covers one slice (Brightspace PLUS for grades, Gradescope, Ed, NotebookLM). None reads a student's own course files, deadlines and campus systems together and tells them what to do first. That combined read is what a student pays for.

**How to apply:** Every USC integration must work on a stranger's Mac with zero config: pick the Chrome profile by freshest cookies, read the student's own enrollments, nothing keyed to Caleb's ids or paths, never open a tab they didn't need. bin/brightspace is the model (fixed 2026-10-10, tests/brightspace.sh covers a second student). The demo moment is "I need to lock in on school" pulling every lecture file and what's due. Related: [[project_chewbacca_positioning]], [[feedback_signed_in_but_403_is_chrome]].

**Model cost and platforms (Caleb, 2026-10-10):** USC students get ChatGPT and Codex free through USC if they ask for it, so Codex is the zero-cost runtime for a USC student (Chewbacca already has a Codex adapter). Make the Codex path work as well as the Claude Code one, and show the "how to get free USC Codex" step during onboarding. Order: perfect Mac, then Windows; perfect Chrome, then other browsers.

**The fresh-Mac student path (2026-10-10, tests/usc_student_e2e.sh):** install links the real `chewbacca` over start.sh's stub (before this, every fresh install's `chewbacca usc`, `chewbacca api` and `chewbacca welcome` printed stub help), the welcome asks "Are you a student?" and detects USC from a Chrome profile's Brightspace cookies, then gives the free-Codex step (itservices.usc.edu/ai/chatgpt-edu-at-usc, Codex by ITS ticket) and runs `chewbacca usc lockin`: courses from their own enrollment, what's due first, ledger files seeded from the Brightspace calendar, every lecture file to ~/coursework/slides with `--apply`. Cookie reads fall back to /usr/bin/openssl because stock python3 has no `cryptography`, and brightspace-sync reads Chrome directly so no api engine is needed. App-bundled Codex (ChatGPT.app) now counts as an installed agent. The coursework assumed-done rule is opt-in; Caleb's semester.yml opts in.
