---
name: project_amber_dev_recruit_one_pager
description: "Dope Amber Tech stuff" PDF, a one-page pitch to Caleb's dev friends on Amber's data model and PeopleRank; NOT yet cleared with Sagar/Karthik, no role or comp in it.
metadata:
  type: project
---

Built 2026-10-01. A one-page PDF at `~/Desktop/Dope Amber Tech stuff.pdf` pitching Amber's tech to Caleb's
developer friends so they want to join. Source HTML is `projects/amber/dope-amber-tech-stuff.html`
(re-render with headless Chrome `--print-to-pdf`, Letter, one page).

Content is grounded in amber-id main as of 2026-09-29 and amber-search main as of 2026-08-25: one Cloud SQL
Postgres DB, the `observations` table with modality, the composite `(owner_id, id)` FK tenant isolation, the
per-hop network visibility, and the three-stage PeopleRank (Haiku filter, embedding math at 0.85 relevance +
0.15 warmth with fact decay, Sonnet answer). It pitches four unbuilt problems: personalized PageRank, the
~6s / 967-contact retrieval (pgvector plan, marked interim), entity resolution, and voice to people.

**Why:** the pitch is built on Sagar's doctrine that you can't sell engineers a feeling, so it shows the open
problems openly.

**How to apply:** nothing shows that Amber is hiring or that Caleb is cleared to recruit, so it's unsent
until Sagar and Karthik say yes. Role, comp and the fundraise are deliberately left out. Don't add them
without a source. See a private note, [[project_amber_circles_architecture]],
a private note.
