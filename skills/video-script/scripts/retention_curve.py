#!/usr/bin/env python3
"""Read the retention curve from an Instagram "How long people watched your reel" screenshot.

Finds the three evenly spaced gridlines (100%, 50%, 0) and the magenta curve between them,
maps the curve's horizontal extent to 0..duration, and prints % still watching at fixed
seconds plus the average watch time implied by the area under the curve. Compare that
average with the app's figure: a gap of more than a few seconds means a misread.

usage: retention_curve.py SCREENSHOT --duration SECONDS [--at 1 3 5 ...]
       retention_curve.py --selftest
Needs Pillow and numpy. Tuned for dark mode; light mode or a new app design may need new colours.
"""
import argparse, json, sys
import numpy as np
from PIL import Image, ImageDraw

DEFAULT_AT = [1, 3, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120]


def read_curve(img, duration):
    im = np.asarray(img.convert("RGB")).astype(int)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    curve = (R > 190) & (G < 90) & (B > 150)  # the magenta line
    h, w = curve.shape
    # Gridlines: rows where most of the width is one flat colour that isn't the background.
    bg = np.median(im.reshape(-1, 3), axis=0)
    grid_rows = []
    for y in range(h):
        row = im[y, w // 6: 5 * w // 6]
        c = np.median(row, axis=0)
        if np.abs(c - bg).sum() > 30 and (np.abs(row - c).sum(axis=1) < 18).mean() > 0.8:
            grid_rows.append(y)
    lines = []
    for y in grid_rows:
        if lines and y - lines[-1][-1] <= 2:
            lines[-1].append(y)
        else:
            lines.append([y])
    lines = [float(np.mean(g)) for g in lines]
    ys, xs = np.nonzero(curve)
    for a, b, c in zip(lines, lines[1:], lines[2:]):
        gap = b - a
        if gap > 40 and abs((c - b) - gap) <= 4:
            sel = (ys >= a - 10) & (ys <= c + 10)
            if sel.sum() > 100:
                cx, cy = xs[sel], ys[sel]
                x0, x1 = cx.min(), cx.max()

                def pct(t):
                    col = cy[np.abs(cx - (x0 + (x1 - x0) * t / duration)) <= 1]
                    return None if len(col) == 0 else float(100 * (c - np.median(col)) / (c - a))
                return pct
    raise SystemExit("No 100/50/0 gridlines with a curve between them. Crop to the retention chart, or read it by eye.")


def summarize(pct, duration, at):
    points = {t: round(pct(t), 1) for t in at if t < duration - 0.5 and pct(t) is not None}
    end = pct(duration - 0.3)
    ts = np.linspace(0, duration, 600)
    vals = np.clip([pct(t) or 0.0 for t in ts], 0, 100)
    return {"points": points, "end": None if end is None else round(end, 1),
            "avg_watch_s_from_area": round(float(np.trapezoid(vals, ts) / 100), 1)}


def selftest():
    # Synthetic dark-mode chart: gridlines at 100/50/0 and a known curve (100% falling to 20%).
    img = Image.new("RGB", (1200, 900), (11, 16, 20))
    d = ImageDraw.Draw(img)
    top, bot, left, right = 200, 600, 150, 1100
    for y in (top, (top + bot) // 2, bot):
        d.line([(100, y), (1150, y)], fill=(36, 41, 46), width=3)
    f = lambda t: 20 + 80 * np.exp(-t / 5)  # % watching at t seconds, duration 60 s
    pts = [(left + (right - left) * t / 60, bot - (bot - top) * f(t) / 100) for t in np.linspace(0, 60, 400)]
    d.line(pts, fill=(230, 40, 200), width=6)
    got = summarize(read_curve(img, 60), 60, [3, 10, 30])
    for t, v in got["points"].items():
        assert abs(v - f(t)) < 2.5, (t, v, f(t))
    expected_avg = float(np.trapezoid([f(t) for t in np.linspace(0, 60, 600)], np.linspace(0, 60, 600)) / 100)
    assert abs(got["avg_watch_s_from_area"] - expected_avg) < 1.0, got
    print("selftest ok", got)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("screenshot", nargs="?")
    p.add_argument("--duration", type=float, help="reel length in seconds (the graph's end label)")
    p.add_argument("--at", type=float, nargs="*", default=DEFAULT_AT)
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()
    if a.selftest:
        selftest()
        sys.exit()
    if not (a.screenshot and a.duration):
        p.error("give a screenshot and --duration")
    print(json.dumps(summarize(read_curve(Image.open(a.screenshot), a.duration), a.duration, a.at), indent=1))
