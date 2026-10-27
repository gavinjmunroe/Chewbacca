"""The home page must finish loading on an iPhone in WebKit.

On 2026-10-26 the edit bay's ruler loop re-read strip.scrollWidth while its
own timecode labels (wider than their 80px spacing on a phone) kept pushing
it out, so iPhone Safari froze before anything showed. Chromium and desktop
widths loaded fine, which is why only a phone-sized WebKit run catches it.
    python3 ~/code/chewbacca/skills/cinematic-scroll/scripts/phone_loads.py <url>
"""
import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    sys.exit("usage: phone_loads.py <url>")
URL = sys.argv[1]
bad = []
with sync_playwright() as p:
    b = p.webkit.launch()
    for w, h in [(390, 844), (375, 667), (600, 900)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        try:
            pg.goto(URL, wait_until="load", timeout=30000)
            pg.evaluate("1")
        except Exception as e:
            bad.append(f"{w}x{h}: did not load ({str(e).splitlines()[0][:80]})")
        if errs:
            bad.append(f"{w}x{h}: {errs[0][:120]}")
        ctx.close()
    b.close()
print("\n".join(bad) if bad else "loads on every phone size")
sys.exit(1 if bad else 0)
