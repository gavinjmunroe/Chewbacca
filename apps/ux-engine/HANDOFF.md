# Handoff, 2026-09-23

State of the math/perception layer, written for whoever picks this up next
(Codex). Everything below was run, not planned. Numbers are measured.

## What changed today, and why

The kit had a rich PER-ELEMENT sense and no whole-page sense. `ux-crawl`
measured 260 elements across 1,885 frames and could not tell that a numeral
was sitting on a paragraph, because nothing was wrong with either element.

Six tools now cover the gap. All are in `bin/`, all runnable standalone.

| tool | answers | key idea |
| --- | --- | --- |
| `ux-eye` | what does the RENDERED page look like | background purity behind text, box collision, edge-energy centroid, squint test |
| `ux-modes` | what does the page DO across scroll | fit `a + b*y`, decompose the residual, effective rank |
| `ux-derive` | is every number DERIVABLE | lattice `k*baseline`, scale `base*r^n` |
| `ux-morph` | how do shapes become other shapes | Hungarian assignment + Procrustes via SVD |
| `ux-place` | where do plates GO | composition as energy minimisation |
| `design-gate` | may this ship | exits 2 on broken, verified |

## Run them

```
./bin/ux-crawl <url> --states film --out lenses/<name>   # film first
./bin/ux-modes lenses/<name> [lenses/<other>]            # compare two
./bin/ux-eye <url> --out eye --shots 8
./bin/ux-derive <url>
./bin/ux-morph --n 260 --seq scatter,phyllotaxis,lens,ring,grid --out morph.json
./bin/ux-place --starts 30 --out place.json
./bin/design-gate <url> --shots 8 ; echo $?                # 2 = refused
```

`design-gate` exit code was checked directly, NOT through a pipe. `| head`
eats `$?` on this machine and `timeout` does not exist here at all, so a
command wrapped in it returns instantly with a fake 0.

## Measured numbers worth keeping

- Reference page: 186 pinned, 42 parallax at **7 distinct rates** (0.106 to
  0.932), residual **effective rank 2.39**. 17,000px and 774 perceptible
  channels resolve to about 2.5 degrees of freedom.
- The study build: 0 pinned, 23 parallax at **1** rate, rank **1.01**, and
  **253 of 253** moving pairs correlating above 0.98. Every element moves
  identically. That was the falsifier passing.
- Optimal point pairing saves **73 to 84%** of travel versus pairing by index.
- Study build derivability: 8px baseline at **56%** compliance, 50 off-lattice
  spacing uses, **7 of 9** distinct type sizes off-scale against a 1.333 ratio.

## Traps already paid for. Do not re-learn these.

1. **Coordinate frame inverts the result.** Viewport `top` makes STATIC
   elements appear to move at scroll rate: rank 1.34 with the top mode at 93%,
   and the mode was scrolling. Document coords then gave 1.08, because a
   pinned element genuinely travels with the document. There are TWO nulls,
   rate 0 and rate 1; removing one reports the other as design. Fit `a + b*y`.
2. **Units decide the SVD.** Position runs to hundreds of px, opacity 0 to 1.
   Unnormalised, position swamps everything and opacity looks irrelevant.
   Divide by just-noticeable-difference first.
3. **Coverage picks the trivial divisor.** Any unit u makes every multiple of u
   fit, so `ux-derive` first returned a 2px baseline at 98%. Floor at 4px and
   discount by median quotient.
4. **Optimising relocates taste, it does not remove it.** `ux-place`'s first
   solve converged perfectly to spacing cv 0.000, a perfect lattice, which is
   the catalogue the term existed to prevent. The solver was right and the
   objective was wrong. Check objectives against a measured reference.

## Not verified. Treat as unproven.

- **`pinned_and_clipped` in `ux-eye` has never fired.** It is committed as
  unproven. Make it refuse a synthetic clipped-pinned headline on purpose
  before trusting it.
- The Lipschitz spike `ux-modes` reports at y=288 (20,706 JND/px) is probably
  an artifact of interpolating across mount/unmount gaps, not a real jump.
- `lemma-replica` still has an INTRA-scene collision at y=5216 (`text.code`
  over `p.giant`, 91%). The partition-of-unity fix addressed scene-vs-scene
  only.

## Next task, named by Caleb and NOT started

Upgrade the ingestion layer to see two things it currently cannot:

1. **Modulated loops.** A repeating animation whose parameters change with
   scroll. The current motion classifier (SPAWN / CONSTANT / SCROLL-LINKED /
   STATE-SWAP / STATIC) is SINGLE-LABEL, and this is a compound: CONSTANT x
   SCROLL-LINKED. Fix is spectral: FFT each channel, and a channel with both a
   strong non-zero-frequency peak AND a scroll-varying envelope of that peak is
   a modulated loop. Separating carrier from envelope is the whole job.
2. **Accent colour as a signal.** Colour is captured as strings and never
   analysed. Convert to Lab/LCh and detect rare-hue events: a hue with high
   chroma appearing where the rest of the page is near-neutral is "flavour",
   and it is detectable as a distribution outlier.
3. **"Holy shit" formalised as surprise.** Notability is rarity. With a corpus
   of 74 design systems, `-log P(technique)` is an honest estimate of how
   unusual a technique is. Common technique, low score; used by 1 of 74, high.

## Repos touched

- `ux-engine` (this repo): commits `6d00d06`, `0e7513d`, `626c570`, plus this file.
- `lemma-replica`: the study build. Presence fix `f13a85d`. **No git remote yet.**
- `second-brain`: `041b80a1`, three memory notes plus index and archive moves.
