"""site-gate's flash and parity verdicts, offline: the pure functions that decide
whether a frame pair flashed and whether a phone version is thinner than desktop.
Both came from Caleb on 2026-10-10: "whiplash and flashbangs" on mobile, and
"the mobile version is 10x lamer than the desktop version" (23:41, after "Bro
tons of things overflow and overlap like crazy on mobile" at 23:32): the
lesson feedback_phone_is_never_lesser, said twice in nine minutes."""
import importlib.machinery
import importlib.util
import sys
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

    w, h = 10, 10
    paper, night = [235] * (w * h), [20] * (w * h)
    check("a frame that holds still is no flash", sg.flash_area(paper, paper, w, h, 0) == 0)
    check("paper to night over the whole view is a flash", sg.flash_area(paper, night, w, h, 0) > sg.FLASH_AREA)
    # a dark band moving up the screen by 3 rows: unshifted it looks like a flash,
    # shifted by the scroll it matches, and the closer match is what counts
    prev = [20] * (w * 6) + [235] * (w * 4)
    cur = [20] * (w * 3) + [235] * (w * 7)
    check("plain scrolling past a dark band is not a flash",
          min(sg.flash_area(prev, cur, w, h, 0), sg.flash_area(prev, cur, w, h, 3)) <= sg.FLASH_AREA)
    check("a small swing under the threshold is ignored", sg.flash_area(paper, [235 - sg.FLASH_SWING] * (w * h), w, h, 0) == 0)

    desk = {"figure_share": 0.5, "motion_share": 0.8, "pinned_scene_screens": 10}
    check("a phone as rich as desktop passes", sg.parity_fails(desk, dict(desk)) == [])
    thin = {"figure_share": 0.2, "motion_share": 0.8, "pinned_scene_screens": 10}
    check("a phone with far fewer figures fails", any("figure" in f for f in sg.parity_fails(desk, thin)))
    unpinned = {"figure_share": 0.5, "motion_share": 0.8, "pinned_scene_screens": 0}
    check("a phone that lost the pinned scene fails", any("pinned" in f for f in sg.parity_fails(desk, unpinned)))

    shape = {"name": "x", "left": 7, "size": 10, "align": "left", "bg": "paper", "boxed": True}
    deck3 = [dict(shape, name=n) for n in "abc"]
    flat = [{"crossed": 0, "sameGround": True}] * 4
    check("three sections with one shape read as a deck", any("in a row" in f for f in sg.deck_fails(deck3, flat[:2])))
    varied = [dict(shape, left=7 + i * 10) for i in range(5)]
    check("five varied sections cut flat on one ground still fail", any("edges" in f for f in sg.deck_fails(varied, flat)))
    carried = [{"crossed": 1, "sameGround": True}, {"crossed": 0, "sameGround": False}, {"crossed": 0, "sameGround": True}, {"crossed": 0, "sameGround": True}]
    check("varied sections with half their edges carried pass", sg.deck_fails(varied, carried) == [])

    flat_text = {"sizes": [15.0] * 30, "choices": 3}
    check("a screen where every line is one size has no place for the eye", any("eye" in f for f in sg.focus_fails(flat_text)))
    led = {"sizes": [15.0] * 20 + [44.0], "choices": 3}
    check("a screen with one big heading over small text passes", sg.focus_fails(led) == [])
    six = {"sizes": [15.0] * 4 + [44.0], "choices": 6}
    check("three paths times before and after is too many choices", any("choices" in f for f in sg.focus_fails(six)))

    pages = {"/": ["AI never does pastoral care.", "Start with your website."], "/trust": ["AI never does pastoral care."]}
    check("a promise said on two pages is a repeat", any("pastoral" in f for f in sg.repeat_fails(pages)))
    check("short labels may repeat", sg.repeat_fails({"/": ["Free website audit"], "/a": ["Free website audit"]}) == [])

    print(f"site-gate flash and parity: {failures} failure(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
