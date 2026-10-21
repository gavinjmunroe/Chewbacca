"""Textures for the v2 fridge scene (docs/FRIDGE-SPEC.md), drawn with the
handwriting skill's pen engine and paper scans. Output: scratch-render/v2tex/.

    python3 make_v2_textures.py [job ...]     jobs: marks clock tapes journal years tucked

Every mark answers the material questions first: what made it, on what, how
fast, how old.
- marks:   pencil height marks on the painted wall under the clock, drawn by a
           parent holding a book flat on a kid's head. Graphite on eggshell paint:
           thin, grey, a little shine, no tooth to grab so the line skips.
- clock:   the printed dial of a cheap kitchen wall clock. Printed, so it is type.
- tapes:   a strip of masking tape across each guest journal's spine, the year in
           black Sharpie, one person's hand across seven years.
- journal: this year's guest book, open: ruled in two columns, Name and Number.
           Left page signed by a few visitors in their own pens, right page empty.
- years:   one spread per year 2019..2025, full of signatures in many hands.
- tucked:  a ticket stub, a pressed flower, a recipe card, tucked into volumes.
"""

import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "v2tex"
OUT.mkdir(exist_ok=True)
SUP = "/System/Library/Fonts/Supplemental/"
BASK = SUP + "Baskerville.ttc"
FUTURA = SUP + "Futura.ttc"
HELV = "/System/Library/Fonts/Helvetica.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def printed(img, xy, text, f, fill, anchor="la", spacing=0.0):
    """Printed type with the slight softness of ink on stock (make_backs.py)."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = xy
    if spacing:
        width = sum(f.getlength(ch) for ch in text) + spacing * (len(text) - 1)
        if anchor[0] == "r":
            x -= width
        elif anchor[0] == "m":
            x -= width / 2
        for ch in text:
            d.text((x, y), ch, font=f, fill=fill, anchor="l" + anchor[1])
            x += f.getlength(ch) + spacing
    else:
        d.text((x, y), text, font=f, fill=fill, anchor=anchor)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.35)))


def write_checked(img, text, x, y, attempts=12, **kw):
    """Write one line, read it back with Vision from a crop of the page, and
    keep the first seed whose reading matches. Digits are where the model
    slips ("202a" for 2020), and a wrong year on a spine is not fixable later."""
    import re
    norm = lambda t: re.sub(r"[^0-9a-z]", "", t.lower().replace("o", "0") if t.replace(" ", "").replace("(", "").replace(")", "").replace("-", "").isdigit() else t.lower())  # noqa: E731
    seed0 = kw.pop("seed")
    best = None
    for k in range(attempts):
        trial = img.copy()
        b = hw.write_learned(trial, [text], x, [y], seed=seed0 + 37 * k, tries=1, **kw)[0]
        if not b:
            continue
        pad = 20
        crop = trial.crop((max(0, int(b[0]) - pad), max(0, int(b[1]) - pad), min(img.width, int(b[2]) + pad), min(img.height, int(b[3]) + pad)))
        bg = Image.new("RGB", crop.size, "white")
        bg.paste(crop.convert("RGB"))
        bg = bg.resize((bg.width * 2, bg.height * 2))
        read = hw._readback([bg])[0] or ""
        ok = norm(read).replace("o", "0") == norm(text).replace("o", "0")
        if best is None:
            best = trial
        if ok:
            img.paste(trial)
            return True, read
    img.paste(best)
    return False, read


def ink_to_alpha(page, base=255.0):
    """A white page the engine wrote on, as an RGBA ink layer: alpha is how
    much the ink darkened the page, colour is the ink's own colour."""
    arr = np.asarray(page.convert("RGB"), dtype=np.float32)
    dark = 1 - arr / base
    a = np.clip(dark.max(axis=2), 0, 1)
    col = np.where(a[..., None] > 1e-3, 255 * (1 - dark / np.maximum(a[..., None], 1e-3)), 0)
    out = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------- pencil marks
# Decal on the wall: 0.36 m wide, from z=0.88 to z=1.40, at 4 px/mm.
MARKS_W, MARKS_Z0, MARKS_Z1, MARKS_PXMM = 0.36, 0.88, 1.40, 4.0


def marks():
    w = int(MARKS_W * 1000 * MARKS_PXMM)
    h = int((MARKS_Z1 - MARKS_Z0) * 1000 * MARKS_PXMM)
    page = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    zpx = lambda z: (MARKS_Z1 - z) * 1000 * MARKS_PXMM  # noqa: E731
    pencil = (58, 58, 64)
    who = hw.Writer("parent", neatness=5, speed=7)
    # (height m, label, line from x, line to x in px, style)
    entries = [
        (1.012, "Maya 4", 70, 470, 12),
        (1.084, "Theo 5", 60, 430, 12),  # crossed out: he was on his toes
        (1.062, "Theo 5", 90, 450, 12),
        (1.147, "Maya 6", 40, 500, 12),
        (1.226, "Theo 7, Aug '21", 80, 520, 12),
    ]
    boxes = {}
    for k, (z, label, x0, x1, style) in enumerate(entries):
        y = zpx(z)
        # the mark itself: a quick pencil line along the top of the book
        hw.strike(page, x0, x1, y, who, tool="pencil", color=pencil, size=26, surface="matte", seed=100 + k)
        b = hw.write_learned(page, [label], x1 + 34, [y + 16], style=style, bias=0.9, tool="pencil",
                             color=pencil, size=26, surface="matte", seed=70 + k, max_width=w - x1 - 50)
        boxes[k] = b[0]
    # the crossed-out one: struck through the label and the old line
    b = boxes[1]
    if b:
        hw.strike(page, b[0] - 6, b[2] + 6, (b[1] + b[3]) / 2, who, tool="pencil", color=pencil, size=30,
                  surface="matte", seed=150)
    ink_to_alpha(page).save(OUT / "marks.png")
    print("marks", page.size, boxes)


# ---------------------------------------------------------------- clock dial
def clock():
    S = 2400  # 250 mm dial
    ss = 2
    img = Image.new("RGBA", (S * ss, S * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S * ss / 2
    R = S * ss / 2
    d.ellipse([0, 0, S * ss - 1, S * ss - 1], fill=(240, 236, 224, 255))
    ink = (30, 30, 32, 255)
    # minute track: 60 ticks, the five-minute ones longer and heavier
    for i in range(60):
        a = np.radians(i * 6)
        long = i % 5 == 0
        r0 = R * (0.86 if long else 0.895)
        r1 = R * 0.935
        wdt = int(R * (0.016 if long else 0.006))
        d.line([(c + r0 * np.sin(a), c - r0 * np.cos(a)), (c + r1 * np.sin(a), c - r1 * np.cos(a))], fill=ink, width=wdt)
    f = font(FUTURA, int(R * 0.2), 0)
    for n in range(1, 13):
        a = np.radians(n * 30)
        r = R * 0.70
        d.text((c + r * np.sin(a), c - r * np.cos(a)), str(n), font=f, fill=ink, anchor="mm")
    f2 = font(FUTURA, int(R * 0.045), 0)
    d.text((c, c + R * 0.36), "QUARTZ", font=f2, fill=(90, 88, 84, 255), anchor="mm")
    img = img.resize((S, S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.4))
    # printed on card stock: a little fibre and an uneven fade toward the edge
    paper = sheet(S, S, (240, 236, 224), scan="paper001", strength=0.35, wear=0.0, seed=5, alpha=False)
    p = np.asarray(paper.convert("RGB"), dtype=np.float32) / np.array([240, 236, 224], dtype=np.float32)
    arr = np.asarray(img, dtype=np.float32)
    arr[..., :3] *= p
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rr = np.hypot(xx - S / 2, yy - S / 2) / (S / 2)
    arr[..., :3] *= (1 - 0.05 * rr ** 3)[..., None]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA").save(OUT / "clock-dial.png")
    print("clock")


# ---------------------------------------------------------------- spine tapes
YEARS = list(range(2019, 2026))


def tape(w, h, base, seed):
    """Crepe masking tape, torn at both ends (make_fridge_labels.py)."""
    img = sheet(w, h, base, scan="paper003", strength=1.1, crumple=0.9, wear=0.0, seed=seed)
    a = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(a)
    rnd = random.Random(seed)
    for x0, sgn in ((0, 1), (w - 1, -1)):
        pts = [(x0, 0)]
        y = 0
        while y < h:
            y += rnd.uniform(6, 16)
            pts.append((x0 + sgn * rnd.uniform(0, 12), min(y, h)))
        pts.append((x0, h))
        d.polygon(pts, fill=0)
    img.putalpha(a)
    return img


def tapes():
    for k, yr in enumerate(YEARS):
        # older tape has yellowed more
        age = (2025 - yr) / 6
        base = (int(232 - 18 * age), int(220 - 26 * age), int(184 - 40 * age))
        img = tape(420, 260, base, 300 + k)
        img.save(OUT / f"tape-{yr}-surface.png")
        ok, read = write_checked(img, str(yr), 60, 178, attempts=20, style=4, bias=0.95, tool="sharpie",
                                 color=(22, 22, 26), size=62, surface="matte", seed=310 + k, max_width=300)
        print(yr, ok, read)
        img.save(OUT / f"tape-{yr}.png")
    print("tapes")


# ---------------------------------------------------------------- guest pages
W, H = 1700, 2400          # 145 x 205 mm drawn; the 3D page is 135 x 190, same aspect
PX_MM = W / 145.0
CREAM = (244, 236, 216)
RULE = 8.0 * PX_MM         # 8 mm: a guest book rules wider than a notebook
TOP = 30.0 * PX_MM         # header rule
NROWS = int((H - TOP - 16 * PX_MM) / RULE)
RULES = [TOP + RULE * i for i in range(NROWS + 1)]
M_OUT, M_IN = 12 * PX_MM, 10 * PX_MM
SPLIT = 0.60               # the name column takes 60% of the ruled width


def columns(gutter_right):
    x0, x1 = (M_OUT, W - M_IN) if gutter_right else (M_IN, W - M_OUT)
    xs = x0 + (x1 - x0) * SPLIT
    return x0, xs, x1


def guest_page(seed, gutter_right, cream=CREAM, age=0.0):
    img = sheet(W, H, cream, scan="paper001", strength=0.55 + 0.3 * age, crumple=0.0, wear=0.25 + 0.4 * age,
                seed=seed, alpha=False)
    img = img.convert("RGBA")
    rnd = random.Random(seed)
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    x0, xs, x1 = columns(gutter_right)
    rule_ink = (120, 140, 165)
    for i, y in enumerate(RULES):
        a = int(rnd.uniform(70, 88)) if i else 120
        d.line([(x0, y), (x1, y)], fill=(*rule_ink, a), width=2 if i else 3)
    d.line([(xs, RULES[0] - 9 * PX_MM), (xs, RULES[-1])], fill=(*rule_ink, 95), width=2)
    img.alpha_composite(over)
    f = font(BASK, 34, 0)
    hdr = (70, 64, 60, 235)
    printed(img, (x0 + 6, RULES[0] - 14), "NAME", f, hdr, anchor="ls", spacing=6)
    printed(img, (xs + 18, RULES[0] - 14), "NUMBER", f, hdr, anchor="ls", spacing=6)
    return img


# Names are written low-bias so the model scrawls a signature that spells no
# real person. Numbers use the 555-01xx range set aside for fiction.
SIG_LETTERS = "mnwrlhvMWHN"


def fake_sig(rnd):
    n = rnd.randint(5, 8)
    s = rnd.choice("MWHNLRK") + "".join(rnd.choice("mnwrlhvo") for _ in range(n - 1))
    if rnd.random() < 0.35:
        s += " " + rnd.choice("MWHNLRK") + "".join(rnd.choice("mnwrlhv") for _ in range(rnd.randint(3, 5)))
    return s


AREAS = ["626", "818", "213", "310", "323", "909", "562", "714", "424", "747"]
PENS = [("ballpoint", (28, 36, 96)), ("gel", (20, 20, 24)), ("fineliner", (24, 26, 40)), ("pencil", (78, 78, 84)),
        ("ballpoint", (30, 40, 110)), ("gel", (110, 30, 36)), ("ballpoint", (22, 22, 26)), ("fineliner", (40, 60, 40))]


def sign_rows(img, gutter_right, rows, seed, check=False):
    """rows: list of rule indices that get a signature and a number."""
    rnd = random.Random(seed)
    x0, xs, x1 = columns(gutter_right)
    for k, ri in enumerate(rows):
        style = rnd.randint(0, 12)
        tool, col = rnd.choice(PENS)
        size = rnd.uniform(24, 32)
        y = RULES[ri] - rnd.uniform(4, 10)
        hw.write_learned(img, [fake_sig(rnd)], x0 + rnd.uniform(14, 90), [y], style=style, bias=0.35, tool=tool,
                         color=col, size=size, surface="notebook", seed=seed * 7 + k,
                         slant=rnd.uniform(-6, 10), max_width=(xs - x0) - 120, tries=1)
        num = f"({rnd.choice(AREAS)}) 555-01{rnd.randint(0, 99):02d}"
        if check:
            ok, read = write_checked(img, num, xs + rnd.uniform(16, 50), y, attempts=10, style=style, bias=0.85,
                                     tool=tool, color=col, size=size * 0.7, surface="notebook",
                                     seed=seed * 7 + 500 + k, max_width=(x1 - xs) - 70)
            print(num, ok, read)
        else:
            hw.write_learned(img, [num], xs + rnd.uniform(16, 50), [y], style=style, bias=0.85, tool=tool,
                             color=col, size=size * 0.7, surface="notebook", seed=seed * 7 + 500 + k,
                             max_width=(x1 - xs) - 70, tries=2)


def journal():
    left = guest_page(31, gutter_right=True)
    sign_rows(left, True, [1, 2, 3, 4, 5, 6], seed=41, check=True)
    left.save(OUT / "journal-left.png")
    right = guest_page(32, gutter_right=False)
    right.save(OUT / "journal-right.png")
    print("journal", left.size, "rows", NROWS)


def years():
    for k, yr in enumerate(YEARS):
        age = (2025 - yr) / 6
        cream = (int(244 - 10 * age), int(236 - 16 * age), int(216 - 28 * age))
        rnd = random.Random(yr)
        for side, gr in (("left", True), ("right", False)):
            img = guest_page(1000 + yr * 2 + gr, gutter_right=gr, cream=cream, age=age)
            n = NROWS if side == "left" else rnd.randint(NROWS - 6, NROWS)
            sign_rows(img, gr, list(range(1, n + 1)), seed=yr * 10 + gr)
            img.save(OUT / f"year-{yr}-{side}.png")
        print("year", yr)


# ---------------------------------------------------------------- tucked things
def tucked():
    # ticket stub, 50 x 28 mm at 20 px/mm, perforated edge on the right
    w, h = 1000, 560
    img = sheet(w, h, (226, 196, 150), scan="paper002", strength=0.8, wear=0.6, seed=61)
    d = ImageDraw.Draw(img)
    d.rectangle([24, 24, w - 70, h - 24], outline=(120, 60, 40, 200), width=4)
    printed(img, (60, 130), "ADMIT ONE", font(FUTURA, 92, 0), (110, 46, 30, 240), spacing=6)
    printed(img, (64, 250), "ROW G   SEAT 14", font(FUTURA, 46, 0), (110, 46, 30, 220), spacing=3)
    printed(img, (64, 340), "HOLLYWOOD BOWL", font(FUTURA, 46, 0), (110, 46, 30, 220), spacing=3)
    printed(img, (64, 430), "AUG 17  7:30 PM", font(FUTURA, 40, 0), (110, 46, 30, 210), spacing=3)
    a = np.asarray(img.getchannel("A")).copy()
    for y in range(10, h, 30):  # torn along the perforation
        a[y:y + 14, w - 22:] = 0
    a[:, w - 8:] = 0
    img.putalpha(Image.fromarray(a))
    img.save(OUT / "ticket.png")
    # recipe card, 127 x 76 mm at 10 px/mm, a grandmother's pencil
    w, h = 1270, 760
    img = sheet(w, h, (247, 242, 228), scan="paper001", strength=0.8, wear=0.7, seed=62)
    d = ImageDraw.Draw(img)
    d.line([(20, 120), (w - 20, 120)], fill=(220, 120, 120, 255), width=3)
    for y in range(190, h - 20, 66):
        d.line([(20, y), (w - 20, y)], fill=(170, 196, 220, 255), width=2)
    hw.write_learned(img, ["Lemon bars"], 50, [104], style=12, bias=0.9, tool="pencil", color=(70, 70, 76),
                     size=34, surface="card", seed=81, max_width=600)
    hw.write_learned(img, ["2 cups flour, 1 cup butter", "4 eggs, 1 1/2 cups sugar", "juice of 3 lemons"], 50,
                     [180, 246, 312], style=12, bias=0.9, tool="pencil", color=(70, 70, 76), size=24,
                     surface="card", seed=82, max_width=1100)
    img.save(OUT / "recipe.png")
    # pressed flower: faded petals, see-through where they dried thin
    S = 900
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rnd = random.Random(9)
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    cx, cy = S * 0.45, S * 0.38
    d.line([(cx, cy), (cx + 80, S - 40)], fill=(120, 120, 70, 230), width=9)
    d.ellipse([cx + 40, cy + 260, cx + 190, cy + 330], fill=(110, 118, 64, 210))
    for p in range(6):
        a = p * np.pi / 3 + rnd.uniform(-0.2, 0.2)
        r = rnd.uniform(120, 150)
        px, py = cx + np.cos(a) * r * 0.6, cy + np.sin(a) * r * 0.6
        bb = [px - r * 0.5, py - r * 0.32, px + r * 0.5, py + r * 0.32]
        petal = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(petal).ellipse(bb, fill=(196, 120, 130, int(rnd.uniform(150, 200))))
        petal = petal.rotate(-np.degrees(a), center=(px, py))
        lay.alpha_composite(petal)
    ImageDraw.Draw(lay).ellipse([cx - 34, cy - 34, cx + 34, cy + 34], fill=(150, 110, 50, 240))
    lay = lay.filter(ImageFilter.GaussianBlur(1.2))
    # dried tissue: mottled density
    n = np.asarray(Image.fromarray((np.random.default_rng(3).random((S // 8, S // 8)) * 255).astype(np.uint8))
                   .resize((S, S), Image.BICUBIC), dtype=np.float32) / 255
    arr = np.asarray(lay, dtype=np.float32)
    arr[..., 3] *= 0.75 + 0.25 * n
    arr[..., :3] *= (0.85 + 0.15 * n)[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    img.save(OUT / "flower.png")
    print("tucked")


JOBS = dict(marks=marks, clock=clock, tapes=tapes, journal=journal, years=years, tucked=tucked)

if __name__ == "__main__":
    for j in sys.argv[1:] or list(JOBS):
        JOBS[j]()
