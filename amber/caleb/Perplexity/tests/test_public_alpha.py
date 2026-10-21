import unittest
from pathlib import Path


class PublicAlphaFilesTests(unittest.TestCase):
    def test_alpha_files_exist(self):
        required = [
            "README.md",
            "LICENSE",
            "CHANGELOG.md",
            ".env.example",
            "RELEASE_CHECKLIST.md",
            "scripts/pipx_install_local.sh",
            "scripts/release_alpha.sh",
        ]
        for item in required:
            self.assertTrue(Path(item).exists(), item)


if __name__ == "__main__":
    unittest.main()
