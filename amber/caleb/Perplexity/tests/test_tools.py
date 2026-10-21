import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.cli import (
    tool_list_dir,
    tool_read_file,
    tool_write_file,
    generate_diff,
    safe_path,
)


class SafePathTests(unittest.TestCase):
    def test_relative_resolves_to_cwd(self):
        p = safe_path("foo.py")
        self.assertTrue(p.is_absolute())
        self.assertEqual(p.name, "foo.py")

    def test_absolute_stays_absolute(self):
        p = safe_path("/tmp/bar.py")
        self.assertTrue(str(p).endswith("/tmp/bar.py"))

    def test_tilde_expansion(self):
        p = safe_path("~/test.py")
        self.assertNotIn("~", str(p))


class ToolListDirTests(unittest.TestCase):
    def test_list_existing_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "a.txt").write_text("hello")
            Path(tmp, "subdir").mkdir()
            result = tool_list_dir(tmp)
            self.assertIn("a.txt", result)
            self.assertIn("subdir/", result)

    def test_list_nonexistent(self):
        result = tool_list_dir("/tmp/nonexistent_dir_xyz_999")
        self.assertIn("does not exist", result)

    def test_list_file_not_dir(self):
        with tempfile.NamedTemporaryFile(suffix=".txt") as f:
            result = tool_list_dir(f.name)
            self.assertIn("is a file", result)


class ToolReadFileTests(unittest.TestCase):
    def test_read_existing(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("test content here")
            f.flush()
            result = tool_read_file(f.name)
            self.assertIn("test content here", result)
            os.unlink(f.name)

    def test_read_nonexistent(self):
        result = tool_read_file("/tmp/nonexistent_file_xyz_999.txt")
        self.assertIn("does not exist", result)

    def test_read_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = tool_read_file(tmp)
            self.assertIn("directory", result.lower())

    def test_truncation(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("x" * 30000)
            f.flush()
            result = tool_read_file(f.name)
            self.assertIn("truncated", result)
            os.unlink(f.name)


class ToolWriteFileTests(unittest.TestCase):
    def test_write_new_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "new.txt")
            result = tool_write_file(path, "hello world")
            self.assertIn("11 characters", result)
            self.assertEqual(Path(path).read_text(), "hello world")

    def test_write_creates_parent_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a", "b", "c.txt")
            result = tool_write_file(path, "deep")
            self.assertIn("4 characters", result)
            self.assertTrue(Path(path).exists())


class GenerateDiffTests(unittest.TestCase):
    def test_basic_diff(self):
        diff = generate_diff("hello world", "hello there", "test.txt")
        self.assertIn("-hello world", diff)
        self.assertIn("+hello there", diff)

    def test_no_change(self):
        diff = generate_diff("same", "same", "test.txt")
        self.assertEqual(diff, "")

    def test_truncation(self):
        old = "\n".join(f"line {i}" for i in range(200))
        new = "\n".join(f"changed {i}" for i in range(200))
        diff = generate_diff(old, new, "test.txt", max_lines=10)
        self.assertIn("truncated", diff)


if __name__ == "__main__":
    unittest.main()
