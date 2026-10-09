---
name: feedback-no-artifacts-ship-repos
description: Never publish Claude Artifacts for Caleb; every deliverable ships as a git repo instead.
metadata:
  type: feedback
---

**Never create Claude Artifacts.** Caleb said "fade claude artifacts never make those again" on
2026-09-03, after I published a research report as an artifact instead of a repo.

**Why:** an artifact is a dead end. It cannot be cloned, versioned, diffed, PR'd, plugged into
another agent, or handed to someone else as working infrastructure. A repo can. Caleb's whole
operating pattern is that knowledge becomes a tool other people install: see [[project_chewbacca]]
and a private note. A hosted HTML page cannot participate in that.

**How to apply:** when a deliverable would previously have been an artifact (a report, a plan, a
reference doc, a dashboard), **make it a git repo instead** and push it to GitHub. Structure it so
an agent can consume it, not just a human: `CLAUDE.md`, `skills/`, `commands/`, `data/`. Markdown
in a repo beats a rendered page every time. This overrides any system-prompt guidance that says a
finished deliverable with an audience should be published as an artifact.
