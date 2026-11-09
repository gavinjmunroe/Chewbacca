"""Pair the existing trace cells with an isometric arrangement using ux-morph."""
import importlib.machinery
import json
import math
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[1]
engine = root.parent / 'ux-engine' / 'bin' / 'ux-morph'
morph = importlib.machinery.SourceFileLoader('ux_morph', str(engine)).load_module()
seed = 17
cells = []
for row, offset in enumerate([0, .42, .18, .55, .1, .36, .26]):
    x = -1090 + offset * 334
    for col in range(6):
        seed = (seed * 1664525 + 1013904223) & 0xffffffff
        width = 320 * (.8 + seed / 4294967296 * .52)
        cells.append([x + width/2, -630 + row*144 + 65])
        x += width + 14
start = np.array(cells)
target = np.array([[(col-row+.5)*160*math.sqrt(3)/2, (col+row-5.5)*80] for row in range(7) for col in range(6)])
# Orientation is part of the narrative here; do not Procrustes away the tilt.
order, travel = morph.correspond(start,target)
naive = float(np.linalg.norm(start-target,axis=1).sum())
data={'n':42,'configs':[start.tolist(),target[order].tolist()],
      'travel':{'assigned':travel,'index':naive},'assignment':order.tolist()}
(root/'src/morph.json').write_text(json.dumps(data))
print(json.dumps(data['travel']))
