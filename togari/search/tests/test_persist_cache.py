"""Disk cache round-trip and disable-flag tests. No network calls.

Run: python -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


class PersistCacheTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.mkdtemp(prefix="pr_cache_test_")
        os.environ["PEOPLERANK_CACHE_DIR"] = self._dir
        os.environ.pop("PEOPLERANK_CACHE_DISABLED", None)
        # Import fresh so the module reads our temp dir.
        import importlib

        import api.persist_cache as pc

        importlib.reload(pc)
        self.pc = pc

    def tearDown(self):
        os.environ.pop("PEOPLERANK_CACHE_DIR", None)
        os.environ.pop("PEOPLERANK_CACHE_DISABLED", None)

    def test_miss_then_hit(self):
        key = self.pc.make_key("a", "b")
        self.assertIsNone(self.pc.get("scores", key))
        self.pc.set("scores", key, {"final": 0.42})
        self.assertEqual(self.pc.get("scores", key), {"final": 0.42})

    def test_keys_are_content_addressed(self):
        self.assertEqual(self.pc.make_key("x", "y"), self.pc.make_key("x", "y"))
        self.assertNotEqual(self.pc.make_key("x", "y"), self.pc.make_key("x", "z"))

    def test_disable_flag_suppresses_cache(self):
        key = self.pc.make_key("c")
        self.pc.set("rationale", key, "cached text")
        os.environ["PEOPLERANK_CACHE_DISABLED"] = "1"
        self.assertIsNone(self.pc.get("rationale", key))

    def test_unserializable_value_does_not_raise(self):
        key = self.pc.make_key("d")
        # A set is not JSON serializable; set() must swallow it silently.
        self.pc.set("scores", key, {1, 2, 3})
        self.assertIsNone(self.pc.get("scores", key))


if __name__ == "__main__":
    unittest.main()
