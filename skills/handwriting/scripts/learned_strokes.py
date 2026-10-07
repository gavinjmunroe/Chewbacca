"""Pen paths learned from real people, for handwrite.py to draw.

Runs Alex Graves' handwriting synthesis model (sjvasquez/handwriting-synthesis,
TF2 port otuva/handwriting-synthesis), which was trained on the IAM On-Line
Handwriting Database: pen trajectories recorded from 221 writers on a
whiteboard tablet. Its output is a sequence of pen moves with pen lifts, which
is what a hand produces, rather than letter outlines.

This file must run inside that repo's own environment, because the model needs
TensorFlow 2.15 on Python 3.11:

    cd ~/code/refs/handwriting-synthesis-tf2
    .venv/bin/python ~/code/chewbacca/skills/handwriting/scripts/learned_strokes.py request.json out.json

request.json: [{"text": "call Lola", "style": 3, "bias": 0.6}, ...]
out.json: one entry per request, {"strokes": [[[x, y], ...], ...]}, in model
units with y pointing down, the baseline near y=0, x starting at 0.

bias trades variety for tidiness: 0.3 is loose, 0.9 is careful. style is one
of the 13 primed writers (0 to 12).
"""

import json
import os
import sys

import numpy as np

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

from handwriting_synthesis import Hand, drawing  # noqa: E402


def main(req_path, out_path):
    reqs = json.loads(open(req_path).read())
    hand = Hand()
    allowed = set(drawing.alphabet)
    out = []
    for r in reqs:
        text = "".join(c for c in r["text"] if c in allowed)
        if not text.strip():
            out.append({"text": text, "strokes": []})
            continue
        np.random.seed(r.get("seed", 0))
        [offsets] = hand._sample([text], biases=[r.get("bias", 0.6)], styles=[r.get("style", 3)])
        offsets[:, :2] *= 1.5
        coords = drawing.offsets_to_coords(offsets)
        coords = drawing.denoise(coords)
        coords[:, :2] = drawing.align(coords[:, :2])
        coords[:, 1] *= -1
        coords[:, 0] -= coords[:, 0].min()
        strokes, cur = [], []
        for x, y, eos in coords:
            cur.append([float(x), float(y)])
            if eos == 1.0:
                if len(cur) > 1:
                    strokes.append(cur)
                cur = []
        if len(cur) > 1:
            strokes.append(cur)
        out.append({"text": text, "strokes": strokes})
    open(out_path, "w").write(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
