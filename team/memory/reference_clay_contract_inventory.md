---
name: reference_clay_contract_inventory
description: library/clay-api/contracts.json lists every ts-rest contract in Clay's frontend bundle (1,772 on 2026-10-16) and which chewbacca clay ops call each; refresh it after a Clay deploy and the drift test names what moved
type: reference
---

`library/clay-api/contracts.json` is the map of Clay's frontend API. It holds every
ts-rest contract in the shipped bundle: name, method, path, query and body keys,
team, and `covered_by`, the `chewbacca clay` ops that already call it. Built by
`tools/clay_contracts.mjs`, which parses the chunks with acorn and never runs them.

On 2026-10-16 (clay_version v20261015_231758Z_05ad0bc21e): 1,772 contracts, 681
GETs, 57 covered. Landed f6ebd6b3.

How to use it:

- Before adding an op, look the endpoint up here. An empty `covered_by` means unmapped.
- After a Clay deploy: GET https://app.clay.com/, save every `assets/*.js` it names
  into an empty dir, run `node tools/clay_contracts.mjs <dir> <clay_version>`, then
  `python3 tests/test_chewbacca_clay.py`. `test_contract_inventory_covers_the_registry`
  names every op whose contract or path moved.
- Offsets are code points (Python indexing). acorn counts UTF-16 units, which
  drifted by 4 to 5 characters by offset 2,000,000 in app-3TgCQQBH.js.

What didn't work: REA's `analyze_javascript_application` parsed the 17 MB store
chunk but timed out at 300 s under load 29, and it has no ts-rest extractor.

Reads added from it the same day, all live on the Sabo workspace: column-status,
running-columns, run-credits, scheduled-runs, workflow-run-summary, workflow-cost,
audience-segment, signal-list.

Open bug: every worktree syncs its `clay.json` into one shared
`~/.chewbacca/api-anything/sites/clay.json` by mtime, so parallel tabs overwrite
each other's ops. Touch your `clay.json` right before a live check until it's fixed.
