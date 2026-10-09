#!/usr/bin/env python3
"""ux-crawl writes it, ux-film reads it. Prove they still agree.

2026-09-23 I replaced ux-crawl's bare integer `anims` with `a`, a digest
carrying per-animation names, durations, easings and keyframe properties,
because a count cannot describe a draw-on. It was a good change.

ux-film reads frames[0]["anims"].

So ux-film raised KeyError on every lens from that moment, and nobody noticed
for three days, because nothing runs it in the suite and I spent those days
hand-rolling the analysis it performs. Caleb had to ask four separate times
whether I was using the tools we built before I ran one and watched it crash.

That is the failure this file exists for, and it is not "ux-film had a bug".
It is that a PRODUCER and a CONSUMER lived in one repo with no test tying
them together, so improving one silently killed the other. Every tool here
that reads another tool's output has the same exposure.

This runs the real producer over a real page and feeds the real consumer,
with no fixture between them. A fixture would have kept passing after the
schema changed, which is precisely how this bug survived.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BIN = ROOT / "bin"

PAGE = """<!doctype html><meta charset=utf-8>
<style>
 body{margin:0;background:#f2f2f2;font:16px system-ui}
 .run{height:300vh;position:relative}
 .pin{position:sticky;top:0;height:100vh;display:grid;place-items:center}
 @keyframes draw{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
 @keyframes spin{to{transform:rotate(360deg)}}
 path{stroke-dasharray:100;stroke-dashoffset:100;animation:draw 700ms linear both}
 svg{animation:spin 2400ms linear infinite}
</style>
<div class=run><div class=pin><svg viewBox="0 0 100 100" width="300" height="300">
 <path d="M10 10 L90 50" fill=none stroke=#755cfe style="animation-delay:0ms"/>
 <path d="M10 50 L90 90" fill=none stroke=#755cfe style="animation-delay:15ms"/>
 <path d="M50 10 L50 90" fill=none stroke=#755cfe style="animation-delay:30ms"/>
</svg></div></div>
<div style="height:200vh;padding:40px"><h1>After</h1><p>Text below the scene.</p></div>
"""


def build_lens(tmp):
    page = pathlib.Path(tmp) / "index.html"
    page.write_text(PAGE, encoding="utf-8")
    lens = pathlib.Path(tmp) / "lens"
    r = subprocess.run(
        [sys.executable, str(BIN / "ux-crawl"), page.as_uri(),
         "--states", "film", "--out", str(lens)],
        capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, f"ux-crawl failed:\n{r.stdout}\n{r.stderr}"
    film = lens / "film.json"
    assert film.exists(), f"ux-crawl wrote no film.json. Got: {list(lens.iterdir())}"
    return lens


def test_crawl_writes_what_film_reads():
    with tempfile.TemporaryDirectory() as tmp:
        lens = build_lens(tmp)
        r = subprocess.run([sys.executable, str(BIN / "ux-film"), str(lens)],
                           capture_output=True, text=True, timeout=180)
        assert r.returncode == 0, (
            "ux-film cannot read what ux-crawl just wrote. The producer and "
            "the consumer have drifted apart.\n\n" + r.stdout + r.stderr)
        assert "animations at load" in r.stdout, (
            "ux-film ran but reported no animation count, so the field it "
            "reads is present and empty.\n\n" + r.stdout)


def test_film_accepts_a_lens_directory():
    """Every other tool here takes the lens directory. This one demanded the
    film.json path and died with IsADirectoryError on the obvious call, which
    reads as a corrupt lens rather than a wrong argument."""
    with tempfile.TemporaryDirectory() as tmp:
        lens = build_lens(tmp)
        for arg in (str(lens), str(lens / "film.json")):
            r = subprocess.run([sys.executable, str(BIN / "ux-film"), arg],
                               capture_output=True, text=True, timeout=180)
            assert r.returncode == 0, f"ux-film rejected {arg}\n{r.stdout}{r.stderr}"


def test_the_capture_actually_captured_motion():
    """A film of a page with three drawing paths and one infinite spin must
    not report zero animations. A capture that records nothing still writes a
    valid file, and every consumer downstream then reports a clean page."""
    with tempfile.TemporaryDirectory() as tmp:
        lens = build_lens(tmp)
        data = json.loads((lens / "film.json").read_text())
        first = data["frames"][0]
        a = first.get("a")
        total = a.get("total", 0) if isinstance(a, dict) else (a or first.get("anims", 0))
        assert total > 0, (
            "ux-crawl filmed a page with four animations and recorded none. "
            f"First frame keys: {sorted(first)}")


if __name__ == "__main__":
    import traceback
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"  PASS  {name}")
            except Exception:
                fails += 1; print(f"  FAIL  {name}"); traceback.print_exc()
    print(f"\n{fails} failure(s)")
    sys.exit(1 if fails else 0)
