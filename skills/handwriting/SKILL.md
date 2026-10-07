---
name: handwriting
description: Make handwriting that a person would believe a hand wrote, on paper that looks like paper. Use for any handwritten note, list, letter, signature, label, kid's drawing, sticky note, postcard, polaroid caption, whiteboard or annotation drawn into an image, a website, a render or a prop. Also fires on: handwritten, handwriting, hand-lettered, written note, scribble, signature, sticky note, notebook page, looks like a font, too perfect, fake handwriting, paper texture.
---

# Handwriting

The standards are [references/standard.md](references/standard.md) for the
writing and [references/surface-standard.md](references/surface-standard.md)
for what it is written on, both Caleb's specs, pasted 2026-10-07. Paper on a
fridge or desk is a physical object with thickness, curl and contact shadows,
so render it in the 3D scene (see the nalana skill) rather than floating a flat
image over a render. Read it before drawing anything. Its first rule is the one
everything else hangs on: **never render text as a handwriting font.**

## The tool on this Mac

`scripts/handwrite.py` draws ink as pen strokes with tool and surface physics.
`scripts/paper.py` makes the sheet from real CC0 paper scans.

```python
import sys; sys.path.insert(0, "~/code/chewbacca/skills/handwriting/scripts")
import handwrite as hw
from paper import sheet

page = sheet(900, 1180, (250, 248, 240), crumple=0.45, fold=0.47)
boxes = hw.write_learned(page, ["None of us have a good", "place to remember our"],
                         x=130, baselines=[243, 315], style=3, bias=0.85,
                         tool="ballpoint", color=(30, 38, 92), size=16,
                         surface="notebook", max_width=700, seed=11)
hw.loop(page, boxes[1], hw.Writer("someone-else"), "ballpoint", (190, 36, 40))
```

`write_learned` gets human pen trajectories from Alex Graves' handwriting
model, trained on the IAM On-Line database. It runs in its own environment at
`~/code/refs/handwriting-synthesis-tf2` (Python 3.11, TensorFlow 2.15, with
`tf.cond` and `tf.while_loop` patched in `handwriting_synthesis/rnn/operations.py`).
If that folder is missing, clone `otuva/handwriting-synthesis`, copy styles
1 to 12 from `sjvasquez/handwriting-synthesis/styles` into `model/style`, make
the venv, and apply the same patch. Results are cached per text, style, bias
and seed in `scripts/.stroke-cache.json`.

- `style` 0 to 12 picks the writer. One note, one style.
- `bias` 0.75 to 0.9 keeps every word legible. Below 0.6 it invents words.
- Tools: ballpoint, gel, fineliner, pencil, mechanical-pencil, sharpie,
  marker, crayon. Surfaces: notebook, printer, sticky, card, glossy, matte,
  napkin, cardboard.
- It returns where each line landed. Draw strike-throughs and circles from
  those boxes, never from a guessed width.

`hw.write` (the Hershey stroke path) still exists for shapes the model cannot
write, but it is a font skeleton and reads as one. Prefer `write_learned`.

## What went wrong on the way, so it does not again

All on the Amber fridge, 2026-10-06 to 07. Each line is something Caleb caught.

1. A handwriting font set straight onto paper. "Too perfect bruh."
2. The same font with per-letter jitter. "Now it's too messy."
3. Text floated through the ruled lines, and he said "ppl generally make
   text that fit between the lines", so baselines now sit on the rule.
4. Every surface got the same ink until he said "Make sure pencil and pen
   look like pencil and pen", because the tool and the surface each change
   the mark.
5. A Hershey stroke font with wobble still looked wrong ("This looks ai idk
   why") because its bones are Futura, with compass ovals, ruler stems and
   textbook a's, and wobble cannot fix wrong bones. Learned trajectories
   fixed it.
6. The paper was one cream colour with static on it, which he called
   "completely monotone and flat, no texture, it doesn't look like real
   paper". It now uses scanned fibre with mottling, a fold and worn edges.
7. The model writes the wrong word at low bias ("21 year of content",
   "a acphi", a 5 that came out as a J). **Read every word back before
   keeping a seed.** Spell numbers out when a digit keeps failing.

## Before keeping anything

Run the standard's final quality gate, then these, on a zoomed crop:

- Every word reads as the requested text.
- Nothing runs off the paper (`max_width`).
- The ink matches its tool on its surface at 4x zoom.
- The paper has fibre, unevenness and a lit surface, not one colour.
- Text drawn into an image is still copy: run the strings through
  `slop-check --stdin` first.
