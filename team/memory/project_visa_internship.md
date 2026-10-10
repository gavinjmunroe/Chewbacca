---
name: project_visa_internship
description: Visa Internship (calebnewtonusc/visa-internship, private) is Chewbacca's dev half as one install, made 2026-10-09 for Sagar's hackathon
metadata:
  type: project
---

Visa Internship is a private repo with 21 dev skills and 7 coding standards from Chewbacca, plus HACKATHON.md, installed by one `install.sh` that symlinks the skills into `~/.claude/skills` and imports its CLAUDE.md. The name is an inside joke. It was built 2026-10-09 because Sagar didn't have time to set up full Chewbacca before his hackathon. Sagar (GitHub `sagartiw`) was invited with write access.

What's in it: debugging, reviewing-changes, deslop, shipping, graph-engineering, stack-rules, clone-site, webapp-testing, mcp-builder, create-cli, project-structure, github-deep-review, demo, and the iOS set (swiftui-*, swift-concurrency-expert, xcode-sync, native-app-performance, instruments-profiling). There's nothing personal and no Mac automation in it. The steipete skills are MIT, and the Anthropic ones are Apache 2.0.

One fix after the first push: `project-structure/map.ts` loaded `typescript` from the scanned repo, which runs that repo's code. It now loads only the skill's own copy, unless `PROJECT_STRUCTURE_TRUST_REPO=1` is set. When a dev skill changes in Chewbacca, copy it here too, or this repo goes stale. Related: [[project_chewbacca]].
