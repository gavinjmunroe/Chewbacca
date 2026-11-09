#!/usr/bin/env python3
"""site-gate check fails a wall of text (feedback_no_walls_of_text).

Caleb, twice on 2026-10-10: at 21:05 "rn it reads as a fat wall of text fix
dat shit up", and at 22:56 "The trust page is so lame bro it's a wall of text,
CHEWBS SHOULD NEVER MAKE A WALL OF TEXT". site-gate's check has refused a
block over 45 words or a section over 120 since that night, inside page
JavaScript that no test exercised, so it could break silently. This renders
two local pages headless and holds it to both sides. Skips, and says so, when
playwright or its Chromium is missing.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
try:
    import playwright  # noqa: F401
except ImportError:
    print("skip  playwright is not installed, so site-gate cannot render")
    sys.exit(0)

WORDS = " ".join(["word"] * 60)
PAGES = {
    "wall.html": f"<section><h2>About</h2><p>{WORDS}</p></section>",
    "beats.html": "<section><h2>About</h2><p>One idea here.</p><p>Then the next one.</p></section>"
                  + "".join(f"<section><h2>Beat {i}</h2><p>{' '.join(['word'] * 30)}</p></section>" for i in range(3)),
    "article.html": f"<article><h2>Essay</h2><p>{WORDS}</p></article>",
}
fails = 0
with tempfile.TemporaryDirectory() as tmp:
    for name, body in PAGES.items():
        (Path(tmp) / name).write_text(
            f'<!doctype html><html><body style="background:#fff;color:#111"><main>{body}</main></body></html>')
    urls = [f"file://{tmp}/{n}" for n in PAGES]
    r = subprocess.run([sys.executable, str(ROOT / "bin" / "site-gate"), "check", *urls, "--json"],
                       capture_output=True, text=True, timeout=300)
    if "Executable doesn't exist" in r.stderr or "playwright install" in r.stderr:
        print("skip  playwright's Chromium is not installed")
        sys.exit(0)
    try:
        found = json.loads(r.stdout)
    except ValueError:
        print(f"FAIL  site-gate printed no JSON: {r.stdout[-300:]} {r.stderr[-300:]}")
        sys.exit(1)
    walls = {Path(u).name: [x for x in v if "wall of text" in x] for u, v in found.items()}
    for name, want in (("wall.html", True), ("beats.html", False), ("article.html", False)):
        ok = bool(walls.get(name)) == want
        print(f"{'ok  ' if ok else 'FAIL'}  {name}: {'refused' if walls.get(name) else 'passed'}"
              f" ({'should refuse' if want else 'should pass'})")
        fails += not ok
sys.exit(1 if fails else 0)
