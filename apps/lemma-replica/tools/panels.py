"""Wave 3.1: what their sticky panel actually contains, at each of the four stages."""
import json, collections
from playwright.sync_api import sync_playwright

JS = r"""() => {
  // the sticky panel: the element with position:sticky inside the feature grid
  const st=[...document.querySelectorAll('div')].find(e=>{
    const c=getComputedStyle(e);
    const b=e.getBoundingClientRect();
    return c.position==='sticky' && b.width>400 && b.width<700 && b.height>600;
  });
  if(!st) return {none:true};
  const b=st.getBoundingClientRect();
  const tags={}; const cls={};
  for(const n of st.querySelectorAll('*')){
    tags[n.tagName]=(tags[n.tagName]||0)+1;
    for(const k of n.classList) if(!/^(flex|grid|w-|h-|p-|m-|text-|bg-|border|rounded|gap|items|justify|absolute|relative|overflow|min-|max-)/.test(k))
      cls[k]=(cls[k]||0)+1;
  }
  // the visible leaf text, which is what the panel actually says
  const leaves=[...st.querySelectorAll('*')].filter(n=>!n.children.length && (n.textContent||'').trim())
    .map(n=>({t:(n.textContent||'').trim().slice(0,40),
              size:getComputedStyle(n).fontSize,
              mono:/mono/i.test(getComputedStyle(n).fontFamily)}));
  return {w:Math.round(b.width), h:Math.round(b.height), total:st.querySelectorAll('*').length,
          tags, leaves:leaves.length,
          sample:leaves.slice(0,14),
          sizes:[...new Set(leaves.map(l=>l.size))].sort(),
          monoShare:+(leaves.filter(l=>l.mono).length/Math.max(leaves.length,1)).toFixed(2)};
}"""

STAGES = [("Traces", 11400), ("Live alerts", 12300), ("Sift MCP", 13200), ("Metrics", 14000)]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1440,"height":900})
    pg.goto("https://www.uselemma.ai/", wait_until="networkidle", timeout=120000); pg.wait_for_timeout(5000)
    out={}
    for name,y in STAGES:
        pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(1600)
        d=pg.evaluate(JS); out[name]=d
        if d.get("none"): print(f"{name}: no sticky panel found"); continue
        top=sorted(d["tags"].items(), key=lambda kv:-kv[1])[:6]
        print(f"\n=== {name}  ({d['w']}x{d['h']}, {d['total']} descendants, {d['leaves']} text leaves) ===")
        print("  tags:", ", ".join(f"{k}x{v}" for k,v in top))
        print("  sizes:", d["sizes"], " mono share:", d["monoShare"])
        for s in d["sample"][:10]: print(f"    {s['size']:>5s} {'mono' if s['mono'] else '    '}  {s['t']}")
    json.dump(out, open("their_panels.json","w"), indent=1)
    b.close()
