#!/usr/bin/env bash
# linkcheck reads %20 as a space and ignores links inside fenced code, and
# still catches a real broken link. Break-it, 2026-10-19: My%20File.md, which
# exists, and a [b](nope.md) inside a code fence were both reported broken.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/docs" "$T/tools"; cp "$ROOT/tools/linkcheck.py" "$T/tools/"
echo x > "$T/docs/My File.md"
printf '[a](My%%20File.md)\n```\n[b](nope.md)\n```\n[c](gone.md)\n' > "$T/docs/t.md"
out=$(python3 "$T/tools/linkcheck.py"); rc=$?
fail=0
[ "$rc" = 1 ] || { echo "  FAIL  a real broken link didn't fail the check"; fail=1; }
grep -q "gone.md" <<< "$out" || { echo "  FAIL  gone.md not reported"; fail=1; }
grep -q "My%20File" <<< "$out" && { echo "  FAIL  an existing file with a space was reported"; fail=1; }
grep -q "nope.md" <<< "$out" && { echo "  FAIL  a link inside a code fence was reported"; fail=1; }
[ "$fail" = 0 ] && echo "  ok    linkcheck: spaces decoded, fences skipped, real breaks caught"
exit "$fail"
