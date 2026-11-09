#!/bin/bash
# The api MCP proxy must renew a lapsed Chrome-imported session and resend the
# call once, pass every other call through untouched, and never let an agent
# open a sign-in window. Engine and renew are fakes: no network, no Chrome.
#
# The case is real: on 2026-10-11 an MCP call to Brightspace answered 403 and
# said to open a login window, while the CLI path, which re-imports, worked.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }
command -v node >/dev/null || { echo "  skip (no node)"; exit 0; }

# Fake engine: brightspace calls fail auth until the renew marker exists.
cat > "$T/engine.mjs" <<'JS'
import readline from "node:readline";
import fs from "node:fs";
const dir = process.argv[2];
readline.createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  fs.appendFileSync(dir + "/engine.log", (m.params?.name || m.method) + "\n");
  const site = m.params?.arguments?.site;
  const ok = site !== "brightspace" || fs.existsSync(dir + "/renewed");
  const body = ok ? { ok: true, data: site } : { ok: false, class: "auth", reason: "HTTP 403 with login markers" };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(body) }] } }) + "\n");
});
JS
cat > "$T/renew.sh" <<SH
#!/bin/bash
echo "\$1" >> "$T/renew.log"
[ "\$1" = handshake ] && exit 1
touch "$T/renewed"
SH
chmod +x "$T/renew.sh"

call() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$1" "$2" "$3"; }
out="$( { call 1 call_operation '{"site":"brightspace","op":"myCourses"}'
          call 2 call_operation '{"site":"yc","op":"companies"}'
          call 3 login '{"site":"x","mode":"window"}'
          call 4 login '{"site":"handshake"}'; } |
  CHEWBACCA_RENEWABLE_SITES="brightspace handshake" node "$ROOT/bin/lib/api_mcp_proxy.mjs" "$T/renew.sh" -- node "$T/engine.mjs" "$T")"

r1="$(printf '%s\n' "$out" | grep '"id":1')"
printf '%s' "$r1" | grep -q '\\"ok\\":true' || fail "lapsed brightspace call not renewed and resent: $r1"
[ "$(grep -c call_operation "$T/engine.log")" = 3 ] || fail "expected 3 engine calls (brightspace twice, yc once): $(cat "$T/engine.log")"
printf '%s\n' "$out" | grep '"id":2' | grep -q 'yc' || fail "other site's call not passed through"
printf '%s\n' "$out" | grep '"id":3' | grep -q 'never opens a sign-in window' || fail "window login not refused"
grep -q '^login$' "$T/engine.log" && fail "a login reached the engine"
printf '%s\n' "$out" | grep '"id":4' | grep -q 'BLOCKED' || fail "a failed renew must say BLOCKED"
[ "$(printf '%s\n' "$out" | grep -c '"id"')" = 4 ] || fail "every request needs exactly one answer: $out"

# The wrapper launches the proxy, not the bare engine.
grep -q 'api_mcp_proxy.mjs' "$ROOT/bin/chewbacca-api" || fail "chewbacca api mcp skips the proxy"
echo "  ok"
