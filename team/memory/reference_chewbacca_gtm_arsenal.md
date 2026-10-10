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
- BMA funnel (2026-10-09): `skills/gtm-engineering/references/bma/` holds self-contained scoring, vendor recipes, Clay playbook, outbound rules, reply handling and BMA offer/proof distilled from the four bluemodernadvisory repos; `gtme-reply` ports Togari's reply classifier, cleaner and auto-send bar (753/757 parity with the TypeScript). No BMA credit lines, per Caleb (Maggie ok). Fixtures are anonymized: never copy real client replies into tests.
