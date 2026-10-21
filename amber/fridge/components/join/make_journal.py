"""Builds the guest journal's pages and the host's date ink.

    python3 components/join/make_journal.py

Writes into public/kitchen/journal/:

- page-standin.png   the blank right page, used until the 3D track ships
                     public/kitchen/layers/journal-page.webp
- page-left.png      the left page, five earlier guests: a loose signature and
                     a date each, every guest in their own hand and pen
- dates/*.png        "Oct" and "7" in the host's hand, composed at runtime
                     into today's date beside the visitor's line

and components/join/journal-dates.ts, the measured ink box of every date
piece, so the runtime can set "Oct" and "7" on the rule a hand would.

Both pages print the same ruling, RULE_TOP and RULE_PITCH, which match the
fallback in components/join/journal.ts. The component measures the rules off
whichever page image it loads, so a real render with different ruling still
gets its fields on its own rules.

The model invents letters at low bias, so every piece of ink this writes is
read back by eye from the contact sheet saved next to the script's output
(public/kitchen/journal/contact.png is deleted after review).
"""

import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/kitchen/journal"
TS = Path(__file__).resolve().parent / "journal-dates.ts"

W, H = 920, 1280
RULE_TOP = 0.11
RULE_PITCH = 0.05
RULE_COUNT = 16
# A guest book's ruling stops short of the edges, the way a printed form does.
RULE_X = (0.05, 0.95)
CREAM = (247, 242, 229)

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# The host dates each line in one hand with one pen.
HOST = dict(style=9, bias=0.95, tool="ballpoint", color=(34, 38, 64), size=22, surface="notebook")


def rules_px():
    return [round((RULE_TOP + i * RULE_PITCH) * H, 2) for i in range(RULE_COUNT)]


def print_rules(rgb, spine_left, rng, first=0):
    """Faint grey-blue printed rules that dip into the gutter as the page curves.

    Ink density drifts along each rule and the paper multiplies through it, so
    a rule is printed ink rather than a vector line.
    """
    h, w, _ = rgb.shape
    xs = np.arange(w, dtype=np.float32)
    dist_spine = xs if spine_left else (w - 1 - xs)
    # Near the binding the page bends down into the gutter, so the rules do too.
    # The page is bent in 3D at runtime, so the rules are printed straight.
    dip = 0.0 * dist_spine
    x0, x1 = RULE_X[0] * w, RULE_X[1] * w
    span = np.clip((xs - x0) / 2.0, 0, 1) * np.clip((x1 - xs) / 2.0, 0, 1)
    yy = np.arange(h, dtype=np.float32)[:, None]
    tint = np.array((150, 168, 196), dtype=np.float32) / 255.0
    for y in rules_px()[first:]:
        drift = np.zeros(w, dtype=np.float32)
        for period, amp in ((w / 1.4, 0.1), (w / 6.0, 0.06), (w / 31.0, 0.05)):
            drift += amp * np.sin(xs / period * 2 * np.pi + rng.uniform(0, 6.28))
        density = np.clip(0.42 * (1 + drift + rng.uniform(-0.04, 0.04)), 0, 1) * span
        centre = y + dip + xs * rng.uniform(-0.4, 0.4) / w
        profile = np.clip(1 - (np.abs(yy - centre[None, :]) - 0.8) / 0.9, 0, 1)
        cover = profile * density[None, :]
        rgb *= 1 - cover[..., None] * (1 - tint[None, None, :])


def curl(rgb, spine_left):
    """Only what the binding itself does to the paper.

    The page's curve and its light are built in 3D at runtime (CurvedPage in
    JoinCard.tsx), so this keeps just a thin darkening where the sheet is
    sewn and glued into the spine, and a hair at the outer cut edge.
    """
    h, w, _ = rgb.shape
    xs = np.arange(w, dtype=np.float32)
    d = xs if spine_left else (w - 1 - xs)
    f = 1 - 0.1 * np.exp(-d / 9.0)
    outer = (w - 1 - xs) if spine_left else xs
    f *= 1 - 0.025 * np.exp(-outer / 10.0)
    rgb *= f[None, :, None]


def page(spine_left, seed, first_rule=0):
    img = sheet(W, H, CREAM, scan="paper002", strength=0.7, crumple=0.0, fold=None, wear=0.18, seed=seed, alpha=False)
    rgb = np.asarray(img, dtype=np.float32)[..., :3].copy()
    rng = random.Random(f"journal-rules-{seed}")
    print_rules(rgb, spine_left, rng, first_rule)
    curl(rgb, spine_left)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


# Five earlier guests, oldest first. Loose initials, never a readable name:
# Caleb's rule is no real people on the site.
GUESTS = [
    dict(date="Sep 14", sig="M. K.", style=2, bias=0.55, tool="ballpoint", color=(30, 44, 120), size=19, slant=6, rule=5, dseed=7),
    dict(date="Sep 21", sig="jd", style=5, bias=0.5, tool="gel", color=(24, 24, 30), size=22, slant=-2, rule=7),
    dict(date="Sep 27", sig="A.L.R", style=11, bias=0.6, tool="fineliner", color=(40, 40, 52), size=17, slant=10, rule=9),
    dict(date="Oct 3", sig="T. O.", style=1, bias=0.55, tool="ballpoint", color=(22, 30, 96), size=20, slant=3, rule=12),
    dict(date="Oct 5", sig="sw", style=7, bias=0.5, tool="pencil", color=(58, 58, 66), size=21, slant=14, rule=14, dseed=9),
]


# The last line of Amber's original homepage essay, printed in the book the
# way a publisher sets an epigraph: a modest book face, small, italic. The
# rest of the essay is told by the objects on the fridge.
EPIGRAPH = (
    "AI shouldn't be a cold, static world. It should be the tool that allows "
    "us to be our most human selves, and do what humans do best: find "
    "patterns and make connections."
)
EPIGRAPH_FONT = ("/System/Library/Fonts/Supplemental/Charter.ttc", 1)
# The left page's ruling starts below the epigraph, at this rule.
LEFT_FIRST_RULE = 3


def letterpress(pg, text, x, y, width, size, seed):
    """Type pressed into paper rather than laid over it.

    Set at 4x and brought down, so the edges are the face's own. The ink
    spreads a fraction of a pixel into the fibre, its density drifts across
    the forme, and a faint shadow under each letter is the bite of the type
    into the sheet.
    """
    from PIL import ImageDraw, ImageFilter, ImageFont

    k = 4
    font = ImageFont.truetype(EPIGRAPH_FONT[0], size * k, index=EPIGRAPH_FONT[1])
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if font.getlength(trial) > width * k and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = trial
    lines.append(cur)
    lead = size * 1.42
    hgt = int(lead * len(lines) + size * 2)
    mask = Image.new("L", (int(width * k + 40 * k), hgt * k), 0)
    d = ImageDraw.Draw(mask)
    for i, ln in enumerate(lines):
        d.text((0, int(i * lead * k)), ln, font=font, fill=255)
    mask = mask.resize((mask.width // k, mask.height // k), Image.LANCZOS)
    m = np.asarray(mask.filter(ImageFilter.GaussianBlur(0.35)), dtype=np.float32) / 255
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0 : m.shape[0], 0 : m.shape[1]].astype(np.float32)
    density = 0.86 + 0.07 * np.sin(xx / 97 + rng.uniform(0, 6)) * np.sin(yy / 41 + rng.uniform(0, 6))
    grain = np.asarray(Image.fromarray((rng.random(m.shape) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255
    ink = np.clip(m * density * (0.9 + 0.12 * grain), 0, 1)
    bite = np.roll(np.roll(m, 1, axis=0), 1, axis=1) * 0.07
    arr = np.asarray(pg, dtype=np.float32)
    ys, xs_ = slice(int(y), int(y) + m.shape[0]), slice(int(x), int(x) + m.shape[1])
    region = arr[ys, xs_, :3]
    ink_rgb = np.array((44, 40, 38), dtype=np.float32) / 255
    a = ink[: region.shape[0], : region.shape[1], None]
    b = bite[: region.shape[0], : region.shape[1], None]
    region *= (1 - b) * (1 - a * (1 - ink_rgb))
    arr[ys, xs_, :3] = region
    pg.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA"))


def left_page():
    pg = page(spine_left=False, seed=21, first_rule=LEFT_FIRST_RULE)
    letterpress(pg, EPIGRAPH, x=W * 0.14, y=H * 0.075, width=W * 0.64, size=23, seed=5)
    ys = rules_px()
    for i, g in enumerate(GUESTS):
        base = ys[g["rule"]]
        common = dict(style=g["style"], tool=g["tool"], color=g["color"], surface="notebook", seed=40 + i)
        hw.write_learned(pg, [g["date"]], x=W * 0.07, baselines=[base - 2], bias=0.9, size=12, **{**common, "seed": g.get("dseed", common["seed"])})
        hw.write_learned(pg, [g["sig"]], x=W * 0.25, baselines=[base - 3], bias=g["bias"], size=g["size"], slant=g["slant"], max_width=W * 0.45, **common)
    pg.convert("RGB").save(OUT / "page-left.png", optimize=True)


def _ink_box(canvas, x_from=0):
    a = np.asarray(canvas, dtype=np.float32)[..., :3].min(axis=2)
    inked = np.where(a[:, x_from:] < 250)
    x0 = x_from + inked[1].min()
    x1 = x_from + inked[1].max()
    return a, x0, x1, inked[0].min(), inked[0].max()


def date_piece(text, seed):
    """One word or number of the host's date, ink only, on white.

    White multiplies away on the page, so the paper under it shows through.
    The model writes a lone number badly (a 7 came out as a caret, a 1 as a
    long dash), and well in context, so a day is written as "Oct 17" and
    the number is cut out after the gap between the two words.
    """
    day = text.isdigit()
    canvas = Image.new("RGBA", (380 if day else 260, 90), (255, 255, 255, 255))
    # Months were read back and kept at bias 0.9; days at 0.95 read cleaner.
    pen = {**HOST, "bias": HOST["bias"] if day else 0.9}
    hw.write_learned(canvas, [f"Oct {text}" if day else text], x=12, baselines=[58], seed=seed, **pen)
    a, x0, x1, y0, y1 = _ink_box(canvas)
    if day:
        # The widest run of blank columns inside the ink is the word gap.
        cols = (a < 250).any(axis=0)
        best, run, start, gap_end = 0, 0, 0, x0
        for x in range(x0, x1 + 1):
            if not cols[x]:
                run += 1
            else:
                if run > best:
                    best, gap_end = run, x
                run = 0
        a, x0, x1, y0, y1 = _ink_box(canvas, gap_end)
        rows = np.where((a[:, x0 : x1 + 1] < 250).any(axis=1))[0]
        y0, y1 = rows.min(), rows.max()
    x0, x1 = max(0, x0 - 3), min(canvas.width, x1 + 4)
    y0, y1 = max(0, y0 - 3), min(canvas.height, y1 + 4)
    crop = canvas.crop((x0, y0, x1, y1)).convert("RGB")
    return crop, {"w": int(x1 - x0), "h": int(y1 - y0), "baseline": int(58 - y0)}


def dates(seeds):
    out = OUT / "dates"
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for text in MONTHS + [str(d) for d in range(1, 32)]:
        img, box = date_piece(text, seeds.get(text, 1))
        name = text.lower()
        img.save(out / f"{name}.png", optimize=True)
        meta[name] = box
    lines = [
        "// Generated by components/join/make_journal.py. Do not edit by hand.",
        "// Ink box of each piece of the host's date, in page-image pixels",
        f"// (the page image is {W} px wide). baseline is from the top of the box.",
        "export const DATE_PIECES: Record<string, { w: number; h: number; baseline: number }> = "
        + json.dumps(meta, indent=2)
        + ";",
        f"export const PAGE_IMAGE_W = {W};",
        "",
    ]
    TS.write_text("\n".join(lines))
    return meta


def contact(meta):
    """Every date piece on one sheet, for reading back by eye."""
    names = list(meta)
    cols = 11
    cw, ch = 140, 70
    sheet_img = Image.new("RGB", (cols * cw, ((len(names) + cols - 1) // cols) * ch), "white")
    for i, n in enumerate(names):
        im = Image.open(OUT / "dates" / f"{n}.png")
        sheet_img.paste(im, ((i % cols) * cw + 6, (i // cols) * ch + 6))
    sheet_img.save(OUT / "contact.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    which = sys.argv[1:] or ["standin", "left", "dates"]
    # Seeds picked after reading the contact sheet: the default seed wrote a
    # wrong digit for these.
    seeds = json.loads((Path(__file__).parent / "journal-seeds.json").read_text()) if (Path(__file__).parent / "journal-seeds.json").exists() else {}
    if "standin" in which:
        page(spine_left=True, seed=12).convert("RGB").save(OUT / "page-standin.png", optimize=True)
    if "left" in which:
        left_page()
    if "dates" in which:
        contact(dates(seeds))
    for p in sorted(OUT.rglob("*.png"))[:6]:
        print(p.relative_to(ROOT), p.stat().st_size)


if __name__ == "__main__":
    main()
