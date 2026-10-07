"""Handwriting as a pen trace, not a typeface.

The skill's first rule is "never render text as a handwriting font". This
draws every letter as the strokes a hand makes: centreline paths from the
Hershey stroke data, bent by one writer's habits, varied by correlated
drift rather than per-letter noise, pressed harder and lighter along each
stroke, and laid down by a specific tool on a specific surface.

    from handwrite import Writer, write, loop
    w = Writer(seed="sagar", neatness=6, speed=5)
    write(page, ["None of us have a good place", "to remember..."], x=126,
          baselines=[244, 316, 388], writer=w, tool="ballpoint",
          color=(30, 38, 92), size=26, surface="notebook", max_width=700)

page is a PIL RGBA image of the paper. Ink is multiplied into it, so the
paper's grain shows through the marks the way it does on a real sheet.

Run it directly to write a test page: python3 handwrite.py out.png
"""

import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent / "hershey"

# Hershey units: baseline at y=9, x-height top near y=-5, caps near y=-12.
# Measured off futural.jhf: "x" spans -5..9, "H" spans -12..9.
X_HEIGHT_UNITS = 14.0
BASELINE_UNITS = 9.0

ASCENDERS = set("bdfhklt")
DESCENDERS = set("gjpqy")

_FONTS = {}


def load_font(name):
    if name in _FONTS:
        return _FONTS[name]
    glyphs = {}
    code = 32
    for line in (HERE / f"{name}.jhf").read_text().splitlines():
        if len(line) < 10:
            continue
        body = line[8:]
        left = ord(body[0]) - ord("R")
        right = ord(body[1]) - ord("R")
        strokes, cur = [], []
        pts = body[2:]
        for i in range(0, len(pts) - 1, 2):
            pair = pts[i : i + 2]
            if pair == " R":
                if cur:
                    strokes.append(cur)
                cur = []
                continue
            cur.append((ord(pair[0]) - ord("R"), ord(pair[1]) - ord("R")))
        if cur:
            strokes.append(cur)
        glyphs[chr(code)] = (left, right, strokes)
        code += 1
    _FONTS[name] = glyphs
    return glyphs


class Drift:
    """Ornstein-Uhlenbeck drift: neighbours agree, the line wanders.

    Human variation is correlated. A letter leaning right makes the next one
    likely to lean right too. Independent noise per letter is what makes
    generated handwriting buzz.
    """

    def __init__(self, rng, sigma, pull=0.25):
        self.rng, self.sigma, self.pull, self.v = rng, sigma, pull, 0.0

    def step(self):
        self.v += -self.pull * self.v + self.rng.gauss(0, self.sigma)
        return self.v


class Writer:
    """One person. Habits are fixed per writer; variation is drawn per mark.

    neatness 1..10 and speed 1..10 follow the skill's scale. Same seed, same
    hand: the "a" on line one and the "a" on line nine belong to one person
    and are still never copies.
    """

    def __init__(self, seed, neatness=6, speed=5, slant=None, font="futural", width=1.0, pressure=1.0):
        self.rng = random.Random(f"writer:{seed}")
        r = self.rng
        self.font = load_font(font)
        self.neat = max(1, min(10, neatness))
        self.speed = max(1, min(10, speed))
        self.slant = r.uniform(3, 10) if slant is None else slant
        self.width = width * r.uniform(0.72, 0.88)
        self.track = r.uniform(0.84, 0.98)
        self.word_gap = r.uniform(0.75, 1.15)
        # How often this writer runs one letter into the next inside a word.
        self.joins = r.uniform(0.15, 0.45) * (0.6 + self.speed / 10)
        self.pressure = pressure * r.uniform(0.9, 1.1)
        self.asc = r.uniform(1.0, 1.18)
        self.desc = r.uniform(0.9, 1.15)
        self.habits = {}
        # How loose the hand is: neat and slow writers vary less.
        self.v = (11 - self.neat) / 10 * (0.65 + self.speed / 12)

    def habit(self, ch):
        if ch not in self.habits:
            r = self.rng
            self.habits[ch] = {
                "w": 1 + r.gauss(0, 0.09),
                "h": 1 + r.gauss(0, 0.07),
                "slant": r.gauss(0, 3.5),
                "lift": r.gauss(0, 0.05),
                # Bowls are ovals in a hand, never compass circles.
                "squash": r.uniform(0.78, 0.95),
                "tilt": r.gauss(0, 6),
            }
        return self.habits[ch]


def _chaikin(pts, n):
    for _ in range(n):
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            out.append(0.75 * a + 0.25 * b)
            out.append(0.25 * a + 0.75 * b)
        out.append(pts[-1])
        pts = np.array(out)
    return pts


def _resample(pts, step):
    if len(pts) < 2:
        return pts
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    if total < 1e-6:
        return pts[:1]
    cum = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(total / step) + 1)
    t = np.linspace(0, total, n)
    x = np.interp(t, cum, pts[:, 0])
    y = np.interp(t, cum, pts[:, 1])
    return np.stack([x, y], axis=1)


def _layout_line(text, writer, size, x0, baseline, rng, drifts):
    """Turn one line of text into pen strokes in page pixels."""
    unit = size / X_HEIGHT_UNITS
    v = writer.v
    strokes = []
    x = x0
    slant_d, size_d, base_d = drifts
    prev_end = None
    for ch in text:
        if ch == " ":
            prev_end = None
            x += unit * 9 * writer.word_gap * (1 + rng.gauss(0, 0.12 * v))
            continue
        glyph = writer.font.get(ch) or writer.font.get("?")
        left, right, gstrokes = glyph
        hb = writer.habit(ch)
        sl = math.radians(writer.slant + hb["slant"] + slant_d.step() * 6)
        sc = unit * (1 + size_d.step() * 0.5) * hb["h"]
        sx = sc * writer.width * hb["w"] * (1 + rng.gauss(0, 0.03 * v))
        by = baseline + base_d.step() * size * 0.5 + hb["lift"] * size
        adv = (right - left) * sx * writer.track
        for s in gstrokes:
            p = np.array(s, dtype=float)
            p[:, 0] -= left
            yy = p[:, 1] - BASELINE_UNITS
            # Ascenders and descenders carry the writer's proportions.
            if ch in ASCENDERS or ch.isupper() or ch.isdigit():
                yy = np.where(yy < -X_HEIGHT_UNITS * 0.6, yy * writer.asc, yy)
            if ch in DESCENDERS:
                yy = np.where(yy > 0, yy * writer.desc, yy)
            px = p[:, 0] * sx - yy * sc * math.tan(sl)
            py = yy * sc
            pts = np.stack([x + px, by + py], axis=1)
            # A closed stroke is a bowl (o, a, e, d...): squash and tilt it the
            # way this writer always does, so no two o's are compass-perfect.
            if len(pts) > 6 and np.linalg.norm(pts[0] - pts[-1]) < unit * 2.5:
                c = pts.mean(axis=0)
                th = math.radians(hb["tilt"] + rng.gauss(0, 3 * v))
                rot = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
                q = (pts - c) @ rot.T
                q[:, 0] *= hb["squash"] * (1 + rng.gauss(0, 0.05 * v))
                pts = q @ rot + c
                # Fast writers leave the loop open where it should close.
                if writer.speed >= 6 and rng.random() < 0.5:
                    pts = pts[: max(3, int(len(pts) * rng.uniform(0.86, 0.95)))]
            # A short stroke is a dot: fast writers flick it to the right.
            # Judged by size alone: a Hershey straight stroke is also two
            # points, and treating every two-point stroke as a dot turned the
            # stem of every T, l and k into a flick.
            if np.ptp(pts[:, 0]) + np.ptp(pts[:, 1]) < unit * 3.2:
                c = pts.mean(axis=0) + np.array([rng.gauss(0.6, 0.6) * unit, rng.gauss(0, 0.5) * unit])
                flick = unit * (0.6 + writer.speed * 0.12)
                pts = np.array([c, c + np.array([flick, -flick * 0.25])])
            strokes.append(pts)
        # Print that half-connects: the pen sometimes stays down from the end
        # of one letter into the start of the next, inside a word only.
        if prev_end is not None and gstrokes and rng.random() < writer.joins:
            first = strokes[-len(gstrokes)]
            gap = first[0] - prev_end
            if 0 < gap[0] < unit * 7 and abs(gap[1]) < unit * 9:
                mid = (prev_end + first[0]) / 2 + np.array([0, unit * 1.2])
                strokes.append(np.array([prev_end, mid, first[0]]))
        prev_end = strokes[-1][-1] if gstrokes else None
        x += adv * (1 + rng.gauss(0, 0.05 * v))
    return strokes, x


def _shape(pts, writer, size, rng):
    """Bend a skeleton into a hand's motion: wobble, rounding, overshoot."""
    v = writer.v
    pts = _resample(pts, max(1.0, size * 0.06))
    if len(pts) < 2:
        return pts
    n = len(pts)
    t = np.linspace(0, 1, n)
    # Low-frequency wobble, smooth along the stroke, never per-point noise.
    amp = size * 0.055 * v
    for k in (1, 2):
        ph1, ph2 = rng.uniform(0, 6.3), rng.uniform(0, 6.3)
        pts = pts + np.stack(
            [amp / k * np.sin(t * math.pi * k + ph1), amp / k * np.sin(t * math.pi * k + ph2)], axis=1
        )
    pts = _chaikin(pts, 2 + (writer.speed > 6))
    # Momentum carries the pen past where it meant to stop.
    if len(pts) > 2:
        d = pts[-1] - pts[-2]
        nd = np.linalg.norm(d)
        if nd > 1e-6:
            over = size * 0.03 * writer.speed / 5 * rng.uniform(0.3, 1.2)
            pts = np.vstack([pts, pts[-1] + d / nd * over])
    return pts


def _pressure(pts, writer, rng):
    """Heavier at the start and on slow curves, lighter on fast straights."""
    n = len(pts)
    t = np.linspace(0, 1, n)
    p = np.ones(n) * writer.pressure
    p *= 1 + 0.28 * np.exp(-t / 0.08)
    p *= np.where(t > 0.82, 1 - (t - 0.82) / 0.18 * 0.45, 1)
    if n > 2:
        d = np.diff(pts, axis=0)
        ang = np.arctan2(d[:, 1], d[:, 0])
        turn = np.abs(np.angle(np.exp(1j * np.diff(ang))))
        turn = np.concatenate([[0], turn, [0]])
        k = np.convolve(turn, np.ones(5) / 5, mode="same")
        p *= 0.86 + np.clip(k * 1.8, 0, 0.3)
    ph = rng.uniform(0, 6.3)
    p *= 1 + 0.1 * np.sin(t * math.pi * rng.uniform(1, 3) + ph)
    return np.clip(p, 0.15, 1.6)


TOOLS = {
    # width as a fraction of x-height, base opacity, edge softness in px
    "ballpoint": (0.075, 0.82, 0.7),
    "gel": (0.095, 0.95, 0.6),
    "fineliner": (0.085, 0.95, 0.75),
    "pencil": (0.08, 0.62, 0.9),
    "mechanical-pencil": (0.06, 0.58, 0.7),
    "sharpie": (0.19, 0.97, 0.9),
    "marker": (0.24, 0.9, 1.0),
    "crayon": (0.26, 0.9, 1.2),
}


def _stamp_stroke(alpha, pts, pres, width, opacity, soft, tool, rng):
    h, w = alpha.shape
    if len(pts) < 1:
        return
    step = max(0.35, width * 0.3)
    dense = _resample(pts, step) if len(pts) > 1 else pts
    pd = np.interp(np.linspace(0, 1, len(dense)), np.linspace(0, 1, len(pres)), pres)
    starve = np.ones(len(dense))
    if tool == "ballpoint":
        # The ball runs dry for a moment on fast strokes: short pale gaps.
        u = np.cumsum(np.full(len(dense), step))
        ph = rng.uniform(0, 100)
        wave = np.sin(u / (width * 9) + ph) + np.sin(u / (width * 3.1) + ph * 1.7) * 0.5
        starve = np.where(wave > 1.15, 0.45, 1.0)
    r_max = width * 1.6 / 2 + soft + 1
    x0 = int(max(0, dense[:, 0].min() - r_max))
    x1 = int(min(w, dense[:, 0].max() + r_max + 1))
    y0 = int(max(0, dense[:, 1].min() - r_max))
    y1 = int(min(h, dense[:, 1].max() + r_max + 1))
    if x1 <= x0 or y1 <= y0:
        return
    buf = np.zeros((y1 - y0, x1 - x0), dtype=np.float32)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    for (cx, cy), p, sv in zip(dense, pd, starve):
        r = width / 2 * (0.75 + 0.35 * p)
        a = min(1.0, opacity * (0.55 + 0.45 * p) * sv)
        lx0, lx1 = int(max(x0, cx - r - soft - 1)), int(min(x1, cx + r + soft + 2))
        ly0, ly1 = int(max(y0, cy - r - soft - 1)), int(min(y1, cy + r + soft + 2))
        if lx1 <= lx0 or ly1 <= ly0:
            continue
        sub_x = xx[ly0 - y0 : ly1 - y0, lx0 - x0 : lx1 - x0]
        sub_y = yy[ly0 - y0 : ly1 - y0, lx0 - x0 : lx1 - x0]
        d = np.sqrt((sub_x - cx) ** 2 + (sub_y - cy) ** 2)
        s = np.clip((r + soft - d) / (2 * soft), 0, 1) * a
        view = buf[ly0 - y0 : ly1 - y0, lx0 - x0 : lx1 - x0]
        np.maximum(view, s, out=view)
    if tool == "ballpoint" and rng.random() < 0.18:
        # A small blob where the pen sat before moving.
        cx, cy = dense[0]
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        np.maximum(buf, np.clip((width * 0.95 - d) / 0.8, 0, 1) * 0.95, out=buf)
    # Strokes stack: where two cross, the ink is darker.
    region = alpha[y0:y1, x0:x1]
    alpha[y0:y1, x0:x1] = 1 - (1 - region) * (1 - buf)


def _tooth(shape, seed, scale=1.0):
    rng = np.random.default_rng(seed)
    h, w = shape
    fine = rng.random((h, w)).astype(np.float32)
    coarse = np.asarray(
        Image.fromarray((rng.random((h // 6 + 2, w // 6 + 2)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC),
        dtype=np.float32,
    ) / 255
    fine = np.asarray(Image.fromarray((fine * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6 * scale)), dtype=np.float32) / 255
    t = fine * 0.65 + coarse * 0.35
    return (t - t.min()) / (np.ptp(t) + 1e-6)


SURFACE_BLEED = {
    # extra blur in px for wet inks, by how absorbent the surface is
    "notebook": 0.25,
    "printer": 0.2,
    "sticky": 0.35,
    "card": 0.15,
    "glossy": 0.0,
    "matte": 0.45,
    "napkin": 1.6,
    "cardboard": 0.9,
}


def _finish(alpha, tool, surface, seed):
    bleed = SURFACE_BLEED.get(surface, 0.2)
    if tool in ("pencil", "mechanical-pencil"):
        # Graphite sits on the tops of the grain and skips the valleys. Light
        # pressure catches fewer peaks than heavy pressure.
        tooth = _tooth(alpha.shape, seed)
        need = 1 - alpha
        catch = np.clip((tooth - need * 0.75 + 0.2) / 0.45, 0, 1)
        alpha = alpha * (0.35 + 0.65 * catch) * 0.92
        return alpha
    if tool == "crayon":
        tooth = _tooth(alpha.shape, seed, 1.4)
        catch = np.clip((tooth - 0.3) / 0.35, 0, 1)
        return alpha * (0.15 + 0.85 * catch)
    if tool in ("sharpie", "marker"):
        img = Image.fromarray((alpha * 255).astype(np.uint8))
        spread = img.filter(ImageFilter.GaussianBlur(0.4 + bleed * 1.4))
        halo = img.filter(ImageFilter.GaussianBlur(1.5 + bleed * 3)).point(lambda v: int(v * (0.1 + bleed * 0.25)))
        return np.maximum(np.asarray(spread, dtype=np.float32), np.asarray(halo, dtype=np.float32)) / 255
    if bleed > 0:
        img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(bleed))
        return np.asarray(img, dtype=np.float32) / 255
    return alpha


def ink_onto(page, alpha, color):
    """Multiply ink into the paper so the grain shows through the mark."""
    arr = np.asarray(page, dtype=np.float32) / 255
    c = np.array(color[:3], dtype=np.float32) / 255
    a = alpha[..., None]
    rgb = arr[..., :3] * (1 - a * (1 - c))
    out = np.concatenate([rgb, arr[..., 3:4]], axis=2)
    page.paste(Image.fromarray((out * 255).astype(np.uint8), "RGBA"))


def _wrap(text, writer, size, max_width):
    unit = size / X_HEIGHT_UNITS
    words, lines, cur, width = text.split(), [], [], 0.0
    for wd in words:
        wlen = sum((writer.font.get(c, writer.font["?"])[1] - writer.font.get(c, writer.font["?"])[0]) for c in wd)
        wlen = wlen * unit * writer.width * writer.track + unit * 9 * writer.word_gap
        if cur and width + wlen > max_width:
            lines.append(" ".join(cur))
            cur, width = [], 0.0
        cur.append(wd)
        width += wlen
    if cur:
        lines.append(" ".join(cur))
    return lines


def write(page, lines, x, baselines, writer, tool="ballpoint", color=(28, 34, 80), size=24, surface="notebook", max_width=None, seed=0):
    """Write lines onto page. baselines is one y per line, usually the rules.

    With max_width set, any line too long for the space wraps onto the next
    baseline, the way a person runs out of room and carries a word down.
    """
    rng = random.Random(f"{seed}:{lines}")
    if max_width:
        wrapped = []
        for ln in lines:
            wrapped.extend(_wrap(ln, writer, size, max_width) if ln else [""])
        lines = wrapped
    width, opacity, soft = TOOLS[tool]
    pen_w = max(1.0, width * size)
    alpha = np.zeros((page.height, page.width), dtype=np.float32)
    slant_d = Drift(rng, 0.09 * writer.v)
    size_d = Drift(rng, 0.06 * writer.v)
    base_d = Drift(rng, 0.045 * writer.v, pull=0.12)
    margin = Drift(rng, size * 0.08 * writer.v, pull=0.5)
    slope = rng.gauss(0, 0.006 * writer.v)
    for i, ln in enumerate(lines):
        if i >= len(baselines) or not ln:
            continue
        x0 = x + margin.step()
        strokes, _ = _layout_line(ln, writer, size, x0, baselines[i], rng, (slant_d, size_d, base_d))
        for s in strokes:
            s = s.copy()
            s[:, 1] += (s[:, 0] - x0) * slope
            shaped = _shape(s, writer, size, rng)
            pres = _pressure(shaped, writer, rng)
            _stamp_stroke(alpha, shaped, pres, pen_w, opacity, soft, tool, rng)
    alpha = _finish(alpha, tool, surface, seed)
    ink_onto(page, alpha, color)
    return lines


def loop(page, box, writer, tool="ballpoint", color=(190, 36, 40), size=24, surface="notebook", turns=1.15, seed=0):
    """A hand-drawn circle around something: never closes where it started."""
    rng = random.Random(f"loop:{seed}:{box}")
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    start = rng.uniform(2.4, 3.6)
    t = np.linspace(start, start + 2 * math.pi * turns, 140)
    wob = 1 + 0.05 * np.sin(t * 2 + rng.uniform(0, 6)) + np.linspace(0, 0.06, len(t))
    pts = np.stack([cx + rx * wob * np.cos(t), cy + ry * wob * np.sin(t) + np.linspace(0, ry * 0.12, len(t))], axis=1)
    width, opacity, soft = TOOLS[tool]
    alpha = np.zeros((page.height, page.width), dtype=np.float32)
    pres = _pressure(pts, writer, rng)
    _stamp_stroke(alpha, pts, pres, max(1.0, width * size), opacity, soft, tool, rng)
    ink_onto(page, _finish(alpha, tool, surface, seed), color)


def strike(page, x0, x1, y, writer, tool="pencil", color=(70, 70, 76), size=24, surface="sticky", seed=0):
    """A quick line through a word: fast, slightly rising, past both ends."""
    rng = random.Random(f"strike:{seed}:{y}")
    pts = np.array([[x0 - size * 0.2, y + rng.gauss(0, 2)], [(x0 + x1) / 2, y - size * 0.06], [x1 + size * 0.25, y - size * 0.15 + rng.gauss(0, 2)]])
    pts = _chaikin(_resample(pts, 3), 2)
    width, opacity, soft = TOOLS[tool]
    alpha = np.zeros((page.height, page.width), dtype=np.float32)
    _stamp_stroke(alpha, pts, _pressure(pts, writer, rng) * 1.1, max(1.0, width * size), opacity, soft, tool, rng)
    ink_onto(page, _finish(alpha, tool, surface, seed), color)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "handwriting-test.png"
    page = Image.new("RGBA", (1100, 700), (250, 248, 240, 255))
    rules = [120 + 64 * i for i in range(9)]
    w = Writer("test", neatness=6, speed=5)
    write(page, ["The quick brown fox jumps over the lazy dog.", "Three a's: a a a. Three e's: e e e.", "Pencil below, then a Sharpie."], 60, rules, w, "ballpoint", (28, 34, 80), 26)
    write(page, ["eggs, oat milk, call Lola"], 60, rules[3:], Writer("list", 5, 7), "pencil", (70, 70, 76), 26, "sticky")
    write(page, ["big sur '23"], 60, rules[5:], Writer("pol", 6, 6), "sharpie", (18, 18, 20), 30, "glossy")
    write(page, ["TO TITA"], 60, rules[7:], Writer("kid", 3, 4, slant=-4), "crayon", (150, 60, 190), 40, "printer")
    page.save(out)
    print(out)


# ---------------------------------------------------------------------------
# Learned strokes: human pen paths instead of a stroke font.
#
# Caleb looked at the Hershey version on 2026-10-07 and said "This looks ai idk
# why". The why: Hershey is a font skeleton (Futura drawn with one line), so
# the bowls were compass ovals, every stem was ruler-straight and the "a" was a
# textbook form. Wobble on top cannot fix wrong bones. learned_strokes.py runs
# a model trained on real people's pen trajectories, and this draws its output
# with the same tool and surface physics as above.

MODEL_DIR = Path.home() / "code/refs/handwriting-synthesis-tf2"
CACHE = Path(__file__).resolve().parent / ".stroke-cache.json"


def _learned(reqs):
    import hashlib
    import json
    import os
    import subprocess
    import tempfile

    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    key = lambda r: hashlib.sha1(json.dumps(r, sort_keys=True).encode()).hexdigest()
    todo = [r for r in reqs if key(r) not in cache]
    if todo:
        with tempfile.TemporaryDirectory() as d:
            req, out = Path(d) / "req.json", Path(d) / "out.json"
            req.write_text(json.dumps(todo))
            subprocess.run(
                [str(MODEL_DIR / ".venv/bin/python"), str(Path(__file__).resolve().parent / "learned_strokes.py"), str(req), str(out)],
                cwd=MODEL_DIR,
                env={**os.environ, "PYTHONPATH": str(MODEL_DIR), "TF_CPP_MIN_LOG_LEVEL": "3"},
                check=True,
                capture_output=True,
            )
            for r, res in zip(todo, json.loads(out.read_text())):
                cache[key(r)] = res["strokes"]
        CACHE.write_text(json.dumps(cache))
    return [cache[key(r)] for r in reqs]


def _speed_pressure(pts, writer, rng):
    """Pressure from the pen's real speed: slow is heavy, fast is light."""
    n = len(pts)
    if n < 2:
        return np.ones(n) * writer.pressure
    step = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    step = np.concatenate([[step[0]], step])
    sp = np.convolve(step, np.ones(5) / 5, mode="same")[:n] if n >= 5 else step
    sp = sp / (np.median(sp) + 1e-6)
    t = np.linspace(0, 1, n)
    p = writer.pressure * (1.2 - 0.32 * np.clip(sp, 0, 2))
    p *= 1 + 0.22 * np.exp(-t / 0.06)
    p *= np.where(t > 0.88, 1 - (t - 0.88) / 0.12 * 0.5, 1)
    return np.clip(p, 0.2, 1.6)


def write_learned(page, lines, x, baselines, style=3, bias=0.6, tool="ballpoint", color=(28, 34, 80), size=24, surface="notebook", seed=0, pressure=1.0, slant=0.0, max_width=None):
    """Write lines with learned human strokes. size is the x-height in px.

    style picks one of the model's 13 primed writers, bias how careful they
    are. Every line of one note should use the same style: one person.
    """
    reqs = [{"text": ln, "style": style, "bias": bias, "seed": seed * 100 + i} for i, ln in enumerate(lines)]
    results = _learned(reqs)
    writer = Writer(f"learned:{style}", pressure=pressure)
    rng = random.Random(f"learned:{seed}:{lines}")
    width, opacity, soft = TOOLS[tool]
    pen_w = max(1.0, width * size)
    alpha = np.zeros((page.height, page.width), dtype=np.float32)
    margin = Drift(rng, size * 0.12, pull=0.5)
    # One person writes one size. The scale comes from every line of the note
    # together, so a line of caps does not come out a different size from the
    # line under it. Per-line scaling made one writer twice as big as another.
    heights = []
    for strokes in results:
        if strokes:
            ys = np.concatenate([np.array(s)[:, 1] for s in strokes])
            heights.append(np.percentile(ys, 78) - np.percentile(ys, 22))
    scale = size / max(1e-6, float(np.median(heights))) if heights else 1.0
    if max_width:
        # A person who is running out of room writes smaller; they don't run
        # off the edge of the card. Shrink the whole note to its widest line.
        widest = max((max(max(p[0] for p in s) for s in st) for st in results if st), default=0)
        if widest * scale > max_width:
            scale = max_width / widest
    boxes = []
    for i, strokes in enumerate(results):
        if i >= len(baselines) or not strokes:
            boxes.append(None)
            continue
        ys = np.concatenate([np.array(s)[:, 1] for s in strokes])
        # 86th percentile, not the 78th: at 78 the bottoms of the letters hung
        # below the rule, so the ruled line read as a strike-through.
        base = np.percentile(ys, 86)
        lo = [1e9, 1e9, -1e9, -1e9]
        x0 = x + margin.step()
        shear = math.tan(math.radians(slant))
        for s in strokes:
            p = np.array(s, dtype=float)
            p[:, 1] = (p[:, 1] - base) * scale
            p[:, 0] = x0 + p[:, 0] * scale - p[:, 1] * shear
            p[:, 1] += baselines[i]
            lo = [min(lo[0], p[:, 0].min()), min(lo[1], p[:, 1].min()), max(lo[2], p[:, 0].max()), max(lo[3], p[:, 1].max())]
            pres = _speed_pressure(p, writer, rng)
            p = _chaikin(p, 1)
            pres = np.interp(np.linspace(0, 1, len(p)), np.linspace(0, 1, len(pres)), pres)
            _stamp_stroke(alpha, p, pres, pen_w, opacity, soft, tool, rng)
        boxes.append(tuple(lo))
    ink_onto(page, _finish(alpha, tool, surface, seed), color)
    # Where each line actually landed, so a strike-through or a circle drawn
    # afterwards goes round the real words rather than a guessed width.
    return boxes
