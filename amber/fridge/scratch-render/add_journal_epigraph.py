"""Print the essay's two core lines across the top of this year's guest
journal, the way a guest book carries a line above its first rule.

Caleb, 2026-10-07: the essay's thesis lives printed in the journal, not as
floating text on the page. Works on the .orig copies so it can run again.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TEX = Path(__file__).resolve().parent / "v2tex"
BASK = "/System/Library/Fonts/Supplemental/Baskerville.ttc"
W, H = 1700, 2400
PX_MM = W / 145.0
TOP = 30.0 * PX_MM  # the header rule, make_v2_textures.py
INK = (66, 60, 56, 230)

LINES = {
    "left": "Humans are at their best when they see patterns\nand make real-life connections.",
    "right": "What if our technology stopped acting like an empty follow button\nand started being the shared connection we needed all along?",
}


def stamp(side):
    img = Image.open(TEX / f"journal-{side}.orig.png").convert("RGBA")
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    both = LINES[side].count("\n") > 1
    # Both lines in the same space need a smaller size; 46 ran off the top and
    # 36 ran into the NAME header and the column rule.
    f = ImageFont.truetype(BASK, 32 if both else 46, index=0)  # the face of NAME and NUMBER
    text = LINES[side]
    box = d.multiline_textbbox((0, 0), text, font=f, spacing=16, align="center")
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (W - tw) / 2
    y = 3.5 * PX_MM if both else TOP - 26 * PX_MM + (12 * PX_MM - th) / 2
    d.multiline_text((x, y), text, font=f, fill=INK, spacing=16, align="center")
    img.alpha_composite(over)
    img.convert("RGB").save(TEX / f"journal-{side}.png")
    print(side, round(y), round(th))


# The phone's page view shows only the right-hand page, so for that one render
# the right page carries both lines (Caleb, 2026-10-07: "on mobile you only see
# the right text"). Run with --phone, render `page golden tall`, then run again
# without it to put the laptop pages back.
import sys

if "--phone" in sys.argv:
    LINES["right"] = LINES["left"] + "\n" + LINES["right"]

for s in LINES:
    stamp(s)
