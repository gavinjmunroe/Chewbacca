#!/bin/bash
# higgsfield-shot must price before it spends, stop over its cap without
# submitting, refuse to pay twice for a name that already completed, and
# report credits per finished second against an edit list.
#
# WHY. The Cowboy Cubans intro paid 332 credits for 52.5 s of Seedance and its
# cut used 10.0 s (2026-09-27). Nothing on disk said so until the clips were
# counted by hand, and a killed wait that was rerun would have billed twice.
# A stand-in higgsfield on PATH answers here, so the test spends nothing.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v ffmpeg >/dev/null || { echo "SKIP higgsfield_shot: ffmpeg not installed"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$TMP"
mkdir stub
ffmpeg -v error -y -f lavfi -i "testsrc=size=320x240:rate=24:duration=4" -c:v libx264 -pix_fmt yuv420p made.mp4 \
  || fail "could not build the stand-in result"

# The stand-in: 28 credits for a 720p job, 60 for 1080p; create logs its call.
cat >stub/higgsfield <<EOF
#!/bin/bash
echo "\$*" >>"$TMP/calls.log"
price=28; [[ "\$*" == *1080p* ]] && price=60
case "\$1 \$2" in
  "generate cost") echo "{\"credits\": \$price}" ;;
  "generate create") status=completed; [[ "\$*" == *BLOCKED* ]] && status=failed
    echo "[{\"id\": \"job-\$RANDOM\", \"status\": \"\$status\", \"result_url\": \"file://$TMP/made.mp4\", \"params\": {\"resolution\": \"720p\"}}]" ;;
  *) echo "unexpected: \$*" >&2; exit 2 ;;
esac
EOF
chmod +x stub/higgsfield
export PATH="$TMP/stub:$PATH"
shot="$ROOT/bin/higgsfield-shot"

"$shot" s01 seedance_2_5 --prompt "two men, twenty paces apart" --duration 4 --dry >out.txt || fail "dry run exited non-zero"
grep -q "28 credits (not run)" out.txt || fail "dry run did not print the price: $(cat out.txt)"
grep -q "generate create" calls.log && fail "dry run submitted a job"

"$shot" big seedance_2_5 --prompt x --resolution 1080p >out.txt 2>&1 && fail "a 60-credit job passed the default cap"
grep -q "over --max 40" out.txt || fail "cap refusal not explained: $(cat out.txt)"
grep -q "generate create" calls.log && fail "an over-cap job was submitted"

"$shot" s01 seedance_2_5 --prompt "two men" --duration 4 >out.txt || fail "normal run failed: $(cat out.txt)"
grep -qE "^s01 ok 28cr 4(\.0)?s job=job-" out.txt || fail "one-line result wrong: $(cat out.txt)"
[ -s clips/s01.mp4 ] && [ -s clips/s01.json ] || fail "result or job JSON not kept in clips/"
grep -q -- "--prompt two men --duration 4 --wait" calls.log || fail "flags not passed through in order: $(tail -1 calls.log)"

"$shot" s01 seedance_2_5 --prompt "two men" >out.txt 2>&1 && fail "a completed name ran twice"
grep -q "already completed" out.txt || fail "second run not refused: $(cat out.txt)"
[ "$(grep -c 'generate create' calls.log)" = 1 ] || fail "second run reached create"

"$shot" s02 seedance_2_5 --prompt "the draw" >/dev/null || fail "second clip failed"
"$shot" s03 seedance_2_5 --prompt "the bite" >/dev/null || fail "third clip failed"
# Higgsfield refunds a failed or moderated job, so the ledger must not bill it.
"$shot" s04 seedance_2_5 --prompt "BLOCKED" >/dev/null 2>&1 && fail "a failed job reported success"
echo '{"shots": [{"clip": "clips/s01.mp4", "in": 0, "out": 1.5}, {"clip": "clips/s02.mp4", "in": 1, "out": 3.5}]}' >edit.json
"$shot" --ledger clips --edit edit.json >out.txt || fail "ledger failed"
grep -q "4 jobs, 84 credits charged, 12.0 s made, failed and refunded: s04" out.txt || fail "ledger totals wrong: $(cat out.txt)"
grep -q "4.0 s in the cut, 33% of what was made, 21.0 credits a finished second" out.txt || fail "cut maths wrong: $(cat out.txt)"
grep -q "never used: s03" out.txt || fail "unused clip not named: $(cat out.txt)"
echo "ok"
