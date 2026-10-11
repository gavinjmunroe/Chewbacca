#!/usr/bin/env python3
"""Departure Mono with tall pixels, each 2 wide by 3 tall.

TypeSafe sets nearly every word of typesafe.ai in LisaTerminal Paper 2X3Y, an
Apple Lisa bitmap face redrawn with tall pixels in Bits'n'Picas (read from the
site's stylesheet and the font's name table on 2026-10-11). The file names no
licence, so it cannot ship. This draws the same shape from Departure Mono, which
is under the OFL: every y and the em grow by half, so a pixel keeps its width
and gets half again as tall. At 16.5 points a pixel is 1 by 1.5 points, as
LisaTerminal's is at 18px, and 2 by 3 device pixels on a 2x screen, so no edge
falls between device pixels. The OFL allows a modified version under a new
name, and it stays under the OFL.

    uv run --no-project --with fonttools python3 hud/scripts/make-tall-pixel.py
"""
from pathlib import Path

from fontTools.misc.roundTools import otRound
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

TALL = 1.5
FAMILY = "Departure Mono 2X3Y"
POSTSCRIPT = "DepartureMono2X3Y-Regular"
FONTS = Path(__file__).resolve().parent.parent / "Fonts"


def tall(value):
    return otRound(value * TALL)


def anchors(node):
    """Every Anchor under a GPOS subtable; the font has mark attachment only."""
    if type(node).__name__ == "Anchor":
        yield node
    elif isinstance(node, list):
        for item in node:
            yield from anchors(item)
    elif hasattr(node, "__dict__"):
        for value in vars(node).values():
            yield from anchors(value)


def main():
    font = TTFont(FONTS / "DepartureMono-Regular.otf")

    head = font["head"]
    head.unitsPerEm = tall(head.unitsPerEm)
    head.yMin, head.yMax = tall(head.yMin), tall(head.yMax)
    hhea = font["hhea"]
    hhea.ascent, hhea.descent, hhea.lineGap = tall(hhea.ascent), tall(hhea.descent), tall(hhea.lineGap)
    os2 = font["OS/2"]
    for field in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent",
                  "sxHeight", "sCapHeight", "yStrikeoutSize", "yStrikeoutPosition",
                  "ySubscriptYSize", "ySubscriptYOffset", "ySuperscriptYSize", "ySuperscriptYOffset",
                  # Shares of the em, which grew, so these keep their share.
                  "ySubscriptXSize", "ySuperscriptXSize"):
        setattr(os2, field, tall(getattr(os2, field)))
    post = font["post"]
    post.underlinePosition, post.underlineThickness = tall(post.underlinePosition), tall(post.underlineThickness)

    cff = font["CFF "].cff
    top = cff.topDictIndex[0]
    top.FontMatrix = [1 / head.unitsPerEm, 0, 0, 1 / head.unitsPerEm, 0, 0]
    left, bottom, right, upper = top.FontBBox
    top.FontBBox = [left, tall(bottom), right, tall(upper)]
    top.UnderlinePosition, top.UnderlineThickness = tall(top.UnderlinePosition), tall(top.UnderlineThickness)
    strings = top.CharStrings
    # Drawn first and written after, since writing replaces what is read.
    pens = {}
    for name in font.getGlyphOrder():
        pen = T2CharStringPen(font["hmtx"][name][0] - top.Private.nominalWidthX, None)
        strings[name].draw(TransformPen(pen, (1, 0, 0, TALL, 0, 0)))
        pens[name] = pen
    for name, pen in pens.items():
        strings[name] = pen.getCharString(private=top.Private, globalSubrs=cff.GlobalSubrs)

    for lookup in font["GPOS"].table.LookupList.Lookup:
        for anchor in anchors(lookup.SubTable):
            anchor.YCoordinate = tall(anchor.YCoordinate)

    cff.fontNames = [POSTSCRIPT]
    top.FamilyName, top.FullName = FAMILY, f"{FAMILY} Regular"
    names = font["name"]
    version = f"{font['head'].fontRevision:.3f}"
    for record in list(names.names):
        if record.nameID in (1, 16):
            names.setName(FAMILY, record.nameID, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 3:
            names.setName(f"{version};UKWN;{POSTSCRIPT}", 3, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 4:
            names.setName(f"{FAMILY} Regular", 4, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 6:
            names.setName(POSTSCRIPT, 6, record.platformID, record.platEncID, record.langID)
    names.setName("Departure Mono by Helena Zhang, every pixel half again as tall, for Kyber.", 10, 3, 1, 0x409)

    out = FONTS / f"{POSTSCRIPT}.otf"
    font.save(out)
    print(out)


if __name__ == "__main__":
    main()
