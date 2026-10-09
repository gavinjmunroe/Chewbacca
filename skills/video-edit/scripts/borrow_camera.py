#!/usr/bin/env python3
"""Give a locked-off shot the reference's handheld camera motion, frame for frame.

    uv run -q --with opencv-python-headless --with numpy python -I borrow_camera.py REF SRC OUT.mov \
        --ss 9.0 --t 6.8 [--anchor 300,1300] [--amount 0.7] [--rot 0.25]

Measures REF's per-frame pan, zoom and rotation (ref_motion.measure), smooths it
lightly, centers the pan and applies it to SRC from --ss for --t seconds at REF's
fps. --amount scales pan and zoom, --rot scales rotation (rotation estimates pick up
parallax from moving subjects, so keep it low). The base zoom is the smallest that keeps
every frame's edges inside the source; zoom is anchored at --anchor (keep the
evidence, e.g. the laptop screen, near it). Writes 1080x1920 video only (ProRes 422 HQ).
"""
import argparse
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir
from ref_motion import measure

W, H = 1080, 1920


def path(ref, amount, rot_amount):
    _, rows = measure(ref)
    a = np.array([r[:8] for r in rows], dtype=float)
    a = np.nan_to_num(a, nan=0.0)
    a[:, 2] = np.where(a[:, 2] == 0, 1, a[:, 2])
    k = np.ones(5) / 5
    sm = lambda v: np.convolve(np.pad(v, 2, mode="edge"), k, mode="valid")
    tx = sm(np.concatenate([[0], np.cumsum(a[:, 3])])) / 100 * W
    ty = sm(np.concatenate([[0], np.cumsum(a[:, 4])])) / 100 * H
    rot = sm(np.concatenate([[0], np.cumsum(a[:, 5])]))
    z = sm(np.concatenate([[1], np.cumprod(a[:, 2])]))
    tx, ty, rot = (tx - (tx.min() + tx.max()) / 2) * amount, (ty - (ty.min() + ty.max()) / 2) * amount, (rot - rot.mean()) * rot_amount
    return tx, ty, rot, 1 + (z - 1) * amount


def matrices(tx, ty, rot, z, anchor):
    """Source->output affine per frame, with the smallest base zoom that hides every edge."""
    corners = np.array([[0, 0, 1], [W, 0, 1], [0, H, 1], [W, H, 1]], float).T
    ms = lambda base: [cv2.getRotationMatrix2D(anchor, r, base * zz) + [[0, 0, x], [0, 0, y]]
                       for x, y, r, zz in zip(tx, ty, rot, z)]
    base = 1.0
    while True:
        ok = True
        for m in ms(base):
            src = cv2.invertAffineTransform(m) @ corners
            if src[0].min() < 0 or src[1].min() < 0 or src[0].max() > W or src[1].max() > H:
                ok = False
                break
        if ok:
            return base, ms(base)
        base += 0.005


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("ref"); p.add_argument("src"); p.add_argument("out")
    p.add_argument("--ss", type=float, default=0); p.add_argument("--t", type=float, required=True)
    p.add_argument("--anchor", default="540,960"); p.add_argument("--amount", type=float, default=0.7)
    p.add_argument("--rot", type=float, default=0.25)
    a = p.parse_args()
    fps = cv2.VideoCapture(a.ref).get(cv2.CAP_PROP_FPS)
    tx, ty, rot, z = path(a.ref, a.amount, a.rot)
    base, ms = matrices(tx, ty, rot, z, tuple(float(v) for v in a.anchor.split(",")))
    print(f"base zoom {base:.3f}; pan x {np.ptp(tx):.0f}px y {np.ptp(ty):.0f}px; rot {np.ptp(rot):.2f}°; zoom {z.min():.3f}-{z.max():.3f}")
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", str(a.ss), "-t", str(a.t), "-i", a.src, "-vf",
                            f"fps={fps},scale={W}:{H},setsar=1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps),
                            "-i", "-", "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
                            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", a.out], stdin=subprocess.PIPE)
    i = 0
    while (buf := dec.stdout.read(W * H * 3)) and len(buf) == W * H * 3:
        f = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        m = ms[min(i, len(ms) - 1)]
        enc.stdin.write(cv2.warpAffine(f, m, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT).tobytes())
        i += 1
    enc.stdin.close(); enc.wait(); dec.wait()
    print(f"{i} frames -> {a.out}")
