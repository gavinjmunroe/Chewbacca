#!/usr/bin/env bash
# apps/ is shared with every collaborator. On 2026-10-09 brain-retrieval's gold
# sets rode in with it and named the owner's health and relationship notes to
# all of them. Anything pointing into a private brain's personal notes, or
# naming them, stays out of the kit.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if git -C "$ROOT" grep -nIE 'memory/user_[a-z0-9_]+|user_freshman_year|_relationship\.md|bipolar' -- apps; then
  echo "personal brain content inside apps/; keep it in the private brain"
  exit 1
fi
