#!/usr/bin/env python3
"""design-gate must PASS a known-good page, not only refuse a broken one.

2026-09-26. design-gate refused the Lemma replica with three findings and two
were its own fault: it counted a position:fixed header sitting over content
that scrolls beneath it as a collision. That is what a fixed header IS, so the
gate would have refused uselemma.ai itself, at every scroll position.

The kit already had a rule for the opposite failure. A guard that never fires
proves nothing, so make it refuse something on purpose. Nobody had written the
other half: a guard that fires on CORRECT input is equally broken, and it is
worse in one way, because it is loud. Every false finding printed next to a
real one teaches the reader to skim past both.

So every guard needs two cases and this file is the second one:

    POSITIVE   it refuses something genuinely broken      (test_refuses_*)
    NEGATIVE   it passes something known good             (this file)

The negative case has to be a page nobody here designed. Checking the gate
against our own output only proves our output matches our own thresholds.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

BIN = pathlib.Path(__file__).resolve().parent.parent / "bin"

# Fixtures rather than the live network: a test that needs the internet fails
# on a plane and gets deleted. Each one reproduces a layout that is CORRECT
# and that a naive pairwise box check calls a collision.
FIXTURES = {
    "fixed-header": """<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#f2f2f2;color:#1d1956;font:16px system-ui}
header{position:fixed;inset-inline:0;top:0;height:56px;background:#fff;
  border-bottom:1px solid #d4d4dd;display:flex;align-items:center;gap:20px;padding:0 24px}
main{padding:96px 24px 400px;max-width:720px}
p{line-height:1.6;margin:0 0 18px}</style>
<header><b>Brand</b><a href=#>Docs</a><a href=#>Blog</a><a href=#>Pricing</a></header>
<main><h1>A perfectly ordinary page</h1>
""" + "<p>Content that scrolls underneath a fixed header, which is correct and is not a collision.</p>" * 22 + "</main>",

    "sticky-rail": """<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#f2f2f2;color:#1d1956;font:16px system-ui}
.wrap{display:grid;grid-template-columns:200px 1fr;gap:40px;padding:40px;max-width:1000px}
nav{position:sticky;top:20px;align-self:start}
nav a{display:block;padding:6px 0;color:#6c6991}
p{line-height:1.6;margin:0 0 18px}</style>
<div class=wrap><nav><a href=#>One</a><a href=#>Two</a><a href=#>Three</a></nav>
<main><h1>Sticky sidebar</h1>
""" + "<p>A sticky rail stays put while this column scrolls past it. Correct layout.</p>" * 26 + "</main></div>",
}


def run_gate(html: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as d:
        page = pathlib.Path(d) / "index.html"
        page.write_text(html, encoding="utf-8")
        out = pathlib.Path(d) / "eye"
        r = subprocess.run(
            [sys.executable, str(BIN / "design-gate"), page.as_uri(), "--shots", "4"],
            capture_output=True, text=True, timeout=180,
            env={**__import__("os").environ, "DESIGN_GATE_OUT": str(out)},
        )
        return r.returncode, r.stdout + r.stderr


def test_passes_a_page_with_a_fixed_header():
    code, out = run_gate(FIXTURES["fixed-header"])
    assert code == 0, (
        "design-gate refused a correct fixed-header layout. A fixed header "
        "overlapping what scrolls beneath it is not a collision, and a gate "
        "that refuses it would refuse most of the web.\n\n" + out)


def test_passes_a_page_with_a_sticky_rail():
    code, out = run_gate(FIXTURES["sticky-rail"])
    assert code == 0, (
        "design-gate refused a correct sticky sidebar.\n\n" + out)


# A phone mock whose chat thread scrolls inside its own overflow:auto box,
# under a static header, the shape of the Anchored Baptize The World demo the
# gate refused twice on 2026-11-03. Bubbles that scrolled up have bounding
# rects running under the header, but the thread clips them: nothing visible
# overlaps. scrollTop 752 leaves bubble 10 (top at 12 + 70*10) with 40 of
# its 60px above the thread's edge, a 67% overlap with the header by raw rect.
CHAT = """<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#e9e6df;font:15px system-ui;padding:100px 0 0 200px}
.phone{width:375px;height:700px;display:flex;flex-direction:column;background:#efeae2;
  border-radius:28px;overflow:hidden;border:1px solid #c9c4ba}
.waBar{height:64px;flex:none;background:#075e54;color:#fff;display:flex;align-items:center;padding:0 16px}
.thread{flex:1;overflow-y:auto;padding:12px}
.msg{background:#fff;color:#111;border-radius:10px;padding:8px 12px;margin:0 40px 10px 0;line-height:1.4;
  height:60px;box-sizing:border-box;overflow:hidden}
.msg.me{background:#d9fdd3;margin:0 0 10px 40px}</style>
<div class=phone><div class=waBar><b>Baptize The World</b></div>
<div class=thread id=t>%s</div></div>
<script>const t=document.getElementById('t');t.scrollTop=752;</script>"""


def test_passes_a_chat_thread_scrolled_under_its_header():
    bubbles = "".join(
        f'<div class="msg{" me" if i % 2 else ""}">Message {i}: see you at the '
        f'baptism on Sunday, bring a towel.</div>' for i in range(40))
    code, out = run_gate(CHAT % bubbles)
    assert code == 0, (
        "design-gate refused chat bubbles that the thread's overflow clips "
        "under the header. Clipped-away parts are not painted and cannot "
        "collide.\n\n" + out)


def test_still_refuses_a_real_overlap_inside_a_scroll_container():
    """The positive case for the clip: two bubbles that visibly sit on top of
    each other inside the scrolling thread must still be refused, or the
    clip has turned into a blind spot."""
    bubbles = ('<div class=msg style="height:60px;width:220px">first</div>'
               '<div class="msg me" style="height:60px;width:220px;'
               'margin-top:-55px;margin-left:60px">second sits on the first</div>')
    code, out = run_gate(CHAT % bubbles)
    assert code == 2 and "collides" in out, (
        "design-gate PASSED two bubbles that visibly overlap inside a scroll "
        "container. The clipping went too far.\n\n" + out)


def test_still_refuses_genuinely_unreadable_text():
    """The positive case, kept beside the negative ones on purpose.

    Calibrating away false positives is exactly how a guard gets quietly
    defanged, so the proof that it still bites lives in the same file as the
    proof that it does not overreach.
    """
    broken = """<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#f2f2f2;font:16px system-ui}
.stack{position:relative;height:1400px}
.big{position:absolute;top:120px;left:0;right:0;text-align:center;
  font-size:300px;font-weight:800;color:#111;line-height:1}
.over{position:absolute;top:300px;left:80px;right:80px;font-size:18px;color:#333}
</style><div class=stack><div class=big>214</div>
<div class=over>This paragraph sits directly on top of a 300px numeral, which is
the failure the gate exists to catch. It is unreadable and it must be refused.</div></div>"""
    code, out = run_gate(broken)
    assert code == 2, (
        "design-gate PASSED text sitting on top of a 300px numeral. The "
        "calibration went too far and the gate no longer bites.\n\n" + out)


if __name__ == "__main__":
    import traceback
    fails = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception:
            fails += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{fails} failure(s)")
    sys.exit(1 if fails else 0)
