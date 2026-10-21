# Amber, inside Chewbacca

Every Amber repo lives here so Chewbacca can use any Amber feature without
depending on an Amber repo. Karthik's ruling, 2026-10-20: Amber and Chewbacca
build the same things, so features move both ways with no credit exchanged.
Each folder is a plain copy of a repo's newest main, with no git history,
`.env` files or `node_modules`. The upstream column is only there for resyncing.

| Folder                  | Upstream                                    | Commit              |
| ----------------------- | ------------------------------------------- | ------------------- |
| `id/`                   | amberintelligence/amber-id                  | 9d29252, 2026-10-21 |
| `ios/`                  | amberintelligence/amber-ios                 | 023366d, 2026-10-19 |
| `website/`              | amberintelligence/amber-website             | 0c09041, 2026-10-21 |
| `sandbox/`              | amberintelligence/amber-sandbox (repo gone) | 51f4fca, 2026-09-01 |
| `circles/`              | calebnewtonusc/amber-circles                | 9631ec3, 2026-10-09 |
| `fridge/`               | calebnewtonusc/amber-fridge                 | a19fd05, 2026-10-08 |
| `outbound/`             | calebnewtonusc/amber-outbound               | 9b9e2c8, 2026-09-18 |
| `phone-call/`           | calebnewtonusc/amber-phone-call             | cb61618, 2026-05-27 |
| `caleb/`                | calebnewtonusc/amber-caleb                  | 25089a6, 2026-08-03 |
| `slack-mirror/`         | calebnewtonusc/medha-slack-mirror           | 1534de4, 2026-06-05 |
| `prometheus-targeting/` | calebnewtonusc/prometheus-targeting         | 0211a55, 2026-09-21 |

`amberintelligence/amber-search` (PeopleRank) is already at `togari/search/`,
current at d87e3bd, so it isn't copied twice.

What was changed or left out on purpose:

- Real phone numbers. Nine team cells sat in test fixtures and scripts, and
  people outside the Amber team can read this repo. Each became its own
  `555-010-XXXX` fake, so tests that compare two numbers still compare equal.
- `prometheus-targeting/lists/*.csv` keep only their header row. They held real
  investor names and emails for a client.
- `caleb/Newton/agent/extract-homework.py` reads `TODOIST_API_KEY` from the
  environment. The upstream file had the key inline.
- Branches. Only main came over. The `*-wip` repos (amber-id-wip,
  amber-ios-wip, amber-website-wip, amber-archive-wip) hold rescued unmerged
  branches and stay where they are.
- `amber-sandbox` no longer exists on GitHub. This copy is from the last
  `origin/main` fetched into `~/code/amber/amber-sandbox`.

To resync a folder, copy from the remote's main, never the local checkout:
`git -C <clone> fetch && git -C <clone> archive origin/main | tar -x -C amber/<folder>`,
then rerun the phone and secret checks before landing.

---

All glory to God! ✝️❤️
