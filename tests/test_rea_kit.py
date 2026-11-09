"""chewbacca rea: REA stays optional, every run has a deadline that kills the
whole process group, universal binaries get thinned before Ghidra sees them,
and scoping never hands REA a file it stalls on. Offline: a fake REA binary
stands in for the real one, so nothing is downloaded or analyzed."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(home: Path):
    os.environ["HOME"] = str(home)
    for k in ("REA_KIT_CACHE", "REA_KIT_CLAUDE_JSON", "REA_KIT_CODEX_TOML", "REA_KIT_NPX_CACHE",
              "GHIDRA_INSTALL_DIR", "REA_KIT_BIN"):
        os.environ.pop(k, None)
    # Never the real Claude Code CLI: it would rewrite a real ~/.claude.json.
    os.environ["REA_KIT_CLAUDE"] = ""
    os.environ["REA_KIT_CACHE"] = str(home / "cache")
    spec = importlib.util.spec_from_file_location("rea_kit", str(ROOT / "tools" / "rea_kit.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers kill 0; ps says whether it's really running.
    st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(st) and not st.startswith("Z")


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        home = Path(d)

        # 1. No REA anywhere: doctor's line is information, and the CLI exits 0.
        rk = load(home)
        s = rk.status()
        assert s["installed"] is False, s
        line = rk.status_line(s)
        assert line.startswith("REA: not installed (optional"), line
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "rea_kit.py"), "status", "--line"],
                           capture_output=True, text=True, env=dict(os.environ))
        assert r.returncode == 0 and "optional" in r.stdout, (r.returncode, r.stdout, r.stderr)

        # 2. Registered in both agents, Ghidra env missing, then present.
        (home / ".codex").mkdir()
        (home / ".claude.json").write_text(json.dumps({"mcpServers": {"rea": {
            "command": "npx", "args": ["-y", "rea-agents@6.4.0", "mcp"]}}}))
        toml = home / ".codex" / "config.toml"
        toml.write_text('[mcp_servers.rea]\ncommand = "npx"\nargs = [ "-y", "rea-agents@6.4.0", "mcp" ]\n\n'
                        '[mcp_servers.other]\ncommand = "x"\n')
        rk = load(home)
        s = rk.status()
        assert s["installed"] and s["claude_mcp"] and s["codex_mcp"], s
        assert s["registered_pins"] == ["6.4.0"], s
        assert not s["ghidra_wired_claude"] and not s["ghidra_wired_codex"], s

        # 3. wire points Codex's rea table at the proxy, once, in place.
        res = rk.wire(apply=True)
        assert res["ok"] and res["wired"] == ["codex"], res
        text = toml.read_text()
        assert text.count("[mcp_servers.rea]") == 1 and "rea_kit.py" in text, text
        assert text.index("[mcp_servers.rea]") < text.index("[mcp_servers.other]"), text
        rk = load(home)
        assert rk.status()["proxied_codex"], rk.codex_block()
        assert rk.wire(apply=True)["message"].startswith("already wired"), rk.wire(apply=True)

        # 4. The slice Ghidra reads: Apple ships arm64e only for system tools,
        # and a universal binary is refused outright.
        assert rk.pick_arch(["x86_64", "x86_64h", "arm64e"], "arm64") == "arm64e"
        assert rk.pick_arch(["x86_64", "arm64"], "arm64") == "arm64"
        assert rk.pick_arch(["x86_64", "arm64"], "x86_64") == "x86_64"
        if len(rk.archs(Path("/usr/bin/true"))) > 1:
            thin = rk.thin(Path("/usr/bin/true"))
            assert rk.archs(thin) == [], rk.archs(thin)

        # 5. The deadline kills the whole group, grandchild included (upstream
        # #2290: the CLI and its worker outlived a failed run).
        pidfile = home / "grandchild.pid"
        fake = home / "fake-rea"
        fake.write_text("#!/bin/bash\nsleep 300 &\necho $! > %s\nsleep 300\n" % pidfile)
        fake.chmod(0o755)
        os.environ["REA_KIT_BIN"] = str(fake)
        t0 = time.time()
        res = rk.run_rea(["analyze", "x"], home / "out.json", deadline=1.5)
        assert res["code"] == "deadline" and time.time() - t0 < 10, res
        gpid = int(pidfile.read_text())
        time.sleep(0.3)
        assert not alive(gpid), "grandchild %d survived the deadline" % gpid

        # 6. An REA error comes back as its code, not as success.
        fake.write_text('#!/bin/bash\necho \'{"error":"Analysis failed","code":"provider_unavailable","message":"m"}\'\n')
        res = rk.run_rea(["analyze", "x"], home / "out2.json", deadline=10)
        assert res["ok"] is False and res["code"] == "provider_unavailable", res

        # 7. Scoping: the seed's small files go in, a file REA stalls on is
        # named for plain reading instead, and node_modules is skipped.
        app = home / "app"
        (app / "build").mkdir(parents=True)
        (app / "node_modules" / "dep").mkdir(parents=True)
        (app / "build" / "small.js").write_text("ipcRenderer.invoke('openThing')\n")
        (app / "build" / "preload.js").write_text("contextBridge.exposeInMainWorld('x', {})\n")
        (app / "build" / "huge.js").write_text("openThing;" + "a" * (rk.MAX_FILE_BYTES + 10))
        (app / "node_modules" / "dep" / "v.js").write_text("openThing\n")
        files = rk.find_seed(app, "openThing", 8)
        names = sorted(p.name for p in files)
        assert names == ["preload.js", "small.js"], names
        assert [Path(p).name for p in rk.too_big(app, "openThing")] == ["huge.js"]
        fake.write_text('#!/bin/bash\necho \'{"normalized_result":{"summary":{"context_bridge_apis":1,'
                        '"ipc":{"operations":2}},"statistics":{"parsed_javascript_files":2,"parse_failures":0}}}\'\n')
        res = rk.scope(str(app), "openThing", 8, deadline=10)
        assert res["ok"], res
        assert res["summary"]["context_bridge_apis"] == 1 and res["summary"]["parsed_javascript_files"] == 2, res
        assert [Path(p).name for p in res["read_these"]] == ["huge.js"], res
        # The CLI gives counts; tracing needs the MCP pair, handed over ready.
        nxt = res["mcp_next"][0]
        assert nxt["analyze_javascript_application"]["input_path"] == res["scoped_dir"], nxt
        assert nxt["analyze_javascript_application"]["detail"] == "summary", nxt
        assert nxt["trace_application_feature"]["seed"]["value"] == "openThing", nxt
        (app / "build" / "small.js").write_text("nothing\n")
        res = rk.scope(str(app), "openThing", 8, deadline=10)
        assert res["code"] == "only_large_files" and "MCP" in res["message"], res
        assert res["mcp_next"][0]["analyze_javascript_application"]["input_path"].endswith("huge.js"), res
        res = rk.scope(str(app), "notThere", 8, deadline=10)
        assert res["code"] == "seed_not_found", res
    # 8. Doctor reports it and setup offers it, both through the one status line.
    assert 'rea_kit.py" status --line' in (ROOT / "doctor.sh").read_text()
    setup = (ROOT / "setup.sh").read_text()
    assert 'rea_kit.py" status --line' in setup and "chewbacca rea install" in setup
    assert "tools/rea_kit.py" in (ROOT / "bin" / "chewbacca").read_text()
    print("rea_kit: optional, deadline kills the group, thinned, scoped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
