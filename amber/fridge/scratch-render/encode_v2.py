"""Turn the lossless v2 renders into what the page loads, and write the manifest.

    python3 scratch-render/encode_v2.py

Reads scratch-render/v2raw/ (stills, clock hands, clip frames, posters,
geom.json) and writes public/kitchen/v2/. Anything not rendered yet is left
out of the manifest's media (empty strings), so the page can go up while the
rest renders and fill in on the next run. Safe to run repeatedly: a file that
already exists and is newer than its source is skipped.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

HERE = Path(__file__).resolve().parent
RAW = HERE / "v2raw"
OUT = HERE.parent / "public" / "kitchen" / "v2"
URL = "/kitchen/v2"
LIGHTS = ("morning", "golden", "night")
CAMS = ("wide", "tall")
SMALL = {"wide": 1920, "tall": 1080}
FPS = 24
NFRAMES = 48       # render_v2.py
FRONT_FRAME = 24   # render_v2.py: where the page pauses on the object's front

# The three shelf volumes that can be pulled out; the other four stay put.
# Caleb never picked a count; three was the recommendation (2026-10-07).
SHELF_YEARS = [2019, 2020, 2023]

OBJECTS = [
    ("note", "Notebook page on the freezer door",
     "Not sure if it's a like-minded friend or a well-made bot. You're just hoping to raise a number to feel more. Can social networking be any different?"),
    ("polaroid", "Instant photo of five friends",
     "Finding the perfect group for that road trip you've been wanting to take."),
    ("bizcard", "Business card for Halden and Rue, furniture makers",
     "Met at Maya's party. Needs a designer. Turning the connection you never knew you had into your next client."),
    ("resume", "Resume for Lucia Moreno with a sticky note",
     "Introducing your little sister, who's looking for an internship, to your friend's company because you know it'd be a good fit."),
    ("prayer", "Index card in pencil, who to pray for this week",
     "Talk to God before you talk to anyone else today."),
]


def encoder():
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("no ffmpeg on PATH and no imageio-ffmpeg; install one")


def fresh(dst: Path, src: Path) -> bool:
    return dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime


def webp(src: Path, dst: Path, width=None, quality=82):
    if fresh(dst, src):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=quality, method=6)
    print("webp", dst.relative_to(OUT))


def mp4(frames: Path, dst: Path, reverse=False):
    first = frames / "0001.png"
    if fresh(dst, first):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = "reverse,format=yuv420p" if reverse else "format=yuv420p"
    subprocess.run(
        [encoder(), "-y", "-loglevel", "error", "-framerate", str(FPS),
         "-i", str(frames / "%04d.png"), "-vf", vf, "-c:v", "libx264",
         "-crf", "20", "-preset", "slow", "-movflags", "+faststart", str(dst)],
        check=True,
    )
    print("mp4 ", dst.relative_to(OUT))


def hand_layers(cam: str, tag: str) -> dict:
    """The clock hands, one transparent full-frame layer each.

    The render's dial is a shadow catcher, and the hidden rim and glass still
    shade it, so every layer came out with the same dark disc under its hand
    (seen on the first deploy, 2026-10-07: the page drew a black clock face).
    Measured on the golden render, the disc sits at alpha 200 to 249 and the
    hands at 250 and up, so the hand is what clears 250, grown a pixel to keep
    its antialiased edge."""
    srcs = {l: RAW / f"hands-{cam}-{tag}-{l}.png" for l in ("hour", "minute", "cap")}
    if not all(p.exists() for p in srcs.values()):
        return {l: "" for l in srcs}
    out = {}
    for l, src in srcs.items():
        dst = OUT / cam / f"hands-{tag}-{l}.webp"
        if not fresh(dst, src):
            im = Image.open(src).convert("RGBA")
            a = im.getchannel("A")
            mask = a.point(lambda v: 255 if v >= 250 else 0).filter(ImageFilter.MaxFilter(3))
            keep = ImageChops.multiply(a, mask)
            cut = im.copy()
            cut.putalpha(keep)
            dst.parent.mkdir(parents=True, exist_ok=True)
            cut.save(dst, "WEBP", quality=90, method=6)
            print("webp", dst.relative_to(OUT))
        out[l] = f"{URL}/{cam}/hands-{tag}-{l}.webp"
    return out


def clip(tag: str) -> dict:
    """One clip's entry. Clips are full frame: the room's depth of field
    changes every pixel, so there is no smaller rect to overlay."""
    frames = RAW / "clips" / tag
    poster = RAW / "clips" / f"{tag}-poster.png"
    entry = {"rect": [0, 0, 100, 100], "in": "", "out": "", "poster": ""}
    # Door objects are 48 frames since the front pause; the shelf volumes kept
    # their 38-frame renders from the first golden pass, which already worked.
    need = 38 if tag.startswith("vol") else NFRAMES
    done = frames.is_dir() and (frames / f"{need:04d}.png").exists()
    if done:
        mp4(frames, OUT / "clips" / f"{tag}-in.mp4")
        mp4(frames, OUT / "clips" / f"{tag}-out.mp4", reverse=True)
        entry["in"] = f"{URL}/clips/{tag}-in.mp4"
        entry["out"] = f"{URL}/clips/{tag}-out.mp4"
    if poster.exists() and done:
        webp(poster, OUT / "clips" / f"{tag}-poster.webp", quality=86)
        entry["poster"] = f"{URL}/clips/{tag}-poster.webp"
    front = RAW / "clips" / f"{tag}-front.png"
    if front.exists() and done:
        webp(front, OUT / "clips" / f"{tag}-front.webp", quality=86)
        entry["front"] = f"{URL}/clips/{tag}-front.webp"
        entry["frontAt"] = round((FRONT_FRAME - 1) / FPS, 4)
    return entry


def main():
    geom = json.loads((RAW / "geom.json").read_text())
    # Until the tall camera renders, phones get the wide camera, held on the
    # fridge by the web track's focus point.
    have = {c: (RAW / f"still-{c}-golden.png").exists() for c in CAMS}
    src_cam = {c: (c if have[c] else "wide") for c in CAMS}

    stills, clocks = {}, {}
    for cam in CAMS:
        sc = src_cam[cam]
        stills[cam], clocks[cam] = {}, {}
        for light in LIGHTS:
            src = RAW / f"still-{sc}-{light}.png"
            if not src.exists():
                src = RAW / f"still-{sc}-golden.png"   # until this light renders
                tag = "golden"
            else:
                tag = light
            webp(src, OUT / sc / f"{tag}.webp")
            webp(src, OUT / sc / f"{tag}-{SMALL[cam]}.webp", width=SMALL[cam])
            stills[cam][light] = f"{URL}/{sc}/{tag}.webp"
            hands = hand_layers(sc, tag)
            clocks[cam][light] = {"pivot": geom[sc]["clock_pivot"], **hands}

    def per_cam_light(fn):
        return {cam: {light: fn(src_cam[cam], light) for light in LIGHTS} for cam in CAMS}

    def lit(sc, light, tag):
        """The clip for this light, or golden's until this light renders."""
        own = clip(f"{tag}-{sc}-{light}")
        return own if own["in"] else clip(f"{tag}-{sc}-golden")

    cameras = {}
    for cam in CAMS:
        w, h = geom[src_cam[cam]]["size"]
        cameras[cam] = {"width": w, "height": h}
        if src_cam[cam] != cam:
            cameras[cam]["focus"] = [31, 52]

    # Where each held object sits on screen (render_v2.py held <cam>), so the
    # page can tell a click on the object from a click beside it.
    held = {}
    for cam in CAMS:
        f = RAW / f"held-{cam}.json"
        held[cam] = json.loads(f.read_text()) if f.exists() else {}

    def with_held(entry, sc, iid):
        if iid in held.get(sc, {}):
            entry = {**entry, "held": held[sc][iid]}
        return entry

    objects = [
        {
            "id": iid, "label": label, "backText": back,
            "hotspot": {cam: geom[src_cam[cam]]["objects"][iid] for cam in CAMS},
            "clip": per_cam_light(lambda sc, light, iid=iid: with_held(lit(sc, light, iid), sc, iid)),
        }
        for iid, label, back in OBJECTS
    ]

    shelf = {
        "years": SHELF_YEARS,
        "hotspot": {cam: [geom[src_cam[cam]]["volumes"][str(y)] for y in SHELF_YEARS] for cam in CAMS},
        # On the phone the pulled journal came out small and the room stayed
        # sharp behind it (2026-10-07 check at 390x844), so the shelf is not
        # clickable there until that motion is redone for the phone camera.
        "clip": per_cam_light(lambda sc, light: [
            lit(sc, light, f"vol{y}") if sc == "wide" else {"rect": [0, 0, 100, 100], "in": "", "out": "", "poster": ""}
            for y in SHELF_YEARS]),
    }

    # The open guest page, rendered from straight above in the room's light
    # (render_v2.py page). Fractions measured on the golden render, which
    # matched make_v2_textures.py's ruling to within 1.5% of the width:
    # header rule 0.147, an 8 mm row every 0.039, the first line to sign on
    # one row down, columns split at 0.564.
    PAGE_X0, PAGE_XS, PAGE_X1 = 0.057, 0.564, 0.912
    PAGE_TOP, PAGE_ROW, PAGE_BOTTOM = 0.147, 0.039, 0.889

    def page(sc, light):
        w, h = geom[sc]["size"]
        suffix = "" if sc == "wide" else f"-{sc}"
        src = RAW / f"page-{light}{suffix}.png"
        tag = light
        if not src.exists():
            src, tag = RAW / f"page-golden{suffix}.png", "golden"
        meta = RAW / f"page-{tag}{suffix}.json"
        if src.exists() and meta.exists():
            webp(src, OUT / "page" / f"{tag}{suffix}.webp", quality=86)
            image = f"{URL}/page/{tag}{suffix}.webp"
            # The render is its own full frame; the page sits inside it here.
            rect = [0, 0, 100, 100]
            pr = json.loads(meta.read_text())["page_rect"]
        else:
            image, iw, ih = "/kitchen/journal/page-standin.png", 920, 1280
            book = geom[sc]["journal"]
            cx = sum(p[0] for p in book) / len(book)
            top = min(p[1] for p in book)
            pw = 8
            ph = pw * w * (ih / iw) / h
            rect = [round(cx - pw / 2, 3), round(max(1.0, top - ph - 1.5), 3), pw, ph]
            pr = rect
        pw, ph = pr[2], pr[3]
        px = lambda fx: pr[0] + fx * pw  # noqa: E731
        py = lambda fy: pr[1] + fy * ph  # noqa: E731
        return {
            "rect": rect,
            "image": image,
            "nameColumn": [[px(PAGE_X0), py(PAGE_TOP)], [px(PAGE_XS), py(PAGE_TOP)], [px(PAGE_XS), py(PAGE_BOTTOM)], [px(PAGE_X0), py(PAGE_BOTTOM)]],
            "numberColumn": [[px(PAGE_XS), py(PAGE_TOP)], [px(PAGE_X1), py(PAGE_TOP)], [px(PAGE_X1), py(PAGE_BOTTOM)], [px(PAGE_XS), py(PAGE_BOTTOM)]],
            "firstLine": py(PAGE_TOP + PAGE_ROW),
            "lineGap": PAGE_ROW * ph,
        }

    manifest = {
        "version": 2,
        "cameras": cameras,
        "stills": stills,
        "objects": objects,
        "clock": clocks,
        "shelf": shelf,
        "journal": {
            "hotspot": {cam: geom[src_cam[cam]]["journal"] for cam in CAMS},
            "page": per_cam_light(page),
        },
        "ambient": {cam: {light: {} for light in LIGHTS} for cam in CAMS},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=1))
    tmp.replace(OUT / "manifest.json")
    print("manifest", OUT / "manifest.json")


if __name__ == "__main__":
    main()
