#!/bin/bash
# Build "Chewbacca Setup.app": the double-click installer for someone who has
# never opened Terminal.
#
#   tools/build_setup_app.sh [--out DIR] [--ref REF]
#
# The app carries the kit inside it (a `git archive` of REF, default HEAD), so
# it installs with the repo private and with no download. Double-clicking runs
# tools/setup_app/install.sh, which talks in small dialogs and never opens a
# Terminal window. Output: DIR/Chewbacca Setup.app and DIR/Chewbacca Setup.zip.
#
# It is ad-hoc signed only. Without an Apple Developer ID and notarization,
# a copy that arrived by download shows macOS's "unidentified developer"
# warning, and the person has to choose Open from the right-click menu once.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${CHEWBACCA_HOME:-$HOME/.chewbacca}/dist"
REF="HEAD"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a folder}"; shift 2 ;;
    --ref) REF="${2:?--ref needs a git ref}"; shift 2 ;;
    -h|--help) sed -n 2,15p "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

APP="$OUT/Chewbacca Setup.app"
mkdir -p "$OUT"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
RES="$APP/Contents/Resources"

# The payload start.sh unpacks. git archive takes committed files only, so it
# matches the SHA256SUMS.txt committed beside them and start.sh's checksum
# check passes; a dirty working tree cannot leak into it.
git -C "$ROOT" archive --format=tar.gz --prefix=chewbacca/ -o "$RES/chewbacca.tar.gz" "$REF"
git -C "$ROOT" show "$REF:start.sh" > "$RES/start.sh"
git -C "$ROOT" show "$REF:tools/setup_app/install.sh" > "$RES/install.sh"
VERSION="$(git -C "$ROOT" show "$REF:VERSION" 2>/dev/null | head -1 || true)"
COMMIT="$(git -C "$ROOT" rev-parse --short "$REF")"

cat > "$APP/Contents/MacOS/Chewbacca Setup" <<'EXEC'
#!/bin/bash
# Finder runs this with no terminal attached. Everything it shows is a dialog.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec /bin/bash "$RES/install.sh" "$RES/chewbacca.tar.gz"
EXEC
chmod +x "$APP/Contents/MacOS/Chewbacca Setup" "$RES/install.sh" "$RES/start.sh"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Chewbacca Setup</string>
  <key>CFBundleIdentifier</key><string>dev.chewbacca.setup</string>
  <key>CFBundleName</key><string>Chewbacca Setup</string>
  <key>CFBundleDisplayName</key><string>Chewbacca Setup</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-0}</string>
  <key>CFBundleVersion</key><string>${COMMIT}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc signature, so a copy built on this Mac opens without a warning here.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

rm -f "$OUT/Chewbacca Setup.zip"
ditto -c -k --keepParent "$APP" "$OUT/Chewbacca Setup.zip"
echo "$APP"
echo "$OUT/Chewbacca Setup.zip ($(du -h "$OUT/Chewbacca Setup.zip" | cut -f1 | tr -d ' '), $COMMIT)"
