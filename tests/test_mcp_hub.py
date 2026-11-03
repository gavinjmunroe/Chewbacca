#!/usr/bin/env python3
"""mcp-hub: one child per server shared by every client, tokens and Host
checked, Keychain values handed to the child and kept out of both configs,
a crashing server trips the breaker, and hub move/undo round-trips a Claude
entry. A fake stdio server and a fake claude; no network, no real Keychain."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
if not subprocess.run(["sh", "-c", "command -v node"], capture_output=True).stdout:
    print("SKIP: node not installed")
    sys.exit(77)
sys.path.insert(0, str(ROOT / "tools"))
import mcp_setup  # noqa: E402

fails = []


def no(msg):
    fails.append(msg)
    print("FAIL:", msg)


FAKE_SERVER = r'''
import json, os, sys, time
time.sleep(float(os.environ.get("FAKE_BOOT_S", "0")))
for line in sys.stdin:
    msg = json.loads(line)
    mid, method = msg.get("id"), msg.get("method")
    if mid is None:
        continue
    if method == "initialize":
        out = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "1"}}
    elif method == "tools/list":
        out = {"tools": [{"name": "whoami", "inputSchema": {"type": "object"}}]}
    elif method == "tools/call":
        name = msg["params"]["name"]
        if name == "crash":
            sys.exit(3)
        out = {"content": [{"type": "text", "text": json.dumps({"pid": os.getpid(), "token": os.environ.get("TOKEN", ""), "arg": sys.argv[1:]})}]}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "nope"}}), flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": mid, "result": out}), flush=True)
'''


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


with tempfile.TemporaryDirectory() as t:
    t = Path(t)
    (t / "fake.py").write_text(FAKE_SERVER)
    kc = t / "kc.json"
    kc.write_text(json.dumps({"fake.TOKEN": "sk_live_SECRET42", "fake.access-token": "argsecret77"}))
    port = free_port()
    (t / "mcp-hub.json").write_text(json.dumps({"port": port, "servers": {
        "fake": {"command": sys.executable, "args": [str(t / "fake.py"), "--access-token", "keychain:fake.access-token"],
                 "env": {"TOKEN": "keychain:fake.TOKEN"}}}}))
    env = dict(os.environ, CHEWBACCA_MCP_HUB_DIR=str(t), MCP_HUB_FAKE_KEYCHAIN=str(kc), MCP_HUB_CALL_TIMEOUT_MS="5000")
    hub = subprocess.Popen(["node", str(ROOT / "bin/mcp-hub"), "serve"], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(50):
            if (t / "mcp-hub.token").exists():
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                    break
                except Exception:
                    pass
            time.sleep(0.1)
        tok = (t / "mcp-hub.token").read_text().strip()

        def post(body, token=tok, host=None, path="/s/fake/mcp"):
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
            if host:
                headers["Host"] = host
            req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(),
                                         headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.status, json.loads(r.read() or b"null")
            except urllib.error.HTTPError as err:
                return err.code, None

        call = lambda i, name="whoami": post({"jsonrpc": "2.0", "id": i, "method": "tools/call",
                                              "params": {"name": name, "arguments": {}}})

        code, init = post({"jsonrpc": "2.0", "id": "a", "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
        if code != 200 or init["id"] != "a" or init["result"]["serverInfo"]["name"] != "fake":
            no(f"initialize: {code} {init}")

        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(call, range(100, 108)))
        ids = [r[1]["id"] for r in results]
        if ids != list(range(100, 108)):
            no(f"concurrent calls got each other's answers: {ids}")
        payloads = [json.loads(r[1]["result"]["content"][0]["text"]) for r in results]
        if len({p["pid"] for p in payloads}) != 1:
            no(f"8 clients should share one child, saw pids {sorted({p['pid'] for p in payloads})}")
        if payloads[0]["token"] != "sk_live_SECRET42" or "argsecret77" not in payloads[0]["arg"]:
            no(f"Keychain values did not reach the child: {payloads[0]}")

        if post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, token="wrong")[0] != 401:
            no("a wrong token was let through")
        if post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, host="evil.example")[0] != 403:
            no("a foreign Host header was let through (DNS rebinding)")
        if post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, path="/s/nope/mcp")[0] != 404:
            no("an unknown server should 404")

        for i in range(3):
            call(200 + i, "crash")
        code, body = call(300)
        msg = (body or {}).get("error", {}).get("message", "")
        if "failed 3 times" not in msg:
            no(f"three crashes should open the breaker, got {body}")
    finally:
        hub.terminate()
        hub.wait(timeout=5)
    # A restart answers initialize and tools/list from the cache while a slow
    # server boots, and server/discover never waits on a cold start.
    if not (t / "mcp-hub-cache.json").exists():
        no("the hub never cached the server's init and tool list")
    env_slow = dict(env, FAKE_BOOT_S="4")
    hub = subprocess.Popen(["node", str(ROOT / "bin/mcp-hub"), "serve"], env=env_slow,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        began = time.time()
        code, disc = post({"jsonrpc": "2.0", "id": "d", "method": "server/discover"})
        code, init2 = post({"jsonrpc": "2.0", "id": "i", "method": "initialize", "params": {}})
        code, tl = post({"jsonrpc": "2.0", "id": "l", "method": "tools/list"})
        took = time.time() - began
        if took > 2:
            no(f"cached answers took {took:.1f}s behind a 4s cold start")
        if (disc or {}).get("error", {}).get("code") != -32601:
            no(f"server/discover should be refused at once: {disc}")
        if (init2 or {}).get("result", {}).get("serverInfo", {}).get("name") != "fake":
            no(f"initialize was not served from the cache: {init2}")
        if [t_["name"] for t_ in (tl or {}).get("result", {}).get("tools", [])] != ["whoami"]:
            no(f"tools/list was not served from the cache: {tl}")
        code, live = call(400)
        if code != 200 or "result" not in (live or {}):
            no(f"a real call after a cached connect failed: {live}")
    finally:
        hub.terminate()
        hub.wait(timeout=5)
    log = (t / "logs/mcp-hub.log").read_text()
    if "SECRET42" in log or "argsecret77" in log:
        no("a secret reached the hub log")

    # hub move / undo against a fake claude
    home, bindir, calls = t / "home", t / "bin", t / "calls"
    home.mkdir()
    bindir.mkdir()
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {
        "db": {"type": "stdio", "command": "npx", "args": ["-y", "dbserver", "--access-token", "sbp_PLAIN99"],
               "env": {"DB_API_KEY": "key_PLAIN11", "REGION": "us"}},
        "playwright": {"type": "stdio", "command": "npx", "args": ["@playwright/mcp"]}}}))
    (bindir / "claude").write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n')
    (bindir / "claude").chmod(0o755)
    hub_dir = t / "hubdir"
    kc2 = t / "kc2.json"
    env2 = dict(os.environ, HOME=str(home), FAKE_LOG=str(calls), CHEWBACCA_MCP_HUB_DIR=str(hub_dir),
                MCP_HUB_FAKE_KEYCHAIN=str(kc2), PATH=f"{bindir}:/usr/bin:/bin")
    env2.pop("CLAUDE_CONFIG_DIR", None)
    tool = [sys.executable, str(ROOT / "tools/mcp_setup.py")]
    r = subprocess.run(tool + ["hub", "move", "db", "playwright"], env=env2, capture_output=True, text=True)
    log_lines = calls.read_text().splitlines() if calls.exists() else []
    if not any(l.startswith("mcp add --transport http db --scope user --header Authorization: Bearer ")
               and l.endswith("-- http://127.0.0.1:7338/s/db/mcp") for l in log_lines):
        no(f"hub move did not re-add db as a hub URL: {log_lines}")
    if any("playwright" in l for l in log_lines):
        no("playwright keeps a browser per tab and must not be moved")
    hub_text = (hub_dir / "mcp-hub.json").read_text()
    if "sbp_PLAIN99" in hub_text or "key_PLAIN11" in hub_text:
        no("a plaintext secret landed in mcp-hub.json")
    if "sbp_PLAIN99" in r.stdout + r.stderr:
        no("hub move printed a secret")
    if json.loads(kc2.read_text()) != {"db.DB_API_KEY": "key_PLAIN11", "db.access-token": "sbp_PLAIN99"}:
        no(f"the Keychain did not get both secrets: {kc2.read_text()}")
    if json.loads(hub_text)["servers"]["db"]["env"]["REGION"] != "us":
        no("a non-secret env value should stay as it was")

    calls.write_text("")
    subprocess.run(tool + ["hub", "undo", "db"], env=env2, capture_output=True, text=True)
    restored = [l for l in calls.read_text().splitlines() if l.startswith("mcp add-json db ")]
    if not restored:
        no("hub undo did not put db back")
    else:
        back = json.loads(restored[0][len("mcp add-json db "):].rsplit(" --scope", 1)[0])
        if back["args"][-1] != "sbp_PLAIN99" or back["env"]["DB_API_KEY"] != "key_PLAIN11":
            no(f"undo should restore the original values from the Keychain: {back}")
    if "db" in json.loads((hub_dir / "mcp-hub.json").read_text())["servers"]:
        no("undo left db in the hub config")

# hub start: registered under the kit's stable path, never a versioned
# snapshot, with a PATH that has node in it so npx servers can start.
with tempfile.TemporaryDirectory() as t:
    t = Path(t)
    stable = t / ".chewbacca/kit/current/bin/mcp-hub"
    stable.parent.mkdir(parents=True)
    stable.touch()
    env3 = dict(os.environ, HOME=str(t), CHEWBACCA_DAEMON_DIR=str(t / "daemon"), CHEWBACCA_MCP_HUB_DIR=str(t / "hub"))
    subprocess.run([sys.executable, str(ROOT / "tools/mcp_setup.py"), "hub", "start"], env=env3, capture_output=True)
    try:
        svc = json.loads((t / "daemon/services/mcp-hub.json").read_text())
    except (OSError, ValueError):
        svc = {}
    if svc.get("argv", [None, None])[1] != str(stable):
        no(f"hub start should register the stable kit path: {svc.get('argv')}")
    node_dir = os.path.dirname(subprocess.run(["sh", "-c", "command -v node"], capture_output=True, text=True).stdout.strip())
    if node_dir not in svc.get("env", {}).get("PATH", "").split(os.pathsep):
        no("hub start's PATH has no node in it, so npx servers would fail under the daemon")

print("ok" if not fails else f"{len(fails)} failed")
sys.exit(1 if fails else 0)
