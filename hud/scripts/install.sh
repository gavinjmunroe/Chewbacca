#!/usr/bin/env bash
# Put the freshly bundled Kyber.app into /Applications and relaunch it.
#
# The old copy goes to the Trash, not `rm -rf`, so a bad build is one drag
# away from undone. Refuses an unsigned or wrongly signed build, because
# macOS ties Accessibility and Screen Recording grants to the signature and
# an ad hoc build silently drops both.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$here/build/Kyber.app}"
dest="/Applications/Kyber.app"
identity="Chewbacca Local Signing"

[ -d "$src" ] || { echo "no build at $src: run scripts/bundle.sh first" >&2; exit 1; }

id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$src/Contents/Info.plist")"
[ "$id" = "dev.bobthebuilder.hud" ] || { echo "$src is $id, not Kyber" >&2; exit 1; }

# Read into a variable first: `grep -q` quits at the first match, codesign
# takes a SIGPIPE, and pipefail turns a good signature into a refusal.
signature="$(codesign -dvv "$src" 2>&1 || true)"
if ! grep -q "Authority=$identity" <<<"$signature"; then
  echo "$src is not signed with \"$identity\"; grants would not carry over" >&2
  exit 1
fi

pkill -x Kyber 2>/dev/null || true
# Give it a moment to release the socket before the new one claims it.
for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Kyber >/dev/null || break; sleep 0.2; done

if [ -d "$dest" ]; then
  mv "$dest" "$HOME/.Trash/Kyber-$(date +%Y%m%d-%H%M%S).app"
fi
ditto "$src" "$dest"
open "$dest"
echo "installed $dest ($(codesign -dvv "$dest" 2>&1 | sed -n 's/^Authority=//p' | head -1))"
