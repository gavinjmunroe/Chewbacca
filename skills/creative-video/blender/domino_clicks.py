#!/usr/bin/env python3
"""The sound of the dominoes, from the render's own impact times.

  domino_clicks.py timings.json out.wav [--seed 7]

One click per domino, placed on the instant domino_reveal.py says it hit the
next one, so the sound can never drift from the picture. Nothing is sampled:
each click is a short noise burst plus a decaying woody resonance, varied per
domino in pitch, level and pan, then a small room.
"""

import argparse
import json
import wave

import numpy as np

RATE = 48_000


def click(rng: np.random.Generator) -> np.ndarray:
    n = int(0.03 * RATE)
    t = np.arange(n) / RATE
    burst = rng.standard_normal(n) * np.exp(-t / 0.0016)
    burst = np.diff(burst, prepend=0.0)          # tilt it bright, like a hard edge
    f = rng.uniform(2100, 3600)
    body = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006) * 0.6
    low = np.sin(2 * np.pi * f / 3.1 * t) * np.exp(-t / 0.010) * 0.25
    return burst * 0.5 + body + low


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("timings")
    ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    data = json.load(open(args.timings))
    total = int(data["seconds"] * RATE) + RATE
    out = np.zeros((total, 2))
    for t in data["impacts"]:
        c = click(rng) * rng.uniform(0.35, 1.0)
        pan = rng.uniform(0.25, 0.75)
        i = int(t * RATE + rng.integers(-40, 40))
        if i < 0 or i + len(c) >= total:
            continue
        out[i:i + len(c), 0] += c * np.sqrt(1 - pan)
        out[i:i + len(c), 1] += c * np.sqrt(pan)
    # A small room: 60 ms of decaying noise as an impulse response.
    ir_n = int(0.06 * RATE)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (0.015 * RATE)) * 0.08
    ir[0] = 1.0
    for ch in range(2):
        out[:, ch] = np.convolve(out[:, ch], ir)[:total]
    out /= max(1e-9, np.abs(out).max()) / 0.8
    pcm = (out * 32767).astype("<i2")
    with wave.open(args.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print(f"domino_clicks: {len(data['impacts'])} clicks, {total / RATE:.1f}s -> {args.out}")


if __name__ == "__main__":
    main()
