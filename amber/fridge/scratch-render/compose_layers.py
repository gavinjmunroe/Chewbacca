"""Turn the lossless renders in layer-raw/ into registered webps and room.json.

Cycles on Metal isn't bit-deterministic: re-rendering the unchanged golden frame
with the same seed and settings differed from the original in 28,000 of 8.3M
pixels, by at most 7 levels (97 pixels over 2), measured 2026-10-07. So no
layer is shipped straight from its render. Each one takes the render only
inside the region that really changed, found from a blurred difference against
its reference frame, and the reference's own pixels everywhere else. Outside
that region every layer is bit-identical to its reference before encoding.

    python3 compose_layers.py            # everything
    python3 compose_layers.py bases      # only the journal base frames
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
RAW = HERE / "layer-raw"
PUB = HERE.parent / "public" / "kitchen"
LAY = PUB / "layers"
LAY.mkdir(exist_ok=True)
W, H = 3840, 2160
LIGHTS = ("golden", "morning", "night")
report = {}

# blurred |difference| above this (8-bit levels, max over RGB) counts as a real
# change. Render noise blurred at radius 4 stayed under 1.2 on the golden
# re-render test above; 3 leaves margin without missing faint light spill.
CHANGE_LEVEL = 3.0


def load(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float32)


def save_webp(arr, name, alpha=None, lossless=False):
    """Full size at q84, and a -1920 version at q82, as the base frames are."""
    img = Image.fromarray(arr.clip(0, 255).round().astype(np.uint8), "RGB")
    if alpha is not None:
        img.putalpha(Image.fromarray(alpha.clip(0, 255).round().astype(np.uint8), "L"))
    kw = dict(lossless=True) if lossless else dict(quality=84, method=6)
    img.save(LAY / f"{name}.webp" if not name.startswith("/") else name, **kw)
    small = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    kw2 = dict(lossless=True) if lossless else dict(quality=82, method=6)
    p = (LAY / f"{name}-1920.webp") if not name.startswith("/") else Path(name.replace(".webp", "-1920.webp"))
    small.save(p, **kw2)


def dilate(img, r):
    """Fast square dilation of an L mask by r px. PIL's MaxFilter is O(r^2) and
    took over ten minutes on a 4K frame at r=60; a box blur is O(1) per pixel."""
    if r <= 0:
        return img
    b = img.filter(ImageFilter.BoxBlur(r))
    return b.point(lambda v: 255 if v > 0 else 0)


def erode(img, r):
    inv = img.point(lambda v: 255 - v)
    return dilate(inv, r).point(lambda v: 255 - v)


def change_mask(render, ref, extra=None, grow=24, feather=10):
    d = np.abs(render - ref).max(2)
    blur = np.asarray(Image.fromarray(d.clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(4)), dtype=np.float32)
    m = (blur > CHANGE_LEVEL).astype(np.uint8) * 255
    mi = Image.fromarray(m)
    if extra is not None:
        mi = Image.fromarray(np.maximum(m, extra))
    # close small holes, grow, then feather inward so the seam sits in noise
    mi = erode(dilate(mi, 4), 4)
    mi = dilate(mi, grow // 2)
    hard = np.asarray(mi, dtype=np.float32) / 255.0
    soft = np.asarray(erode(mi, feather // 2).filter(ImageFilter.GaussianBlur(feather / 2)), dtype=np.float32) / 255.0
    soft = np.minimum(soft, hard)  # never reaches outside the hard region
    return hard, soft


def compose(render, ref, soft):
    return ref * (1 - soft[..., None]) + render * soft[..., None]


def check(out, ref, hard, name, render=None):
    """Registration: out must equal ref exactly wherever the mask is 0."""
    o = np.round(out).astype(np.int16)
    r = np.round(ref).astype(np.int16)
    outside = hard == 0
    d = np.abs(o - r).max(2)
    res = {
        "changedRegionPct": round(float((~outside).mean() * 100), 2),
        "maxDiffOutsideRegion": int(d[outside].max()) if outside.any() else 0,
        "bbox": bbox_pct(hard),
    }
    if render is not None:
        # how different the raw render was outside the region: render noise only
        rd = np.abs(render - ref).max(2)[outside]
        res["rawRenderOutsideMax"] = int(rd.max()) if rd.size else 0
        res["rawRenderOutsideOver2"] = int((rd > 2).sum())
    report[name] = res
    print(name, res, flush=True)
    return res


def bbox_pct(mask):
    ys, xs = np.nonzero(mask > 0)
    if not len(xs):
        return None
    return [round(xs.min() / W * 100, 3), round(ys.min() / H * 100, 3), round((xs.max() + 1) / W * 100, 3), round((ys.max() + 1) / H * 100, 3)]


def poly_mask(poly_pct, grow_px):
    im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).polygon([(x / 100 * W, y / 100 * H) for x, y in poly_pct], fill=255)
    return np.asarray(dilate(im, grow_px), dtype=np.uint8)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.hypot(*ab) or 1e-9
    ds = [abs(ab[1] * (p[0] - a[0]) - ab[0] * (p[1] - a[1])) / n for p in pts[1:-1]]
    i = int(np.argmax(ds)) + 1
    if ds[i - 1] > eps:
        return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def simplify(ring, limit=16):
    eps = 0.005
    while True:
        far = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
        a = rdp(ring[: far + 1], eps)
        b = rdp(ring[far:] + ring[:1], eps)
        out = a[:-1] + b[:-1]
        if len(out) <= limit:
            return [[round(x, 2), round(y, 2)] for x, y in out]
        eps *= 1.4


anchors = json.loads((RAW / "anchors.json").read_text())
anchors["journal"] = simplify(anchors["journal"])
anchors["fridgeDoorClosed"] = simplify(anchors["fridgeDoorClosed"])
anchors["fridgeDoorOpen"] = simplify(anchors["fridgeDoorOpen"])
only = sys.argv[1:] or ["bases", "layers", "tree", "sky", "page", "json"]

# ---------------------------------------------------------------- journal bases
if "bases" in only:
    jm = poly_mask(anchors["journal"], 14)  # the book and its contact shadow
    for L in LIGHTS:
        old = load(HERE / f"kitchen-{L}.png")
        new = load(RAW / f"base-{L}.png")
        hard, soft = change_mask(new, old)
        # The journal is the only change in the scene. Changes found away from it
        # are counted: at night the chrome fridge handle reflects the journal
        # (an 8 x 18 px spot at x 1534, y 1128), which is real and is kept.
        near = np.asarray(dilate(Image.fromarray(jm), 60), dtype=np.float32) / 255
        stray = hard * (1 - near)
        report[f"base-{L}-changePxAwayFromJournal"] = int((stray > 0).sum())
        hard = np.maximum(hard, jm / 255.0)
        soft = np.maximum(soft, np.asarray(erode(Image.fromarray(jm), 4).filter(ImageFilter.GaussianBlur(3)), dtype=np.float32) / 255 * (jm / 255.0))
        out = compose(new, old, soft)
        check(out, old, hard, f"base-{L}", new)
        Image.fromarray(out.round().astype(np.uint8)).save(RAW / f"kitchen-{L}-journal.png")
        save_webp(out, str(PUB / f"kitchen-{L}.webp"))

# ---------------------------------------------------------------- full-frame states
if "layers" in only:
    ref = {L: load(RAW / f"kitchen-{L}-journal.png") for L in ("golden", "night")}
    lampoff = load(RAW / "lampoff-night.png")
    ho, so = change_mask(lampoff, ref["night"])
    out_lampoff = compose(lampoff, ref["night"], so)
    check(out_lampoff, ref["night"], ho, "lampoff-night", lampoff)
    save_webp(out_lampoff, "lamp-off-night")
    for name, base in (("open-golden", ref["golden"]), ("open-night", ref["night"]), ("open-night-lampoff", out_lampoff)):
        r = load(RAW / f"{name}.png")
        h, s = change_mask(r, base)
        out = compose(r, base, s)
        check(out, base, h, name, r)
        save_webp(out, f"fridge-{name}")

# ---------------------------------------------------------------- tree + panes
if "tree" in only:
    panes = load(RAW / "panes.png", "RGBA")[..., 3]
    report["panes"] = {"bbox": bbox_pct(panes > 127)}
    white = np.full((H, W, 3), 255, np.float32)
    save_webp(white, "window-panes", alpha=panes, lossless=True)
    for L in LIGHTS:
        t = load(RAW / f"tree-{L}.png", "RGBA")
        a = t[..., 3]
        save_webp(t[..., :3], f"tree-{L}", alpha=a)
        # Registration: where the tree is opaque and the window shows it, the
        # layer should be the same pixel as the base frame.
        base = load(RAW / f"kitchen-{L}-journal.png")
        sel = (a > 250) & (panes > 250)
        d = np.abs(t[..., :3] - base).max(2)[sel]
        report[f"tree-{L}"] = {"opaquePxInPanes": int(sel.sum()), "meanDiffVsBase": round(float(d.mean()), 2),
                               "p99DiffVsBase": round(float(np.percentile(d, 99)), 1), "bbox": bbox_pct(a > 0)}
        print(f"tree-{L}", report[f"tree-{L}"], flush=True)

# ---------------------------------------------------------------- sky gradient spec
SKY_ORDER = ["dawn", "morning", "noon", "golden", "dusk", "night"]
sky_spec = {}
if "sky" in only or "json" in only:
    panes = load(RAW / "panes.png", "RGBA")[..., 3]
    bb = bbox_pct(panes > 127)
    for k in SKY_ORDER:
        plate = load(RAW / f"sky-{k}.png")  # 25% scale
        ph, pw = plate.shape[:2]
        pm = np.asarray(Image.fromarray(panes.astype(np.uint8)).resize((pw, ph), Image.BILINEAR)) > 250
        ys = np.nonzero(pm.any(1))[0]
        y0, y1 = ys.min(), ys.max()
        stops = []
        for f in (0.0, 0.25, 0.5, 0.75, 1.0):
            y = int(round(y0 + f * (y1 - y0)))
            band = slice(max(y0, y - 3), min(y1, y + 3) + 1)
            px = plate[band][pm[band]]
            col = px.mean(0)
            stops.append({"at": f, "rgb": [int(round(c)) for c in col], "hex": "#%02x%02x%02x" % tuple(int(round(c)) for c in col)})
        sky_spec[k] = {
            "hour": anchors["sky"][k]["hour"],
            "stops": stops,
            "css": "linear-gradient(to bottom, " + ", ".join(f"{s['hex']} {int(s['at'] * 100)}%" for s in stops) + ")",
            "treeLayer": {"dawn": "morning", "morning": "morning", "noon": "morning", "golden": "golden", "dusk": "golden", "night": "night"}[k],
            "fromScene": k in ("golden", "morning", "night"),
        }
        if k in LIGHTS:
            # does the plate match the sky in the real base frame?
            base = load(RAW / f"kitchen-{k}-journal.png")
            tree = load(RAW / f"tree-{k}.png", "RGBA")[..., 3]
            sel = (panes > 250) & (tree < 2)
            full = np.asarray(Image.fromarray(plate.astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float32)
            d = np.abs(full - base).max(2)[sel]
            sky_spec[k]["meanDiffVsBaseSky"] = round(float(d.mean()), 2)
    report["skyPanesBbox"] = bb

# ---------------------------------------------------------------- journal page
if "page" in only:
    p = Image.open(RAW / "journal-page.png").convert("RGB")
    p.save(LAY / "journal-page.webp", quality=84, method=6)
    for k in ("journal-open", "journal-open-nopen"):
        im = Image.open(RAW / f"{k}.png").convert("RGBA")
        im.save(LAY / f"{k}.webp", quality=84, alpha_quality=100, method=6)
        report[k] = {"size": list(im.size)}

# ---------------------------------------------------------------- room.json
if "json" in only:
    def layer(file, what, **kw):
        d = {"file": f"/kitchen/layers/{file}", "small": f"/kitchen/layers/{file.replace('.webp', '-1920.webp')}", "what": what}
        d.update(kw)
        return d

    rep = json.loads((RAW / "report.json").read_text()) if (RAW / "report.json").exists() else {}
    rep.update(report)
    room = {
        "frame": {"width": 3840, "height": 2160, "units": "percent of frame, x from left, y from top"},
        "bases": {L: {"file": f"/kitchen/kitchen-{L}.webp", "small": f"/kitchen/kitchen-{L}-1920.webp",
                      "what": f"{L} light, journal on the counter"} for L in LIGHTS},
        "layers": [
            layer("window-panes.webp", "Mask of the window panes: white, alpha 1 where the window shows sky or tree, 0 on the frame, mullions, sill plant and wall. Lossless. Clip the sky gradient and the tree to it.", kind="mask"),
            *[layer(f"tree-{L}.webp", f"The tree alone in {L} light, transparent everywhere else, rendered past the pane edges so it can sway without showing a hole. Draw over the sky gradient, clipped by window-panes.", kind="tree", light=L, pivot=anchors["treePivot"]) for L in LIGHTS],
            layer("fridge-open-golden.webp", f"Full frame, golden light, fridge door open {anchors['doorDeg']} degrees with the interior lit; the paper and magnets ride on the door.", kind="full", light="golden", state="fridgeOpen"),
            layer("fridge-open-night.webp", "Full frame, night with the pendant on, fridge open; its light spills on the floor and the cabinet side.", kind="full", light="night", state="fridgeOpen"),
            layer("fridge-open-night-lampoff.webp", "Full frame, night with the pendant off and the fridge open: the fridge is the only light.", kind="full", light="night", state="fridgeOpen+lampOff"),
            layer("lamp-off-night.webp", "Full frame, night with the pendant off (the base night frame has it on). Crossfade for the pull chain.", kind="full", light="night", state="lampOff"),
            {"file": "/kitchen/layers/journal-open.webp", "what": "The whole open journal from straight above in golden light, with ribbon and pen, 2400 wide. Transparent around it except the journal's own shadow on the counter (shadow catcher). Spine runs top to bottom through the centre.", "kind": "journalTop"},
            {"file": "/kitchen/layers/journal-open-nopen.webp", "what": "Same view without the pen.", "kind": "journalTop"},
            {"file": "/kitchen/layers/journal-page.webp", "what": "Top-down, flat-lit render of the journal's right page alone, 1705x2400, for signing. Gutter on its left edge.", "kind": "page"},
        ],
        "anchors": {
            "potLid": anchors["potLid"],
            "thermosTop": anchors["thermosTop"],
            "steam": {"evening": "potLid", "morning": "thermosTop"},
            "pendant": anchors["pendant"],
            "plantLeaves": anchors["plantLeaves"],
            "sillPlantLeaves": anchors["sillPlantLeaves"],
            "fridgeHandle": anchors["fridgeHandle"],
            "fridgeDoorClosed": anchors["fridgeDoorClosed"],
            "fridgeDoorOpen": anchors["fridgeDoorOpen"],
            "treePivot": anchors["treePivot"],
            "treeCrown": anchors["treeCrown"],
        },
        "journal": anchors["journal"],
        "journalPage": anchors["journalPage"],
        "journalPageOrder": "top-left at the gutter, top-right, bottom-right, bottom-left, as the page image is oriented",
        "sky": sky_spec,
        "without": [],
        "notes": [
            "Leaf anchors: centre, tip and stem of the largest loose parts of each plant's leaf mesh, biggest first; areaCm2 is relative.",
            "Pendant hangs above frame: lampBottom has negative y. Hang the pull chain from the top edge at that x.",
            "without-<id> patches are not rendered yet: they wait for the new door items.",
            "Sky stops run top (0) to bottom (1) of the panes bbox in skyPanesBbox. golden, morning and night use the scene's own sky; dawn, noon and dusk are new values rendered the same way.",
        ],
        "registration": rep,
    }
    (PUB / "room.json").write_text(json.dumps(room, indent=1))
    print("wrote room.json")

if report:
    old = json.loads((RAW / "report.json").read_text()) if (RAW / "report.json").exists() else {}
    old.update(report)
    (RAW / "report.json").write_text(json.dumps(old, indent=1))
