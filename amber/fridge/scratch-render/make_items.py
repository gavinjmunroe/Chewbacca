"""Draw the paper on the fridge door.

Every item is a PNG with a transparent background so the page can drop its
own shadow under it and flutter it on hover. Drawn at roughly twice the size
it shows at, because clicking an item zooms the kitchen in on it.
"""

import random
from pathlib import Path

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# The pen engine lives in Chewbacca's handwriting skill, so every project draws
# ink the same physical way instead of setting a font and roughing it up.
sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "public" / "kitchen" / "items"
OUT.mkdir(parents=True, exist_ok=True)
SUP = "/System/Library/Fonts/Supplemental/"
SYS = "/System/Library/Fonts/"
random.seed(7)

# Seeds that produced the right words. The model sometimes writes "content"
# for "context" or adds a "!", so each note is read back before a seed is kept.
LETTER_SEED = int(__import__("os").environ.get("LETTER_SEED", 11))
POLAROID_SEED = int(__import__("os").environ.get("POLAROID_SEED", 14))


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


BRADLEY = SUP + "Bradley Hand Bold.ttf"
NOTE = SYS + "Noteworthy.ttc"
MARKER = SYS + "MarkerFelt.ttc"
CHALK = SUP + "ChalkboardSE.ttc"
TYPE = SUP + "AmericanTypewriter.ttc"
DIN = SUP + "DIN Condensed Bold.ttf"
DIDOT = SUP + "Didot.ttc"
SNELL = SUP + "SnellRoundhand.ttc"
FUTURA = SUP + "Futura.ttc"


def scrawl(img, xy, text, path, size, color, index=0, slope=None, seed=None, medium="ballpoint", surface="paper", on_line=None):
    """Write like a hand, not a font.

    Every glyph is drawn on its own layer with its own rotation, size, baseline
    and ink density, the line drifts up or down across its length, and the
    spacing breathes. Caleb looked at the first version, set in Bradley Hand
    straight off the font, and called it too perfect: a font repeats the same
    'e' identically every time, which no pen does.
    """
    rnd = random.Random(seed if seed is not None else text)
    target = img
    img = Image.new("RGBA", target.size, (0, 0, 0, 0))
    x, y = xy
    slope = rnd.uniform(-0.018, 0.012) if slope is None else slope
    start_x = x
    word_tilt = 0.0
    drift = 0.0  # a smooth random walk, so the line wanders instead of buzzing
    lean = rnd.uniform(-1.5, 1.5)
    n_chars = max(1, len(text))
    i_char = 0
    for ch in text:
        if ch == " ":
            x += size * rnd.uniform(0.26, 0.38)
            word_tilt = rnd.uniform(-1.2, 1.2)
            continue
        # Scale carries the hand more than wobble does: a line starts a touch
        # big and tightens as the writer runs out of room, and capitals stand
        # tall. Per-letter jitter stays small. The noisy version had letters
        # spinning +-8 degrees and Caleb called it "too messy".
        taper = 1.05 - 0.10 * (i_char / n_chars)
        cap = 1.06 if ch.isupper() else 1.0
        sz = max(8, int(size * taper * cap * rnd.uniform(0.96, 1.04)))
        i_char += 1
        drift = max(-3.5, min(3.5, drift + rnd.uniform(-0.8, 0.8)))
        f = font(path, sz, index)
        bbox = f.getbbox(ch)
        cw, chh = bbox[2] - bbox[0] + 8, int(sz * 1.6)
        layer = Image.new("RGBA", (cw + 16, chh), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ink = rnd.randint(185, 255)
        r, g, b = color[:3]
        dv = rnd.randint(-14, 14)
        ink_rgba = (max(0, r + dv), max(0, g + dv), max(0, b + dv), ink)
        # pen pressure: some strokes go down heavier than others
        ld.text((8 - bbox[0], 4), ch, font=f, fill=ink_rgba, stroke_width=1 if rnd.random() < 0.35 else 0, stroke_fill=ink_rgba)
        layer = layer.rotate(rnd.uniform(-2.5, 2.5) + word_tilt + lean, resample=Image.BICUBIC, expand=False)
        if on_line is not None:
            # Sit on the ruling: people write between the lines, so the
            # baseline lands just above the rule and only the wander moves it.
            # The first version used the glyph's top as y and floated every
            # line through the rule below it.
            ascent = f.getmetrics()[0]
            by = on_line - 4 - ascent - 3 + (x - start_x) * slope * 0.3 + drift * 0.5
        else:
            by = y + (x - start_x) * slope + drift + rnd.uniform(-0.8, 0.8)
        img.alpha_composite(layer, (int(x - 8), int(by)))
        adv = f.getlength(ch)
        x += adv * rnd.uniform(0.96, 1.02)
    target.alpha_composite(lay_ink(img, medium, surface, color, rnd.randint(0, 99999)))
    return x


def _noise(size, scale, seed):
    """Value noise in 0..1: scale is the feature size in pixels."""
    rng = np.random.default_rng(seed)
    w, h = size
    small = rng.random((max(2, h // scale + 2), max(2, w // scale + 2))).astype(np.float32)
    big = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(big, dtype=np.float32) / 255.0


def lay_ink(ink, medium, surface, color, seed):
    """Make a mark look like the tool that made it, on the thing it was made on.

    Caleb, 2026-10-07: "Make sure pencil and pen look like pencil and pen, and
    make sure based on the surface they are on they actually look like that
    surface." The glyph shapes come from scrawl(). This decides what the line
    is made of:

      ballpoint  thin and even, oily blue-black, skips where the ball runs dry,
                 and skips more on coated card than on notebook paper
      pencil     grey graphite that only catches the tops of the paper grain
      sharpie    flat black, fattened, a soft halo on paper, crisp on plastic
      fineliner  dark, even, a hair of bleed into matte card
      crayon     waxy, the grain shows through in streaks
    """
    a = np.asarray(ink.getchannel("A"), dtype=np.float32) / 255.0
    w, h = ink.size
    r, g, b = color[:3]
    if medium == "ballpoint":
        # Thinned, never erased: a font already drawn thin loses whole strokes
        # to a min filter, which is how "bring the bp log" went half missing.
        thin = np.asarray(ink.getchannel("A").filter(ImageFilter.MinFilter(3)), dtype=np.float32) / 255.0
        a = np.maximum(thin, a * 0.7)
        dry = _noise(ink.size, 26, seed)
        skip_at = 0.10 if surface == "coated" else 0.05
        a *= np.clip((dry - skip_at) / 0.12, 0.5, 1.0)
        a *= 0.94
        blur = 0.35
    elif medium == "pencil":
        # Graphite catches the tops of the grain: fine, even speckle, never
        # gaps big enough to read as a dotted line.
        tooth = _noise(ink.size, 1, seed)
        fibre = _noise(ink.size, 5, seed + 1)
        catch = np.clip((tooth * 0.55 + fibre * 0.45 - 0.12) / 0.45, 0.4, 1.0)
        a = a * catch * 0.82
        blur = 0.3
    elif medium == "sharpie":
        # Felt tip lays a flat, solid line. It only spreads on porous paper.
        if surface != "slick":
            fat = np.asarray(ink.getchannel("A").filter(ImageFilter.MaxFilter(3)), dtype=np.float32) / 255.0
            a = np.maximum(a, fat * 0.9)
        blur = 0.35 if surface == "slick" else 1.0
    elif medium == "fineliner":
        blur = 0.6
    elif medium == "crayon":
        tooth = _noise(ink.size, 2, seed)
        streak = np.asarray(Image.fromarray((_noise((w, h // 3 + 1), 3, seed + 2) * 255).astype(np.uint8)).resize((w, h)), dtype=np.float32) / 255.0
        a = a * np.clip((tooth * 0.6 + streak * 0.4 - 0.22) / 0.45, 0.0, 1.0)
        blur = 0.2
    else:
        blur = 0.4
    a = np.clip(a, 0, 1)
    out = Image.new("RGBA", ink.size, (r, g, b, 0))
    alpha = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    if medium == "sharpie" and surface != "slick":
        halo = alpha.filter(ImageFilter.GaussianBlur(2.2)).point(lambda v: int(v * 0.28))
        alpha = Image.fromarray(np.maximum(np.asarray(alpha), np.asarray(halo)))
    rgb = ink.convert("RGB")
    out = Image.merge("RGBA", (*rgb.split(), alpha))
    return out


def paper(w, h, base=(250, 246, 236), grain=6, **kw):
    """Real paper from the CC0 scans in Chewbacca's handwriting skill.

    The old version filled one flat colour and sprinkled per-pixel static, and
    Caleb read it as AI on sight: "completely monotone and flat, no texture".
    """
    return sheet(w, h, base, **kw)


def save(img, name):
    img.save(OUT / f"{name}.png", optimize=True)
    print("wrote", name, img.size)


def letter():
    """Sagar's own July 2026 post, set on a ruled notebook page."""
    w, h = 900, 1180
    img = paper(w, h, (250, 248, 240), crumple=0.45, fold=0.47, seed=1)
    d = ImageDraw.Draw(img)
    for y in range(176, h - 40, 72):
        d.line([(40, y), (w - 40, y)], fill=(168, 196, 222, 255), width=2)
    d.line([(110, 0), (110, h)], fill=(226, 140, 140, 255), width=2)
    for y in (90, h // 2, h - 90):
        d.ellipse([28, y - 16, 60, y + 16], fill=(0, 0, 0, 0))
    hand = font(BRADLEY, 50)
    lines = [
        "None of us have a good",
        "place to remember our",
        "relationships. A place to",
        "actually remember the",
        "people in my life.",
        "",
        "21 years of context, and",
        "my memory was the",
        "bottleneck.",
        "",
        "A common save file for",
        "the people who make you",
        "happier and healthier.",
    ]
    rules = [176 + 72 * i - 5 for i in range(len(lines) + 2)]
    # One writer for the whole note: learned style 3, careful enough that
    # every word reads, in blue ballpoint on notebook paper.
    hw.write_learned(img, lines, 130, rules, style=3, bias=0.85, tool="ballpoint", color=(30, 38, 92), size=16, surface="notebook", seed=LETTER_SEED, max_width=700)
    hw.write_learned(img, ["Sagar"], 600, [rules[len(lines)] + 6], style=3, bias=0.75, tool="ballpoint", color=(30, 38, 92), size=22, surface="notebook", seed=2)
    # punched holes go through the sheet
    alpha = img.getchannel("A")
    ad = ImageDraw.Draw(alpha)
    for y in (90, h // 2, h - 90):
        ad.ellipse([28, y - 16, 60, y + 16], fill=0)
    img.putalpha(alpha)
    save(img, "letter")


def save_the_date():
    w, h = 700, 980
    img = paper(w, h, (244, 236, 224), strength=1.4, wear=0.3, seed=2)
    d = ImageDraw.Draw(img)
    d.rectangle([28, 28, w - 28, h - 28], outline=(176, 120, 72, 255), width=3)
    d.rectangle([42, 42, w - 42, h - 42], outline=(176, 120, 72, 255), width=1)
    d.text((w / 2, 170), "save the date", font=font(SNELL, 92, 1), fill=(120, 72, 40, 255), anchor="mm")
    d.text((w / 2, 380), "PRIYA", font=font(DIDOT, 96), fill=(40, 34, 30, 255), anchor="mm")
    d.text((w / 2, 470), "&", font=font(SNELL, 90, 1), fill=(176, 120, 72, 255), anchor="mm")
    d.text((w / 2, 565), "DEV", font=font(DIDOT, 96), fill=(40, 34, 30, 255), anchor="mm")
    d.text((w / 2, 720), "JUNE 14  .  OJAI", font=font(FUTURA, 38), fill=(90, 70, 56, 255), anchor="mm")
    d.text((w / 2, 800), "formal invitation to follow", font=font(DIDOT, 30), fill=(120, 100, 86, 255), anchor="mm")
    save(img, "save-the-date")


def drawing():
    """A kid's crayon drawing, the one every fridge has."""
    w, h = 980, 760
    img = paper(w, h, (252, 251, 247), strength=1.1, seed=3)
    d = ImageDraw.Draw(img)

    import math

    def crayon(points, color, width=14):
        """A kid presses hard and goes over the line twice."""
        ink = Image.new("RGBA", img.size, color + (0,))
        ink_d = ImageDraw.Draw(ink)
        for i in range(3):
            jitter = [(x + random.randint(-4, 4), y + random.randint(-4, 4)) for x, y in points]
            ink_d.line(jitter, fill=color + (255,), width=width - i * 3, joint="curve")
        img.alpha_composite(lay_ink(ink, "crayon", "paper", color, random.randint(0, 9999)))

    def crayon_ring(box, color, width=10):
        ink = Image.new("RGBA", img.size, color + (0,))
        ImageDraw.Draw(ink).ellipse(box, outline=color + (255,), width=width)
        img.alpha_composite(lay_ink(ink, "crayon", "paper", color, random.randint(0, 9999)))

    def crayon_fill(box, color):
        ink = Image.new("RGBA", img.size, color + (0,))
        ImageDraw.Draw(ink).ellipse(box, fill=color + (255,))
        img.alpha_composite(lay_ink(ink, "crayon", "paper", color, random.randint(0, 9999)))

    crayon([(0, 640), (330, 628), (650, 644), (980, 630)], (60, 160, 70), 30)
    crayon([(160, 640), (158, 420), (362, 424), (360, 640)], (220, 70, 60))
    crayon([(140, 430), (262, 296), (384, 432)], (220, 70, 60))
    for cx, cy, c in [(560, 520, (40, 110, 200)), (700, 540, (230, 120, 170)), (820, 520, (240, 160, 40))]:
        crayon([(cx, cy - 80), (cx + 4, cy + 40)], c)
        crayon_ring([cx - 34, cy - 152, cx + 36, cy - 80], c)
        crayon([(cx - 52, cy - 36), (cx + 50, cy - 44)], c, 10)
        crayon([(cx + 4, cy + 40), (cx - 36, cy + 112)], c, 10)
        crayon([(cx + 4, cy + 40), (cx + 34, cy + 108)], c, 10)
    crayon_fill([800, 50, 930, 180], (250, 196, 40))
    for a in range(0, 360, 40):
        x0 = 865 + 80 * math.cos(math.radians(a))
        y0 = 115 + 80 * math.sin(math.radians(a))
        x1 = 865 + random.uniform(112, 130) * math.cos(math.radians(a))
        y1 = 115 + random.uniform(112, 130) * math.sin(math.radians(a))
        crayon([(x0, y0), (x1, y1)], (250, 190, 30), 8)
    hw.write_learned(img, ["to tita"], 70, [150], style=11, bias=0.9, tool="crayon", color=(150, 60, 190), size=50, surface="printer", seed=9, pressure=1.3)
    hw.write_learned(img, ["love Maya"], 96, [250], style=11, bias=0.9, tool="crayon", color=(40, 110, 200), size=36, surface="printer", seed=10, pressure=1.3)
    save(img, "drawing")


def race_bib():
    w, h = 900, 760
    img = paper(w, h, (253, 253, 252), strength=0.8, crumple=0.3, seed=4)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 150], fill=(222, 60, 50, 255))
    d.text((w / 2, 78), "LOS ANGELES MARATHON", font=font(DIN, 84), fill=(255, 255, 255, 255), anchor="mm")
    d.text((w / 2, 400), "2117", font=font(DIN, 330), fill=(20, 20, 24, 255), anchor="mm")
    d.rectangle([0, h - 110, w, h], fill=(30, 60, 140, 255))
    d.text((w / 2, h - 56), "MARCUS + ME  .  WAVE C", font=font(DIN, 60), fill=(255, 255, 255, 255), anchor="mm")
    for x, y in [(40, 190), (w - 40, 190), (40, h - 150), (w - 40, h - 150)]:
        d.ellipse([x - 14, y - 14, x + 14, y + 14], outline=(170, 170, 170, 255), width=4)
    save(img, "race-bib")


def appointment():
    w, h = 820, 480
    img = paper(w, h, (246, 248, 250), strength=0.6, seed=5)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 96], fill=(46, 120, 128, 255))
    d.text((40, 48), "EASTSIDE FAMILY MEDICINE", font=font(FUTURA, 40), fill=(255, 255, 255, 255), anchor="lm")
    d.text((40, 118), "YOUR NEXT APPOINTMENT", font=font(FUTURA, 28), fill=(90, 110, 120, 255))
    for i, y in enumerate((230, 320, 410)):
        d.line([(40, y), (w - 40, y)], fill=(180, 190, 200, 255), width=2)
    pen = font(NOTE, 58)
    # Ballpoint on coated card: it skips more, and the receptionist writes fast.
    hw.write_learned(img, ["Dad with Dr Reyes", "Thurs 2:30 pm", "bring the bp log"], 62, [222, 312, 402], style=5, bias=0.8, tool="ballpoint", color=(28, 50, 140), size=22, surface="glossy", seed=3)
    save(img, "appointment")


def polaroid():
    w, h = 640, 760
    img = paper(w, h, (244, 242, 236), strength=0.45, wear=0.5, seed=8)
    src = Image.open(Path(__file__).parent / "blouberg_sunrise_2.png").convert("RGB")
    photo = src.crop((0, 150, 520, 670)).resize((560, 560))
    img.paste(photo, (40, 40))
    d = ImageDraw.Draw(img)
    # Sharpie on the slick polaroid border: flat black, no bleed.
    hw.write_learned(img, ["big sur '23 with all five of us!!"], 64, [688], style=1, bias=0.85, tool="sharpie", color=(18, 18, 20), size=14, surface="glossy", seed=POLAROID_SEED, max_width=510)
    save(img, "polaroid")


def postcard():
    w, h = 980, 640
    img = paper(w, h, (238, 226, 204), scan="paper002", strength=1.0, wear=0.9, seed=6)
    d = ImageDraw.Draw(img)
    d.line([(w / 2, 50), (w / 2, h - 50)], fill=(160, 140, 120, 255), width=2)
    d.rectangle([w - 190, 50, w - 60, 210], fill=(60, 110, 160, 255), outline=(255, 255, 255, 255), width=8)
    d.text((w - 125, 130), "PT", font=font(DIN, 70), fill=(255, 255, 255, 255), anchor="mm")
    for y in (300, 380, 460):
        d.line([(w / 2 + 40, y), (w - 60, y)], fill=(160, 140, 120, 255), width=2)
    pen = font(BRADLEY, 46)
    hw.write_learned(img, ["Lisbon is", "everything.", "Coming home", "in August!!", "", "miss u!! xo Ana"], 58, [112, 172, 248, 308, 368, 430], style=7, bias=0.8, tool="fineliner", color=(22, 24, 40), size=17, surface="matte", seed=5, max_width=400)
    hw.write_learned(img, ["for the fridge"], w / 2 + 44, [294], style=7, bias=0.8, tool="fineliner", color=(22, 24, 40), size=15, surface="matte", seed=6)
    save(img, "postcard")


def grocery():
    """A to-do pad. The circled line is the whole point of Amber."""
    w, h = 560, 900
    img = paper(w, h, (253, 240, 150), strength=0.9, wear=0.4, seed=7)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 60], fill=(240, 220, 120, 255))
    me = hw.Writer("list-writer", neatness=4, speed=7)
    items = ["eggs", "oat milk", "limes", "call Lola", "birthday card", "Jordan's order?"]
    baselines = [176 + 118 * i for i in range(len(items))]
    boxes = hw.write_learned(img, items, 52, baselines, style=12, bias=0.8, tool="pencil", color=(70, 70, 76), size=24, surface="sticky", seed=7, max_width=440)
    for i in (0, 2):
        x0, y0, x1, y1 = boxes[i]
        # Through the middle of the x-height, not the box: a descender (the
        # g in eggs) drags the box centre down to where it reads as underline.
        hw.strike(img, x0, x1, baselines[i] - 24 * 0.55, me, "pencil", (70, 70, 76), 30, "sticky", seed=i)
    # circled later, by somebody else, in red ballpoint
    x0, y0, x1, y1 = boxes[3]
    hw.loop(img, (x0 - 26, y0 - 22, x1 + 26, y1 + 18), hw.Writer("mom", 6, 6), "ballpoint", (190, 36, 40), 30, "sticky", seed=8)
    save(img, "list")


if __name__ == "__main__":
    letter()
    save_the_date()
    drawing()
    race_bib()
    appointment()
    polaroid()
    postcard()
    grocery()
