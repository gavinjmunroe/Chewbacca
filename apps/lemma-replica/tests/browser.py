"""Regression checks for scene seams, correspondence, and accessible fallback."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('REPLICA_TEST_OUT', tempfile.mkdtemp(prefix='replica-browser-')))
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    reports = []
    for width, height, reduced in [(1440,900,False),(862,734,False),(390,844,False),(1440,900,True)]:
        page = browser.new_page(viewport={'width':width,'height':height}, reduced_motion='reduce' if reduced else 'no-preference')
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:4310', wait_until='networkidle')
        page.wait_for_timeout(900)
        gizmos = page.locator('.scatter .plate')
        assert gizmos.evaluate_all('(els)=>els.filter(e=>getComputedStyle(e).display!=="none").length') == 6
        shape = page.locator('.scatter .plate').first.locator('path').first
        before = shape.get_attribute('d')
        page.wait_for_timeout(180)
        assert (shape.get_attribute('d') == before) == reduced, 'clock/reduced-motion mismatch'
        assert page.locator('.field rect').count() == (84 if reduced else 42)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
        travel = page.locator('.run').evaluate('(el) => el.offsetHeight - innerHeight')
        first_cell = page.locator('.field rect').first.element_handle()
        positions = [0,.16,.1666,.167,.3,.49,.5,.51,.6,.7,.8333,.84,1,.5,0] if not reduced else [0]
        samples=[]
        for progress in positions:
            page.evaluate('(y) => scrollTo(0,y)', max(0,travel*progress))
            page.wait_for_timeout(100)
            active=page.locator('.scene').evaluate_all('(els) => els.filter(e => getComputedStyle(e).display !== "none" && +getComputedStyle(e).opacity > .5).length')
            assert active == (4 if reduced else 1), (progress,active)
            assert first_cell.evaluate('(el) => el.isConnected'), 'trace replaced during scroll'
            if not reduced:
                nav = page.locator('.nav').bounding_box()
                assert nav['y'] == 0 and nav['height'] == 56, nav
            samples.append(active)
        if not reduced:
            page.evaluate('(y) => scrollTo(0,y)', travel*.8)
            page.wait_for_timeout(100)
            axes = page.locator('.field g').evaluate_all("""(cells) => cells.map(g => {
                const m = g.transform.baseVal.consolidate().matrix;
                const r = g.querySelector('rect');
                const w = r.width.baseVal.value, h = r.height.baseVal.value;
                const u = [m.a*w,m.b*w], v = [m.c*h,m.d*h];
                const x = Math.hypot(...u), y = Math.hypot(...v);
                return [x,y,(u[0]*v[0]+u[1]*v[1])/(x*y)];
            })""")
            assert all(abs(x-y)<.001 and abs(cosine+.5)<.0001 for x,y,cosine in axes), axes
            page.evaluate('scrollTo(0,0)')
            page.wait_for_timeout(100)
        page.screenshot(path=str(OUT / f'{width}-{reduced}-hero.png'))
        if not reduced:
            page.evaluate('(y) => scrollTo(0,y)', travel*.67)
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / f'{width}-signal.png'))
        assert not errors, errors
        reports.append({'width':width,'reduced':reduced,'samples':len(samples),'errors':errors})
        page.close()
    browser.close()
    (OUT/'results.json').write_text(json.dumps(reports,indent=2))
    print(json.dumps({'reports': reports, 'output': str(OUT)}))
