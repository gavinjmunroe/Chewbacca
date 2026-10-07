"""Paper that looks like paper.

Caleb, 2026-10-07: "I think the ai part is the background being completely
monotone and flat, no texture, it doesn't look like real paper." The first
sheets were one flat colour with per-pixel static. Real paper has fibre, a
cloudy unevenness, a surface that catches light, edges that took the wear, and
for a note on a fridge, usually a fold.

    from paper import sheet
    img = sheet(900, 1180, (250, 247, 238), scan="paper001", crumple=0.3, fold=0.42)

Detail comes from CC0 scans (paper-scans/README.md), so the fibre is real.
"""

import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SCANS = Path(__file__).resolve().parent / "paper-scans"


def _crop(path, w, h, rng, zoom):
    src = Image.open(path).convert("RGB")
    cw, ch = int(src.width / zoom), int(src.height / zoom)
    cw, ch = min(cw, src.width), min(ch, src.height)
    x = rng.randint(0, src.width - cw)
    y = rng.randint(0, src.height - ch)
    return src.crop((x, y, x + cw, y + ch)).resize((w, h), Image.BICUBIC)


def _detail(img, radius):
    """Fine structure only: the scan divided by its own blur, centred on 1."""
    lum = np.asarray(img.convert("L"), dtype=np.float32) + 1
    blur = np.asarray(img.convert("L").filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) + 1
    return lum / blur


def _shade(normal_img, light=(-0.45, -0.55, 0.7)):
    n = np.asarray(normal_img, dtype=np.float32) / 127.5 - 1
    l = np.array(light, dtype=np.float32)
    l /= np.linalg.norm(l)
    # OpenGL normal map: green points up the image, so flip it for y-down.
    d = n[..., 0] * l[0] - n[..., 1] * l[1] + n[..., 2] * l[2]
    return d / (np.median(d) + 1e-6)


def sheet(w, h, base, scan="paper001", strength=1.0, crumple=0.0, fold=None, wear=0.6, seed=0, alpha=True):
    rng = random.Random(f"paper:{scan}:{seed}:{w}x{h}")
    zoom = max(w, h) / 1024 * 1.4
    color = _crop(SCANS / f"{scan}-color.jpg", w, h, rng, zoom)
    normal = _crop(SCANS / f"{scan}-normal.jpg", w, h, rng, zoom)
    fibre = _detail(color, 6)
    cloud = _detail(color, 60)  # the slow unevenness a sheet has across it
    shade = _shade(normal)
    tex = 1 + (fibre - 1) * 0.7 * strength + (cloud - 1) * 0.9 * strength + (shade - 1) * 0.18 * strength
    if crumple > 0:
        c_norm = _crop(SCANS / "paper003-normal.jpg", w, h, rng, max(1.0, zoom * 0.6))
        tex *= 1 + (_shade(c_norm) - 1) * 0.3 * crumple
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Light falls off across the sheet a little, never perfectly even.
    tex *= 1 - 0.035 * (yy / h) - 0.02 * (xx / w)
    if fold is not None:
        # A fold across the sheet: a soft shadow on one side, a lifted
        # highlight on the other, and a crease line where the fibres broke.
        fy = h * fold + rng.uniform(-6, 6)
        tilt = rng.uniform(-0.015, 0.015)
        d = yy - (fy + (xx - w / 2) * tilt)
        tex *= 1 - 0.06 * np.exp(-((d + 10) / 18) ** 2) + 0.035 * np.exp(-((d - 12) / 24) ** 2)
        tex *= 1 - 0.09 * np.exp(-(d / 1.6) ** 2)
    if wear > 0:
        # Edges handled more than the middle: slightly darker, slightly grubby.
        edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy])
        tex *= 1 - wear * 0.05 * np.exp(-edge / 10)
    rgb = np.clip(np.array(base, dtype=np.float32)[None, None, :] * tex[..., None], 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")
    if alpha and wear > 0:
        # Corners are never perfectly sharp on paper that has been around.
        a = np.full((h, w), 255, dtype=np.uint8)
        r = max(2, int(min(w, h) * 0.006))
        for cx, cy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            ys = slice(max(0, cy - r), min(h, cy + r + 1))
            xs = slice(max(0, cx - r), min(w, cx + r + 1))
            sub_y, sub_x = np.mgrid[ys, xs]
            inside = (abs(sub_x - cx) + abs(sub_y - cy)) < r
            a[ys, xs][inside] = 0
        img.putalpha(Image.fromarray(a))
    return img
