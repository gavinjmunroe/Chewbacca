"""font-guard refuses code that names a macOS font that is downloadable but not
installed. 2026-10-11 7:11pm: "Downloading font Nanum Brush Script" popped over
Caleb's work, and he wrote "Fix chewbs permission should never be asked to
download things"."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude" / "hooks" / "font-guard.sh"
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import font_check  # noqa: E402

if not font_check.CATALOG_DIR.is_dir():
    print("  skip font-guard (no macOS font catalog)")
    raise SystemExit(0)
missing = [n for n in font_check.missing() if " " not in n]
if not missing:
    print("  skip font-guard (every downloadable font is installed)")
    raise SystemExit(0)
name = missing[0]


def run(tool, tool_input):
    body = json.dumps({"tool_name": tool, "tool_input": tool_input})
    return subprocess.run(["bash", str(HOOK)], input=body, capture_output=True, text=True).returncode


failed = []


def check(label, ok):
    print(("ok   " if ok else "FAIL ") + label)
    if not ok:
        failed.append(label)


check("a CSS font-family naming a missing font is refused",
      run("Write", {"file_path": "/x/a.css", "content": "h1 { font-family: '%s'; }" % name}) == 2)
check("a Pillow truetype in a shell command is refused",
      run("Bash", {"command": "python3 -c \"from PIL import ImageFont; ImageFont.truetype('%s', 20)\"" % name}) == 2)
check("an Edit adding it to a Swift file is refused",
      run("Edit", {"file_path": "/x/V.swift", "new_string": 'NSFont(name: "%s", size: 12)' % name}) == 2)
check("installed fonts go through",
      run("Write", {"file_path": "/x/a.css", "content": "h1 { font-family: -apple-system, Helvetica; }"}) == 0)
check("prose in a markdown file goes through",
      run("Write", {"file_path": "/x/notes.md", "content": "font-family: '%s'" % name}) == 0)
check("font-ok: lets one through",
      run("Write", {"file_path": "/x/a.css", "content": "/* font-ok: he asked */ h1 { font-family: '%s'; }" % name}) == 0)
raise SystemExit(1 if failed else 0)
