---
name: oss-apps
description: "Find the open source version of a Mac app or proprietary product, and say whether its license lets you build on it and ship. Use when someone asks for an open source alternative to Notion, Figma, Bartender, Photoshop or any app, wants a free or self-hosted replacement, asks what open source Mac apps exist in a category, wants a repo to fork or remix into a new app, or asks whether a project's license is MIT, GPL or AGPL before reusing code."
license: MIT
requires: [oss-apps]
---

# Open source apps, and which ones you can remix

```bash
oss-apps replaces Notion                 # what replaces a proprietary app
oss-apps replaces Figma --remixable      # only the ones you can build on and ship
oss-apps search "menu bar"               # name, description, category, stack
oss-apps category "Window Management"    # one category; no argument lists them all
oss-apps remixable --stack tauri         # permissive licenses, filtered by stack
oss-apps show toeverything/AFFiNE        # one entry in full, with license notes
oss-apps stats                           # counts, sources, what could not be fetched
```

Add `--json` to any of them for an agent, and `--limit 0` for every row.

The data is `config/data/oss-apps/apps.json`, about 1,465 repos merged from
serhii-londar/open-source-mac-os-apps and OpenAlternative's
open-source-alternatives list, plus `config/data/oss-apps/curated.json`. Each entry has
the repo, categories, the proprietary apps it replaces, a stack (Swift, Electron,
Tauri, Flutter, Qt, Web), the license, stars and last push.

## Answer the license question before suggesting a fork

`remixable` is the field that matters when the plan is to build a new app on top
of an existing one. It is true only for a permissive license GitHub detected
itself (MIT, Apache-2.0, BSD, ISC and similar). A second field,
`remixable_with_caveat`, covers MPL-2.0 (edited MPL files stay MPL) and the
open-core repos a person read and recorded in `curated.json`.
`--remixable --with-caveats` lists both and prints each caveat. These four
groups are always false on both fields:

- **AGPL and GPL.** Shipping a derivative means shipping its source under the
  same license. AGPL extends that to anyone using it over a network.
- **No license.** All rights reserved by default. Public on GitHub is not a grant.
- **NOASSERTION.** GitHub could not classify the file. `license_guess` holds a
  title match and is a guess: Zed's root file reads as Apache-2.0 while the
  editor is GPL-3.0. Read the LICENSE, then record the verdict in `curated.json`.
- **Source-available** licenses: BUSL, Elastic, SSPL, FSL, PolyForm, Sustainable Use.

Say which bucket an app is in, in one line, whenever you recommend it as a base.
An AGPL app is still fine to study, to run, or to use as a reference for a fresh
implementation.

**Open core is permissive with holes.** AFFiNE, Stirling-PDF and Medusa are MIT
except for named directories under commercial licenses, so they are
`remixable_with_caveat`, never plain `remixable`. `open_core: true` and
`remix_caveat` name the directories. Do not copy from them.

`remixable` reads the root LICENSE only. It says nothing about trademarks, names
or icons: a remix ships under its own name and art.

## What the replaces field is and is not

Most mappings come from OpenAlternative, which lists the proprietary products
each tool is an alternative to. Mac utilities neither catalog maps (Rectangle to
Magnet, Ice to Bartender, Maccy to Paste) come from `curated.json`. About half
the entries, mostly Mac-only utilities, have no mapping, so an empty `replaces`
result is a reason to run `oss-apps search` with the category word next.

## Refreshing

```bash
oss-apps build             # refetch READMEs and GitHub facts, reuse cached tool pages
python3 tools/oss_apps_build.py --refresh   # refetch all 816 OpenAlternative pages too
```

The build writes nothing and exits non-zero when GitHub returns an empty batch,
when far more repos go missing than last time, when a curated license no longer
matches what GitHub reports, or when run with `--no-github` against the real file.

A new hand-read license or a missing mapping goes in `curated.json`, never in
`apps.json`, which the build overwrites. Rebuild after editing it and run
`bash tests/run.sh oss-apps`.
