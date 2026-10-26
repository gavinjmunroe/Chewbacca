"""Every listed pinned layer must span the whole window.

A 40px section gutter once boxed a scene in and let the previous one show
through at both edges (Parker site, 2026-10-25).
    python3 full_bleed.py <url> ".pin-a,.pin-b"
"""
import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) < 3:
    sys.exit("usage: full_bleed.py <url> \".pin-a,.pin-b\"")
URL = sys.argv[1]
PINS = [x.strip() for x in sys.argv[2].split(",") if x.strip()]

with sync_playwright() as p:
    b = p.chromium.launch()
    bad = []
    for w, h in [(1000, 506), (1440, 900)]:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto(URL, wait_until="load", timeout=60000)
        pg.wait_for_timeout(1500)
        for s in PINS:
            r = pg.evaluate(f"()=>{{const e=document.querySelector('{s}');if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.width]}}")
            # A scene hidden at this width (display: none) has nothing to frame.
            if r and r[1] > 0 and (abs(r[0]) > 0.5 or abs(r[1] - w) > 0.5):
                bad.append(f"{w}x{h} {s} left={r[0]:.0f} width={r[1]:.0f}")
        pg.close()
    b.close()
print("\n".join(bad) or "all pinned scenes are full bleed")
sys.exit(1 if bad else 0)
