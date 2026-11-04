"""llms-txt: every page gets a markdown twin, llms.txt links resolve, check catches drift."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("llms_txt", ROOT / "tools/llms_txt.py")
lt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lt)

HOME = """<html><head><title>Example Studio | Home</title><meta name="description" content="We build things.">
<script>var x = "secret script text";</script></head><body><nav>Menu Link</nav><main><h1>Build it</h1>
<p>We ship &amp; teach.</p><ul><li>One</li><li>Two</li></ul></main><footer>Footer junk</footer></body></html>"""
WORK = """<html><head><title>Case one</title></head><body><h1>Payroll</h1><p>Hours down.</p></body></html>"""


def site(tmp):
    os.makedirs(Path(tmp, "work"))
    os.makedirs(Path(tmp, "_next"))
    Path(tmp, "index.html").write_text(HOME)
    Path(tmp, "work", "index.html").write_text(WORK)
    Path(tmp, "404.html").write_text("<title>nope</title>")
    Path(tmp, "_next", "x.html").write_text("<title>chunk</title>")
    return tmp


class LlmsTxtTests(unittest.TestCase):
    def test_build_writes_index_and_twins(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = lt.build(site(tmp), "Example Studio", "An AI studio.", sections={"work": "Delivered work"})
            self.assertEqual(r["pages"], 2)
            self.assertEqual(r["missing_description"], ["work/index.html"])
            txt = Path(tmp, "llms.txt").read_text()
            self.assertTrue(txt.startswith("# Example Studio\n\n> An AI studio."))
            self.assertIn("## Delivered work", txt)
            self.assertIn("- [Example Studio](index.md): We build things.", txt)
            md = Path(tmp, "index.md").read_text()
            self.assertIn("# Build it", md)
            self.assertIn("- One", md)
            self.assertIn("We ship & teach.", md)
            for junk in ("secret script text", "Menu Link", "Footer junk"):
                self.assertNotIn(junk, md)
            self.assertFalse(Path(tmp, "404.md").exists())
            self.assertFalse(Path(tmp, "_next", "x.md").exists())

    def test_check_flags_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            lt.build(site(tmp), "S", "s")
            self.assertEqual(lt.check(tmp), ["no meta description: work/index.html"])
            Path(tmp, "work", "index.md").unlink()
            Path(tmp, "new.html").write_text("<title>t</title><meta name=description content=d>")
            bad = lt.check(tmp)
            self.assertIn("broken link: work/index.md", bad)
            self.assertIn("no markdown twin: new.html", bad)

    def test_base_url_links_still_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            lt.build(site(tmp), "S", "s", base="https://example.test")
            self.assertIn("(https://example.test/index.md)", Path(tmp, "llms.txt").read_text())
            self.assertNotIn("broken link", " ".join(lt.check(tmp)))

    def test_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            site(tmp)
            out = subprocess.run([sys.executable, str(ROOT / "bin/llms-txt"), "build", tmp, "--name", "S", "--summary", "s"],
                                 capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("2 pages", out.stdout)
            chk = subprocess.run([sys.executable, str(ROOT / "bin/llms-txt"), "check", tmp], capture_output=True, text=True)
            self.assertEqual(chk.returncode, 1)
            empty = tempfile.mkdtemp(dir=tmp)
            none = subprocess.run([sys.executable, str(ROOT / "bin/llms-txt"), "build", empty, "--name", "S", "--summary", "s"],
                                  capture_output=True, text=True)
            self.assertEqual(none.returncode, 2)


if __name__ == "__main__":
    unittest.main()
