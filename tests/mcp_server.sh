#!/usr/bin/env bash
# The MCP server is the kit's only surface that does not need a shell.
#
# Everything else here is a SKILL.md read off disk, a hook in a process
# lifecycle, or an 8,000-line CLI. All three need a terminal, which is why the
# honest answer to "can a non-technical person use this from Claude in a
# browser" was zero percent. A technical co-founder bounced off the
# terminal install twice and then said "it's not a product I need to work for
# me". MCP is the one transport a browser client can reach a local machine
# through, and the kit consumed twelve MCP servers while exposing none.
#
# These check the protocol, not the prose, because a malformed initialize is
# invisible until a client silently refuses to connect.
set -uo pipefail
ROOT="${1:?repo root}"
MCP="$ROOT/bin/chewbacca-mcp"
fail() { echo "$1" >&2; exit 1; }

rpc() { printf '%s\n' "$1" | "$MCP" 2>/dev/null | head -1; }

# 1. initialize must return a protocol version and a server name.
out="$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')"
echo "$out" | grep -q '"protocolVersion"' || fail "initialize returned no protocolVersion: $out"
echo "$out" | grep -q '"chewbacca"' || fail "initialize did not name the server: $out"

# 2. tools/list must return every tool with a description, because the
#    description is the only thing a model reads when deciding to call.
out="$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
n="$(printf '%s' "$out" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["result"]["tools"]))' 2>/dev/null)"
[ "${n:-0}" -ge 5 ] || fail "expected at least 5 tools, got ${n:-0}"
printf '%s' "$out" | python3 -c '
import sys, json
for t in json.load(sys.stdin)["result"]["tools"]:
    assert t.get("description"), t["name"] + " has no description"
    assert t.get("inputSchema"), t["name"] + " has no inputSchema"
' || fail "a tool is missing a description or schema"

# 3. An unknown tool must error rather than hang or crash the server.
out="$(rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope","arguments":{}}}')"
echo "$out" | grep -q '"error"' || fail "unknown tool did not error: $out"

# 4. Arguments reach a CLI through execFile, never a shell. A model's argument
#    is attacker-controlled the moment the model reads a web page, so a shell
#    string here is the whole attack. This proves the metacharacters survive as
#    literal text instead of being interpreted.
canary="$(mktemp -u /tmp/mcp-canary-XXXX)"
rpc "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"who_do_i_know\",\"arguments\":{\"query\":\"; touch $canary\"}}}" >/dev/null
[ -f "$canary" ] && { rm -f "$canary"; fail "SHELL INJECTION: the argument was executed"; }

# 5. Malformed JSON must not take the server down.
out="$(printf 'not json\n{"jsonrpc":"2.0","id":5,"method":"tools/list"}\n' | "$MCP" 2>/dev/null | tail -1)"
echo "$out" | grep -q '"tools"' || fail "server did not recover from malformed input"

# 6. --register must be idempotent and must not destroy an existing config.
#    This writes files other programs depend on. A corrupted
#    claude_desktop_config.json stops THEIR servers working, which is a worse
#    outcome than this tool not being registered at all.
tmp="$(mktemp -d)"
mkdir -p "$tmp/Library/Application Support/Claude"
cfg="$tmp/Library/Application Support/Claude/claude_desktop_config.json"
printf '%s' '{"mcpServers":{"theirs":{"command":"/bin/true"}},"preferences":{"keep":"me"}}' > "$cfg"

HOME="$tmp" "$MCP" --register >/dev/null 2>&1
HOME="$tmp" "$MCP" --register >/dev/null 2>&1   # twice: must not duplicate

python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert "theirs" in d["mcpServers"], "destroyed an existing server"
assert d.get("preferences", {}).get("keep") == "me", "dropped an unrelated key"
assert "chewbacca" in d["mcpServers"], "did not register itself"
' "$cfg" || fail "--register damaged a config"

[ -f "$cfg.before-chewbacca" ] || fail "--register did not back the config up"

# 7. find_capability and kit_read reach the rest of the kit, read only.
#    2026-10-11: HockeyStack shipped ~20 MCP tools and no approval on deletes;
#    this exposes reads only, through a fixed registry with typed params.
out="$(rpc '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"find_capability","arguments":{"query":"which agents need me"}}}')"
echo "$out" | grep -q 'agents.needs' || fail "find_capability did not find agents.needs: $out"
out="$(rpc '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"kit_read","arguments":{"id":"people.search","params":{"query":"--help"}}}}')"
echo "$out" | grep -q 'does not start with a dash' || fail "a flag-shaped value reached a CLI: $out"
out="$(rpc '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"kit_read","arguments":{"id":"glass.walk","params":{"kind":"../../etc"}}}}')"
echo "$out" | grep -q 'expected one of' || fail "a choice param took a value off its list: $out"
# `people calls sync` and `people texts sync` write: a bare write verb as a
# positional value is refused, wherever the entry puts it.
out="$(rpc '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"kit_read","arguments":{"id":"people.thread","params":{"name":"sync"}}}}')"
echo "$out" | grep -q 'command word' || fail "a write verb reached a CLI as a value: $out"
out="$(rpc '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"kit_read","arguments":{"id":"rm.everything"}}}')"
echo "$out" | grep -q 'No capability' || fail "an unknown id did not refuse: $out"
python3 - "$ROOT/config/data/mcp-reads.json" <<'PY' || fail "a registry entry looks like a write"
import json, sys
bad = {"send", "add", "apply", "delete", "rm", "write", "set", "on", "off", "start", "stop", "submit", "push", "import"}
for e in json.load(open(sys.argv[1]))["reads"]:
    assert not (set(e.get("argv", [])) & bad), e["id"]
PY
python3 - "$ROOT" <<'PY' || fail "a registry entry names a tool that is not in bin/, or repeats an id"
import json, os, sys
reads = json.load(open(os.path.join(sys.argv[1], "config/data/mcp-reads.json")))["reads"]
ids = [e["id"] for e in reads]
assert len(ids) == len(set(ids)), "duplicate id"
for e in reads:
    assert os.path.isfile(os.path.join(sys.argv[1], "bin", e["tool"])), e["id"]
PY

# 8. The HTTP mode refuses a browser page and a rebinding host. Any site the
#    person visits could otherwise read their people through 127.0.0.1.
port=$((20000 + RANDOM % 20000))
"$MCP" --http "$port" 2>/dev/null & srv=$!
for _ in $(seq 1 30); do curl -s "http://127.0.0.1:$port/" >/dev/null 2>&1 && break; sleep 0.1; done
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://127.0.0.1:$port/")"
host="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Host: rebind.example' -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://127.0.0.1:$port/")"
okc="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://127.0.0.1:$port/")"
kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null
[ "$code" = 403 ] || fail "a browser Origin was served (HTTP $code)"
[ "$host" = 403 ] || fail "a foreign Host was served (HTTP $host)"
[ "$okc" = 200 ] || fail "a plain local client was refused (HTTP $okc)"

exit 0
