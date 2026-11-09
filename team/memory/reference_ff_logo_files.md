---
name: reference_ff_logo_files
description: Where the current Firm Foundation logo lives and how to export it; the 10/9 "Firm Foundation AI Logo.png" in Downloads is stale
metadata:
  type: reference
---

The current Firm Foundation logo is the 10/18 mark Gavin picked: one course over two
F's set back to back, no cross, beside "Firm Foundation" in Figtree 600 with
"TECHNOLOGIES" in IBM Plex Mono 500 under it. Royal #2347d0 for the mark, ink #121a3a
for the name, paper #eeebe4 as the site ground.

Source of truth is `site/components/Wordmark.tsx` on firm-foundation origin/main
(`MARK` rects and the `PLAIN` path, `Lockup`), plus `site/app/icon.svg` for the favicon.
`site/public/brand/` and `research/brand/logo/svg/` still hold the 10/11 cornerstone and
stack files and are NOT the current logo.

Exported files from 2026-10-31 sit in `~/Downloads/Firm Foundation logo/` on Caleb's
Mac: full logo PNG (transparent, on paper, all white), the mark PNG, and SVGs. They were
built by reading the rects and path out of Wordmark.tsx and screenshotting inline SVG in
headless Chrome with Plex Mono loaded from Google Fonts. Re-export the same way if the
mark changes; never hand out `~/Downloads/Firm Foundation AI Logo.png` (2026-10-09), it
predates both redesigns.

Related: [[project_firm_foundation_site]], [[project_ff_team_page_2026_10_28]]
