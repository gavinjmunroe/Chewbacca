#!/usr/bin/env python3
"""Draw Chewbacca.icns, the icon System Settings shows for the background runtime.

The runtime used to be a bare `node` binary, which Settings lists with a black
"exec" icon. Caleb, 2026-10-10: "non devs will think its malware". This draws a
warm fur-brown tile with a bandolier across it, deterministic, so the icns can
be rebuilt from source.

    python3 mac/runtime/make_icon.py   writes mac/runtime/Chewbacca.icns
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SIZE = 1024


def tile() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # Apple's icon grid: an 824 square body, 100 in from each side, radius 185.
    body = Image.new("RGBA", (SIZE, SIZE))
    d = ImageDraw.Draw(body)
    for y in range(SIZE):  # warm fur gradient, light at the top
        t = y / SIZE
        d.line([(0, y), (SIZE, y)], fill=(int(176 - 70 * t), int(118 - 52 * t), int(72 - 38 * t), 255))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([100, 100, 924, 924], radius=185, fill=255)
    img.paste(body, (0, 0), mask)

    # The bandolier: a dark leather strap shoulder to hip, with five pouches.
    strap = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    s = ImageDraw.Draw(strap)
    s.polygon([(250, 100), (390, 100), (774, 924), (634, 924)], fill=(46, 30, 20, 255))
    # Pouches sit on the strap's centreline, which runs from x=320 at the top
    # edge to x=704 at the bottom; four keep the last one inside the tile.
    for i in range(4):
        cy = 270 + i * 170
        cx = int(320 + (cy - 100) * 384 / 824)
        s.rounded_rectangle([cx - 52, cy - 40, cx + 52, cy + 40], radius=14, fill=(196, 196, 188, 255))
        s.rounded_rectangle([cx - 52, cy - 40, cx + 52, cy - 18], radius=10, fill=(150, 150, 142, 255))
    clipped = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    clipped.paste(strap, (0, 0), Image.composite(strap.split()[3], Image.new("L", (SIZE, SIZE), 0), mask))
    # The strap's shadow is offset first and clipped after, so none of it
    # lands outside the tile's rounded corners.
    blur = clipped.split()[3].filter(ImageFilter.GaussianBlur(12))
    shifted = Image.new("L", (SIZE, SIZE), 0)
    shifted.paste(blur, (8, 14))
    shade = Image.composite(shifted.point(lambda v: v * 90 // 255), Image.new("L", (SIZE, SIZE), 0), mask)
    img.paste((0, 0, 0, 255), (0, 0), shade)
    img.alpha_composite(clipped)
    return img


def main() -> None:
    base = tile()
    work = Path(tempfile.mkdtemp())
    iconset = work / "Chewbacca.iconset"
    iconset.mkdir()
    for px in (16, 32, 128, 256, 512):
        base.resize((px, px), Image.LANCZOS).save(iconset / f"icon_{px}x{px}.png")
        base.resize((px * 2, px * 2), Image.LANCZOS).save(iconset / f"icon_{px}x{px}@2x.png")
    out = HERE / "Chewbacca.icns"
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out)], check=True)
    base.save(work / "preview.png")
    shutil.copy(work / "preview.png", HERE / "icon-preview.png")
    shutil.rmtree(work)
    print(out)


if __name__ == "__main__":
    main()
