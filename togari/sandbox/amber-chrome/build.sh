#!/usr/bin/env bash
#
# build.sh
#
# Produce a Chrome Web Store-ready zip of the Amber LinkedIn extension. Drops
# dev-only files (tests/, docs/, *.md, .DS_Store) and validates manifest.json
# before zipping.
#
# Usage:
#   ./build.sh
#
# Output:
#   amber-linkedin-<version>.zip  (next to this script)

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ─── Sanity checks ───────────────────────────────────────────────────────────

if [[ ! -f manifest.json ]]; then
  echo "Error: manifest.json not found in $DIR" >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: 'zip' binary not found. brew install zip" >&2
  exit 1
fi

# Validate JSON syntactically. Prefer node, fall back to python3.
if command -v node >/dev/null 2>&1; then
  if ! node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))" 2>/dev/null; then
    echo "Error: manifest.json is not valid JSON" >&2
    exit 1
  fi
elif command -v python3 >/dev/null 2>&1; then
  if ! python3 -c "import json; json.load(open('manifest.json'))" 2>/dev/null; then
    echo "Error: manifest.json is not valid JSON" >&2
    exit 1
  fi
fi

# Extract version. Anchor the colon directly after "version" so we don't
# accidentally match "version_name". macOS sed doesn't understand \s, so
# we use POSIX [[:space:]].
VERSION=$(grep -E '^[[:space:]]*"version":' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
if [[ -z "$VERSION" ]]; then
  echo "Error: could not read version from manifest.json" >&2
  exit 1
fi

# ─── Required files ──────────────────────────────────────────────────────────

REQUIRED=(
  "manifest.json"
  "background.js"
  "popup.html"
  "popup.js"
  "icons/icon16.png"
  "icons/icon48.png"
  "icons/icon128.png"
)

for f in "${REQUIRED[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: required file missing: $f" >&2
    exit 1
  fi
done

# ─── Cross-check the two security allowlists ─────────────────────────────────
# manifest.json's externally_connectable.matches AND background.js's
# TRUSTED_BACKENDS must contain the same set of trusted backend origins.
#
# A mismatch is a security bug. The build emits a WARNING (not a hard fail)
# because the two lists serve overlapping but not identical purposes:
# externally_connectable governs who can talk TO the extension, while
# TRUSTED_BACKENDS governs where the extension is allowed to send cookies.
# The frontend may legitimately appear in externally_connectable but not in
# TRUSTED_BACKENDS (it sends messages but never receives cookies). To keep
# the parity check meaningful, we filter manifest's matches down to the
# backend origin only.

manifest_backend=$(awk '
  /"externally_connectable"/ { in_block = 1 }
  in_block && /\]/            { print; in_block = 0; next }
  in_block                    { print }
' manifest.json | grep -oE 'https?://[^"/*]+' | grep -E 'medha-id' | sort -u)

backend_origins=$(awk '
  /^const TRUSTED_BACKENDS = \[/ { in_block = 1 }
  in_block && /\];/              { print; in_block = 0; next }
  in_block                       { print }
' background.js | grep -oE 'https?://[^"]+' | sort -u)

if [[ "$manifest_backend" != "$backend_origins" ]]; then
  echo ""
  echo "WARNING: backend origin(s) in externally_connectable.matches do not match" >&2
  echo "         TRUSTED_BACKENDS in background.js." >&2
  echo "" >&2
  echo "  manifest backend:  $manifest_backend" | tr '\n' ' ' >&2
  echo "" >&2
  echo "  TRUSTED_BACKENDS:  $backend_origins" | tr '\n' ' ' >&2
  echo "" >&2
  echo "         Both lists must include the same backend origin or the" >&2
  echo "         layered security model breaks. Continuing with the build." >&2
  echo ""
fi

# ─── Build the zip ───────────────────────────────────────────────────────────

OUT="amber-linkedin-${VERSION}.zip"
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  popup.html \
  popup.js \
  icons/ \
  -x "icons/.*" \
  -x "*.DS_Store" \
  > /dev/null

# ─── Sanity-check the zip ────────────────────────────────────────────────────

size_bytes=$(wc -c < "$OUT" | tr -d ' ')
size_kb=$(( size_bytes / 1024 ))

contents=$(unzip -l "$OUT" 2>/dev/null | awk 'NR>3 && NF>=4 {print $4}' | grep -v '^$' | sort)

echo ""
echo "Built $OUT  (${size_kb} KB)"
echo ""
echo "Contents:"
echo "$contents" | sed 's/^/  /'

# Refuse the build if any unwanted file leaked in
LEAKED=$(echo "$contents" | grep -E '\.test\.|tests/|docs/|STORE_LISTING|PRIVACY|BACKEND_INTEGRATION|README|build\.sh|\.DS_Store' || true)
if [[ -n "$LEAKED" ]]; then
  echo ""
  echo "ERROR: unwanted files leaked into the zip:" >&2
  echo "$LEAKED" | sed 's/^/  /' >&2
  rm -f "$OUT"
  exit 1
fi

echo ""
echo "Ready to upload to:"
echo "  https://chrome.google.com/webstore/devconsole"
echo ""
echo "Listing copy + permission justifications: STORE_LISTING.md"
echo "Privacy policy to host before submitting:  docs/privacy.html (publish via GitHub Pages)"
echo "Backend endpoint contract (must be live):  BACKEND_INTEGRATION.md"
