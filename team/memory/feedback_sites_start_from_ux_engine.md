---
name: feedback_sites_start_from_ux_engine
description: Every landing page or site starts from ux-pick, the house stack (Next.js + motion + lenis) and site-gate research, never a hand-rolled Tailwind CDN HTML file; site-stack-gate.sh refuses the write
metadata:
  type: feedback
---

A landing page or site is started with `apps/ux-engine/bin/ux-pick "<brief>"`, scaffolded on the house stack (Next.js + `motion` + `lenis`, as in TTS-Dev's `package.json`), and researched with `site-gate research`. It is never a hand-written HTML file on `cdn.tailwindcss.com`. On 2026-10-27 the Kyber landing page for an ACAD 185 team went out as `public/index.html` on the Tailwind CDN with an eyebrow over every heading, 3-card grids, tick lists and a CSS phone mock, and none of the three steps ran. Caleb: "Bro it looks so ai slop html/css", "Don't we literally have a UX engine?", "Fix chewbs to never do that again".

**Why:** loading the interface skill (interface-first.sh) did not stop a CDN page; the UX engine and the stack are where the taste lives, so skipping them produces the generic page every time.

**How to apply:** `.claude/hooks/site-stack-gate.sh` denies (permission decision, exit 0, no red error) a Write of a 150+ line .html site page (an index/home/landing file on the Tailwind CDN or with a nav and footer, or any page with a nav, a footer and 3+ sections) until ux-pick or ux-gen ran this session and the repo has the stack or `research/INDEX.md`. Utility pages like `taste.html` or a vote page pass. A phone mock of iMessage must look like real iOS (Dynamic Island, real status bar, nav header w avatars and FaceTime icon, tailed bubbles, Delivered, app extension card, compose bar w + and mic, home indicator); see skills/interface/SKILL.md. Tests: tests/site_stack_gate.sh and tests/test_site_stack_gate_replay.py (10 real pages, the CDN taste vote must pass).
