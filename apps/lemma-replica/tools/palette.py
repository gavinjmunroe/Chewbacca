"""Phase 0.4: for every repeated element set, the DISTINCT values it uses.

Yesterday's lesson in one script. A wall of 42 bricks was first a uniform
lattice, then overcorrected to a seeded random masonry, and the truth was four
widths in a fixed sequence. Uniform and random are both guesses. A set of four
distinct values is a palette and has to be read, not invented.
"""
import sys, json, collections
from playwright.sync_api import sync_playwright

JS = r"""() => {
  const groups = new Map();           // parent signature -> children boxes
  for (const el of document.querySelectorAll('body *')) {
    const kids = [...el.children];
    if (kids.length < 6) continue;
    const tags = new Set(kids.map(k => k.tagName));
    if (tags.size > 2) continue;      // a genuine repeated set, not a mixed container
    const boxes = kids.map(k => { const b = k.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height),
               x: Math.round(b.left), y: Math.round(b.top) }; })
      .filter(b => b.w > 1 && b.h > 1);
    if (boxes.length < 6) continue;
    const key = el.tagName + '>' + [...tags].join(',') + ' n=' + boxes.length;
    if (!groups.has(key)) groups.set(key, boxes);
  }
  const out = [];
  for (const [key, boxes] of groups) {
    const uw = [...new Set(boxes.map(b => b.w))].sort((a,b)=>a-b);
    const uh = [...new Set(boxes.map(b => b.h))].sort((a,b)=>a-b);
    // gaps between consecutive siblings on the same row
    const rows = {};
    for (const b of boxes) (rows[b.y] = rows[b.y] || []).push(b);
    const gaps = [];
    for (const y of Object.keys(rows)) {
      const r = rows[y].sort((a,b)=>a.x-b.x);
      for (let i=1;i<r.length;i++) gaps.push(r[i].x - (r[i-1].x + r[i-1].w));
    }
    out.push({ key, n: boxes.length,
      widths: uw.slice(0,14), n_widths: uw.length,
      heights: uh.slice(0,8), n_heights: uh.length,
      gaps: [...new Set(gaps)].sort((a,b)=>a-b).slice(0,8), rows: Object.keys(rows).length });
  }
  return out;
}"""

url, tag = sys.argv[1], sys.argv[2]
YS = [int(v) for v in sys.argv[3].split(",")]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1440,"height":900})
    pg.goto(url, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(5000)
    seen={}
    for y in YS:
        pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(1100)
        for g in pg.evaluate(JS):
            seen.setdefault(g["key"], g)
    print(f"=== {tag}: {len(seen)} repeated sets ===")
    for g in sorted(seen.values(), key=lambda g: -g["n"]):
        verdict = ("UNIFORM" if g["n_widths"]==1 else
                   f"PALETTE of {g['n_widths']}" if g["n_widths"]<=6 else
                   f"{g['n_widths']} widths, likely continuous")
        print(f"  {g['key']:44s} rows{g['rows']:3d} | {verdict:26s} w{g['widths'][:6]} h{g['heights'][:3]} gaps{g['gaps'][:4]}")
    json.dump(list(seen.values()), open(f"palette_{tag}.json","w"), indent=1)
    b.close()
