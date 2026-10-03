# Upstream

- Source: https://github.com/cathrynlavery/diagram-design (MIT, `LICENSE` here is theirs)
- Pinned: `f903933a534ba92cde1c85a28186267b3a317bb2` (2026-10-01, plugin 2.6.51)
- Vendored: 2026-10-03, from a shallow clone, no install step run

## Kept

- `skills/diagram-design/references/`, 57 of 60 files
- `skills/diagram-design/scripts/`: `self_check.py`, `export_svg.py`,
  `mermaid_extract.py`, `drawio_extract.py`, `excalidraw_extract.py`. All stdlib,
  no network calls, no subprocess.
- `scripts/verify-geometry.py` from the repo root, which the installed upstream
  skill does not ship. `ASSET_DIR` now points at `assets/` beside it.
- `skills/diagram-design/assets/`: the light, dark, terminal and motion templates,
  the light and dark examples, the import examples and `icons.html`.

`SKILL.md` is rewritten, not copied.

## Left out, and why

| Left out | Why |
|---|---|
| `references/onboarding.md` and the first-run style-guide gate | It rewrites the skill's own `style-guide.md` from a URL. Here that file is shared by every project in the checkout. |
| `references/profiles.md`, the `.diagram-design` marker | Writes to `~/.diagram-design/profiles/` outside the repo. |
| `references/doctor.md` | Diagnoses the plugin layout (`commands/`, `prompts/`), which is not vendored. |
| Marketplace plugin files and the "enable auto-update" advice | Upstream took 34 commits between 2026-09-15 and 2026-09-28 with a version bump bot. Auto-update means unreviewed prompt changes at startup. Re-vendor by hand. |
| `assets/template-full.html`, every `example-*-full.html`, `assets/index.html` | The full-editorial page is the stance Caleb called AI slop on 2026-09-27. `index.html` is a gallery linking to those pages. |
| Repo CI, linters, `verify-*.py` other than geometry | Maintainer tooling for upstream's own examples. |

Edits inside kept references: lines pointing at removed `-full` examples were
deleted, upstream slash commands (`/diagram-design:*`) were removed, the
customization section of `style-guide.md` was rewritten to forbid editing the
shared file, and skill paths now read `skills/diagram/`.

## Re-vendoring

Clone at the new SHA, diff `skills/diagram-design/` and `scripts/verify-geometry.py`
against this folder, reapply the edits above, rerun `tests/geometry.sh`, and
update the SHA here and in `SKILL.md`.
