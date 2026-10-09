#!/bin/bash
# Link every skill in this repo that is not yet installed in ~/.claude/skills.
#
# Adds missing symlinks and repairs dangling ones. Never removes, replaces or
# rewrites anything else: a real directory or a link to somewhere else is
# someone's skill and setup.sh owns that decision.
#
# Why this exists, 2026-10-09: doctor found 8 of 61 skills uninstalled
# (spiderverse-style, web-apis, video-edit among them), every one added by a
# tab after setup last ran. kit-autopull said "run chewbacca setup" and no tab
# did, so a skill written that night could never fire. Linking is a symlink
# per skill, cheap enough to run from git hooks on every commit and merge.
#
# Usage: link-skills.sh [repo-dir]    prints one line per skill it linked
REPO="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DST="${CHEWBACCA_SKILLS_DIR:-$HOME/.claude/skills}"
[ -d "$REPO/skills" ] || exit 0
mkdir -p "$DST" 2>/dev/null || exit 0

for sk in "$REPO"/skills/*/; do
  [ -f "$sk/SKILL.md" ] || continue
  n="$(basename "$sk")"
  t="$DST/$n"
  if [ -L "$t" ] && [ ! -e "$t" ]; then
    rm -f "$t"                      # dangling link: the old target is gone
  elif [ -e "$t" ] || [ -L "$t" ]; then
    continue                        # installed, or not ours to touch
  fi
  ln -s "${sk%/}" "$t" && echo "linked $n"
done
exit 0
