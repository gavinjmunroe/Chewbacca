"""brand-grab: the widest srcset candidate wins, a bot check or an access-denied
page counts as refused, and a palette is read off the image's own pixels.
No network, no browser."""
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def main() -> int:
    m = SourceFileLoader("brand_grab", str(ROOT / "bin" / "brand-grab")).load_module()

    got = m.biggest("a.jpg 320w, b.jpg 1080w, c.jpg 640w", "s.jpg")
    check("the widest srcset candidate wins", got == ("b.jpg", 1080), got)
    got = m.biggest("", "s.jpg")
    check("no srcset falls back to src", got == ("s.jpg", 0), got)
    got = m.biggest("x.jpg 2x, y.jpg 1x", "s.jpg")
    check("density descriptors are not widths", got == ("s.jpg", 0), got)

    check("an access-denied page is refused", m.is_blocked("Access Denied\nYou don't have permission" + " " * 700))
    check("a press-and-hold check is refused",
          m.is_blocked("Before we continue...\nPress & Hold to confirm you are\na human" + " x" * 400))
    check("a stub page is refused by length", m.is_blocked("Loading..."))
    check("a real article is read", not m.is_blocked("At just 19, the owner has turned years of grind. " * 30))

    check("slugs are file-safe", m.slug("connor.garbo") == "connor-garbo", m.slug("connor.garbo"))

    try:
        from PIL import Image
    except ImportError:
        print("skip palette: Pillow not installed")
    else:
        tmp = Path(tempfile.mkdtemp())
        im = Image.new("RGBA", (100, 100), (232, 52, 56, 255))
        for x in range(100):
            for y in range(30):
                im.putpixel((x, y), (214, 238, 240, 255))
        for x in range(10):
            im.putpixel((x, 99), (0, 0, 0, 0))
        im.save(tmp / "poster.png")
        pal = m.palette(tmp / "poster.png", n=3)
        check("the most used color comes first", pal[:1] == ["#e83438"], pal)
        check("the second color is found", "#d6eef0" in pal, pal)
        check("transparent pixels are left out", "#000000" not in pal, pal)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
