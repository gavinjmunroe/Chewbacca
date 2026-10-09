---
name: feedback-everything-is-part-of-chewbacca
description: Third-party CLIs (wacli, gws, slackcli) are engines Chewbacca drives; Caleb never types them or learns them
metadata:
  type: feedback
---

Caleb, 2026-10-08: "wacli shouldnt be its own thing it should j be part of chewbs", then "Ideally everything we do should j be part of chewbs, rmr how we removed plynn and j integrated it".

**Why:** a tool he has to know about, link and babysit separately is one more app, and that's the exact thing Chewbacca OS exists to remove ([[project_chewbacca_os]]). Plynn got retired because it ran as a second app with its own UI ([[project_chewbacca]], plynn/SALVAGE.md).

**How to apply:** wrap the engine in a `chewbacca <thing>` verb or a `people` command. setup.sh installs it and doctor checks it, and every user-facing message names the chewbacca command, never the engine. Keep an engine as an upstream binary when it tracks a moving target (wacli follows WhatsApp's protocol). Mine apps that bring their own UI for parts, Plynn-style, instead of running them (mail-0/zero, CB-521). Example: a private note.

Caleb, 2026-10-09: "everything we make should be in chewbs especially that lemma replica the team needs to be able to ball out". Builds now live in chewbacca `apps/<name>` (lemma-replica imported with history), run with `chewbacca apps run <name>`, and `/new-project` scaffolds there. A standalone repo only when he names one.
- Shared tooling the kit or team uses (ux-engine, presence, brain-retrieval, chewbacca-usecases) moved into apps/ on 2026-10-09 so every teammate has the same kit; `tests/same_experience.sh` refuses any hook/bin/setup path into ~/code/{tools,work,personal,amber,school,corpora,kits}. Kept out on purpose: deployed sites, client/org repos, coursework, personal repos, and comedy-engine (his texts).
