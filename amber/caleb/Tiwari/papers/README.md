# Tiwari Papers

Formal mathematical treatments of the three Tiwari primitives. Each paper
is the source of truth for its corresponding implementation: if code and
paper disagree, the paper wins and the code is wrong.

| Paper | Primitive | What it formalizes |
|---|---|---|
| `peoplerank.tex` | `Tiwari/tiwari-peoplerank/` | Six-channel personalized PageRank on the relationship graph, fused on the probability simplex via weighted geometric mean + entropy bonus. |
| `enrich.tex` | `Tiwari/tiwari-enrich/` | Dempster–Shafer evidence fusion across pipes with pipe-trust discounting. Proves that first-person check-ins dominate scraped records. |
| `opportunity.tex` | `Tiwari/tiwari-opportunity/` | Contextual bandit whose reward is dimensional balance, not engagement. Proves asymptotic uniformity across the six dimensions. |

## Why we write papers alongside code

Sagar's mandate is that these primitives be "studied like math problems
for dozens of years." Papers force two disciplines:

1. **The math has to be right.** A paper that doesn't close cannot be
   published, so the code cannot be shipped.
2. **The ideas outlive the implementation.** Languages and services
   will change. The formalism in LaTeX is the institutional memory.

## Build

From this directory:

```sh
pdflatex peoplerank.tex
pdflatex enrich.tex
pdflatex opportunity.tex
```

All three compile against a stock TeX Live install with `amsmath`,
`amssymb`, `amsthm`, `bm`, `geometry`, `hyperref`.

## Citation contract

Implementations reference equations by number. Do not renumber
equations without updating the code:

- `peoplerank.tex` Eq. 2, 3 (stationary-distribution fixpoint + fusion)
  → `Tiwari/tiwari-peoplerank/src/pagerank.js`
- `enrich.tex` § Dempster's Rule + § Pignistic Transform
  → `Tiwari/tiwari-enrich/src/ds.js`
- `opportunity.tex` Eq. 1, 2 (reward + LinUCB with diversity bonus)
  → `Tiwari/tiwari-opportunity/src/bandit.js`

See `amber-agent/docs/PERPLEXITY-AMBER.md` for the hemispheric
doctrine these primitives serve.
