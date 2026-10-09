#!/usr/bin/env python3
"""Check what this skill needs on this machine; print JSON the agent can act on.

    python3 preflight.py [--project DIR]

Each check reports ok, what was found, and the install command for this OS.
Exit 0 when every required tool is present, 1 otherwise. It installs nothing:
the agent shows the commands and runs them only after the user agrees.
Resolve is optional here; the brief decides whether it is required.
"""
import json
import os
import platform
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

RESOLVE_APP = {
    "Darwin": "/Applications/DaVinci Resolve/DaVinci Resolve.app",
    "Windows": r"C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe",
    "Linux": "/opt/resolve/bin/resolve",
}
RESOLVE_DOWNLOAD = "https://www.blackmagicdesign.com/products/davinciresolve"
MIN_FREE_GB = 20
# subtitles burns captions (libass); zscale converts iPhone HLG/HDR to SDR (zimg)
NEEDED_FILTERS = ("subtitles", "zscale")


def install_cmd(tool, system, has):
    """Install command for ffmpeg or uv on this OS; has(name) tests PATH."""
    if system == "Darwin":
        if has("brew"):
            return f"brew install {tool}"
        if tool == "uv":
            return "curl -LsSf https://astral.sh/uv/install.sh | sh"
        return ('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/'
                'Homebrew/install/HEAD/install.sh)" && brew install ffmpeg')
    if system == "Windows":
        return {"ffmpeg": "winget install Gyan.FFmpeg", "uv": "winget install astral-sh.uv"}[tool]
    if tool == "uv":
        return "curl -LsSf https://astral.sh/uv/install.sh | sh"
    for pm, cmd in (("apt-get", "sudo apt-get install -y ffmpeg"),
                    ("dnf", "sudo dnf install -y ffmpeg"),
                    ("pacman", "sudo pacman -S --noconfirm ffmpeg")):
        if has(pm):
            return cmd
    return "Install ffmpeg with your system package manager"


def missing_filters(filter_listing):
    """Needed FFmpeg filters absent from `ffmpeg -filters` output."""
    names = {line.split()[1] for line in filter_listing.splitlines() if len(line.split()) > 1}
    return [f for f in NEEDED_FILTERS if f not in names]


def transcribe_cmd(system, machine):
    """Word-timestamp JSON (segments[].words[]) in the format make_captions.py reads."""
    if system == "Darwin" and machine == "arm64":
        script = shlex.quote(str(Path(__file__).with_name("transcribe.py").resolve()))
        return f"uv run {script} audio.wav --output-dir ."
    return ("uvx whisper-ctranslate2 audio.wav --model large-v3-turbo "
            "--word_timestamps True --output_format json --output_dir .")


def main():
    project = sys.argv[sys.argv.index("--project") + 1] if "--project" in sys.argv else "."
    system, machine = platform.system(), platform.machine()
    has = lambda name: shutil.which(name) is not None
    checks = {}
    for tool in ("ffmpeg", "ffprobe"):
        checks[tool] = {"ok": has(tool), "required": True,
                        "install": install_cmd("ffmpeg", system, has)}
    if has("ffmpeg"):
        listing = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                                 capture_output=True, text=True).stdout
        gone = missing_filters(listing)
        if gone:
            checks["ffmpeg"].update(ok=False, missing_filters=gone,
                                    note="This FFmpeg build lacks libass and/or zimg; "
                                         "install a full build with the command above.")
    checks["python"] = {"ok": sys.version_info >= (3, 9), "required": True,
                        "found": platform.python_version(),
                        "install": "Install Python 3.9 or newer from https://www.python.org/downloads/"}
    phonon = system == "Darwin" and machine == "arm64"
    checks["transcription"] = {"ok": has("uv" if phonon else "uvx"), "required": True,
                               "command": transcribe_cmd(system, machine),
                               "install": install_cmd("uv", system, has),
                               "note": ("Local Phonon-2 for English speech; first run downloads "
                                        "164 MB of weights plus Python dependencies. Speech-gap "
                                        "flags require review. Use Whisper for other languages."
                                        if phonon else "This host is unsupported by the Phonon helper; "
                                        "use local Whisper. First run downloads about 1.5 GB of weights.")}
    app = RESOLVE_APP.get(system, "")
    checks["resolve"] = {"ok": bool(app) and os.path.exists(app), "required": False,
                         "found": app if app and os.path.exists(app) else None,
                         "install": f"Download DaVinci Resolve (free) from {RESOLVE_DOWNLOAD}; "
                                    "the installer needs the user."}
    free_gb = shutil.disk_usage(project).free / 1e9
    checks["disk"] = {"ok": free_gb >= MIN_FREE_GB, "required": False,
                      "found": f"{free_gb:.0f} GB free at {os.path.abspath(project)}"}
    missing = [k for k, v in checks.items() if v["required"] and not v["ok"]]
    print(json.dumps({"system": f"{system} {machine}", "missing_required": missing,
                      "checks": checks}, indent=2))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
