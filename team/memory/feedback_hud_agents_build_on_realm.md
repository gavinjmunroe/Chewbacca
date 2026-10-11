---
name: feedback_hud_agents_build_on_realm
description: HUD agent work builds on Carlton's Realm engine inside the HUD, LLM and account agnostic; a parallel cockpit in kyber-sessions drew "TS lame" and "did you forget Carlton's repo"
metadata:
  type: feedback
---

On 2026-10-10 a tab built the HUD agent cockpit (start, stop, lanes, counts) on kyber-sessions, which only knows Claude Code transcripts. Caleb: "did you totally forget abt carlton's [realm] repo and refactoring that like he told us to?", "Make it LLM and Acct agnostic", "Realm is supposed to be inside the hud, as is everything we build", then of the redesigned panel: "TS lame".

**Why:** Realm (github.com/31Carlton7/realm, vendored at ~/code/vendor/realm, run headless by bin/realm-engine) already runs Claude plus every ACP agent (Cursor, Gemini, OpenCode, Copilot, goose, Qwen, Grok) through one adapter, imports Claude Code transcripts (apps/server/src/import/claude.ts), and has permissions, interrupt and fork. bin/lib/surfaces/agents.py is the Realm-backed surface. Building a second cockpit beside it duplicated work and stayed Claude-only.

**How to apply:** agent features on the glass go through realm_client and the agents surface, never a new parallel path. Read Realm's design.md before drawing anything. His order: core function first so no other app is needed, then make it epic; but even now it must not look one-dimensional, so stacked text rows with buttons do not pass. Related: [[project_chewbacca_os]].
