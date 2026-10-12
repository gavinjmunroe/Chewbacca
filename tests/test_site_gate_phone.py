"""site-gate's iPhone Safari verdict, offline. Chromium at 390 passed three
bugs Caleb's iPhone showed on usctts.com on 2026-10-11: advisor faces drawn
0px tall ("on mobile Andrew laffoon is the only face I see"), two pages
33,554,432px wide, and a 0px mailbox video. phone_fails decides from one
WebKit load; this pins what it refuses and what it lets through."""
import importlib.machinery
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("site_gate", str(ROOT / "bin" / "site-gate"))
spec = importlib.util.spec_from_loader("site_gate", loader)
sg = importlib.util.module_from_spec(spec)
loader.exec_module(sg)


def main():
    failures = 0

    def check(name, cond):
        nonlocal failures
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
        failures += not cond

    check("a page that fits with every image drawn passes", sg.phone_fails({"over": 0, "flat": []}) == [])
    check("one px of rounding is not a scroll", sg.phone_fails({"over": 1, "flat": []}) == [])
    wide = sg.phone_fails({"over": 33554039, "flat": []})
    check("the 33M px canvas page fails", len(wide) == 1 and "33554039px" in wide[0])
    flat = sg.phone_fails({"over": 0, "flat": ["/tts/home/mailbox-loop-1120.webm", "/img/andrew.jpg"]})
    check("each flat image or video is its own failure", len(flat) == 2 and "mailbox" in flat[0])
    check("the probe reads width and flat media", "scrollWidth" in sg.PHONE_PROBE and "height < 2" in sg.PHONE_PROBE)
    print(f"site-gate phone: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
