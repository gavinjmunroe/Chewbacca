"""Which freely licensable face is closest to theirs, measured not eyeballed.

Renders the same string at the same size in each candidate and records the
advance width of the whole string plus of individual letters, then scores each
candidate by mean absolute difference from the reference's own metrics.
"""
import json
from playwright.sync_api import sync_playwright

S = "Stop guessing why your agents fail"
LETTERS = list("abcdefghijklmnopqrstuvwxyzAGMRSWagmrsw")

CANDIDATES = [
  ("Inter",            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=block"),
  ("Figtree",          "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500&display=block"),
  ("Hanken Grotesk",   "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500&display=block"),
  ("Plus Jakarta Sans","https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500&display=block"),
  ("Manrope",          "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500&display=block"),
  ("Outfit",           "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500&display=block"),
  ("DM Sans",          "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&display=block"),
]

MEASURE = """(args) => {
  const [fam, s, letters] = args;
  const c = document.createElement('canvas').getContext('2d');
  c.font = '400 40px ' + fam;
  const out = { full: +c.measureText(s).width.toFixed(2), letters: {} };
  const m = c.measureText('H');
  out.capH = +(m.actualBoundingBoxAscent).toFixed(2);
  const x = c.measureText('x');
  out.xH = +(x.actualBoundingBoxAscent).toFixed(2);
  for (const L of letters) out.letters[L] = +c.measureText(L).width.toFixed(3);
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. the reference's own metrics, from its live page
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("https://www.uselemma.ai/", wait_until="networkidle", timeout=90000)
    pg.wait_for_timeout(4000)
    ref = pg.evaluate(MEASURE, ["brittiSans", S, LETTERS])
    pg.close()

    # 2. each candidate, loaded from Google Fonts in a blank page
    results = []
    for name, href in CANDIDATES:
        q = b.new_page(viewport={"width": 1440, "height": 900})
        q.set_content(f'<link rel="stylesheet" href="{href}">'
                      f'<div style="font-family:\'{name}\';font-size:40px">{S}</div>')
        q.wait_for_timeout(2500)
        try: q.evaluate("document.fonts.ready")
        except Exception: pass
        q.wait_for_timeout(500)
        m = q.evaluate(MEASURE, [f"'{name}'", S, LETTERS])
        q.close()
        if m["full"] == 0: continue
        # normalise for overall width so we compare SHAPE not just scale
        k = ref["full"] / m["full"]
        diffs = [abs(m["letters"][L] * k - ref["letters"][L]) for L in LETTERS]
        results.append({
            "font": name, "width": m["full"], "scale_to_match": round(k, 4),
            "capH": m["capH"], "xH": m["xH"],
            "mean_letter_err_px": round(sum(diffs)/len(diffs), 3),
            "max_letter_err_px": round(max(diffs), 3),
        })
    b.close()

results.sort(key=lambda r: r["mean_letter_err_px"])
print(f"reference brittiSans: full width {ref['full']}px at 40px, cap {ref['capH']}, x-height {ref['xH']}\n")
print(f"{'font':20s} {'width':>8s} {'scale':>7s} {'capH':>6s} {'xH':>6s} {'mean err':>9s} {'max err':>8s}")
for r in results:
    print(f"{r['font']:20s} {r['width']:8.1f} {r['scale_to_match']:7.3f} {r['capH']:6.1f} {r['xH']:6.1f} "
          f"{r['mean_letter_err_px']:9.3f} {r['max_letter_err_px']:8.3f}")
json.dump({"reference": ref, "candidates": results}, open("fontmatch.json","w"), indent=1)
