"""site-gate's slideshow verdicts, offline. Caleb, 2026-10-25, on the Parker
Manley site: "NEVER make anything that could've been a slideshow! Fix chewbs".
A pinned scene that holds still and swaps is refused, a carousel library or
slide markup in source is refused by `site-gate research`, and a scene where
something happens on every step passes."""
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("site_gate", str(ROOT / "bin" / "site-gate"))
spec = importlib.util.spec_from_loader("site_gate", loader)
sg = importlib.util.module_from_spec(spec)
loader.exec_module(sg)


class Scenes(unittest.TestCase):
    def test_hold_and_swap_is_a_slideshow(self):
        # three plates over 30 steps: still, swap, still, swap, still
        ch = [0.0] * 9 + [0.6] + [0.001] * 9 + [0.55] + [0.0] * 10
        self.assertTrue(sg.slideshow_fails([{"name": "work", "changes": ch}]))

    def test_a_faint_swap_still_counts(self):
        # the synthetic three-card page, 2026-10-26: pastel grounds diff little
        ch = [0.0] * 22 + [0.011] + [0.0] * 21 + [0.019] + [0.0] * 22
        self.assertTrue(sg.slideshow_fails([{"name": "st", "changes": ch}]))

    def test_something_happening_on_every_step_passes(self):
        ch = [0.04, 0.06, 0.05, 0.08, 0.03, 0.07, 0.05, 0.06] * 4
        self.assertEqual(sg.slideshow_fails([{"name": "film", "changes": ch}]), [])
        # the rolling ball, 2026-10-26: small changes on every step
        ch = [0.006 + i * 0.0002 for i in range(50)] + [0.016 - i * 0.0006 for i in range(17)]
        self.assertEqual(sg.slideshow_fails([{"name": "film", "changes": ch}]), [])

    def test_one_reveal_in_a_still_scene_is_not_a_slideshow(self):
        ch = [0.0] * 12 + [0.4] + [0.0] * 12
        self.assertEqual(sg.slideshow_fails([{"name": "title", "changes": ch}]), [])


class Source(unittest.TestCase):
    def lint(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in files.items():
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(text)
            return sg.slideshow_lint(root)

    def test_a_carousel_dependency_is_refused(self):
        got = self.lint({"package.json": json.dumps({"dependencies": {"swiper": "^11", "react": "^19"}})})
        self.assertTrue(any("swiper" in f for f in got), got)

    def test_slide_markup_is_refused(self):
        got = self.lint({"src/Work.tsx": '<div className="slides">{plates.map(p => <img src={p} />)}</div>'})
        self.assertTrue(got)
        self.assertTrue(self.lint({"index.html": '<section class="hero carousel"></section>'}))

    def test_motion_utilities_named_slide_pass(self):
        # every shadcn component carries these (review, 2026-10-26)
        self.assertEqual(self.lint({"src/Menu.tsx": '<div className="animate-in slide-in-from-top-2 fade-in">',
                                    "index.html": '<p class="reveal slide-up">'}), [])

    def test_a_scene_and_vendored_code_pass(self):
        self.assertEqual(self.lint({"src/Film.tsx": '<div className="stage film-roll">{frame}</div>',
                                    "node_modules/swiper/index.js": 'import "swiper"'}), [])

    def test_research_runs_the_lint(self):
        self.assertIn("slideshow_lint(root)", (ROOT / "bin/site-gate").read_text())


if __name__ == "__main__":
    unittest.main()
