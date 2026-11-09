"""Domain controls: these slopes must survive or vanish for physical reasons."""
import importlib.machinery
import pathlib
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

import numpy as np

modes = importlib.machinery.SourceFileLoader(
    "ux_modes", str(pathlib.Path(__file__).resolve().parents[1] / "bin/ux-modes")
).load_module()


def film(y, value, channel="top", missing=()):
    return [{"y": float(scroll), "el": [] if i in missing else [
        {"id": "target", "vis": True, channel: float(v)}]}
        for i, (scroll, v) in enumerate(zip(y, value))]


class DerivativeDomainTests(unittest.TestCase):
    def test_static_pinned_and_general_affine_are_nulls(self):
        y = np.arange(128.)
        for viewport in (100 - y, np.full(128, 100.), 3 * y + 100):
            with self.subTest(viewport=viewport[:2]):
                d = modes.derivative_metrics(film(y, viewport))
                self.assertEqual(np.count_nonzero(d["counts"]), 127)
                self.assertLess(np.nanmax(d["sum"]), 1e-9)

    def test_observed_step_survives(self):
        y = np.arange(128.)
        slopes = modes.residual_slopes(y, 100 * (y >= 64))
        self.assertGreater(slopes[63], 90)
        self.assertEqual(int(np.nanargmax(slopes)), 63)

    def test_mount_gap_cannot_invent_transition(self):
        y = np.arange(128.)
        v = y.copy()
        v[80:] += 1000
        d = modes.derivative_metrics(film(y, v, "bx", range(48, 80)))
        self.assertEqual(np.count_nonzero(d["counts"]), 94)
        self.assertTrue(np.isnan(d["sum"][47:80]).all())
        self.assertLess(np.nanmax(d["sum"]), 1e-9)

    def test_duplicate_scroll_is_undefined_not_epsilon(self):
        y = np.repeat(np.arange(128.), 2)
        d = modes.derivative_metrics(film(y, y, "bx"))
        self.assertEqual(np.count_nonzero(d["counts"]), 127)
        self.assertEqual(d["stationary_intervals"], 128)
        self.assertTrue(np.isnan(d["sum"][::2]).all())
        self.assertLess(np.nanmax(d["sum"]), 1e-9)

    def test_time_motion_during_hold_is_not_silently_static(self):
        d = modes.derivative_metrics(film([0, 0, 0], [0, 5, 10], "bx"))
        self.assertEqual(d["stationary_changed_channels"].tolist(), [1, 1])
        self.assertTrue(np.isnan(d["sum"]).all())

    def test_visibility_gone_opacity_and_channel_denominator(self):
        fr = film(np.arange(6.), np.arange(6.), "bx")
        fr[1]["el"][0]["vis"] = False
        fr[2]["el"][0]["gone"] = True
        fr[3]["el"][0]["o"] = 0
        for f in fr:
            f["el"].append({"id": "other", "vis": True, "bx": 3.})
        d = modes.derivative_metrics(fr)
        self.assertEqual(d["counts"].tolist(), [1, 1, 1, 1, 2])
        np.testing.assert_allclose(d["mean"], d["sum"] / d["counts"])

    def test_report_runs_domain_diagnostic_before_too_little_svd_motion(self):
        fr = film([0, 0, 0], [0, 5, 10], "bx")
        output = StringIO()
        with patch.object(modes, "load", return_value=(fr, [])):
            with redirect_stdout(output):
                modes.report("hold", "unused", 120)
        self.assertIn("time derivative unmeasured", output.getvalue())
        self.assertIn("no supported forward-scroll slopes", output.getvalue())
        self.assertNotIn("Lipschitz", output.getvalue())

    def test_unsupported_and_reverse_intervals_stay_undefined(self):
        self.assertEqual(len(modes.derivative_metrics([])["sum"]), 0)
        d = modes.derivative_metrics(film([2, 1, 0], [1, 2, 3], "bx"))
        self.assertEqual(d["reverse_intervals"], 2)
        self.assertTrue(np.isnan(d["sum"]).all())


if __name__ == "__main__":
    unittest.main()
