#!/usr/bin/env bash
# Everyone building Chewbacca gets the same kit (Caleb, 2026-10-09: "Everyone
# building chewbacca rn tgt should all hv the same exact experience"). Until
# that day the design hooks and setup read ux-engine from ~/code/tools, a
# private repo only Caleb's Mac had, so every teammate's install ran without
# the design gate and nothing said so. A hook, bin or setup path into one of
# his personal folders is that bug again. Third-party clones setup fetches
# itself (~/code/refs, ~/code/vendor) are the same on every Mac and allowed.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
hits="$(git -C "$ROOT" grep -nE '(\$HOME|~)/code/(tools|work|personal|amber|school|corpora|kits)/' \
  -- .claude/hooks bin setup.sh doctor.sh hud ':!apps' 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' \
  | grep -v 'has not pulled apps/ yet')"
if [ -n "$hits" ]; then
  echo "These depend on a folder only one Mac has. Move the thing into apps/:"
  echo "$hits"
  exit 1
fi
