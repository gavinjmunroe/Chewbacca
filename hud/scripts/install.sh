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

[ -d "$src" ] || { echo "no build at $src: run scripts/bundle.sh first" >&2; exit 1; }

id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$src/Contents/Info.plist")"
[ "$id" = "dev.bobthebuilder.hud" ] || { echo "$src is $id, not Kyber" >&2; exit 1; }

# Read into a variable first: `grep -q` quits at the first match, codesign
# takes a SIGPIPE, and pipefail turns a good signature into a refusal.
signature="$(codesign -dvv "$src" 2>&1 || true)"
authority="$(sed -n 's/^Authority=//p' <<<"$signature" | head -1)"
# bundle.sh signs with "Chewbacca Local Signing" or, failing that, the Mac's
# "Apple Development" cert. Requiring only the first refused every build on a
# Mac that has the second (Caleb's, 2026-10-04). What actually keeps the grants
# is the same certificate as the installed copy, so that is what is checked.
if [ -z "$authority" ]; then
  echo "$src is ad hoc signed; grants would not carry over (run scripts/signing-identity.sh)" >&2
  exit 1
fi
if [ -d "$dest" ] && [ -z "${KYBER_NEW_CERT:-}" ]; then
  installed="$(codesign -dvv "$dest" 2>&1 | sed -n 's/^Authority=//p' | head -1 || true)"
  if [ -n "$installed" ] && [ "$installed" != "$authority" ]; then
    echo "$src is signed as \"$authority\" but the installed copy is \"$installed\"; grants would not carry over. KYBER_NEW_CERT=1 to install anyway and re-grant" >&2
    exit 1
  fi
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
