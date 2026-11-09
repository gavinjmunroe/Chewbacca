---
name: handwriting
description: "Handwriting a person would believe a hand wrote, on real-looking paper: notes, letters, signatures, sticky notes, labels, annotations in an image, site or render. Use when it looks like a font."
triggers: >-
  Make handwriting that a person would believe a hand wrote, on paper that looks like paper. Use for any handwritten note, list, letter, signature, label, kid's drawing, sticky note, postcard, polaroid caption, whiteboard or annotation drawn into an image, a website, a render or a prop. Also fires on: handwritten, handwriting, hand-lettered, written note, scribble, signature, sticky note, notebook page, looks like a font, too perfect, fake handwriting, paper texture.
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

8. A Sharpie with a soft grey ring around it reads as a drop shadow, so the
   label looks like it floats ("I think it's the sharpie looking like it's
   floating"). Felt tip keeps a firm edge, wicks out only as fibre hairs on
   porous stock, and lets the surface show through its dye. Ink also has to
   follow the surface's creases and light (`follow=`), or it sits on top.

9. **Building textures before reading this skill.** On 2026-10-23 a desk
   render for Patrick Kellogg's site put his apple list, postcards and a
   cassette label in Bradley Hand and Noteworthy on PIL-noise paper, rule 1
   broken again, because the textures were written in a scene script before
   anyone opened this file. Caleb: "Always rmr what we learned abt
   handwriting, making it look realistic, and making the writing surface
   look realistic and the combination of the 2 to look realistic". So any
   texture script that puts writing on a surface imports `handwrite` and
   `paper.sheet` from here at the top, and a font is only for print (a
   business card, a postcard's "POST CARD").

## Writing, surface and the two together, in a 3D render

Hand and paper can each pass on their own and still read fake once they're
in a scene. What the desk and fridge renders taught:

- The writing: learned strokes (`write_learned`), one writer per object,
  baselines on the printed rules, the right tool for the object (ballpoint on
  an index card, fineliner on a postcard, Sharpie on a cassette label).
- The surface: a scanned sheet (`sheet`), never one colour plus noise. In the
  scene it's a mesh with thickness (Solidify, about 0.4 mm), a slight bow,
  and contact shadow on what it lies on.
- The combination: ink takes the surface's light, so it goes into the
  texture before the render and never on top of the finished frame. Watch
  exposure, because a first render at default exposure blew the paper out
  and washed the ink to grey. Check a crop at full size: the ink has to sit
  in the paper's fibre and dim with its shading.

## Before keeping anything

Run the standard's final quality gate, then these, on a zoomed crop:

- Every word reads as the requested text.
- Nothing runs off the paper (`max_width`).
- The ink matches its tool on its surface at 4x zoom.
- The paper has fibre, unevenness and a lit surface, not one colour.
- Text drawn into an image is still copy: run the strings through
  `slop-check --stdin` first.

## Reading someone else's handwriting

Caleb asked on 2026-10-11 whether this skill means Chewbacca can read
handwriting too ("Check the image sagar sent"). The scripts here only draw.
Reading is the model looking at the photo, so say that plainly, then do it:

- Find the photo through `people texts <name>`: an image shows as a blank
  line at its timestamp. Then
  `find ~/Library/Messages/Attachments -type f -newermt "<ts>" ! -newermt "<ts+10m>"`
  and Read the file. Raw SQL on chat.db is refused by a hook.
- Transcribe in the note's own order and words, dates and arrows included.
- Name every word you guessed at (brand names and tiny scribbles are the
  usual ones) instead of smoothing it into confident text.
- Lead with the line that's about him.
