#!/bin/bash
# PreToolUse on Write, Edit and Bash: refuse code that asks for a macOS font
# that is downloadable but not on this Mac.
#
# Asking for one by name (a CSS font-family, NSFont, a CoreText descriptor,
# Pillow's truetype, an SVG font) makes macOS put "Downloading font ..." over
# whatever the person is doing. On 2026-10-11 at 7:11pm one came up for "Nanum
# Brush Script" mid-session and Caleb wrote: "Fix chewbs permission should
# never be asked to download things". The trigger is the name in code, so the
# name is what this stops.
#
# Only code is read: Write and Edit of css, html, js, jsx, ts, tsx, svg,
# swift, py, sh and json files, and Bash commands. Prose that mentions a
# typeface is left alone. `font-ok:` anywhere in the content lets one through,
# for a font the person asked to install.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
LIB=""
for cand in "$HERE/../../bin/lib" "$HOME/.chewbacca/kit/current/bin/lib"; do
  [ -f "$cand/font_check.py" ] && { LIB="$cand"; break; }
done
[ -n "$LIB" ] || exit 0

printf '%s' "$INPUT" | FONT_LIB="$LIB" /usr/bin/python3 -I -c '
import json, os, sys
sys.path.insert(0, os.environ["FONT_LIB"])
import font_check
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
tool = d.get("tool_name") or ""
ti = d.get("tool_input") or {}
if not isinstance(ti, dict):
    raise SystemExit(0)
CODE = (".css", ".scss", ".html", ".htm", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".svg",
        ".swift", ".py", ".sh", ".json", ".vue")
if tool == "Bash":
    text = str(ti.get("command") or "")
elif tool in ("Write", "Edit", "MultiEdit"):
    path = str(ti.get("file_path") or "").lower()
    if not path.endswith(CODE):
        raise SystemExit(0)
    parts = [ti.get("content"), ti.get("new_string")]
    for e in ti.get("edits") or []:
        if isinstance(e, dict):
            parts.append(e.get("new_string"))
    text = "\n".join(str(p) for p in parts if p)
else:
    raise SystemExit(0)
if not text or "font-ok:" in text:
    raise SystemExit(0)
hits = font_check.mentions(text)
if not hits:
    raise SystemExit(0)
names = ", ".join(sorted(set(hits))[:5])
sys.stderr.write(
    "font-guard: " + names + " is a macOS font that is not installed on this Mac. "
    "Asking for it makes macOS pop a \"Downloading font\" window over the person'\''s work "
    "(2026-10-11, Nanum Brush Script). Use an installed font (font_check.installed_families()), "
    "or bundle a web font file with the project. If the person asked for this font, put "
    "font-ok: in the content.\n")
raise SystemExit(2)
'
