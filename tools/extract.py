#!/usr/bin/env python3
"""Reduce 74 design systems to one index an agent can read in a single pass.

THE FAILURE THIS EXISTS FOR. The vendored corpus is 40,000 lines. An agent
picking a visual direction cannot read it, so it does what it always did:
invents a look from the house rule and produces the same violet-gradient page
every time. Caleb's word for the symptom was "laggy", and the cause is the
model re-deriving the method on every request.

So this does not summarize. It extracts the CONSTRAINT SIGNATURE: what each
system refuses to do. Bugatti is recognizable because its radius scale holds
0px and 9999px and nothing between, because no color in it is saturated, and
because no display weight exceeds 400. Those three facts fit on a line and
they are most of what makes a page look like Bugatti rather than like every
other generated page.

Zero dependencies on purpose. pyyaml is not installable on a PEP 668 machine
and this has to run on any install of the kit.
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SYSTEMS = REPO / "systems"


def frontmatter(text):
    """Parse the two-level scalar YAML subset this corpus actually uses.

    Written rather than imported because the schema is small and fixed:
    `key: value` at top level, two-space indented children, no lists, no
    anchors. A real YAML parser would be a dependency to buy nothing.
    """
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    if not m:
        return {}
    out, section, sub = {}, None, None
    for raw in m.group(1).split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        # A wrapped scalar: a description long enough to run onto the next
        # line arrives with no colon on it. Without this branch the wrap is
        # silently dropped and `description` comes back as an empty dict,
        # which is how this crashed the first time it ran.
        if ":" not in raw and section and isinstance(out.get(section), str):
            out[section] = (out[section] + " " + raw.strip()).strip()
            continue
        key, _, val = raw.strip().partition(":")
        val = val.strip().strip('"').strip("'")
        if indent == 0:
            section = key
            sub = None
            out[key] = val if val else {}
        elif indent == 2 and section:
            if not isinstance(out.get(section), dict):
                out[section] = {}
            if val:
                out[section][key] = val
                sub = None
            else:
                out[section][key] = {}
                sub = key
        elif indent >= 4 and section and sub:
            if isinstance(out[section].get(sub), dict):
                out[section][sub][key] = val
    return out


def text_of(v):
    """Frontmatter values are str when well-formed and dict when not."""
    return v.strip() if isinstance(v, str) else ""


COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def clean_color(v):
    """Take the hex and drop the trailing prose.

    `canvas: "#7a8aba"   # Periwinkle metallic - primary interface body` is a
    real line in this corpus. Splitting on "#" to strip the comment also eats
    the colour, so match the hex instead of stripping around it.
    """
    if not isinstance(v, str):
        return None
    m = COLOR_RE.search(v)
    return m.group(0) if m else None


# Tokens that are never a brand accent, however saturated they are. Bugatti
# states outright that it has no accent colour, and it still has warning gold
# and success green, because every system needs to render an error. Reading
# those as the brand is how the extractor first reported Bugatti as gold and
# Stripe as its drop-shadow blue.
NOT_ACCENT = re.compile(
    r"warn|success|error|danger|caution|info|destructive|positive|negative"
    r"|shadow|border|hairline|outline|ring|focus|overlay|scrim|backdrop"
    r"|link|visited|disabled|placeholder|skeleton|on-|text-|body|muted|ink",
    re.I,
)
BRAND_FIRST = re.compile(r"primary|accent|brand|action|cta|highlight|voltage", re.I)


def hex_to_rgb(h):
    h = (h or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return None
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def saturation(rgb):
    """HSL saturation. The test for 'does this system own an accent color'."""
    r, g, b = (c / 255 for c in rgb)
    hi, lo = max(r, g, b), min(r, g, b)
    if hi == lo:
        return 0.0
    d = hi - lo
    l = (hi + lo) / 2
    return d / (2 - hi - lo) if l > 0.5 else d / (hi + lo)


def luminance(rgb):
    r, g, b = rgb
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def px(val):
    m = re.search(r"(-?[\d.]+)", str(val or ""))
    return float(m.group(1)) if m else None


def signature(name, text):
    fm = frontmatter(text)
    colors = fm.get("colors") or {}
    colors = {k: c for k, v in colors.items() if (c := clean_color(v))}
    typo = fm.get("typography") or {}
    rounded = fm.get("rounded") or {}
    body = text[len(re.match(r"^---\n.*?\n---", text, re.S).group(0)):] if re.match(r"^---\n.*?\n---", text, re.S) else text
    low = body.lower()

    rgbs = {k: hex_to_rgb(v) for k, v in colors.items()}
    rgbs = {k: v for k, v in rgbs.items() if v}

    # Accent. A system with no saturated color has decided to have no accent,
    # which is Bugatti's single most imitable choice.
    sats = {k: saturation(v) for k, v in rgbs.items()}
    chromatic = {
        k: round(v, 2) for k, v in sats.items()
        if v >= 0.25 and not NOT_ACCENT.search(k)
    }
    accent = None
    if chromatic:
        branded = [k for k in chromatic if BRAND_FIRST.search(k)]
        pick = min(branded, key=len) if branded else max(chromatic, key=lambda k: sats[k])
        accent = {"token": pick, "hex": colors[pick], "saturation": chromatic[pick]}

    # Canvas decides dark or light, and it is the field most often wrong when
    # a human eyeballs it, because #0a0a0a and #000000 look identical in prose
    # and are a deliberate distinction in every system that makes it.
    canvas_key = next((k for k in ("canvas", "background", "bg", "surface") if k in colors), None)
    canvas = colors.get(canvas_key) if canvas_key else None
    canvas_rgb = rgbs.get(canvas_key) if canvas_key else None
    mode = None
    if canvas_rgb:
        mode = "dark" if luminance(canvas_rgb) < 0.5 else "light"

    # Radius profile. Excluding anything pill-shaped, because almost every
    # system has a pill and it therefore separates nothing. The cutoff is 100px
    # rather than 9999px: Vercel writes its pill as 100px and was being scored
    # "round" for it, next to systems whose cards really are 24px.
    radii = sorted(
        v for v in (px(x) for x in rounded.values() if isinstance(x, str)) if v is not None and v < 100
    )
    max_r = radii[-1] if radii else None
    if max_r is None:
        radius_profile = "unknown"
    elif max_r == 0:
        radius_profile = "sharp"          # 0 or pill only. Bugatti, Nintendo.
    elif max_r <= 8:
        radius_profile = "tight"
    elif max_r <= 16:
        radius_profile = "soft"
    else:
        radius_profile = "round"

    weights = [int(w) for w in re.findall(r"fontWeight:\s*(\d{3})", text)]
    families = []
    for f in re.findall(r"fontFamily:\s*\"?([^\"\n,]+)", text):
        f = f.strip()
        if f and f.lower() not in {"sans-serif", "serif", "monospace"} and f not in families:
            families.append(f)

    tracking = [px(t) for t in re.findall(r"letterSpacing:\s*\"?(-?[\d.]+px)", text)]
    tracking = [t for t in tracking if t is not None]

    # HOW MANY COMPONENTS THIS SYSTEM DOCUMENTS, and nothing more.
    #
    # An earlier version tried to classify each system as product or
    # marketing from its component names, and it does not work. A bare
    # "row-" matched "eyebrow-mono"; tightening it to "-row" then matched
    # every marketing layout row. Two attempts, two different wrong answers,
    # because the signal is not in the data.
    #
    # The real finding stands and does not need a classifier: a census of all
    # 64 machine-readable systems found roughly 64 product-UI components
    # against 365 marketing ones. EVERY system here was extracted from a
    # marketing site. Even linear.app carries pricing-card and
    # testimonial-card, because that is the website, not the application.
    #
    # So this corpus answers "what should it look like" and cannot answer
    # "what should it do". presets/ answers the second, compiled from
    # research/ rather than scraped. The two do not overlap and neither
    # pretends to be the other.
    comps = fm.get("components")
    component_count = len(comps) if isinstance(comps, dict) else 0

    # What it refuses. This is the whole point of the file.
    #
    # Only derived for a system whose token schema actually parsed. Ten of the
    # vendored systems ship prose with no frontmatter, and the first version of
    # this reported every one of them as "no accent colour, monochrome only"
    # because it found no colours to measure. Spotify's accent is #1DB954.
    # Absence of data is not a constraint, and shipping it as one would teach
    # the generator something false about ten real brands.
    if not fm:
        return {
            "name": name, "title": name, "description": "",
            "mode": None, "canvas": None, "accent": None,
            "radius_profile": "unparsed", "radius_max_px": None,
            "fonts": [], "weight_max": None, "tracking_max_px": None,
            "forbids": [], "component_count": 0,
            "has_frontmatter": False,
            "lines": text.count("\n") + 1,
            "path": f"systems/{name}/DESIGN.md",
        }
    forbids = []
    if not accent:
        forbids.append("no accent color, monochrome only")
    if radius_profile == "sharp":
        forbids.append("no rounded corners, 0px or pill only")
    if "gradient" not in low:
        forbids.append("no gradients")
    if not re.search(r"shadow|elevation", low):
        forbids.append("no shadows")
    if weights and max(weights) <= 500:
        forbids.append(f"display type never bolder than {max(weights)}")
    if tracking and max(tracking) >= 2:
        forbids.append(f"wide display tracking up to {max(tracking):g}px")

    return {
        "name": name,
        "title": text_of(fm.get("name")) or name,
        "description": text_of(fm.get("description")),
        "mode": mode,
        "canvas": canvas,
        "accent": accent,
        "radius_profile": radius_profile,
        "radius_max_px": max_r,
        "fonts": families[:4],
        "weight_max": max(weights) if weights else None,
        "tracking_max_px": max(tracking) if tracking else None,
        "forbids": forbids,
        "component_count": component_count,
        "has_frontmatter": bool(fm),
        "lines": text.count("\n") + 1,
        "path": f"systems/{name}/DESIGN.md",
    }


def main():
    rows = []
    for d in sorted(SYSTEMS.iterdir()):
        f = d / "DESIGN.md"
        if not d.is_dir() or not f.exists():
            continue
        rows.append(signature(d.name, f.read_text(errors="ignore")))

    (REPO / "data").mkdir(exist_ok=True)
    (REPO / "data" / "systems.json").write_text(json.dumps(rows, indent=1) + "\n")

    structured = [r for r in rows if r["has_frontmatter"]]
    print(f"{len(rows)} systems, {len(structured)} with a parseable token schema")
    print(f"  {sum(1 for r in rows if r['mode'] == 'dark')} dark, {sum(1 for r in rows if r['mode'] == 'light')} light")
    print(f"  {sum(1 for r in rows if not r['accent'])} with no accent color")
    for p in ("sharp", "tight", "soft", "round"):
        print(f"  {sum(1 for r in rows if r['radius_profile'] == p):3d} {p}")
    print("  all extracted from marketing sites: load presets/ for behaviour")
    print(f"wrote data/systems.json ({sum(r['lines'] for r in rows):,} source lines indexed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
