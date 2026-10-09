#!/usr/bin/env python3
"""Normalise a design system file and a generated page into ONE feature space.

The point. `ux-lint` asserts which choices are slop. This does not assert
anything: it turns any file into a bag of device-independent design tokens
(hue, saturation, radius in px, weight, size in px, family class), so the
frequency of a token in real design systems can be compared against its
frequency in unguided LLM output.

A Tailwind class and a raw hex land on the same axis, which is what makes the
comparison possible at all. `rounded-2xl`, `border-radius:16px` and
`{rounded.2xl}` are all `radius:16`.

Features are presence per document, not counts. A page that says indigo-600
forty times is one vote, same as a page that says it once, because the question
is "does this choice appear", not "how committed is the author".
"""
import colorsys
import re

# ---------------------------------------------------------------------------
# Tailwind, mapped to hue and lightness rather than to 242 hardcoded hex values.
# Hue is what the feature space needs; the exact hex is not.
TW_HUE = {
    "slate": 215, "gray": 220, "zinc": 240, "neutral": 0, "stone": 30,
    "red": 0, "orange": 25, "amber": 38, "yellow": 48, "lime": 85,
    "green": 142, "emerald": 160, "teal": 173, "cyan": 189, "sky": 199,
    "blue": 217, "indigo": 239, "violet": 258, "purple": 271,
    "fuchsia": 292, "pink": 330, "rose": 350,
}
TW_NEUTRALS = {"slate", "gray", "zinc", "neutral", "stone"}
# shade -> approximate L in HSL
TW_SHADE_L = {50: 97, 100: 94, 200: 86, 300: 77, 400: 64,
              500: 54, 600: 47, 700: 39, 800: 31, 900: 24, 950: 15}

TW_RADIUS = {"none": 0, "sm": 2, "": 4, "md": 6, "lg": 8,
             "xl": 12, "2xl": 16, "3xl": 24, "full": 9999}
TW_SIZE = {"xs": 12, "sm": 14, "base": 16, "lg": 18, "xl": 20, "2xl": 24,
           "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72,
           "8xl": 96, "9xl": 128}
TW_WEIGHT = {"thin": 100, "extralight": 200, "light": 300, "normal": 400,
             "medium": 500, "semibold": 600, "bold": 700,
             "extrabold": 800, "black": 900}

HEX = re.compile(r"#([0-9a-fA-F]{6})\b|#([0-9a-fA-F]{3})\b")
TW_COLOR = re.compile(
    r"\b(?:bg|text|from|to|via|border|ring|fill|stroke|decoration|shadow|outline|accent|caret|divide)"
    r"-(" + "|".join(TW_HUE) + r")-(\d{2,3})\b")
TW_ROUND = re.compile(r"\brounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e))?-?(none|sm|md|lg|xl|2xl|3xl|full)?\b")
TW_TEXTSZ = re.compile(r"\btext-(" + "|".join(TW_SIZE) + r")\b")
TW_FONTWT = re.compile(r"\bfont-(" + "|".join(TW_WEIGHT) + r")\b")
CSS_RADIUS = re.compile(r"border-radius\s*:\s*([\d.]+)(px|rem|em)")
CSS_FSIZE = re.compile(r"font-size\s*:\s*([\d.]+)(px|rem|em)")
CSS_FWEIGHT = re.compile(r"font-weight\s*:\s*(\d{3})")
CSS_FAMILY = re.compile(r"font-family\s*:\s*([^;}\n]+)")
YAML_FSIZE = re.compile(r"fontSize:\s*([\d.]+)px")
YAML_FWEIGHT = re.compile(r"fontWeight:\s*(\d{3})")
YAML_FAMILY = re.compile(r"fontFamily:\s*[\"']?([^\"'\n,]+)")
# Radius lives under its own `rounded:` block. An earlier version matched any
# `key: 14px` line, so every fontSize was read as a corner radius and airbnb
# reported radii of 11, 13, 21 and 22px that exist nowhere in the file.
YAML_ROUNDED_BLOCK = re.compile(r"^rounded:\n((?:[ \t]+.*\n)+)", re.M)
YAML_PX = re.compile(r":\s*[\"']?([\d.]+)px")

# (?<!sans-) matters more than the rest of this regex put together. Without
# it every `font-family: system-ui, sans-serif` fallback registered as a
# serif face, and the learned prior reported that 8 of 9 generated pages
# were set in serif against 3 of 74 real systems, which is backwards.
SERIF = re.compile(r"(?<!sans-)\bserif\b|georgia|times new roman|garamond"
                   r"|playfair|merriweather|\blora\b|charter|\bcambria\b", re.I)
MONO = re.compile(r"mono|courier|consolas|menlo|jetbrains|ibm plex mono|roboto mono", re.I)
SYSTEM = re.compile(r"-apple-system|system-ui|blinkmacsystemfont|segoe ui", re.I)


def _px(val, unit):
    v = float(val)
    return v * 16 if unit in ("rem", "em") else v


def _hue_bucket(h):
    """30-degree buckets. Finer than that is noise across brands."""
    return int(round(h / 30.0) * 30) % 360


def _from_hsl(h, s, l, out):
    if s < 0.12:
        out.add("neutral")
        out.add(f"neutral-l:{int(round(l * 10) * 10)}")
    else:
        out.add(f"hue:{_hue_bucket(h * 360)}")
        out.add("sat:hi" if s >= 0.55 else "sat:mid")
        out.add(f"chroma-l:{int(round(l * 10) * 10)}")


def _hex_feats(text, out):
    for m in HEX.finditer(text):
        raw = m.group(1) or m.group(2)
        if len(raw) == 3:
            raw = "".join(c * 2 for c in raw)
        r, g, b = (int(raw[i:i + 2], 16) / 255 for i in (0, 2, 4))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        _from_hsl(h, s, l, out)


def _family_class(name):
    if MONO.search(name):
        return "family:mono"
    if SERIF.search(name):
        return "family:serif"
    if SYSTEM.search(name):
        return "family:system"
    return "family:named-sans"


def features(text, kind="html"):
    """Return the set of design-token features present in `text`."""
    out = set()
    _hex_feats(text, out)

    if kind == "html":
        for name, shade in TW_COLOR.findall(text):
            shade = int(shade)
            if shade not in TW_SHADE_L:
                continue
            l = TW_SHADE_L[shade] / 100.0
            if name in TW_NEUTRALS:
                out.add("neutral")
                out.add(f"neutral-l:{int(round(l * 10) * 10)}")
            else:
                out.add(f"hue:{_hue_bucket(TW_HUE[name])}")
                out.add("sat:hi" if 300 <= shade <= 700 else "sat:mid")
                out.add(f"chroma-l:{int(round(l * 10) * 10)}")
        for r in TW_ROUND.findall(text):
            out.add(f"radius:{TW_RADIUS.get(r, 4)}")
        for s in TW_TEXTSZ.findall(text):
            out.add(f"size:{TW_SIZE[s]}")
        for w in TW_FONTWT.findall(text):
            out.add(f"weight:{TW_WEIGHT[w]}")

    for v, u in CSS_RADIUS.findall(text):
        out.add(f"radius:{int(_px(v, u))}")
    for v, u in CSS_FSIZE.findall(text):
        out.add(f"size:{int(_px(v, u))}")
    for w in CSS_FWEIGHT.findall(text):
        out.add(f"weight:{int(w)}")
    for fam in CSS_FAMILY.findall(text):
        out.add(_family_class(fam))

    if kind == "design":
        for v in YAML_FSIZE.findall(text):
            out.add(f"size:{int(float(v))}")
        for w in YAML_FWEIGHT.findall(text):
            out.add(f"weight:{int(w)}")
        for fam in YAML_FAMILY.findall(text):
            out.add(_family_class(fam))
        for block in YAML_ROUNDED_BLOCK.findall(text):
            for v in YAML_PX.findall(block):
                px = float(v)
                out.add(f"radius:{9999 if px > 64 else int(px)}")

    if re.search(r"box-shadow\s*:(?!\s*none)|\bshadow-(?:sm|md|lg|xl|2xl)\b", text):
        out.add("shadow:yes")
    if re.search(r"linear-gradient|bg-gradient-to-", text):
        out.add("gradient:yes")
    if re.search(r"backdrop-blur|backdrop-filter\s*:\s*blur", text):
        out.add("glass:yes")
    return out
