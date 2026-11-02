#!/usr/bin/env python3
"""chewbacca mcp: list, add, sign into and check MCP servers, one command each.

The catalog is config/mcp/catalog.json. Adding goes through each agent's own
CLI (`claude mcp add`, `codex mcp add`), never a hand edit of their config:
~/.claude.json carries the whole Claude Code state, and Claude Code rewrites it
while it runs.

  chewbacca mcp                     everything, grouped, with what's added here
  chewbacca mcp add figma notion    add, then open each browser sign-in
  chewbacca mcp add --group design  a whole group
  chewbacca mcp add --all           every server that needs no key
  chewbacca mcp login figma         redo a sign-in
  chewbacca mcp status              ask Claude Code what is connected right now
  chewbacca mcp remove figma
  chewbacca mcp verify              probe every catalog URL and package (network)
"""
import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("CHEWBACCA_ROOT") or Path(__file__).resolve().parent.parent)
CATALOG = ROOT / "config/mcp/catalog.json"
HOME = Path.home()
GROUPS = ["design", "work", "dev", "money", "search", "browser", "mac", "media", "kit"]
AUTH_WORDS = {
    "none": "no account",
    "oauth": "sign in",
    "key": "paste a key",
    "gh": "GitHub CLI",
    "kit": "ships w Chewbacca",
}


def load_catalog():
    return json.loads(CATALOG.read_text())["servers"]


def fill(value):
    return value.replace("{root}", str(ROOT)) if isinstance(value, str) else value


def claude_bin():
    return shutil.which("claude")


def codex_bin():
    return shutil.which("codex")


def claude_config():
    """The file `claude mcp add --scope user` writes, which follows CLAUDE_CONFIG_DIR."""
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(base) / ".claude.json" if base else HOME / ".claude.json"


def claude_entries():
    """User-scope servers, read only, never written here."""
    try:
        return json.loads(claude_config().read_text()).get("mcpServers") or {}
    except (OSError, ValueError):
        return {}


def claude_servers():
    return set(claude_entries())


def codex_servers():
    path = HOME / ".codex/config.toml"
    try:
        text = path.read_text()
    except OSError:
        return set()
    names = set()
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[mcp_servers.") and line.endswith("]"):
            name = line[len("[mcp_servers."):-1].split(".")[0].strip('"')
            names.add(name)
    return names


def enabled_plugins():
    """Plugin short names enabled in any Claude settings file on this machine,
    plus the ones `claude plugin list` reports loaded. The second source is
    what catches a plugin the desktop app syncs in per session: figma@synced
    on 2026-11-02 was in no settings file, so a user-scope figma would have
    sat beside plugin:figma:figma in every desktop session."""
    names = set()
    claude = claude_bin()
    if claude:
        ok, out = run([claude, "plugin", "list"])
        current = None
        for line in out.splitlines() if ok else []:
            line = line.strip()
            if line.startswith("\u276f"):
                current = line[1:].strip().split("@")[0]
            elif current and line.startswith("Status:") and "loaded" in line and "not" not in line:
                names.add(current)
    for f in ("settings.json", "settings.local.json"):
        try:
            data = json.loads((HOME / ".claude" / f).read_text())
        except (OSError, ValueError):
            continue
        for key, on in (data.get("enabledPlugins") or {}).items():
            if on:
                names.add(key.split("@")[0])
    return names


def state(name, spec, claude_have, codex_have, plugins):
    if spec.get("plugin") in plugins:
        return "added (plugin)"
    where = [w for w, have in (("Claude", claude_have), ("Codex", codex_have)) if name in have]
    return "added (" + ", ".join(where) + ")" if where else ""


def cmd_list(args):
    servers = load_catalog()
    claude_have, codex_have, plugins = claude_servers(), codex_servers(), enabled_plugins()
    groups = [args.group] if args.group else GROUPS
    for group in groups:
        rows = [(n, s) for n, s in servers.items() if s["group"] == group]
        if not rows:
            continue
        print(f"\n{group}")
        for name, spec in rows:
            mark = state(name, spec, claude_have, codex_have, plugins)
            print(f"  {name:<17} {AUTH_WORDS[spec['auth']]:<18} {spec['what']}"
                  + (f"   [{mark}]" if mark else ""))
    print("\nAdd one:  chewbacca mcp add <name>     a group:  chewbacca mcp add --group dev")
    return 0


def run(cmd, quiet=False):
    """Run an agent CLI. Returns (ok, combined output) and never raises."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, str(err)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def read_key(var, spec, interactive):
    value = os.environ.get(var, "").strip()
    if value or not interactive:
        return value
    where = spec.get("signup", "")
    print(f"  {var} is needed" + (f", get one at {where}" if where else ""))
    try:
        return getpass.getpass(f"  paste {var} (hidden, Enter to skip): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def gh_token():
    gh = shutil.which("gh")
    if not gh:
        return ""
    # stdout alone: a warning on stderr would otherwise become the stored token.
    try:
        r = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    lines = r.stdout.strip().splitlines()
    return lines[-1].strip() if r.returncode == 0 and lines else ""


def plan_add(name, spec, interactive):
    """What to run for Claude and for Codex, or the one thing missing."""
    if spec.get("mac") and sys.platform != "darwin":
        return None, "Mac only"
    if spec.get("requires") and not shutil.which(spec["requires"]):
        return None, f"needs {spec['requires']} installed first"
    transport = spec["transport"]
    env, headers = {}, {}
    if spec["auth"] == "key":
        for var in spec.get("env", []):
            value = read_key(var, spec, interactive)
            if not value:
                return None, f"needs {var}" + (f" from {spec['signup']}" if spec.get("signup") else "")
            env[spec.get("env_as", {}).get(var, var)] = value
    if spec["auth"] == "gh":
        token = gh_token()
        if not token:
            return None, "needs the GitHub CLI signed in: gh auth login"
        headers["Authorization"] = f"Bearer {token}"

    claude = [claude_bin() or "claude", "mcp", "add", name, "--scope", "user"]
    codex = [codex_bin() or "codex", "mcp", "add", name]
    if transport in ("http", "sse"):
        claude[3:3] = ["--transport", transport]
        for key, value in headers.items():
            claude += ["--header", f"{key}: {value}"]
        # --header takes any number of values, so without the -- it swallowed
        # the URL as a second header and every github add failed with
        # "missing required argument 'commandOrUrl'" (review, 2026-11-02).
        claude += ["--", spec["url"]]
        # Codex speaks streamable HTTP only, and takes a bearer token from an
        # env var rather than a stored header.
        codex = None if transport == "sse" or headers else codex + ["--url", spec["url"]]
    else:
        for key, value in env.items():
            claude += ["--env", f"{key}={value}"]
            codex += ["--env", f"{key}={value}"]
        argv = [fill(spec["command"])] + [fill(a) for a in spec.get("args", [])]
        claude += ["--"] + argv
        codex += ["--"] + argv
    return {"claude": claude, "codex": codex}, ""


def add_one(name, spec, opts, have):
    claude_have, codex_have, plugins = have
    if spec.get("plugin") in plugins:
        # A second copy beside the plugin's would put two servers with the same
        # tools in every session. Signing the plugin's copy in is what's needed.
        server = f"plugin:{spec['plugin']}:{spec['plugin']}"
        print(f"  {name}: already here through the {spec['plugin']} plugin")
        if spec["auth"] == "oauth" and opts.login:
            login(server)
        return True
    if spec.get("add_with"):
        ok, out = run([fill(a) for a in spec["add_with"]])
        print(f"  {name}: {'added' if ok else 'FAILED'}" + ("" if ok else f"\n{out[-400:]}"))
        return ok
    if name in claude_have and not opts.replace:
        print(f"  {name}: already added to Claude, left alone (--replace to swap it)")
        if spec["auth"] == "oauth" and opts.login:
            login(name)
        return True
    cmds, missing = plan_add(name, spec, opts.interactive)
    if not cmds:
        print(f"  {name}: skipped, {missing}")
        return False
    if not claude_bin():
        print(f"  {name}: skipped, Claude Code is not installed")
        return False
    old = claude_entries().get(name) if name in claude_have else None
    if old is not None:
        run([claude_bin(), "mcp", "remove", name, "--scope", "user"])
    ok, out = run(cmds["claude"])
    if not ok:
        if old is not None:
            # A failed --replace must not leave the server gone: put the old one back.
            run([claude_bin(), "mcp", "add-json", name, json.dumps(old), "--scope", "user"])
        print(f"  {name}: FAILED in Claude: {out[-300:]}" + (", the old entry was put back" if old else ""))
        return False
    line = f"  {name}: added to Claude"
    if cmds["codex"] and codex_bin() and opts.codex:
        if name in codex_have and not opts.replace:
            line += ", Codex already had it"
        else:
            if name in codex_have:
                run([codex_bin(), "mcp", "remove", name])
            cok, _ = run(cmds["codex"])
            line += ", and Codex" if cok else ", Codex refused it"
    print(line)
    if spec.get("note"):
        print(f"    {spec['note']}")
    if spec["auth"] == "oauth" and opts.login:
        login(name)
    return True


def login(name):
    claude = claude_bin()
    if not claude:
        return False
    if not sys.stdin.isatty():
        # A sign-in opens a browser and waits for the redirect. Without a
        # person at a terminal it hangs until the timeout, so say the one step.
        print(f"    sign in later: chewbacca mcp login {name}")
        return False
    print(f"    opening the {name} sign-in in your browser")
    return subprocess.run([claude, "mcp", "login", name]).returncode == 0


def pick(args, servers):
    if args.all:
        names = [n for n, s in servers.items() if s["auth"] != "key" and s["group"] != "kit"]
    elif args.group:
        names = [n for n, s in servers.items() if s["group"] == args.group]
    else:
        names = args.names
    unknown = [n for n in names if n not in servers]
    if unknown:
        print("not in the catalog: " + ", ".join(unknown) + ". See: chewbacca mcp", file=sys.stderr)
        return None
    if not names:
        print("name a server, --group <group> or --all. See: chewbacca mcp", file=sys.stderr)
        return None
    return names


def cmd_add(args):
    servers = load_catalog()
    names = pick(args, servers)
    if names is None:
        return 2
    args.interactive = sys.stdin.isatty() and not args.no_prompt
    have = (claude_servers(), codex_servers(), enabled_plugins())
    results = [add_one(n, servers[n], args, have) for n in names]
    done = sum(results)
    print(f"\n{done} of {len(names)} ready to use. Check them: chewbacca mcp status")
    return 0 if done == len(names) else 1


def cmd_login(args):
    servers = load_catalog()
    plugins = enabled_plugins()
    spec = servers.get(args.name, {})
    server = args.name
    if spec.get("plugin") in plugins:
        server = f"plugin:{spec['plugin']}:{spec['plugin']}"
    return 0 if login(server) else 1


def cmd_remove(args):
    servers = load_catalog()
    for name in args.names:
        spec = servers.get(name, {})
        if spec.get("plugin") in enabled_plugins():
            print(f"  {name}: comes from the {spec['plugin']} plugin, turn it off w claude plugin disable {spec['plugin']}")
            continue
        ok, _ = run([claude_bin() or "claude", "mcp", "remove", name, "--scope", "user"])
        line = f"  {name}: {'removed from Claude' if ok else 'not in Claude'}"
        if codex_bin() and name in codex_servers():
            cok, _ = run([codex_bin(), "mcp", "remove", name])
            line += ", removed from Codex" if cok else ", Codex refused"
        print(line)
    return 0


def parse_status(text):
    """`claude mcp list` lines into {server name: word}."""
    out = {}
    for line in text.splitlines():
        if ": " not in line or " - " not in line:
            continue
        name = line.split(": ", 1)[0].strip()
        tail = line.rsplit(" - ", 1)[1]
        if "Connected" in tail:
            word = "connected"
        elif "authentication" in tail.lower():
            word = "needs sign-in"
        elif "Pending" in tail:
            word = "pending approval"
        else:
            word = "failing"
        out[name] = word
    return out


def cmd_status(args):
    if not claude_bin():
        print("Claude Code is not installed")
        return 1
    print("asking Claude Code (it starts each server, this takes a bit)")
    ok, text = run([claude_bin(), "mcp", "list"])
    live = parse_status(text)
    if not live:
        print("  Claude Code listed nothing" + (f": {text[-300:]}" if text else ""))
        return 1
    servers = load_catalog()
    for server, word in sorted(live.items(), key=lambda kv: (kv[1] == "connected", kv[0])):
        short = server.split(":")[-1] if server.startswith("plugin:") else server
        fix = ""
        if word == "needs sign-in":
            fix = f"  fix: chewbacca mcp login {short if short in servers else server}"
        elif word == "failing":
            fix = "  fix: check the URL or key, or chewbacca mcp remove " + short
        print(f"  {server:<34} {word}{fix}")
    bad = [w for w in live.values() if w != "connected"]
    print(f"\n{len(live) - len(bad)} of {len(live)} connected")
    return 0 if ok else 1


def probe(url):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "chewbacca-verify", "version": "1"}}}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
        # Python's default User-Agent gets a 403 from every Cloudflare-fronted
        # server: 15 of 58 on 2026-11-02, Sentry, Supabase and Exa among them.
        "User-Agent": "chewbacca-mcp-verify/1"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception:
        return 0


def package_exists(command, args):
    pkg = next((a for a in args if not a.startswith("-")), "")
    if command == "npx":
        name = pkg.rsplit("@", 1)[0] if pkg.count("@") > (1 if pkg.startswith("@") else 0) else pkg
        url = f"https://registry.npmjs.org/{name.replace('/', '%2F')}"
    elif command == "uvx":
        url = f"https://pypi.org/pypi/{pkg}/json"
    else:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "chewbacca-mcp-verify/1"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:
        return False


def cmd_verify(args):
    from concurrent.futures import ThreadPoolExecutor
    servers = load_catalog()

    def check(item):
        name, spec = item
        if spec.get("url"):
            code = probe(spec["url"])
            # 401 is the expected answer from a server that wants a sign-in.
            return name, code in (200, 401, 405), f"HTTP {code}"
        if spec.get("command") in ("npx", "uvx"):
            ok = package_exists(spec["command"], spec.get("args", []))
            return name, bool(ok), "package found" if ok else "package missing"
        return name, True, "local"

    with ThreadPoolExecutor(12) as pool:
        results = list(pool.map(check, servers.items()))
    bad = [r for r in results if not r[1]]
    for name, ok, why in results:
        if not ok or args.verbose:
            print(f"  {'ok  ' if ok else 'FAIL'} {name:<17} {why}")
    print(f"{len(results) - len(bad)} of {len(results)} reachable")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="chewbacca mcp", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("list")
    p.add_argument("--group", choices=GROUPS)
    p = sub.add_parser("add")
    p.add_argument("names", nargs="*")
    p.add_argument("--group", choices=GROUPS)
    p.add_argument("--all", action="store_true", help="every server that needs no key")
    p.add_argument("--replace", action="store_true", help="swap out an entry with the same name")
    p.add_argument("--no-login", dest="login", action="store_false", help="add now, sign in later")
    p.add_argument("--no-codex", dest="codex", action="store_false")
    p.add_argument("--no-prompt", action="store_true", help="never ask for a key, skip instead")
    p = sub.add_parser("login")
    p.add_argument("name")
    p = sub.add_parser("remove")
    p.add_argument("names", nargs="+")
    sub.add_parser("status")
    p = sub.add_parser("verify")
    p.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)
    if not args.cmd:
        args = ap.parse_args(["list"] + (argv or []))
    return {"list": cmd_list, "add": cmd_add, "login": cmd_login, "remove": cmd_remove,
            "status": cmd_status, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
