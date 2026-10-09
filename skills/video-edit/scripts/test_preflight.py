#!/usr/bin/env python3
"""Dependency-free check of preflight's per-OS install and transcription commands."""
import os
from pathlib import Path
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from preflight import install_cmd, missing_filters, transcribe_cmd  # noqa: E402

only = lambda *names: (lambda name: name in names)

assert install_cmd("ffmpeg", "Darwin", only("brew")) == "brew install ffmpeg"
assert "Homebrew/install" in install_cmd("ffmpeg", "Darwin", only())
assert install_cmd("uv", "Darwin", only()).startswith("curl -LsSf https://astral.sh/uv")
assert install_cmd("ffmpeg", "Windows", only()) == "winget install Gyan.FFmpeg"
assert install_cmd("ffmpeg", "Linux", only("dnf")) == "sudo dnf install -y ffmpeg"
assert install_cmd("ffmpeg", "Linux", only()).startswith("Install ffmpeg")
command = shlex.split(transcribe_cmd("Darwin", "arm64"))
assert command[:2] == ["uv", "run"]
assert Path(command[2]).is_file()
assert command[3:] == ["audio.wav", "--output-dir", "."]
assert "whisper-ctranslate2" in transcribe_cmd("Darwin", "x86_64")
assert "whisper-ctranslate2" in transcribe_cmd("Linux", "x86_64")
listing = " ... subtitles         V->V       Render text subtitles\n ... zscale   V->V  Apply resizing\n"
assert missing_filters(listing) == []
assert missing_filters(" ... scale  V->V  Scale\n") == ["subtitles", "zscale"]
print("ok")
