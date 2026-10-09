"""clay_geometry: a control's place in the Clay page, in CSS pixels, becomes
screen points for Kyber, and a window that would put every mark in the wrong
place stops the run instead. Values are recorded shapes, not a live Chrome."""
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
from clay_geometry import Display, Rect, Window, problem, read_display, to_screen  # noqa: E402

RETINA = Display(1512, 982, 2.0)


def win(**changes) -> Window:
    base = dict(screen_x=0, screen_y=38, outer_w=1512, outer_h=944,
                inner_w=1512, inner_h=857, dpr=2.0)
    base.update(changes)
    return Window(**base)


class Geometry(unittest.TestCase):
    def test_retina_at_100(self):
        self.assertEqual(to_screen(Rect(100, 200, 80, 30), win(), RETINA), Rect(100, 325, 80, 30))
        self.assertIsNone(problem(win(), RETINA))

    def test_zoom_125(self):
        w = win(dpr=2.5, inner_w=1209.6, inner_h=685.6)
        got = to_screen(Rect(100, 200, 80, 30), w, RETINA)
        self.assertAlmostEqual(got.x, 125)
        self.assertAlmostEqual(got.y, 38 + 87 + 250)
        self.assertAlmostEqual(got.w, 100)
        self.assertAlmostEqual(got.h, 37.5)
        self.assertIsNone(problem(w, RETINA))

    def test_non_retina(self):
        display = Display(1920, 1080, 1.0)
        self.assertEqual(to_screen(Rect(10, 10, 5, 5), win(dpr=1.0), display), Rect(10, 135, 5, 5))

    def test_devtools_docked_stops(self):
        self.assertIn("DevTools", problem(win(inner_h=500), RETINA))

    def test_a_panel_docked_beside_the_page_stops(self):
        # DevTools or Chrome's side panel on the left moves every x by its
        # width, and the toolbar height cannot see it.
        self.assertIn("DevTools", problem(win(inner_w=1112), RETINA))
        # Rounding at 125% zoom is not a panel: innerWidth 1209 * 1.25 = 1511.25.
        self.assertIsNone(problem(win(dpr=2.5, inner_w=1209, inner_h=686), RETINA))

    def test_second_display_stops(self):
        self.assertIn("main display", problem(win(screen_x=1600), RETINA))
        self.assertIn("main display", problem(win(screen_x=-900), RETINA))

    def test_from_page_takes_the_finder_keys(self):
        page = {"screen_x": 0, "screen_y": 38, "outer_w": 1512, "outer_h": 944,
                "inner_w": 1512, "inner_h": 857, "dpr": 2, "href": "https://app.clay.com/x"}
        self.assertEqual(Window.from_page(page), win())

    def test_read_display_parses_jxa(self):
        class Done:
            returncode = 0
            stdout = "[1512,982,2]\n"
            stderr = ""
        seen = []
        got = read_display(run=lambda argv, **kw: seen.append(argv) or Done())
        self.assertEqual(got, RETINA)
        self.assertEqual(seen[0][:3], ["osascript", "-l", "JavaScript"])


if __name__ == "__main__":
    unittest.main()
