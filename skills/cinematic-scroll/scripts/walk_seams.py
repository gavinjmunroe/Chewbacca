"""Shoot a frame either side of every hand-off at Caleb's window size.

Every bug on 2026-10-25 lived at a seam: a section's padding showing the
scene before it, a z-index change putting the Mac over Premiere, a monitor
switching pictures at the cut. Run this after any change and look at the
sheet it writes.
    python3 walk_seams.py <url> ".scene:0,.scene:0.99" [out.png]
"""
import sys
from playwright.sync_api import sync_playwright
from PIL import Image

if len(sys.argv) < 3:
    sys.exit("usage: walk_seams.py <url> \".scene:0,.scene:0.99,...\" [out.png]")
URL = sys.argv[1]
SEAMS = [(x.rsplit(":", 1)[0], float(x.rsplit(":", 1)[1])) for x in sys.argv[2].split(",") if x.strip()]
OUT = sys.argv[3] if len(sys.argv) > 3 else "seams.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1000, "height": 506})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(3000)
    shots = []
    for i, (sel, f) in enumerate(SEAMS):
        y = pg.evaluate(f"()=>{{const e=document.querySelector('{sel}');if(!e)return null;const t=e.getBoundingClientRect().top+scrollY;return t+Math.max(0,e.offsetHeight-innerHeight)*{f}}}")
        if y is None:
            print("missing", sel)
            continue
        for dy in (-3, 3):
            pg.evaluate(f"scrollTo(0,{y + dy})")
            pg.wait_for_timeout(700)
            shots.append(pg.screenshot())
    b.close()
import io
ims = [Image.open(io.BytesIO(s)).resize((400, 202)) for s in shots]
sheet = Image.new("RGB", (800, 202 * ((len(ims) + 1) // 2)))
for k, im in enumerate(ims):
    sheet.paste(im, ((k % 2) * 400, (k // 2) * 202))
sheet.save(OUT)
print("errors", errs, "->", OUT)
sys.exit(1 if errs else 0)
