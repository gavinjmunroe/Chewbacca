#!/bin/bash
# tools/product_sync.py and chewbacca products against a made-up Chewbacca and
# a made-up product: a landed change moves, an uncommitted one never does, a
# change on both sides stops, a mapped path follows its map, the firewall keeps
# a personal file out, and products pull pushes only when the product's tests
# pass.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
g() { git -C "$1" -c user.name=t -c user.email=t@t "${@:2}"; }

git init -q --bare -b main "$T/origin.git"
git init -q -b main "$T/chewbacca"; g "$T/chewbacca" remote add origin "$T/origin.git"
mkdir -p "$T/chewbacca/bin" "$T/chewbacca/config"
echo v1 > "$T/chewbacca/bin/tool"; echo c1 > "$T/chewbacca/bin/checker"
printf '{"patterns": ["\\\\bZed\\\\b"]}\n' > "$T/chewbacca/config/product-firewall.json"
g "$T/chewbacca" add -A; g "$T/chewbacca" commit -qm one; g "$T/chewbacca" push -q origin main
mkdir -p "$T/prod"; g "$T/prod" init -q -b main 2>/dev/null || git init -q -b main "$T/prod"
export CHEWBACCA_DIR="$T/chewbacca"
S() { /usr/bin/python3 "$ROOT/tools/product_sync.py" --root "$T/prod" "$@"; }
push_chew() { g "$T/chewbacca" commit -qam "$1"; g "$T/chewbacca" push -q origin main; }

S add bin/tool scripts/checker=bin/checker > /dev/null && S pull > /dev/null
[ "$(cat "$T/prod/bin/tool")" = v1 ] && ok "add then pull brings a Chewbacca file in" || no "pull same path"
[ "$(cat "$T/prod/scripts/checker" 2>/dev/null)" = c1 ] && ok "a mapped file lands at its own path here" || no "mapped pull: $(ls -R "$T/prod")"
S > /dev/null && ok "status exits 0 when every file is in step" || no "status not clean after pull"

echo half-done > "$T/chewbacca/bin/tool"
S pull > /dev/null; [ "$(cat "$T/prod/bin/tool")" = v1 ] && ok "an uncommitted Chewbacca edit stays out" || no "pulled the working tree"
g "$T/chewbacca" checkout -q -- bin/tool

echo c2 > "$T/chewbacca/bin/checker"; push_chew two
S > "$T/st"; grep -q "changed in Chewbacca *scripts/checker" "$T/st" && ok "status names the side that moved, by the path here" || no "status: $(cat "$T/st")"
S pull > /dev/null; [ "$(cat "$T/prod/scripts/checker")" = c2 ] && ok "a landed change follows the map" || no "mapped v2 not pulled"

printf 'v2\n# thanks Zed\n' > "$T/chewbacca/bin/tool"; push_chew three
out="$(S pull)"; rc=$?
[ "$rc" = 4 ] && printf '%s' "$out" | grep -q "BLOCKED: bin/tool in Chewbacca has personal data" && [ "$(cat "$T/prod/bin/tool")" = v1 ] \
  && ok "the firewall keeps a file w a private name out and says which line" || no "firewall: rc=$rc $out"
printf 'v2\nreach me at +1 555 123 4567\n' > "$T/chewbacca/bin/tool"; push_chew four
S pull > /dev/null; [ $? = 4 ] && [ "$(cat "$T/prod/bin/tool")" = v1 ] && ok "a phone number is held too" || no "phone got through"
echo v3 > "$T/chewbacca/bin/tool"; push_chew five
S pull > /dev/null && [ "$(cat "$T/prod/bin/tool")" = v3 ] && ok "a clean copy pulls once the source is fixed" || no "clean v3 not pulled"

echo mine > "$T/prod/bin/tool"
echo v4 > "$T/chewbacca/bin/tool"; push_chew six
out="$(S pull)"; rc=$?
[ "$rc" = 3 ] && printf '%s' "$out" | grep -q "^BLOCKED: bin/tool changed in both" && [ "$(cat "$T/prod/bin/tool")" = mine ] \
  && ok "a change on both sides stops and overwrites nothing" || no "conflict: rc=$rc $out"
out="$(S push --dry-run)"; [ $? = 3 ] && ok "push refuses a conflict too" || no "push over a conflict: $out"
grep -qE "joelnewton|calebnew|\\\\bCaleb" "$ROOT/tools/product_sync.py" && no "the engine carries a private pattern, so it can't ship" || ok "the engine itself holds no private name or account"

# chewbacca products pull: clone, pull, test, push only on green.
cp "$ROOT/tools/product_sync.py" "$T/engine.py"
git init -q --bare -b main "$T/prod-origin.git"
git clone -q "$T/prod-origin.git" "$T/p2" 2>/dev/null
cp "$T/prod/sync.json" "$T/p2/"
mkdir -p "$T/p2/bin" "$T/p2/scripts"; cp "$T/chewbacca/bin/checker" "$T/p2/scripts/checker"; echo old > "$T/p2/bin/tool"
# The lock says bin/tool was in step at "old", so only Chewbacca moved since.
/usr/bin/python3 -c 'import hashlib,json,sys;h=lambda p:hashlib.sha256(open(p,"rb").read()).hexdigest();json.dump({"bin/tool":{"sha256":h(sys.argv[1]+"/bin/tool")},"scripts/checker":{"sha256":h(sys.argv[1]+"/scripts/checker")}},open(sys.argv[1]+"/sync.lock.json","w"))' "$T/p2"
g "$T/p2" add -A; g "$T/p2" commit -qm base; g "$T/p2" push -q origin main
printf '{"products": [{"name": "demo", "repo": "x/demo", "test": "grep -q v4 bin/tool"}]}\n' > "$T/reg.json"
export CHEWBACCA_HOME="$T/home" CHEWBACCA_PRODUCTS="$T/reg.json" CHEWBACCA_PRODUCT_REMOTE_DEMO="$T/prod-origin.git"
P() { GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t /usr/bin/python3 "$ROOT/bin/chewbacca-products" "$@"; }
P > "$T/st"; grep -q "demo: " "$T/st" && grep -q "changed" "$T/st" && ok "products status reads a product from its origin" || no "products status: $(cat "$T/st")"
P pull > "$T/out"; git -C "$T/prod-origin.git" show main:bin/tool | grep -q v4 \
  && ok "products pull pushes the product's main when its tests pass" || no "products pull: $(cat "$T/out")"
echo v5 > "$T/chewbacca/bin/tool"; push_chew seven
P pull > "$T/out"; rc=$?
[ "$rc" = 1 ] && grep -q "BLOCKED: demo tests failed" "$T/out" && git -C "$T/prod-origin.git" show main:bin/tool | grep -q v4 \
  && ok "a red product test pushes nothing" || no "pushed past red tests: $(cat "$T/out")"
grep -q '"bin/checker"' "$T/home/products-shared.json" 2>/dev/null && grep -q '"bin/tool"' "$T/home/products-shared.json" \
  && ok "products writes the Chewbacca-side shared paths land reads" || no "cache: $(cat "$T/home/products-shared.json" 2>&1)"

# land queues a pull only for a landed diff that touches a shared path.
mkdir -p "$T/bin"; printf '#!/bin/bash\necho "$@" >> "%s/queued"\n' "$T" > "$T/bin/chewbacca"; chmod +x "$T/bin/chewbacca"
mkdir -p "$T/chewbacca/config"; echo '{"products": []}' > "$T/chewbacca/config/products.json"
g "$T/chewbacca" add -A; g "$T/chewbacca" commit -qm reg; g "$T/chewbacca" push -q origin main
Q() { (cd "$ROOT" && PATH="$T/bin:$PATH" CHEWBACCA_NO_RUNTIME= /usr/bin/python3 -c '
import sys
from importlib.machinery import SourceFileLoader
m=SourceFileLoader("land",sys.argv[1]).load_module()
m.queue_product_sync(sys.argv[2], sys.argv[3])' "$ROOT/bin/chewbacca-land" "$T/chewbacca" "$1"); }
echo notes > "$T/chewbacca/README"; g "$T/chewbacca" add README; g "$T/chewbacca" commit -qm readme
Q HEAD~1 > /dev/null; [ ! -s "$T/queued" ] && ok "a land touching no shared file queues nothing" || no "queued for an unshared file: $(cat "$T/queued")"
echo v9 > "$T/chewbacca/bin/tool"; g "$T/chewbacca" commit -qam nine
Q HEAD~1 > /dev/null; grep -q "jobs submit --net --once .* products pull" "$T/queued" 2>/dev/null \
  && ok "a land touching a shared file queues products pull on the machine queue" || no "not queued: $(cat "$T/queued" 2>&1)"
: > "$T/queued"; CHEWBACCA_NO_PRODUCT_SYNC=1 Q HEAD~1 > /dev/null 2>&1
[ ! -s "$T/queued" ] && ok "CHEWBACCA_NO_PRODUCT_SYNC keeps a scratch land from queueing" || no "queued under the opt-out"
exit "$fail"
