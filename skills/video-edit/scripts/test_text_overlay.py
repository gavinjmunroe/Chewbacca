#!/usr/bin/env python3
"""Render check for text_overlay.py: forced breaks, wrapping, and vertical placement."""
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

SCRIPT = Path(__file__).with_name("text_overlay.py")


def ink_rows(text, *args):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "t.png"
        subprocess.run([sys.executable, str(SCRIPT), str(out), text, *args], check=True)
        alpha = np.asarray(Image.open(out))[:, :, 3]
    rows = np.where(alpha.max(1) > 0)[0]
    return rows, np.split(rows, np.where(np.diff(rows) > 1)[0] + 1)


rows, lines = ink_rows("MOMENT ONE|NOW TWO", "--y", "0.25")  # no descenders, so lines separate
assert len(lines) == 2, len(lines)
assert abs((rows.min() + rows.max()) / 2 - 0.25 * 1920) < 60
_, lines = ink_rows("ME AT THREE AM ADDING ANOTHER FEATURE INSTEAD OF TELLING ANYONE MY APP EXISTS")
assert len(lines) >= 3, len(lines)  # no forced breaks: wraps at 72% width
print("ok")

# A hidden-emoji layer and its revealed twin share text placement, and the emoji draws in color.
with tempfile.TemporaryDirectory() as tmp:
    base, full = Path(tmp) / "a.png", Path(tmp) / "b.png"
    args = ["MOMENT|*NOW* 🙏", "--style", "box", "--hang-emoji", "--accent", "#2F6BFF"]
    subprocess.run([sys.executable, str(SCRIPT), str(base), *args, "--hide-emoji"], check=True)
    subprocess.run([sys.executable, str(SCRIPT), str(full), *args], check=True)
    a, b = (np.asarray(Image.open(f)).astype(int) for f in (base, full))
    changed = np.where((a != b).any(2).any(0))[0]
    word = np.where((a[:, :, :3] == [255, 255, 255]).all(2) & (a[:, :, 3] > 0))[1]
    assert changed.min() > 540, changed.min()  # only the right side (emoji) changes
    assert ((b[:, :, 0] > 200) & (b[:, :, 1] > 120) & (b[:, :, 2] < 90)).sum() > 50  # yellow emoji pixels
print("ok reveal")
