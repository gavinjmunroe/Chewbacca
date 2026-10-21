"""Draw the two open pages of the guest journal on the kitchen counter.

Left page: a few visitors have already signed, each in their own hand and pen,
a loose signature and a date. Nobody is readable as a real name: signatures are
written by the learned model at low bias, where it stops forming words.
Right page: blank, faint rules, the page the visitor signs.

Pages are 145 x 205 mm, drawn at 1700 x 2400 px (about 11.7 px/mm) so the
browser's top-down close-up of the right page has real fibre at full size.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

OUT = Path(__file__).resolve().parent / "journal"
OUT.mkdir(exist_ok=True)
W, H = 1700, 2400
PX_MM = W / 145.0
CREAM = (244, 236, 216)
# 7 mm ruling, the common journal ruling; first rule 22 mm down.
RULE = 7.0 * PX_MM
TOP = 22.0 * PX_MM
RULES = [TOP + RULE * i for i in range(int((H - TOP - 14 * PX_MM) / RULE) + 1)]


def page(seed, gutter_right, rules_from=0.0):
    img = sheet(W, H, CREAM, scan="paper001", strength=0.55, crumple=0.0, wear=0.25, seed=seed, alpha=False)
    # Printed rules: faint grey-blue offset ink, a hair uneven in density. Drawn
    # on their own layer and composited, so the alpha actually blends (drawing
    # an RGBA fill straight onto the sheet wrote the ink fully opaque).
    import random
    rnd = random.Random(seed)
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    m_out = 12 * PX_MM
    m_in = 9 * PX_MM
    x0, x1 = (m_out, W - m_in) if gutter_right else (m_in, W - m_out)
    for y in RULES:
        if y < rules_from:
            continue  # the printed epigraph sits in an unruled head
        a = int(rnd.uniform(70, 88))
        d.line([(x0, y), (x1, y)], fill=(120, 140, 165, a), width=2)
    img = img.convert("RGBA")
    img.alpha_composite(over)  # stays RGBA: the pen engine writes into RGBA pages
    return img


EPIGRAPH = ("AI shouldn’t be a cold, static world. It should be the tool that allows us to be our "
            "most human selves, and do what humans do best: find patterns and make connections.")


def print_epigraph(img, x0, x1, y0):
    """Set the epigraph as printed type: Baskerville, about 9 pt, ragged right,
    in a warm near-black offset ink that sits slightly into the paper."""
    from PIL import ImageFont, ImageFilter
    import numpy as np
    ss = 3  # draw at 3x and downsample so the type has real edges, not hinted pixels
    f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Baskerville.ttc", 40 * ss, index=2)  # italic
    width = (x1 - x0) * ss
    words, lines, cur = EPIGRAPH.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if f.getlength(t) > width:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)
    lead = 58 * ss
    mask = Image.new("L", (int(width), int(lead * (len(lines) + 1))), 0)
    d = ImageDraw.Draw(mask)
    for i, ln in enumerate(lines):
        # centred, as a book's epigraph usually is
        d.text(((width - f.getlength(ln)) / 2, i * lead), ln, font=f, fill=255)
    mask = mask.resize((mask.width // ss, mask.height // ss), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.45))
    a = np.asarray(mask, dtype=np.float32) / 255.0 * 0.88
    # print density varies a little across the sheet
    a *= 0.93 + 0.07 * np.random.default_rng(5).random(a.shape).astype(np.float32) ** 0.3
    base = np.asarray(img.convert("RGB"), dtype=np.float32)
    ink = np.array([46, 40, 36], dtype=np.float32)
    h, w = a.shape
    reg = base[y0:y0 + h, x0:x0 + w]
    reg[:] = reg * (1 - a[..., None]) + ink * a[..., None]
    out = Image.fromarray(base.clip(0, 255).astype("uint8"), "RGB")
    img.paste(out)
    return y0 + h


def left():
    # head of the page is unruled, the epigraph printed in it, rules resume below
    img = page(31, gutter_right=True, rules_from=RULES[4] - 1)
    print_epigraph(img, 300, 1500, int(RULES[1] - 20))
    # (fake signature text, style, bias, tool, colour, x-height, date, rule index, x)
    # Low bias makes the model scrawl letter-like strokes that spell nothing.
    entries = [
        ("Mmwrnlh", 2, 0.35, "ballpoint", (28, 36, 96), 40, "Oct 1", 7, 150),
        ("lnwmrr", 9, 0.35, "gel", (20, 20, 24), 34, "Oct 2", 9, 300),
        ("Hmmnvl", 5, 0.35, "fineliner", (24, 26, 40), 36, "Oct 3", 11, 190),
        ("mwlnnr", 11, 0.35, "pencil", (78, 78, 84), 40, "Oct 4", 13, 360),
        ("Wmrnhm", 7, 0.35, "ballpoint", (30, 40, 110), 38, "Oct 5", 15, 160),
        ("vnmlw", 1, 0.35, "gel", (110, 30, 36), 38, "Oct 6", 17, 260),
    ]
    for k, (sig, style, bias, tool, col, size, date, ri, x) in enumerate(entries):
        hw.write_learned(img, [sig], x, [RULES[ri]], style=style, bias=bias, tool=tool, color=col,
                         size=size, surface="notebook", seed=40 + k, slant=[-6, 4, 0, 10, -3, 6][k], max_width=820)
        hw.write_learned(img, [date], 1130 + (k % 3) * 40, [RULES[ri]], style=style, bias=0.85, tool=tool,
                         color=col, size=size * 0.55, surface="notebook", seed=[60, 83, 62, 63, 64, 65][k])
    img.save(OUT / "left.png")
    print("left", img.size)


def right():
    img = page(32, gutter_right=False)
    img.save(OUT / "right.png")
    print("right", img.size)


if __name__ == "__main__":
    left()
    right()
