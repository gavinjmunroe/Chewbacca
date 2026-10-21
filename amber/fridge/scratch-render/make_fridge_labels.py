"""Hand-written labels for the things kept in the open fridge, drawn with the
handwriting skill's pen engine and used as textures in room_scene.fill_fridge.

The ink is written straight onto the substrate image the scene uses (the
crinkled tape, the card), so the engine bends strokes over its creases. Each
label also saves its blank substrate as <name>-surface.png, which the 3D
material uses as the bump height, so ink and tape share one surface and one
sheen.

Each label is one person's hand on the material it is really written on:
marker on a folded index card, Sharpie on crepe masking tape and on green
painter's tape, ballpoint on a scrap of notebook paper. ~12 px/mm.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path.home() / "code/chewbacca/skills/handwriting/scripts"))
import handwrite as hw  # noqa: E402
from paper import sheet  # noqa: E402

OUT = Path(__file__).resolve().parent / "fridge-labels"
OUT.mkdir(exist_ok=True)


def tape(w, h, base, seed):
    """Crepe paper tape: crumpled-paper normal for the crepe, torn short ends."""
    img = sheet(w, h, base, scan="paper003", strength=1.1, crumple=0.9, wear=0.0, seed=seed)
    a = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(a)
    import random
    rnd = random.Random(seed)
    for x0, sgn in ((0, 1), (w - 1, -1)):  # torn, not cut: a ragged zigzag at each end
        pts = [(x0, 0)]
        y = 0
        while y < h:
            y += rnd.uniform(6, 16)
            pts.append((x0 + sgn * rnd.uniform(0, 14), min(y, h)))
        pts.append((x0, h))
        d.polygon(pts, fill=0)
    img.putalpha(a)
    return img


def tent_card():
    # 90 x 50 mm index card face, the visible half of a folded tent
    img = sheet(1080, 600, (250, 249, 244), scan="paper001", strength=0.6, wear=0.3, seed=21)
    img.save(OUT / "tent-surface.png")
    hw.write_learned(img, ["save for Theo"], 90, [370], style=9, bias=0.85, tool="sharpie",
                     color=(30, 30, 34), size=70, surface="card", seed=36, max_width=900)
    img.save(OUT / "tent.png")


def sand_tape():
    img = tape(720, 240, (226, 210, 168), 22)
    img.save(OUT / "sand-tape-surface.png")
    hw.write_learned(img, ["Aug 9"], 120, [160], style=4, bias=0.85, tool="sharpie",
                     color=(24, 24, 28), size=56, surface="matte", seed=42, max_width=480)
    img.save(OUT / "sand-tape.png")


def lemon_note():
    img = sheet(840, 420, (247, 244, 233), scan="paper001", strength=0.7, wear=0.4, seed=23)
    img.save(OUT / "lemon-note-surface.png")
    hw.write_learned(img, ["from next door's tree"], 50, [240], style=3, bias=0.9, tool="ballpoint",
                     color=(30, 38, 92), size=40, surface="notebook", seed=53, max_width=740)
    img.save(OUT / "lemon-note.png")


def mole_tape():
    img = tape(1200, 380, (158, 178, 134), 24)  # green painter's tape
    img.save(OUT / "mole-tape-surface.png")
    hw.write_learned(img, ["Abuela's mole", "Sunday"], 90, [170, 300], style=12, bias=0.85, tool="sharpie",
                     color=(20, 20, 24), size=46, surface="matte", seed=34, max_width=1000)
    img.save(OUT / "mole-tape.png")


if __name__ == "__main__":
    for f in (tent_card, sand_tape, lemon_note, mole_tape):
        f()
        print("wrote", f.__name__)
