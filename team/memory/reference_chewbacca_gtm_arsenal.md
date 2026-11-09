---
name: reference_chewbacca_gtm_arsenal
description: "Where Chewbacca's GTM tooling lives after the 2026-10-09 scavenge: repo atlas, 5 pinned skill packs, gtme-dedupe, gtme-signals formd, mined playbook rules."
metadata:
  node_type: memory
  type: reference
  originSessionId: da9a11df-9b73-46ea-a2cc-614a19fb54b0
  modified: 2026-10-09T09:00:25.795Z
---

Chewbacca's GTM arsenal, built 2026-10-09 when Caleb asked to make it "a gtme monster". Part of [[project_chewbacca_growth_engineer_direction]].

- Repo atlas: `skills/gtm-engineering/references/REPO-ATLAS.md` + `repo-atlas.json`, 705 GitHub repos verified via GraphQL, 18 start-here picks at the top.
- Skill packs linked from `~/Projects/<pack>` and pinned to vetted commits in setup.sh (tools/inventory.py PACKS): coldoutboundskills (26), explorium-gtm-skills (8), unify-agent-plugins (5), goose-skills (6), typesafe-skills (1). Anything that buys inboxes, starts sending, spends third-party credits or writes a CRM stays unlinked.
- Instantly's skill was linked then removed: its description claims every outbound task and would route Clay/Zeutara work to a tool we don't use. ColdIQ and Amplemarket have no license: cite only.
- `gtme-dedupe` (splink 5.0.0 in its own uv venv): scan-only unless `--out`, weights hand-set and unmeasured.
- `gtme-signals formd`: SEC Form D raises, funds and amendments dropped by default. A filing is a signal, not proof of buying.
- `demand-gen-playbooks.md` gained ~100 sourced rules, 41 ColdIQ triggers and a five-gate pre-send grading section.
- launch-guard false-positives on words like "launch", "enroll", "activate" in any Bash text; doc edits go through the Edit tool.
- Added 2026-10-09/10, all on main: `chewbacca clay` (26 reads + 16 writes derived from Clay's frontend bundle; every write needs a person typing the op name at /dev/tty, frozen request, START always refused), `chewbacca gtm` (local graph of sends, replies, meetings via gws Google Calendar, booking signals; `gtm suppress` lists every never-again address with a reason), `chewbacca gtm-memory` (Amber-grade store: identity, client walls, sourced facts, timeline, decaying scores, overdue commitments, Clay column history, credit ledger; design in docs/GTM-MEMORY.md), `chewbacca gtme` (start/setup/brief/next/report/explain, beginner-first, cites WALKTHROUGHS), `gtme-grade` (five playbook gates, signed campaign-bound receipts; add-leads checks one in code), `gtme-interview` (33 cases, ~8 ms), `clay-go`/`clay-map` (382 screens, 5,831 elements, routes by URL; our share of a hop under 13 ms), and library/learning/clay-navigation/WALKTHROUGHS.md (132 sourced procedures from Clay University).
- Not done when paused 2026-10-10: the new allowlist launch-guard is on main but NOT installed to ~/.claude/hooks (it would block the Zeutara tab's clay-named scripts until they're allowlisted); 466 Clay YouTube videos await whisper (CHW-200); the gtme follow-ups (bounce/unsubscribe via gtme_reply, real reply ids, refill rule, `gtm sync --json`, add-leads campaign=, `gtme rule`, per-offer report split, client-text rules) were in progress on a worktree branch.
- BMA funnel (2026-10-09): `skills/gtm-engineering/references/bma/` holds self-contained scoring, vendor recipes, Clay playbook, outbound rules, reply handling and BMA offer/proof distilled from the four bluemodernadvisory repos; `gtme-reply` ports Togari's reply classifier, cleaner and auto-send bar (753/757 parity with the TypeScript). No BMA credit lines, per Caleb (Maggie ok). Fixtures are anonymized: never copy real client replies into tests.
- Own-inbox path, 2026-10-11 (Caleb: "a gtme any average joe can pay for to do all their gtme for them on their device"): `tools/gtme_solo.py` behind `chewbacca gtme sender/find/batch/send/inbox/reply/today`, landed e12e5b55 and hardened 742436d0. No Clay and no extra inboxes: emails come only from each company's own site, each day's emails freeze into a batch whose id is a hash of the text, send runs only that id within 2 hours, never twice and never past the day's cap (5 a day rising to 20, because it's their primary inbox), follow-ups thread under the first email, opt-outs and bounces are suppressed, any reply stops follow-ups, positive replies become Gmail drafts. Fetches connect only to the vetted public address. Not built yet: billing, Outlook, separate sending domains for volume, and a first real customer run.
