#!/usr/bin/env bash
# chewbacca-node builds the launchd runtime as a signed Chewbacca.app, so
# System Settings shows "Chewbacca" with an icon instead of a bare "node"
# (2026-10-10, Caleb: "non devs will think its malware"), and it rebuilds only
# when node's major version moves, because every re-sign needs the grant again.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$(command -v node || true)"
[ -n "$SRC" ] || { echo "skip: no node on PATH"; exit 0; }
SRC="$(cd "$(dirname "$SRC")" && pwd -P)/$(basename "$SRC")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_RUNTIME="$T/runtime" CHEWBACCA_NODE_SOURCE="$SRC"
fail() { echo "$1" >&2; exit 1; }

# An old install: a plain copy at the node path, which must become the link.
mkdir -p "$T/runtime"; cp -p "$SRC" "$T/runtime/node"
out="$(bash "$ROOT/bin/chewbacca-node" 2>&1)" || fail "build failed: $out"
APP="$T/runtime/Chewbacca.app"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$APP/Contents/Info.plist")" = Chewbacca ] || fail "bundle is not named Chewbacca"
[ -f "$APP/Contents/Resources/Chewbacca.icns" ] || fail "no icon in the bundle"
codesign -v "$APP" 2>/dev/null || fail "bundle signature does not verify"
codesign -dv "$APP" 2>&1 | grep -q "Identifier=com.chewbacca.runtime" || fail "signed under the wrong identifier"
[ -L "$T/runtime/node" ] || fail "the old plain copy at the node path was not replaced by a link"
[ "$("$T/runtime/node" -e 'process.stdout.write(process.execPath)')" = "$(cd "$APP/Contents/MacOS" && pwd -P)/Chewbacca" ] \
  || fail "node through the link is not the bundled binary, so TCC would not see Chewbacca"

before="$(stat -f %m "$APP/Contents/MacOS/Chewbacca")"
sleep 1
bash "$ROOT/bin/chewbacca-node" >/dev/null 2>&1 || fail "second run failed"
[ "$(stat -f %m "$APP/Contents/MacOS/Chewbacca")" = "$before" ] || fail "a second run re-signed, which would cost the grant"

/usr/libexec/PlistBuddy -c 'Set :ChewbaccaNodeMajor 0' "$APP/Contents/Info.plist"
out="$(bash "$ROOT/bin/chewbacca-node" 2>&1)"
grep -q "built" <<<"$out" || fail "a node major version change did not rebuild"
codesign -v "$APP" 2>/dev/null || fail "rebuilt bundle does not verify"
exit 0
