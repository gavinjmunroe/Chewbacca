#!/bin/sh
# Builds Chewbacca Week.app from main.swift with the Swift compiler that ships
# with the command line tools. No Xcode project, no dependencies.
#   apps/week-window/build.sh            installs to ~/Applications
#   DEST=/path apps/week-window/build.sh  somewhere else
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${DEST:-$HOME/Applications}"
APP="$DEST/Chewbacca Week.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/ChewbaccaWeek" "$HERE/main.swift" -framework Cocoa -framework WebKit
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built $APP"
