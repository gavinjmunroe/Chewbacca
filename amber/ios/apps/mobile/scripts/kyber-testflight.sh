#!/usr/bin/env bash
# Canonical TestFlight release entry point for Amber + the Kyber keyboard.
# Uses the app's EAS project, build profile, and submit profile as the source of
# truth for ownership, bundle IDs, Apple team, and App Store Connect app ID.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v eas >/dev/null 2>&1; then
  echo "EAS CLI is required. Install it with: npm install -g eas-cli" >&2
  exit 1
fi

exec eas build \
  --profile kyber \
  --platform ios \
  --auto-submit-with-profile production \
  --non-interactive
