#!/usr/bin/env python3
"""Measure camera motion, speed and transitions in a reference video.

    uv run -q --with opencv-python-headless --with numpy python -I ref_motion.py REF.mp4 [--every 0.1]

Prints one row per --every seconds: frame diff (subject motion), zoom per frame and
cumulative zoom since the last cut (push-in > 1, pull-out < 1), pan in % of frame
per frame, rotation and mean luma (a dip to black or a flash shows here). Then, per
shot, the share of repeated frames: a 30 fps source in a 60 fps file repeats every
other frame; irregular repeats mean low-light variable frame rate or slow motion;
no repeats with unusually fast motion suggests a speed-up. Confirm on frame strips.
"""
import argparse
import cv2
import numpy as np


def measure(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    prev, rows, cum, i = None, [], 1.0, 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(cv2.resize(f, (360, 640)), cv2.COLOR_BGR2GRAY)
        if prev is not None:
            diff = float(np.mean(cv2.absdiff(g, prev)))
            s = tx = ty = rot = np.nan
            p0 = cv2.goodFeaturesToTrack(prev, 400, 0.01, 8)
            if p0 is not None and len(p0) > 20:
                p1, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, p0, None)
                ok_pts = st.ravel() == 1
                M, _ = cv2.estimateAffinePartial2D(p0[ok_pts], p1[ok_pts], method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if M is not None:
                    s = float(np.hypot(M[0, 0], M[1, 0]))
                    rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
                    cx, cy = M @ [180, 320, 1]  # pan = motion of the frame center, so a centered zoom reads as zero pan
                    tx, ty = (cx - 180) / 360 * 100, (cy - 320) / 640 * 100
            cut = diff > 25 or (g.mean() < 20 <= prev.mean())  # hard cut, or entering a dip to black
            cum = 1.0 if cut else cum * (1 if np.isnan(s) else s)
            rows.append((i / fps, diff, s, tx, ty, rot, cum, float(g.mean()), cut))
        prev, i = g, i + 1
    return fps, rows


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("ref")
    p.add_argument("--every", type=float, default=0.1)
    a = p.parse_args()
    fps, rows = measure(a.ref)
    step = max(1, round(fps * a.every))
    print(f"{a.ref}  {fps:.0f} fps, {len(rows) + 1} frames")
    print("    t   diff  zoom/fr  pan_x%  pan_y%   rot°  cumzoom  luma")
    for r in rows[::step]:
        print(f"{r[0]:5.2f} {r[1]:6.2f} {r[2]:8.5f} {r[3]:7.3f} {r[4]:7.3f} {r[5]:6.3f} {r[6]:8.3f} {r[7]:5.0f}")
    cuts = [0.0] + [r[0] for r in rows if r[8]] + [rows[-1][0] + 1 / fps]
    print("shot          repeated frames  unique fps")
    for s, e in zip(cuts, cuts[1:]):
        d = [r[1] for r in rows if s <= r[0] < e]
        if d:
            rep = sum(x < 0.15 for x in d)
            print(f"{s:5.2f}-{e:5.2f}  {rep / len(d) * 100:13.0f}%  {(len(d) - rep) / (e - s):10.1f}")
