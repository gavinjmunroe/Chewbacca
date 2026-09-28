"""Phase 0.2, corrected: measure each section with the viewport AT that section.

The first version walked the whole page once and then measured everything from
one final pass. Both pages are scroll-animated, so that reads every section in
whatever state the walk left it in: the reference's hero had unmounted entirely
and our hero's heading reported x=296 against its true 531. A delta ledger built
on that would be wrong in a way that looks precise.
"""
import sys, json
from playwright.sync_api import sync_playwright

FIND = r"""() => [...document.querySelectorAll('h1,h2')]
  .filter(h => (h.innerText||'').trim() && h.getBoundingClientRect().width > 0)
  .map(h => ({ y: Math.round(h.getBoundingClientRect().top + scrollY),
               text: (h.innerText||'').trim().replace(/\s+/g,' ').slice(0,52) }))"""

MEASURE = r"""(want) => {
  const heads = [...document.querySelectorAll('h1,h2')]
    .filter(h => (h.innerText||'').trim());
  let h = heads.find(x => (x.innerText||'').trim().replace(/\s+/g,' ').slice(0,52) === want);
  if (!h) return null;
  const hb = h.getBoundingClientRect(), hc = getComputedStyle(h);
  /* THE LEAD IS THE FIRST <p> AFTER THE HEADING INSIDE THE HEADING'S OWN
     BLOCK, not the first one found by walking siblings upward.

     The sibling walk climbed out of the heading's container whenever the
     heading was the last child, and then grabbed a paragraph from the next
     section entirely. On the four feature blocks it reported three of them as
     715px wide with a 14px gap while the DOM said 384 and 8, so the ledger
     had me about to fix three things that were already correct.

     Climbing to the nearest container that holds BOTH the heading and a
     paragraph keeps the search inside one block. */
  let lead = null, box = h.parentElement;
  for (let k = 0; k < 6 && box; k++) {
    const ps = [...box.querySelectorAll('p')].filter(x =>
      h.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (ps.length) { lead = ps[0]; break; }
    box = box.parentElement;
  }
  const lb = lead && lead.getBoundingClientRect(), lc = lead && getComputedStyle(lead);
  // everything currently painted in the viewport band
  const kids = [...document.querySelectorAll('body *')].filter(e => {
    const b = e.getBoundingClientRect();
    return b.width > 2 && b.height > 2 && b.bottom > 0 && b.top < innerHeight;
  });
  const tags = {};
  for (const e of kids) tags[e.tagName] = (tags[e.tagName]||0) + 1;
  let big = null;
  for (const e of kids) {
    if (!/^(DIV|SECTION|FIGURE|IMG|CANVAS|svg|PRE|TABLE)$/.test(e.tagName)) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 200 || b.height < 140 || b.width > 1400) continue;
    const a = b.width * b.height;
    if (!big || a > big.a) big = { a, w: Math.round(b.width), h: Math.round(b.height),
                                   tag: e.tagName, kids: e.querySelectorAll('*').length };
  }
  const ctl = kids.filter(e => /^(A|BUTTON|INPUT)$/.test(e.tagName))
    .map(e => Math.round(e.getBoundingClientRect().height));
  return {
    h_size: hc.fontSize, h_lh: hc.lineHeight, h_ls: hc.letterSpacing,
    h_weight: hc.fontWeight, h_align: hc.textAlign,
    h_x: Math.round(hb.left), h_w: Math.round(hb.width),
    h_lines: Math.max(1, Math.round(hb.height / (parseFloat(hc.lineHeight) || 1))),
    lead: lead ? { size: lc.fontSize, lh: lc.lineHeight, color: lc.color,
                   w: Math.round(lb.width), gap: Math.round(lb.top - hb.bottom) } : null,
    painted: kids.length,
    shapes: (tags.path||0)+(tags.polyline||0)+(tags.polygon||0)+(tags.circle||0)+(tags.line||0)+(tags.rect||0),
    svg: tags.svg||0, canvas: tags.CANVAS||0, img: tags.IMG||0,
    mockup: big ? { w: big.w, h: big.h, tag: big.tag, kids: big.kids } : null,
    controls: ctl.length, control_h: [...new Set(ctl)].sort((a,b)=>a-b).slice(0,5),
  };
}"""

url, tag = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(url, wait_until="networkidle", timeout=120000)
    pg.wait_for_timeout(5000)
    heads = pg.evaluate(FIND)                      # positions BEFORE any walk
    total = pg.evaluate("document.documentElement.scrollHeight")
    # a lazy page grows; walk once to find the rest, then re-collect
    y = 0
    while y < total:
        pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(60)
        total = pg.evaluate("document.documentElement.scrollHeight"); y += 600
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(1500)
    later = pg.evaluate(FIND)
    seen = {h["text"] for h in heads}
    for h in later:
        if h["text"] not in seen: heads.append(h); seen.add(h["text"])
    heads.sort(key=lambda h: h["y"])

    # PINNED HEADINGS ARE ONE SECTION, NOT SEVERAL.
    #
    # `rect.top + scrollY` is not a stable page position for a sticky element,
    # so a pinned heading whose text cycles as you scroll past reports a new
    # position and a new string at every sample, and reads as four sections.
    # Both pages do this: it is why ours showed a trace scene plus three
    # feature sections, and why theirs shows four feature sections that are
    # really one pinned column.
    #
    # Detection is behavioural rather than a CSS read, because the pin can be
    # on any ancestor and can be implemented with transforms rather than
    # `position: sticky`: sample the same heading's page-y at two scroll
    # offsets 400px apart. A heading in normal flow does not move. A pinned
    # one does.
    pinned = []
    for h in heads:
        a = pg.evaluate("(t) => { const e=[...document.querySelectorAll('h1,h2')]"
                        r".find(x=>(x.innerText||'').trim().replace(/\s+/g,' ').slice(0,52)===t);"
                        "return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }", h["text"])
        pg.evaluate(f"window.scrollTo(0,{max(0, h['y'] - 700)})"); pg.wait_for_timeout(500)
        b1 = pg.evaluate("(t) => { const e=[...document.querySelectorAll('h1,h2')]"
                         r".find(x=>(x.innerText||'').trim().replace(/\s+/g,' ').slice(0,52)===t);"
                         "return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }", h["text"])
        pg.evaluate(f"window.scrollTo(0,{max(0, h['y'] - 300)})"); pg.wait_for_timeout(500)
        b2 = pg.evaluate("(t) => { const e=[...document.querySelectorAll('h1,h2')]"
                         r".find(x=>(x.innerText||'').trim().replace(/\s+/g,' ').slice(0,52)===t);"
                         "return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }", h["text"])
        h["pinned"] = (b1 is not None and b2 is not None and abs(b2 - b1) > 24)
        if h["pinned"]: pinned.append(h["text"])
    if pinned:
        print(f"  pinned headings (collapsed to one section each): {len(pinned)}")
        for t in pinned: print(f"    {t}")

    out = []
    for i, h in enumerate(heads):
        nxt = heads[i+1]["y"] if i+1 < len(heads) else total
        # put the heading a third of the way down the viewport
        pg.evaluate(f"window.scrollTo(0,{max(0, h['y']-300)})")
        pg.wait_for_timeout(1200)
        m = pg.evaluate(MEASURE, h["text"])
        if m is None: m = {"unmounted": True}
        m.update({"i": i, "y": h["y"], "height": nxt - h["y"], "heading": h["text"]})
        out.append(m)
    json.dump({"height": total, "sections": out}, open(f"m2_{tag}.json","w"), indent=1)
    print(f"{tag}  height={total}  sections={len(out)}")
    b.close()
