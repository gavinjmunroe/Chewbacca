# Comparing matched captures

`bin/ux-compare` makes a self-contained offline HTML comparison. It embeds the
images, switches both sides together, and offers side-by-side and adjustable
overlay views. Previous/Next buttons and left/right keys move between scenes.
Both sides decode off-screen before the images and scene heading change together;
an older pending selection cannot replace a newer selection. While decoding, the
last complete comparison remains visible and a loading status is shown.
It assigns no quality score and runs no browser, model, or capture process.

```sh
python3 bin/ux-compare /path/checkpoints.json --out /path/comparison.html
python3 bin/ux-compare /path/checkpoints.json --out /path/blind.html --blind
python3 tests/test_compare.py
```

Manifest paths resolve relative to the manifest file. Each checkpoint must have
a unique ID, a neutral scene label, and an explicit viewport in image pixels:

```json
{
  "checkpoints": [
    {
      "id": "trace-grid",
      "label": "Trace grid fully revealed",
      "viewport": {"width": 1280, "height": 900},
      "reference": {"path": "reference/grid.png", "scroll_y": 5216, "time_ms": 4200},
      "candidate": {"path": "candidate/grid.png", "scroll_y": 3900, "time_ms": 5100}
    }
  ]
}
```

The example offsets are illustrative, not measured. A side may also be just an
image path string when metadata is unavailable. Match the same semantic scene
and animation state, not equal absolute scroll positions: different section
heights can put the same scene at different offsets. The tool preserves these
differences; it cannot verify that the chosen scenes actually correspond.

Both images must match the declared pixel dimensions exactly. CSS viewport
dimensions are insufficient if device pixel ratios differ. Missing pairs,
missing/unreadable images, zero-byte files, and uniformly colored images are
rejected before writing output. "Blank" here means exactly uniform after
compositing transparency onto white, not a perceptual blank-page detector.

Blind mode randomly assigns A/B once, keeps that assignment across checkpoints,
and omits source paths and scroll/time metadata. IDs and labels should be neutral;
the images themselves may identify their source. This is presentation blinding,
not a secrecy boundary. The original manifest retains provenance. Labels are
rendered as text and image metadata is stripped during PNG embedding.

The initial 50% overlay is a viewing control, not an optimized alignment or score.
Resize affects display only. No pixel registration, geometric warping, or automatic
judgment hides differences between captures.
