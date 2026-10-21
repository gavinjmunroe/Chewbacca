"""Draw the back of every object on the fridge door.

Each back carries one line of the original homepage essay, written by
whoever in the household would have written on that object, in their own
hand and with their own pen. The wording is Caleb's original copy and is
kept exactly. Everything else on a back is what the maker printed there.

Each back is the size of its front in public/kitchen/items. When the front
exists, the back takes the front's own alpha, mirrored the way the object
turns, so corners, holes and worn edges line up after a flip. Cards and
photos turn side to side, so their backs mirror left to right.

Every word was read back from the render before its seed was kept. Seeds
can be auditioned from the environment, e.g. NOTE_SEED=12.
"""

import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FRONTS = ROOT / "public" / "kitchen" / "items"
OUT = Path(os.environ["BACKS_OUT"]) if os.environ.get("BACKS_OUT") else ROOT / "public" / "kitchen" / "backs"
OUT.mkdir(parents=True, exist_ok=True)

SUP = "/System/Library/Fonts/Supplemental/"
SYS = "/System/Library/Fonts/"
FUTURA = SUP + "Futura.ttc"
DIN = SUP + "DIN Condensed Bold.ttf"
HELV = SYS + "Helvetica.ttc"

# A seed is not a stable address for a set of strokes. On 2026-10-07 the
# skill began sampling six candidates per line and keeping the one Vision
# reads back best, and its shared cache was rewritten by parallel renders, so
# "seed 43" came back reading "Cud" where it had read "God" an hour earlier. The strokes behind every kept back are frozen
# here instead, and a line only reaches the model when it is not in this file.
FROZEN = Path(__file__).resolve().parent / "backs-strokes.json"
_model_learned = hw._learned


def _frozen_learned(reqs):
    import hashlib
    import json

    key = lambda r: hashlib.sha1(json.dumps(r, sort_keys=True).encode()).hexdigest()
    frozen = json.loads(FROZEN.read_text()) if FROZEN.exists() else {}
    if os.environ.get("REROLL"):
        for name in os.environ["REROLL"].split(","):
            frozen = {k: v for k, v in frozen.items() if name not in v.get("text", "")}
    todo = [r for r in reqs if key(r) not in frozen]
    if todo:
        for r, strokes in zip(todo, _model_learned(todo)):
            frozen[key(r)] = {"text": r["text"], "strokes": strokes}
        FROZEN.write_text(json.dumps(frozen))
    return [frozen[key(r)]["strokes"] for r in reqs]


hw._learned = _frozen_learned

# Sizes agreed with the integrator, used until the front exists on disk.
SIZES = {
    "note": (900, 1180),
    "down": (760, 980),
    "party": (900, 1180),
    "resume": (900, 1160),
    "bizcard": (700, 400),
    "print": (640, 800),
    "polaroid": (640, 760),
    "race-bib": (900, 760),
    "prayer": (820, 480),
}


def seed(name, default):
    return int(os.environ.get(f"{name.upper().replace('-', '_')}_SEED", default))


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def front(name):
    p = FRONTS / f"{name}.png"
    return Image.open(p).convert("RGBA") if p.exists() else None


def size_of(name):
    f = front(name)
    return f.size if f is not None else SIZES[name]


def mirror(img, axis="x"):
    return img.transpose(Image.FLIP_LEFT_RIGHT if axis == "x" else Image.FLIP_TOP_BOTTOM)


def outline_from_front(back, name, axis="x"):
    """Give the back the front's exact silhouette, mirrored the way it turns.
    Until the front exists, the sheet keeps its own worn corners."""
    f = front(name)
    if f is not None and f.size == back.size:
        a = np.asarray(mirror(f, axis).getchannel("A")).copy()
        # Only the silhouette is taken. A front with see-through ink inside
        # its outline (the card's petals were drawn at alpha 200) must not
        # punch ghost holes through the back.
        inner = np.zeros_like(a, dtype=bool)
        inner[8:-8, 8:-8] = True
        a[inner & (a > 0)] = 255
        back.putalpha(Image.fromarray(a))
    return back


def show_through(back, name, axis="x", strength=0.14, blur=2.2):
    """What a light behind the paper would show of the other side: only the
    marks, softened by the fibre they passed through."""
    f = front(name)
    if f is None or f.size != back.size:
        return back
    f = mirror(f, axis)
    rgb = np.asarray(f.convert("RGB"), dtype=np.float32)
    lum = rgb.mean(axis=2) + 1
    local = np.asarray(f.convert("L").filter(ImageFilter.GaussianBlur(24)), dtype=np.float32) + 1
    dark = np.clip(1 - lum / np.maximum(local, lum.max() * 0.6), 0, 1)
    dark = np.clip((dark - 0.06) / 0.5, 0, 1)
    a = Image.fromarray((dark * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(a, dtype=np.float32) / 255 * strength
    tint = np.asarray(f.convert("RGB").filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) / 255
    grey = tint.mean(axis=2, keepdims=True)
    tint = grey + (tint - grey) * 0.5
    arr = np.asarray(back, dtype=np.float32) / 255
    arr[..., :3] = arr[..., :3] * (1 - a[..., None] * (1 - tint))
    return Image.fromarray((arr * 255).astype(np.uint8), "RGBA")


def light_ink(page, lines, x, baselines, color, **kw):
    """Paint marker on a dark surface. The pen engine multiplies ink into the
    paper, which can only darken, so the stroke shape is drawn on a white
    scratch sheet and then laid over the dark surface as an opaque light mark."""
    scratch = Image.new("RGBA", page.size, (255, 255, 255, 255))
    boxes = hw.write_learned(scratch, lines, x, baselines, color=(0, 0, 0), **kw)
    a = 1 - np.asarray(scratch.convert("L"), dtype=np.float32) / 255
    a = np.clip(a * 1.15, 0, 1)
    rng = np.random.default_rng(7)
    grain = np.asarray(Image.fromarray((rng.random(a.shape) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255
    a *= 0.82 + 0.18 * grain
    arr = np.asarray(page, dtype=np.float32) / 255
    c = np.array(color, dtype=np.float32) / 255
    arr[..., :3] = arr[..., :3] * (1 - a[..., None]) + c * a[..., None]
    page.paste(Image.fromarray((arr * 255).astype(np.uint8), "RGBA"))
    return boxes


def printed(img, xy, text, f, fill, anchor="la", spacing=0.0):
    """Printed type, with the slight softness of ink on stock. Letter spacing
    is laid out by hand, so the anchor is resolved here against the full
    tracked width rather than per character."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = xy
    if spacing:
        width = sum(f.getlength(ch) for ch in text) + spacing * (len(text) - 1)
        if anchor[0] == "r":
            x -= width
        elif anchor[0] == "m":
            x -= width / 2
        va = "l" + anchor[1]
        for ch in text:
            d.text((x, y), ch, font=f, fill=fill, anchor=va)
            x += f.getlength(ch) + spacing
    else:
        d.text((x, y), text, font=f, fill=fill, anchor=anchor)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.35)))


def creases(img, ys, axis="h", depth=1.0):
    """Fold lines that changed the sheet's geometry: a valley shadow on one
    side, a lifted highlight on the other, broken fibre on the line."""
    arr = np.asarray(img, dtype=np.float32)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for fy in ys:
        d = (yy - fy - (xx - w / 2) * 0.004) if axis == "h" else (xx - fy - (yy - h / 2) * 0.004)
        arr[..., :3] *= (1 - depth * (0.05 * np.exp(-((d + 9) / 16) ** 2) - 0.03 * np.exp(-((d - 10) / 22) ** 2)))[..., None]
        arr[..., :3] *= (1 - depth * 0.08 * np.exp(-(d / 1.4) ** 2))[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def save(img, name):
    img.save(OUT / f"{name}.png", optimize=True)
    img.save(OUT / f"{name}.webp", quality=88, method=6)
    print("wrote", name, img.size)


def note():
    """The reverse of the punched notebook sheet: the same writer carries the
    thought on overleaf in blue ballpoint. Filler paper is ruled on both
    sides; the red margin is printed on the front only and shows through,
    with the holes and the crease mirrored from the front."""
    w, h = size_of("note")
    img = sheet(w, h, (250, 248, 240), crumple=0.35, seed=31)
    d = ImageDraw.Draw(img)
    rules = list(range(176, h - 40, 72))
    for y in rules:
        d.line([(40, y), (w - 40, y)], fill=(172, 198, 224, 255), width=2)
    lines = [
        "Not sure if it's a like-minded",
        "friend or a well-made bot.",
        "You're just hoping to raise",
        "a number to feel more",
        "connected.",
        "Can social networking be",
        "any different?",
    ]
    hw.write_learned(img, lines, 84, [r - 5 for r in rules], style=9, bias=0.85, tool="ballpoint",
                     color=(28, 36, 88), size=21, surface="notebook", seed=seed("note", 12), max_width=700)
    img = creases(img, (h / 3,), depth=0.8)
    img = show_through(img, "note", strength=0.1, blur=1.8)
    img = outline_from_front(img, "note")
    save(img, "note")


def down():
    """Back cover of a folded greeting card: heavy matte stock, a small
    printer's line at the foot, and someone's black gel pen."""
    w, h = size_of("down")
    img = sheet(w, h, (246, 243, 236), strength=0.9, wear=0.35, seed=32)
    printed(img, (w / 2, h - 70), "PRINTED ON RECYCLED PAPER", font(FUTURA, 11), (150, 146, 140, 220), anchor="ms", spacing=1.6)
    baselines = [300, 368, 436, 504]
    # This writer's model always trails a tick after a final full stop, so
    # the line is written without it and the pen comes back for the dot.
    boxes = hw.write_learned(img, ["Seeing a friend who is down", "and recognizing what has made", "you feel better in those", "same situations"],
                             88, baselines, style=6, bias=0.85, tool="gel", color=(20, 20, 26), size=17,
                             surface="card", seed=seed("down", 5), max_width=w - 170, trim_tail=True)
    dot = np.zeros((h, w), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = boxes[3][2] + 7, baselines[3] - 1.5
    dot += np.clip(2.6 - np.hypot((xx - dx) * 0.9, yy - dy), 0, 1)
    hw.ink_onto(img, dot, (20, 20, 26))
    img = outline_from_front(img, "down")
    save(img, "down")


def party():
    """The back of a printed plan: printer paper, the plan coming through,
    and the line in pencil, written fast on the kitchen counter."""
    w, h = size_of("party")
    img = sheet(w, h, (251, 251, 248), strength=1.0, crumple=0.25, seed=33)
    img = show_through(img, "party", strength=0.09, blur=2.0)
    hw.write_learned(img, ["Coming up with a plan for an", "event and thinking of the", "perfect people to help", "execute it."],
                     110, [250, 330, 410, 490], style=12, bias=0.85, tool="pencil", color=(64, 64, 70), size=21,
                     surface="printer", seed=seed("party", 7), max_width=w - 220)
    img = creases(img, (h / 2,), depth=0.6)
    img = outline_from_front(img, "party")
    save(img, "party")


def resume():
    """Back of a printed resume page: the type shows through mirrored, and
    the note is in blue ballpoint from whoever was passing it along."""
    w, h = size_of("resume")
    img = sheet(w, h, (252, 252, 250), strength=0.9, seed=34)
    img = show_through(img, "resume", strength=0.12, blur=1.4)
    hw.write_learned(img, ["Introducing your little sister,", "who's looking for an internship,", "to your friend's company because", "you know it'd be a good fit."],
                     96, [h - 420, h - 352, h - 284, h - 216], style=10, bias=0.85, tool="ballpoint", color=(28, 40, 120),
                     size=17, surface="printer", seed=seed("resume", 12), max_width=w - 190)
    img = outline_from_front(img, "resume")
    save(img, "resume")


def bizcard():
    """Back of a business card, blank stock. The first two lines are the
    note you write the night you meet someone; the last runs small along the
    bottom because the card ran out of room."""
    w, h = size_of("bizcard")
    img = sheet(w, h, (248, 247, 243), strength=0.7, wear=0.4, seed=35)
    hw.write_learned(img, ["Met at Maya's party.", "Needs a designer."], 54, [112, 168], style=5, bias=0.85,
                     tool="ballpoint", color=(26, 30, 80), size=17, surface="card", seed=seed("bizcard", 3), max_width=w - 110)
    hw.write_learned(img, ["Turning the connection you never", "knew you had into your next client."], 54, [282, 324],
                     style=5, bias=0.85, tool="ballpoint", color=(26, 30, 80), size=10, surface="card",
                     seed=seed("bizcard-small", 67), max_width=w - 110)
    img = outline_from_front(img, "bizcard")
    save(img, "bizcard")


def art_print():
    """A small print in a glassine sleeve, seen from behind: grey chipboard
    backing seen through the translucent glassine, the sleeve's back seam,
    and the line in pencil on the board."""
    w, h = size_of("print")
    board = sheet(w, h, (168, 164, 156), scan="paper002", strength=1.3, wear=0.5, seed=36)
    hw.write_learned(board, ["Meeting that friend of a friend", "who is selling the exact art", "you wanted."],
                     70, [300, 356, 412], style=8, bias=0.85, tool="pencil", color=(30, 30, 34), size=15,
                     surface="cardboard", seed=seed("print", 9), max_width=w - 130, pressure=1.3)
    arr = np.asarray(board, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Glassine: a milky veil with a slow cloud in it and a soft sheen band.
    rng = np.random.default_rng(36)
    n = rng.random((h // 40 + 2, w // 40 + 2)).astype(np.float32)
    cloud = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
    veil = 0.2 + 0.06 * cloud + 0.08 * np.exp(-((xx + yy * 0.5 - w * 0.75) / (w * 0.18)) ** 2)
    arr[..., :3] = arr[..., :3] * (1 - veil[..., None]) + 246 * veil[..., None]
    # The sleeve's back seam runs up the middle, a strip of double glassine.
    seam = np.exp(-((xx - w * 0.52) / 14) ** 8)
    arr[..., :3] = arr[..., :3] * (1 - 0.1 * seam[..., None]) + 250 * 0.1 * seam[..., None]
    arr[..., :3] *= (1 - 0.06 * np.exp(-((np.abs(xx - w * 0.52) - 14) / 1.5) ** 2))[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    img = outline_from_front(img, "print")
    save(img, "print")


def polaroid():
    """Integral instant film has a black plastic back. Ballpoint and Sharpie
    vanish on it, so the line is in a silver paint marker."""
    w, h = size_of("polaroid")
    base = sheet(w, h, (30, 30, 32), strength=0.25, wear=0.2, seed=21)
    arr = np.asarray(base, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sheen = np.exp(-(((xx - w * 0.28) / (w * 0.5)) ** 2 + ((yy - h * 0.22) / (h * 0.45)) ** 2))
    arr[..., :3] += sheen[..., None] * 14
    # The bottom border is thicker over the chemistry pod, so its edge
    # catches the light as a raised seam.
    seam_y = h - 128
    arr[..., :3] += (np.exp(-((yy - seam_y) / 2.0) ** 2) * 16)[..., None]
    arr[..., :3] -= (np.exp(-((yy - seam_y - 5) / 3.0) ** 2) * 8)[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    grey = (112, 112, 116, 255)
    printed(img, (w - 40, 40), "INSTANT FILM", font(HELV, 13), grey, anchor="rs", spacing=1.5)
    printed(img, (40, h - 40), "DO NOT CUT OR SEPARATE", font(HELV, 11), grey, anchor="ls", spacing=1.2)
    printed(img, (w - 40, h - 40), "2307 0418", font(HELV, 11), grey, anchor="rs", spacing=1.2)
    light_ink(img, ["Finding the perfect group", "for that road trip you've", "been wanting to take."], 76, [262, 326, 390],
              (214, 216, 220), style=1, bias=0.85, tool="marker", size=14, surface="glossy",
              seed=seed("polaroid", 18), max_width=w - 150)
    img = outline_from_front(img, "polaroid")
    save(img, "polaroid")


def tyvek(w, h, s):
    """Spun-bonded fibre: white, the cloudy flecked web Tyvek shows in
    raking light, and creases from being pinned to a running shirt."""
    img = sheet(w, h, (250, 250, 249), strength=0.5, crumple=0.8, wear=0.15, seed=s)
    rng = np.random.default_rng(s)
    web = np.zeros((h, w), dtype=np.float32)
    for scale, amp in ((3, 0.5), (9, 0.35), (22, 0.25)):
        n = rng.random((h // scale + 2, w // scale + 2)).astype(np.float32)
        n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
        web += (n - 0.5) * amp
    arr = np.asarray(img, dtype=np.float32)
    arr[..., :3] *= (1 + web * 0.05)[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def race_bib():
    """The Tyvek back: the medical panel every bib prints, the timing strip,
    the safety-pin holes, and a finish time in pen."""
    w, h = size_of("race-bib")
    img = tyvek(w, h, 25)
    img = show_through(img, "race-bib", strength=0.07, blur=3.2)
    grey = (128, 130, 136, 255)
    printed(img, (70, 200), "EMERGENCY CONTACT", font(DIN, 26), grey, spacing=1.2)
    d = ImageDraw.Draw(img)
    for y in (262, 316):
        d.line([(70, y), (w - 70, y)], fill=(196, 198, 204, 255), width=2)
    printed(img, (70, 360), "MEDICAL CONDITIONS", font(DIN, 26), grey, spacing=1.2)
    for y in (422, 476):
        d.line([(70, y), (w - 70, y)], fill=(196, 198, 204, 255), width=2)
    strip = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(strip)
    sx0, sy0, sx1, sy1 = 120, h - 168, w - 120, h - 104
    sd.rounded_rectangle([sx0 + 3, sy0 + 5, sx1 + 3, sy1 + 6], 8, fill=(0, 0, 0, 40))
    strip = strip.filter(ImageFilter.GaussianBlur(4))
    sd = ImageDraw.Draw(strip)
    sd.rounded_rectangle([sx0, sy0, sx1, sy1], 8, fill=(236, 236, 232, 255), outline=(204, 204, 200, 255), width=2)
    sd.rounded_rectangle([sx0 + 250, sy0 + 10, sx0 + 410, sy1 - 10], 6, fill=(226, 226, 222, 255))
    img.alpha_composite(strip)
    printed(img, (w / 2, sy0 + 34), "TIMING CHIP INSIDE. DO NOT FOLD OR REMOVE.", font(DIN, 20), (120, 120, 124, 255), anchor="mm")
    hw.write_learned(img, ["4:12:38"], w - 300, [h - 216], style=9, bias=0.9, tool="ballpoint",
                     color=(24, 28, 70), size=24, surface="card", seed=seed("race-bib", 32))
    # Safety pins go in and out at each corner: a pair of holes with a
    # little puckered tear, mirrored from the printed targets on the front.
    arr = np.asarray(img, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rng = np.random.default_rng(5)
    holes = np.zeros((h, w), dtype=bool)
    for fx, fy in ((40, 190), (w - 40, 190), (40, h - 150), (w - 40, h - 150)):
        bx = w - fx
        for dy in (-12, 12):
            hx, hy = bx + rng.uniform(-3, 3), fy + dy + rng.uniform(-2, 2)
            r = np.hypot(xx - hx, yy - hy)
            holes |= r < 2.6
            arr[..., :3] *= (1 - 0.22 * np.exp(-((r - 4) / 2.2) ** 2))[..., None]
            arr[..., :3] *= (1 - 0.06 * np.exp(-(((xx - hx) / 3) ** 2 + ((yy - hy - 9 * np.sign(-dy)) / 9) ** 2)))[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    img = outline_from_front(img, "race-bib")
    a = np.asarray(img.getchannel("A")).copy()
    a[holes] = 0
    img.putalpha(Image.fromarray(a))
    save(img, "race-bib")


def prayer():
    """The plain reverse of the index card. Index cards are ruled on one side,
    so the rules and the pencil list only show through faintly, and the hand
    that rested on the front left a graphite smudge. One line, in the same
    pencil hand as the list (style 12), a reminder to oneself."""
    w, h = size_of("prayer")
    img = sheet(w, h, (250, 249, 244), strength=0.9, wear=0.6, seed=39)
    img = show_through(img, "prayer", strength=0.13, blur=1.6)
    hw.write_learned(img, ["Talk to God before you talk", "to anyone else today."], 70, [214, 280], style=12, bias=0.95,
                     tool="pencil", color=(70, 70, 76), size=17, surface="card", seed=seed("prayer", 43), max_width=w - 140)
    # The heel of a hand dragged across the pencil on the front, then rested
    # here: a soft grey smear near one edge, darker where it pressed.
    arr = np.asarray(img, dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rng = np.random.default_rng(39)
    n = rng.random((h // 6 + 2, w // 6 + 2)).astype(np.float32)
    grain = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
    u, v = (xx - w * 0.82) / 90, (yy - h * 0.74) / 34
    smudge = np.exp(-(u * u + v * v + 0.6 * u * v)) * (0.6 + 0.4 * grain)
    arr[..., :3] *= (1 - 0.07 * smudge)[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    img = outline_from_front(img, "prayer")
    save(img, "prayer")


JOBS = {
    "note": note,
    "down": down,
    "party": party,
    "resume": resume,
    "bizcard": bizcard,
    "print": art_print,
    "polaroid": polaroid,
    "race-bib": race_bib,
    "prayer": prayer,
}

if __name__ == "__main__":
    only = sys.argv[1:] or list(JOBS)
    for name in only:
        JOBS[name]()
