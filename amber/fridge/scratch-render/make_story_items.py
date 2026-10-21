"""Draw the fronts of the objects that tell the original homepage essay.

Caleb, 2026-10-07: "I like the original copy from the original letter site, we
just gotta bring all the aspects of it through a more immersive story." Each
example in the essay became a real thing on a family's fridge; its back holds
the essay's line (drawn by the backs track). These are the fronts.

No real people: every name is invented, and nothing explains Amber.
Run from this folder: python3 make_story_items.py
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "kitchen" / "items"
OUT.mkdir(parents=True, exist_ok=True)
SUP = "/System/Library/Fonts/Supplemental/"
FUTURA = SUP + "Futura.ttc"
DIDOT = SUP + "Didot.ttc"
DIN = SUP + "DIN Condensed Bold.ttf"
BASK = SUP + "Baskerville.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def save(img, name):
    img.save(OUT / f"{name}.png", optimize=True)
    img.save(OUT / f"{name}.webp", "WEBP", quality=90, method=6)
    print("wrote", name, img.size)


def ruled(img, top, gap, color=(168, 196, 222, 255), margin=None):
    d = ImageDraw.Draw(img)
    w, h = img.size
    ys = list(range(top, h - 30, gap))
    for y in ys:
        d.line([(30, y), (w - 30, y)], fill=color, width=2)
    if margin:
        d.line([(margin, 0), (margin, h)], fill=(226, 140, 140, 255), width=2)
    return ys


def note():
    """The freezer note: the essay's opening, in a hurried ballpoint."""
    w, h = 900, 1180
    img = sheet(w, h, (250, 248, 240), crumple=0.35, fold=0.33, seed=21)
    rules = ruled(img, 150, 70, margin=104)
    # punched holes go through the sheet
    a = img.getchannel("A")
    ad = ImageDraw.Draw(a)
    for y in (90, h // 2, h - 90):
        ad.ellipse([30, y - 15, 60, y + 15], fill=0)
    img.putalpha(a)
    lines = [
        "Is there anything beyond",
        "the follow button?",
        "",
        "There's no depth to the",
        "profile you're looking at.",
    ]
    hw.write_learned(img, lines, 126, rules[1:], style=9, bias=0.95, tries=10, tool="ballpoint",
                     color=(28, 36, 88), size=30, surface="notebook", seed=41, max_width=720)
    save(img, "note")


def down():
    """A folded card a friend keeps for the bad days."""
    w, h = 760, 980
    img = sheet(w, h, (243, 236, 226), strength=1.3, wear=0.5, seed=22)
    d = ImageDraw.Draw(img)
    # a soft printed border and a small pressed-flower print on the cover
    d.rounded_rectangle([34, 34, w - 34, h - 34], 18, outline=(196, 160, 120, 255), width=3)
    for i, (cx, cy) in enumerate([(380, 300), (430, 340), (350, 360), (400, 390)]):
        d.ellipse([cx - 34, cy - 20, cx + 34, cy + 20], fill=(226, 150, 120 + i * 10, 200))
    d.line([(390, 360), (380, 560)], fill=(110, 140, 90, 255), width=5)
    hw.write_learned(img, ["for when", "you're down"], 170, [700, 790], style=1, bias=0.85,
                     tool="fineliner", color=(40, 36, 60), size=34, surface="matte", seed=32, max_width=470)
    save(img, "down")


def party():
    """A plan for a birthday, with a name pencilled against every job."""
    w, h = 900, 1180
    img = sheet(w, h, (252, 252, 250), strength=0.9, seed=23)
    rules = list(range(240, h - 60, 92))
    d = ImageDraw.Draw(img)
    d.text((70, 80), "Saturday in the backyard", font=font(FUTURA, 46), fill=(30, 30, 34, 255))
    d.text((70, 140), "starts at 6", font=font(FUTURA, 28), fill=(110, 110, 116, 255))
    jobs = ["tacos", "lights", "playlist", "cake", "chairs", "photos", "clean up"]
    who = ["Rosa", "Theo", "Mina", "Abuela", "Sam + Jo", "Kai", "everyone"]
    hw.write_learned(img, jobs, 80, rules, style=12, bias=0.85, tool="pencil",
                     color=(70, 70, 76), size=24, surface="printer", seed=33)
    hw.write_learned(img, who, 520, rules, style=5, bias=0.85, tool="pencil",
                     color=(70, 70, 76), size=24, surface="printer", seed=34)
    save(img, "party")


def resume():
    """A little sister's resume, with somebody's sticky note on it."""
    w, h = 900, 1160
    img = sheet(w, h, (253, 253, 252), strength=0.7, seed=24)
    d = ImageDraw.Draw(img)
    d.text((70, 70), "Lucia Moreno", font=font(BASK, 62), fill=(24, 24, 28, 255))
    d.text((72, 150), "Design student, looking for a summer internship", font=font(BASK, 26), fill=(90, 90, 96, 255))
    d.line([(70, 200), (w - 70, 200)], fill=(40, 40, 44, 255), width=2)
    y = 240
    for head, items in [
        ("Education", ["BFA Graphic Design, expected 2028", "Dean's list, two semesters"]),
        ("Experience", ["Poster series for the campus film club", "Menu redesign for a family restaurant", "Freelance logos, six clients"]),
        ("Skills", ["Figma, Illustrator, hand lettering", "Spanish and English"]),
    ]:
        d.text((70, y), head.upper(), font=font(FUTURA, 22), fill=(120, 120, 126, 255))
        y += 44
        for it in items:
            d.text((90, y), it, font=font(BASK, 28), fill=(40, 40, 44, 255))
            y += 44
        y += 30
    # the sticky note stuck on top, slightly rotated
    st = sheet(330, 300, (253, 240, 150), strength=0.8, wear=0.3, seed=25)
    hw.write_learned(st, ["send to", "Dev?"], 30, [130, 210], style=3, bias=0.85, tool="ballpoint",
                     color=(30, 38, 92), size=26, surface="sticky", seed=35, max_width=260)
    st = st.rotate(-6, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(st, (500, 740))
    save(img, "resume")


def bizcard():
    """A business card from a party. The note is on the back."""
    w, h = 700, 400
    img = sheet(w, h, (244, 241, 234), strength=1.0, wear=0.4, seed=26)
    d = ImageDraw.Draw(img)
    d.text((60, 70), "Halden & Rue", font=font(DIDOT, 54), fill=(28, 28, 30, 255))
    d.text((62, 140), "furniture makers", font=font(DIDOT, 28), fill=(100, 96, 90, 255))
    d.text((60, 270), "Ines Halden", font=font(FUTURA, 26), fill=(40, 40, 44, 255))
    d.text((60, 308), "Pasadena", font=font(FUTURA, 22), fill=(110, 110, 116, 255))
    save(img, "bizcard")


def art_print():
    """A small print of an 1895 landscape, in its glassine sleeve."""
    w, h = 640, 800
    img = sheet(w, h, (247, 244, 236), strength=0.8, seed=27)
    src = Image.open(HERE / "cazin.jpg").convert("RGB")
    ph = src.resize((520, int(520 * src.height / src.width)))
    img.paste(ph, ((w - 520) // 2, 70))
    d = ImageDraw.Draw(img)
    d.text((w // 2, 560), "after Cazin", font=font(BASK, 24, 1), fill=(90, 86, 80, 255), anchor="mm")
    hw.write_learned(img, ["3/25"], 470, [700], style=1, bias=0.85, tool="pencil",
                     color=(80, 80, 86), size=16, surface="printer", seed=37)
    # the glassine sleeve: a milky, slightly crinkled film over everything
    film = Image.new("RGBA", (w, h), (250, 250, 248, 46))
    img.alpha_composite(film)
    save(img, "print")


def prayer():
    """An index card in pencil: who to pray for this week."""
    w, h = 820, 480
    img = sheet(w, h, (250, 249, 244), strength=0.9, wear=0.6, seed=28)
    d = ImageDraw.Draw(img)
    d.line([(30, 96), (w - 30, 96)], fill=(220, 120, 120, 255), width=2)
    for y in range(160, h - 20, 64):
        d.line([(30, y), (w - 30, y)], fill=(170, 196, 220, 255), width=2)
    hw.write_learned(img, ["this week"], 60, [88], style=12, bias=0.85, tool="pencil",
                     color=(70, 70, 76), size=18, surface="card", seed=38, max_width=300)
    hw.write_learned(img, ["Mom's surgery Thursday", "Jordan's new job", "rain for the garden", "patience"],
                     60, [156, 220, 284, 348], style=12, bias=0.85, tool="pencil",
                     color=(70, 70, 76), size=16, surface="card", seed=39, max_width=680)
    save(img, "prayer")


if __name__ == "__main__":
    for fn in (note, down, party, resume, bizcard, art_print, prayer):
        fn()
