#!/usr/bin/env python3
"""ig-read, offline: the link it accepts, what it keeps from a download, the sheets.

The download itself needs Instagram and is not tested here. Everything after
it is, against a directory shaped like the one yt-dlp left on 2026-09-27.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load():
    # SourceFileLoader explicitly: bin/ig-read has no .py extension.
    loader = importlib.machinery.SourceFileLoader("ig_read", str(ROOT / "bin/ig-read"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def has_pillow():
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


def fake_download(dest, stills, clips=(), images=False):
    """Slides 01..n as jpgs, some with an mp4 beside them, plus info files.

    Only the sheet test needs pictures it can open. The rest get bare bytes,
    because the suite's pytest env and CI's python3 have no Pillow."""
    for n in range(1, stills + 1):
        if images:
            from PIL import Image
            Image.new("RGB", (72, 90), (n * 10, 0, 0)).save(dest / f"{n:02d}.jpg")
        else:
            (dest / f"{n:02d}.jpg").write_bytes(b"\xff\xd8\xff")
        (dest / f"{n:02d}.info.json").write_text(json.dumps({"description": "short"}))
    for n in clips:
        (dest / f"{n:02d}.mp4").write_bytes(b"\0")
    (dest / "post.info.json").write_text(json.dumps({
        "channel": "getintoai", "upload_date": "20260922",
        "description": "AI is moving into almost every corner of tech."}))


def test_takes_posts_reels_and_carousels():
    ig = load()
    assert ig.code_of("https://www.instagram.com/p/Ddkh4-cGIOG/?stkn=MW9o") == "Ddkh4-cGIOG"
    assert ig.code_of("https://www.instagram.com/reel/DdhIJoittdS/") == "DdhIJoittdS"
    assert ig.code_of("https://instagram.com/someone/p/DdiGYPrDl-Q/") == "DdiGYPrDl-Q"
    assert ig.code_of("https://x.com/a/status/1") is None


def test_a_link_that_is_not_instagram_never_downloads():
    ig = load()
    with tempfile.TemporaryDirectory() as tmp:
        post = ig.read("https://example.com/p/abc", Path(tmp))
        assert "error" in post
        assert list(Path(tmp).iterdir()) == [], "nothing may be written for a bad link"


def test_keeps_the_caption_from_the_post_not_a_slide():
    ig = load()
    with tempfile.TemporaryDirectory() as tmp:
        fake_download(Path(tmp), 3)
        post = ig.collect(Path(tmp))
    assert post["caption"].startswith("AI is moving"), post["caption"]
    assert post["author"] == "getintoai"


def test_a_video_slide_is_still_a_slide():
    """Eight of seventeen slides on the news carousel were clips, and their
    text was only in the frame."""
    ig = load()
    with tempfile.TemporaryDirectory() as tmp:
        fake_download(Path(tmp), 5, clips=(2, 3))
        post = ig.collect(Path(tmp))
    assert len(post["slides"]) == 5, post["slides"]
    assert [Path(v).name for v in post["videos"]] == ["02.mp4", "03.mp4"]


def test_no_pillow_means_no_sheets_not_a_crash():
    ig = load()
    real = sys.modules.get("PIL")
    sys.modules["PIL"] = None  # makes `from PIL import Image` raise ImportError
    try:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            fake_download(d, 9)
            slides = [Path(p) for p in ig.collect(d)["slides"]]
            assert ig.tile(slides, d) == []
    finally:
        if real is None:
            sys.modules.pop("PIL", None)
        else:
            sys.modules["PIL"] = real


def test_sheets_four_to_a_page_and_none_for_a_short_post():
    if not has_pillow():
        print("  skip  sheets: Pillow not installed")
        return
    ig = load()
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        fake_download(d, 9, images=True)
        slides = [Path(p) for p in ig.collect(d)["slides"]]
        assert ig.tile(slides[:4], d) == [], "four slides read fine one by one"
        sheets = ig.tile(slides, d)
        assert len(sheets) == 3, sheets
        from PIL import Image
        assert Image.open(sheets[0]).size == (144, 180), "two by two at slide size"


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  pass  {name}")
            except AssertionError as exc:
                print(f"  FAIL  {name}: {exc}")
                fails += 1
    print(f"\n{'FAILED' if fails else 'ok'}  {fails} failure(s)")
    sys.exit(1 if fails else 0)
