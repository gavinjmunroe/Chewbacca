#!/usr/bin/env bash
# The two slop gates see what they're pointed at. Break-it, 2026-10-19:
# code-slop --max 0 said "nothing to scan" for an untracked new file and for a
# staged é.py; slop-check --max 5 passed a directory of README.MD, .markdown
# and .mdx files scoring 31 each; and "verbatim: true" on any early line, not
# just in frontmatter, skipped a file.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
SLOP='# Step 1: Initialize the variable
x = 1  # Set x to 1
# Now we loop over the items
for i in range(3):
    # Increment the counter
    x += i  # Add i to x
# TODO: implement this
# As an AI language model, I added this helper
'
git -C "$T" init -q r && cd "$T/r" && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf '%s' "$SLOP" > new.py
python3 "$ROOT/bin/code-slop" --max 0 >/dev/null 2>&1; rc=$?
ok "code-slop scans an untracked new file" '[ "$rc" -ne 0 ]'
rm new.py; printf '%s' "$SLOP" > "é.py"; git add "é.py"
python3 "$ROOT/bin/code-slop" --max 0 >/dev/null 2>&1; rc=$?
ok "code-slop scans a staged non-ASCII file name" '[ "$rc" -ne 0 ]'

PROSE='In today'"'"'s fast-paced world, it'"'"'s worth noting that we delve into a robust, seamless tapestry. It'"'"'s not just a tool, it'"'"'s a game changer. Let'"'"'s dive in. Ultimately, this underscores a pivotal moment and a testament to innovation.
'
mkdir -p "$T/d"
for f in README.MD notes.markdown page.mdx; do printf '%s' "$PROSE" > "$T/d/$f"; done
python3 "$ROOT/bin/slop-check" "$T/d" --max 5 >/dev/null 2>&1; rc=$?
ok "slop-check scans .MD, .markdown and .mdx in a directory" '[ "$rc" -ne 0 ]'
printf 'Intro line.\nverbatim: true\n%s' "$PROSE" > "$T/late.md"
python3 "$ROOT/bin/slop-check" "$T/late.md" --max 5 >/dev/null 2>&1; rc=$?
ok "verbatim outside frontmatter doesn't skip the file" '[ "$rc" -ne 0 ]'
printf -- '---\nverbatim: true\n---\n%s' "$PROSE" > "$T/front.md"
python3 "$ROOT/bin/slop-check" "$T/front.md" --max 5 >/dev/null 2>&1; rc=$?
ok "verbatim in frontmatter still skips it" '[ "$rc" -eq 0 ]'
[ "$fail" -eq 0 ] && echo "slop gates ok" || { echo "slop gates: $fail failed"; exit 1; }
