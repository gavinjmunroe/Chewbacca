"""Which macOS fonts are downloadable but not installed.

macOS ships hundreds of fonts as on-demand assets. When code asks for one by
name (a CSS font-family, an NSFont, a CoreText descriptor, a Pillow or SVG
font) the system puts up "Downloading font ..." and makes the person wait or
cancel. On 2026-10-11 at 7:11pm one popped up over Caleb's work for "Nanum
Brush Script" and he wrote: "Fix chewbs permission should never be asked to
download things".

The asset catalog lists every downloadable family; one counts as installed
when its asset folder has AssetData. Stock /usr/bin/python3 3.9, stdlib only.
"""
import json
import os
import plistlib
import re
from pathlib import Path
from typing import Dict, List, Optional

CATALOG_DIR = Path(os.environ.get("CHEWBACCA_FONT_ASSETS", "/System/Library/AssetsV2/com_apple_MobileAsset_Font7"))
CACHE = Path(os.environ.get("CHEWBACCA_FONT_CACHE", str(Path.home() / ".cache" / "chewbacca" / "downloadable-fonts.json")))
# Names this short or this generic match ordinary words in code and prose.
# "Kai" and "Hei" are real families and also syllables. Guessed, never
# measured: four letters is where the false hits seemed to stop.
MIN_LEN = 5


def _catalog() -> Optional[Path]:
    hits = sorted(CATALOG_DIR.glob("*.xml")) if CATALOG_DIR.is_dir() else []
    return hits[0] if hits else None


def installed_families() -> Optional[set]:
    """Font families this Mac has active right now, from CoreText (about 20 ms).
    None when CoreText can't be reached, and then the asset folders decide."""
    try:
        import ctypes
        import ctypes.util
        ct = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreText"))
        cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation"))
        ct.CTFontManagerCopyAvailableFontFamilyNames.restype = ctypes.c_void_p
        cf.CFArrayGetCount.restype = ctypes.c_long
        cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
        cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
        cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
        cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
        cf.CFRelease.argtypes = [ctypes.c_void_p]
        arr = ct.CTFontManagerCopyAvailableFontFamilyNames()
        if not arr:
            return None
        buf = ctypes.create_string_buffer(512)
        out = set()
        for i in range(cf.CFArrayGetCount(arr)):
            if cf.CFStringGetCString(cf.CFArrayGetValueAtIndex(arr, i), buf, 512, 0x08000100):
                out.add(buf.value.decode("utf-8", "replace"))
        cf.CFRelease(arr)
        return out
    except Exception:  # noqa: BLE001 no CoreText (Linux, a sandbox): fall back
        return None


def missing() -> List[str]:
    """Downloadable family and PostScript names that are not active on this Mac.

    The asset folders alone said "Al Bayan" was missing while CoreText had it
    active, so the active family list decides when it can be read."""
    cat = _catalog()
    if cat is None:
        return []
    have = installed_families()
    stamp = "{}:{}:{}".format(cat.stat().st_mtime, CATALOG_DIR.stat().st_mtime, len(have or ()))
    try:
        cached = json.loads(CACHE.read_text())
        if cached.get("stamp") == stamp:
            return list(cached.get("missing") or [])
    except (OSError, ValueError):
        pass
    try:
        assets = plistlib.load(open(cat, "rb")).get("Assets") or []
    except Exception:  # noqa: BLE001 an unreadable catalog means nothing to warn about
        return []
    names = set()
    for entry in assets:
        digest = Path(str(entry.get("__RelativePath") or "")).stem
        on_disk = bool(digest) and (CATALOG_DIR / (digest + ".asset") / "AssetData").exists()
        for info in entry.get("FontInfo4") or []:
            if not isinstance(info, dict):
                continue
            family = info.get("FontFamilyName")
            if not isinstance(family, str) or family.startswith("."):
                continue
            active = family in have if have is not None else on_disk
            if active:
                continue
            for name in (family, info.get("PostScriptFontName")):
                if isinstance(name, str) and len(name) >= MIN_LEN:
                    names.add(name)
    out = sorted(names)
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps({"stamp": stamp, "missing": out}))
    except OSError:
        pass
    return out


# Only a name used as a font counts: "font" within this many characters before
# it (font-family:, fontName=, NSFont(name:, ImageFont.truetype(, font=").
# A bare word match flagged "Times" 67 times and "Impact" in prose across this
# repo on 2026-10-11. Guessed, never measured beyond that scan.
CONTEXT = 60


def mentions(text: str, names: Optional[List[str]] = None) -> List[str]:
    """The not-installed downloadable fonts this text asks for as a font."""
    names = missing() if names is None else names
    low = text.lower()
    if "font" not in low:
        return []
    found = []
    for name in names:
        n = name.lower()
        if n not in low:
            continue
        for m in re.finditer(r"(?<![A-Za-z0-9])" + re.escape(n) + r"(?![A-Za-z0-9])", low):
            if "font" in low[max(0, m.start() - CONTEXT):m.start()]:
                found.append(name)
                break
    return found


def main(argv: List[str]) -> int:
    if argv[:1] == ["--list"]:
        print("\n".join(missing()))
        return 0
    text = " ".join(argv) if argv else ""
    hits = mentions(text)
    for h in hits:
        print(h)
    return 1 if hits else 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main(sys.argv[1:]))
