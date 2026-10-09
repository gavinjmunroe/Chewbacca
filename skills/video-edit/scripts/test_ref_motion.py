#!/usr/bin/env python3
"""ref_motion recovers a known push-in and pan and splits on a dip to black;
borrow_camera's base zoom keeps every frame's edges inside the source.

    uv run -q --with opencv-python-headless --with numpy python -I test_ref_motion.py
"""
import sys
import tempfile
from pathlib import Path
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ref_motion import measure
from borrow_camera import matrices, W, H

rng = np.random.default_rng(0)
tex = cv2.GaussianBlur(rng.integers(0, 255, (640, 360, 3), dtype=np.uint8), (5, 5), 0)
path = str(Path(tempfile.mkdtemp()) / "synthetic.mp4")
out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 30, (360, 640))
for i in range(60):  # 30 frames pushing in 0.3%/frame and panning 1 px/frame, then 30 black frames
    if i < 30:
        m = cv2.getRotationMatrix2D((180, 320), 0, 1.003 ** i) + [[0, 0, i], [0, 0, 0]]
        out.write(cv2.warpAffine(tex, m, (360, 640), borderMode=cv2.BORDER_REFLECT))
    else:
        out.write(np.zeros_like(tex))
out.release()

fps, rows = measure(path)
assert fps == 30
cum = rows[28][6]
assert abs(cum - 1.003 ** 29) < 0.01, cum
pan = np.mean([r[3] for r in rows[:28]]) / 100 * 360
assert abs(pan - 1) < 0.3, pan
assert any(r[8] for r in rows[29:32]), "dip to black should split the shot"

n = 50
tx, ty = np.linspace(-30, 30, n), np.linspace(20, -20, n)
rot, z = np.linspace(-1, 1, n), np.linspace(0.98, 1.01, n)
base, ms = matrices(tx, ty, rot, z, (300.0, 1300.0))
corners = np.array([[0, 0, 1], [W, 0, 1], [0, H, 1], [W, H, 1]], float).T
for m in ms:
    src = cv2.invertAffineTransform(m) @ corners
    assert src.min() >= -1e-6 and src[0].max() <= W + 1e-6 and src[1].max() <= H + 1e-6
assert 1.0 < base < 1.2, base
print("ok")
