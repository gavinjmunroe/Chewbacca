"""ux-eye's pair check: an svg's own children never count as colliding with it."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

EYE = Path(__file__).resolve().parents[1] / "bin" / "ux-eye"


def load_eye():
    loader = importlib.machinery.SourceFileLoader("ux_eye", str(EYE))
    spec = importlib.util.spec_from_loader("ux_eye", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def box(x, y, w, h, **kw):
    return {"x": x, "y": y, "w": w, "h": h, "tag": kw.pop("tag", "div"), "cls": "", **kw}


class SvgChildren(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.eye = load_eye()
        except ImportError as e:  # numpy or playwright missing on this machine
            raise unittest.SkipTest(str(e))

    def test_text_inside_its_own_svg_is_not_a_collision(self):
        # The FF footer lockup (10/29): the svg and its TECHNOLOGIES <text>,
        # overlapping by 78% of the smaller box.
        svg = box(56, 870, 230, 28, tag="svg")
        text = box(56, 884, 180, 18, tag="text", insvg=1)
        self.assertEqual(self.eye.overlaps([svg, text]), [])

    def test_two_real_boxes_still_collide(self):
        a = box(0, 0, 100, 40)
        b = box(30, 10, 100, 40)
        self.assertTrue(self.eye.overlaps([a, b]))


if __name__ == "__main__":
    unittest.main()
