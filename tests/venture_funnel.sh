#!/bin/bash
# venture-validation's funnel.py must reproduce Caleb's graded ACAD 185 A10
# numbers (40/40): product E passes at 321.1% realistic eROAS, and product A,
# the best funnel in the set at a $30 price, fails on price and needs about
# $67 to clear the 200% bar that dashboard used.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
F="$ROOT/skills/venture-validation/bin/funnel.py"
fail=0
e=$(python3 "$F" --spend 2000 --impressions 89898 --clicks 6176 --leads 1791 --reservations 161 --price 97 --cogs 24.25 --bar 2.0)
printf '%s' "$e" | grep -q "realistic 321.1" || { echo "FAIL: product E eROAS is not 321.1%"; echo "$e"; fail=1; }
printf '%s' "$e" | grep -q "^PASS" || { echo "FAIL: product E should pass at 200%"; fail=1; }
a=$(python3 "$F" --spend 1687.27 --impressions 16729 --clicks 1376 --leads 1372 --reservations 122 --price 30 --cogs 7.5 --bar 2.0)
printf '%s' "$a" | grep -q "the problem is price" || { echo "FAIL: product A should fail on price"; echo "$a"; fail=1; }
printf '%s' "$a" | grep -Eq 'PRICE \$30.00 -> \$6[67]\.' || { echo "FAIL: product A price lever is not about \$67"; fail=1; }
# The default bar is the template's 300%, and E (321%) still passes it.
python3 "$F" --spend 2000 --impressions 89898 --clicks 6176 --leads 1791 --reservations 161 --price 97 --cogs 24.25 | grep -q "Bar 300.00%" ||
  { echo "FAIL: default bar is not 300%"; fail=1; }
# A stage under its floor is named first, with its levers.
c=$(python3 "$F" --spend 1000 --impressions 100000 --clicks 2000 --leads 500 --reservations 30 --price 50 --cogs 10)
printf '%s' "$c" | grep -q "fix CTR first" || { echo "FAIL: a 2% CTR should be the first fix"; echo "$c"; fail=1; }
python3 "$F" --spend 10 --clicks 1 --leads 1 --reservations 1 --price 5 >/dev/null 2>&1 && { echo "FAIL: missing impressions/cpm should exit nonzero"; fail=1; }
[ $fail -eq 0 ] && echo "ok: venture funnel"
exit $fail
