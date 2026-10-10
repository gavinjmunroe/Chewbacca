#!/bin/bash
# quote-check must pass a quote that is in its saved source and fail every
# way a quote can be unsupported.
#
# WHY. It is the last step of the deep-research skill. A checker that passes
# everything looks exactly like one that works, so each failure it exists to
# catch has a fixture: one altered word, a citation to a file that was never
# saved, a quote with no saved source at all. Curly and straight quote marks
# must normalize, or every report pasted from a web page fails for nothing.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
QC="$ROOT/bin/quote-check"
mkdir -p "$TMP/sources/web"

cat > "$TMP/sources/web/groundnut.md" <<'EOF'
Groundnut snapshots the cited
sources, checks every citation against   what was fetched, and produces a claim
ledger that makes unsupported extrapolation visible.
EOF
printf '%s\n' "The validator opens each file and checks the quote is really there. Hallucinated citations fail the run." > "$TMP/sources/shellward.txt"
printf '%s\n' '{"readme": "Every finding needs file:line plus a verbatim quote."}' > "$TMP/sources/item.json"
# Curly marks in the source, written as bytes so no editor straightens them.
printf 'Groundnut does not currently decide that a paraphrase is \xe2\x80\x9csemantically supported\xe2\x80\x9d or contradicted.\n' > "$TMP/sources/curly.md"

# 1. Real quotes pass: wrapped lines, a JSON source, an elision, three cite styles.
cat > "$TMP/good.md" <<'EOF'
# Findings

Groundnut "checks every citation against what was fetched, and produces a claim ledger" ([groundnut](web/groundnut.md)).

ShellWard's validator "opens each file and checks the quote ... Hallucinated citations fail the run." [source: shellward.txt]

The rule is "Every finding needs file:line plus a verbatim quote." `item.json`

Short quotes like "not truth" are below the bar and ignored.

```
"this is inside a code fence and has more than six words"
```
EOF
"$QC" "$TMP/good.md" "$TMP/sources" > "$TMP/out" || fail "real quotes failed: $(cat "$TMP/out")"
grep -q "3 of 3 quotes found" "$TMP/out" || fail "expected 3 quotes checked: $(cat "$TMP/out")"

# 2. One altered word fails, and the failure names the quote and the file.
sed 's/what was fetched/what was saved/' "$TMP/good.md" > "$TMP/altered.md"
"$QC" "$TMP/altered.md" "$TMP/sources" > "$TMP/out" && fail "altered quote passed"
grep -q 'FAIL .*what was saved.*not found verbatim in web/groundnut.md' "$TMP/out" \
  || fail "altered quote not named: $(cat "$TMP/out")"
grep -q "2 of 3 quotes found" "$TMP/out" || fail "other quotes should still pass: $(cat "$TMP/out")"

# 3. A quote citing a file that was never saved fails.
cat > "$TMP/missing.md" <<'EOF'
The vendor says "this product never makes a single mistake" ([site](vendor/home.html)).
EOF
"$QC" "$TMP/missing.md" "$TMP/sources" > "$TMP/out" && fail "quote citing a missing file passed"
grep -q "source not on disk: vendor/home.html" "$TMP/out" || fail "missing file not named: $(cat "$TMP/out")"

# 4. A quote citing only a URL, or nothing, has no saved source and fails.
cat > "$TMP/uncited.md" <<'EOF'
Someone wrote "the quote is really there every single time" ([web](https://example.com/x)).

And "a line that nobody ever cites anywhere at all" floats free.
EOF
"$QC" "$TMP/uncited.md" "$TMP/sources" > "$TMP/out" && fail "uncited quote passed"
[ "$(grep -c 'no saved source cited' "$TMP/out")" = 2 ] || fail "uncited quotes not both named: $(cat "$TMP/out")"

# 5. Curly versus straight: curly marks around the report quote, straight
# apostrophe in the report against curly in the source, both directions.
printf 'The README says \xe2\x80\x9cGroundnut does not currently decide that a paraphrase is "semantically supported" or contradicted.\xe2\x80\x9d (source: curly.md)\n' > "$TMP/curly.md"
"$QC" "$TMP/curly.md" "$TMP/sources" > "$TMP/out" || fail "curly vs straight did not normalize: $(cat "$TMP/out")"
grep -q "1 of 1 quotes found" "$TMP/out" || fail "curly quote not checked: $(cat "$TMP/out")"
printf 'It reads \xe2\x80\x9cchecks every citation against what was fetched\xe2\x80\x9d [source: web/groundnut.md]\n' > "$TMP/curly2.md"
"$QC" "$TMP/curly2.md" "$TMP/sources" > "$TMP/out" || fail "curly report quote failed: $(cat "$TMP/out")"

# 6. A citation may not escape the sources folder.
printf 'secret\n' > "$TMP/outside.txt"
printf 'It says "a line from a file outside the sources folder" (source: ../outside.txt)\n' > "$TMP/escape.md"
"$QC" "$TMP/escape.md" "$TMP/sources" > "$TMP/out" && fail "citation outside the sources folder passed"

# 7. Bad arguments exit 2, not 1.
"$QC" "$TMP/nope.md" "$TMP/sources" >/dev/null 2>&1; [ $? = 2 ] || fail "missing report should exit 2"
"$QC" "$TMP/good.md" "$TMP/nope" >/dev/null 2>&1; [ $? = 2 ] || fail "missing sources folder should exit 2"

echo "quote_check: all cases passed"
