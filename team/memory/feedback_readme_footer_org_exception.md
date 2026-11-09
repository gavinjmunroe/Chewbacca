---
name: readme-footer-org-exception
description: 'The "All glory to God" README footer rule has an exception for shared-team repos. amber-organization/* (medha-*), togari org, and any amber/medha/togari repo must NOT include that footer. Personal repos still do.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

The mandatory "All glory to God! ✝️❤️" README footer (from `~/.claude/CLAUDE.md`) does NOT apply to repos under shared-team orgs:

- **`amber-organization/*`** (every medha-\* repo: medha-id, medha-platform, medha-frontend, medha-analytics, etc.)
- **togari org** (togari-platform, togari-imessage, togari-frontend, etc.)
- Any repo whose team includes non-Christians

**Why:** Those teammates didn't choose that sign. Including the footer in shared work pushes a faith expression onto people who haven't opted in. Personal sign of Caleb's faith is fine and good in his own work; on a shared codebase it's the wrong move.

**How to apply:**

- When creating or editing a README in `amber-organization/*` or `togari/*`: do NOT add the footer.
- When you see the footer in an existing README in those orgs: remove it.
- For personal repos under `calebnewtonusc/*` (the iPad portfolio, marrow, etc.): the footer STAYS per the global rule.

**Audit triggered 2026-05-XX:** Caleb asked to sweep amber-organization for any README with the footer and remove it. Going forward, never add it to a repo in those orgs.
