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
  chewbacca mcp add <url | command | JSON>   anything pasted from a README
  chewbacca mcp search <words>      the official MCP registry, live
  chewbacca mcp test <name>         start it, list its tools, say what broke
  chewbacca mcp hub move <name>     run a local server once for every tab
  chewbacca mcp hub undo <name>     put it back the way it was

Paste-to-add, registry search, test, the Cursor and Claude Desktop targets
and the hub are Carlton Aikins's designs, from mcp-manager and realm (MIT).
"""
import argparse
import getpass
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("CHEWBACCA_ROOT") or Path(__file__).resolve().parent.parent)
CATALOG = ROOT / "config/mcp/catalog.json"
HOME = Path.home()
HUB_DIR = Path(os.environ.get("CHEWBACCA_MCP_HUB_DIR") or HOME / ".chewbacca")
HUB_CONFIG = HUB_DIR / "mcp-hub.json"
HUB_PORT = 7338
KEYCHAIN_SERVICE = "chewbacca-mcp"
REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers"
UA = {"User-Agent": "chewbacca-mcp/1"}
# Servers that keep per-conversation state, so one copy shared by every tab
# would hand one tab's browser, REPL or thought chain to another.
UNSHAREABLE = {
    "playwright": "one browser per tab",
    "chrome-devtools": "one browser per tab",
    "browserbase": "one browser session per tab",
    "sequential-thinking": "keeps one chain of thoughts in memory",
    "node_repl": "a REPL whose variables belong to one tab",
    "rea": "has its own proxy already",
    "computer-use": "drives the screen for one tab at a time",
}
# Flags whose next argument is a credential, moved to the Keychain by hub move.
SECRET_FLAGS = {"--access-token", "--token", "--api-key", "--apikey", "--key", "--password", "--secret"}
SECRET_ENV = re.compile(r"(TOKEN|KEY|SECRET|PASSWORD|PAT|CREDENTIAL)", re.I)
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
    if not isinstance(value, str):
        return value
    return value.replace("{root}", str(ROOT)).replace("{home}", str(HOME))


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
    env.update(spec.get("env_values") or {})
    for line in spec.get("headers") or []:
        k, _, v = line.partition(":")
        headers[k.strip()] = v.strip()
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
    return {"claude": claude, "codex": codex, "env": env}, ""


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
    if opts.others:
        for client, (path, takes_url) in json_targets().items():
            if spec["transport"] != "stdio" and not takes_url:
                continue
            result = write_json_target(path, name, json_entry(spec, cmds["env"]), opts.replace)
            if result == "added":
                line += f", {client}"
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
        names = []
        for raw in args.names:
            if raw in servers:
                names.append(raw)
                continue
            parsed = parse_paste(raw, args.as_name)
            for pname, pspec in parsed.items():
                servers[pname] = adhoc_spec(pspec)
                names.append(pname)
            if not parsed:
                names.append(raw)
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


# ---- paste anything (mcp-manager's SmartPasteParser) ------------------------

RUNNERS = {"npx", "uvx", "pipx", "bunx", "pnpx"}


def name_from_host(host):
    parts = [p for p in host.lower().split(".") if p not in ("mcp", "api", "www", "app")]
    return re.sub(r"[^a-z0-9-]", "-", parts[0]) if parts else "server"


def name_from_package(pkg):
    pkg = pkg.split("@")[1] if pkg.startswith("@") and pkg.count("@") > 1 else pkg
    base = pkg.rsplit("@", 1)[0] if not pkg.startswith("@") else pkg
    base = base.split("/")[-1]
    for cut in ("mcp-server-", "server-", "-mcp-server", "-mcp", "mcp-"):
        base = base.replace(cut, "")
    return re.sub(r"[^a-z0-9-]", "-", base.lower()).strip("-") or "server"


def transport_of(url):
    # mcp-manager: the path is the only signal, and /sse is where servers
    # still on the legacy transport put it, by every SDK's convention.
    return "sse" if urllib.parse.urlparse(url).path.rstrip("/").endswith("/sse") else "http"


def from_command(tokens, env=None, name=None):
    command, args = tokens[0], tokens[1:]
    if os.path.basename(command) in RUNNERS and any(a.split("@")[0] == "mcp-remote" for a in args):
        url = next((a for a in args if a.startswith("https://")), None)
        if url:
            return {name or name_from_host(urllib.parse.urlparse(url).hostname or ""):
                    {"transport": transport_of(url), "url": url}}
    pkg = next((a for a in args if not a.startswith("-")), command)
    spec = {"transport": "stdio", "command": command, "args": args}
    if env:
        spec["env_values"] = env
    return {name or name_from_package(pkg if os.path.basename(command) in RUNNERS else os.path.basename(command)): spec}


def from_json_entry(name, entry):
    if entry.get("url"):
        t = entry.get("type") or entry.get("transport") or transport_of(entry["url"])
        return {"transport": "sse" if t == "sse" else "http", "url": entry["url"]}
    spec = {"transport": "stdio", "command": entry.get("command", ""), "args": entry.get("args", [])}
    if entry.get("env"):
        spec["env_values"] = entry["env"]
    return spec


def parse_paste(text, name=None):
    """A URL, a command line, a `claude mcp add` line or README JSON, as
    {name: spec}. Empty when it's none of those."""
    text = text.strip()
    if not text:
        return {}
    if text[0] in "{[":
        try:
            data = json.loads(text)
        except ValueError:
            return {}
        if isinstance(data, dict) and "mcpServers" in data:
            data = data["mcpServers"]
        if isinstance(data, dict) and ("command" in data or "url" in data):
            data = {name or "server": data}
        if isinstance(data, dict):
            return {k: from_json_entry(k, v) for k, v in data.items() if isinstance(v, dict)}
        return {}
    if re.match(r"^https?://", text):
        host = urllib.parse.urlparse(text).hostname or ""
        return {name or name_from_host(host): {"transport": transport_of(text), "url": text}}
    try:
        tokens = shlex.split(text)
    except ValueError:
        return {}
    if tokens[:3] == ["claude", "mcp", "add"]:
        rest, env, transport, headers, scope_name = tokens[3:], {}, None, [], None
        positional = []
        i = 0
        while i < len(rest):
            t = rest[i]
            if t == "--":
                positional += rest[i + 1:]
                break
            if t in ("-t", "--transport"):
                transport = rest[i + 1]; i += 2; continue
            if t in ("-e", "--env"):
                k, _, v = rest[i + 1].partition("="); env[k] = v; i += 2; continue
            if t in ("-H", "--header"):
                headers.append(rest[i + 1]); i += 2; continue
            if t in ("-s", "--scope"):
                i += 2; continue
            positional.append(t); i += 1
        if not positional:
            return {}
        scope_name, target = positional[0], positional[1:]
        if target and re.match(r"^https?://", target[0]):
            spec = {"transport": transport or transport_of(target[0]), "url": target[0]}
            if headers:
                spec["headers"] = headers
            return {name or scope_name: spec}
        return from_command(target, env, name or scope_name) if target else {}
    # A single bare word is a misspelled catalog name far more often than a
    # server binary, so only a real command line counts.
    if len(tokens) < 2 and "/" not in tokens[0]:
        return {}
    return from_command(tokens, None, name)


def adhoc_spec(raw):
    """A parsed paste as a catalog-shaped spec add_one can run."""
    spec = dict(raw)
    spec.setdefault("group", "pasted")
    spec.setdefault("what", "added from a paste")
    if spec["transport"] in ("http", "sse"):
        code = probe(spec["url"])
        spec["auth"] = "oauth" if code == 401 else "none"
    else:
        spec["auth"] = "none"
    return spec


# ---- the official registry (mcp-manager's live catalog search) ---------------

def registry_search(query, limit=15):
    url = f"{REGISTRY}?search={urllib.parse.quote(query)}&limit=100"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    seen, out = set(), []
    for row in data.get("servers", []):
        server = row.get("server", {})
        meta = (row.get("_meta") or {}).get("io.modelcontextprotocol.registry/official", {})
        name = server.get("name", "")
        if name in seen or meta.get("status", "active") != "active":
            continue
        seen.add(name)
        remote = next((r.get("url") for r in server.get("remotes", []) if r.get("url")), "")
        pkg = next((f"{p.get('registryType')}:{p.get('identifier')}" for p in server.get("packages", [])), "")
        out.append({"name": name, "description": server.get("description", ""), "url": remote, "package": pkg})
        if len(out) >= limit:
            break
    return out


def cmd_search(args):
    query = " ".join(args.words)
    servers = load_catalog()
    local = [n for n, s in servers.items() if query.lower() in (n + " " + s["what"]).lower()]
    if local:
        print("In the catalog (one command each):")
        for n in local:
            print(f"  {n:<17} {servers[n]['what']}")
    try:
        found = registry_search(query)
    except Exception as err:
        print(f"the registry didn't answer: {err}")
        return 1 if not local else 0
    if found:
        print("\nIn the official MCP registry:")
        for f in found:
            how = f["url"] or f["package"] or "see its repo"
            print(f"  {f['name']}\n      {f['description'][:90]}\n      {how}")
        print("\nAdd one by pasting its URL or command:  chewbacca mcp add <url>")
    elif not local:
        print(f"nothing for {query!r} in the catalog or the registry")
    return 0


# ---- test (mcp-manager's "test before you trust it", realm's live check) ------

def stdio_tools(command, args, env=None, timeout=45):
    """Start a stdio server, initialize, list tools, stop it. Returns
    (tool names, error)."""
    try:
        p = subprocess.Popen([command] + list(args), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, env=dict(os.environ, **(env or {})),
                             start_new_session=True)
    except OSError as err:
        return None, str(err)
    msgs = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "chewbacca-mcp-test", "version": "1"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    ]
    deadline = time.time() + timeout
    try:
        for m in msgs:
            p.stdin.write(json.dumps(m) + "\n")
        p.stdin.flush()
        while time.time() < deadline:
            line = p.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") == 2:
                if msg.get("error"):
                    return None, msg["error"].get("message", "tools/list failed")
                return [t.get("name") for t in msg.get("result", {}).get("tools", [])], ""
        err = p.stderr.read(400) if p.poll() is not None else "no answer in time"
        return None, (err or "it exited without answering").strip()
    finally:
        try:
            os.killpg(p.pid, 15)
        except OSError:
            pass


def cmd_test(args):
    servers = load_catalog()
    entries = claude_entries()
    target = entries.get(args.name)
    spec = servers.get(args.name)
    if target is None and spec is None:
        parsed = parse_paste(args.name)
        if not parsed:
            print(f"{args.name} is neither added here, in the catalog, nor a URL or command")
            return 2
        name, raw = next(iter(parsed.items()))
        target = {"type": raw["transport"], "url": raw.get("url"), "command": raw.get("command"), "args": raw.get("args", [])}
    elif target is None:
        target = {"type": spec["transport"], "url": spec.get("url"),
                  "command": fill(spec.get("command", "")), "args": [fill(a) for a in spec.get("args", [])]}
    if target.get("url"):
        code = probe(target["url"])
        if code == 200:
            print(f"  {args.name}: answers, no sign-in needed")
        elif code == 401:
            print(f"  {args.name}: answers and wants a sign-in, which is normal: chewbacca mcp login {args.name}")
        else:
            print(f"  {args.name}: HTTP {code or 'no answer'} from {target['url']}")
            return 1
        return 0
    env = {k: v for k, v in (target.get("env") or {}).items() if not str(v).startswith("keychain:")}
    tools, err = stdio_tools(target["command"], target.get("args", []), env)
    if tools is None:
        print(f"  {args.name}: FAILED, {err[:300]}")
        return 1
    print(f"  {args.name}: works, {len(tools)} tools: {', '.join(tools[:12])}{' ...' if len(tools) > 12 else ''}")
    return 0


# ---- Cursor and Claude Desktop (mcp-manager's other two clients) ------------

def json_targets():
    """Clients that read an mcpServers JSON file, only where that file exists:
    a client nobody opened gets no config written for it."""
    out = {}
    cursor = HOME / ".cursor/mcp.json"
    desktop = HOME / "Library/Application Support/Claude/claude_desktop_config.json"
    if cursor.exists():
        out["Cursor"] = (cursor, True)
    if desktop.exists():
        out["Claude Desktop"] = (desktop, False)   # its file takes stdio only
    return out


def write_json_target(path, name, entry, replace):
    """Touch only mcpServers, back the file up first, write atomically: the
    rule mcp-manager's daemon follows for every client file."""
    try:
        data = json.loads(path.read_text() or "{}")
    except (OSError, ValueError):
        return "unreadable, left alone"
    servers = data.setdefault("mcpServers", {})
    if name in servers and not replace:
        return "already had it"
    backup = HUB_DIR / "backups" / path.parent.name
    backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup / f"{path.name}.{int(time.time())}")
    servers[name] = entry
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)
    return "added"


def json_entry(spec, env):
    if spec["transport"] in ("http", "sse"):
        return {"url": spec["url"]}
    entry = {"command": fill(spec["command"]), "args": [fill(a) for a in spec.get("args", [])]}
    if env:
        entry["env"] = env
    return entry


# ---- the hub (realm's McpHub, mcp-manager's gateway) -------------------------

def hub_config():
    try:
        return json.loads(HUB_CONFIG.read_text())
    except (OSError, ValueError):
        return {"port": HUB_PORT, "servers": {}, "originals": {}}


def save_hub_config(cfg):
    HUB_DIR.mkdir(parents=True, exist_ok=True)
    tmp = HUB_CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, HUB_CONFIG)


def hub_token():
    path = HUB_DIR / "mcp-hub.token"
    try:
        return path.read_text().strip()
    except OSError:
        import secrets
        HUB_DIR.mkdir(parents=True, exist_ok=True)
        t = secrets.token_hex(24)
        path.write_text(t + "\n")
        os.chmod(path, 0o600)
        return t


def keychain_put(account, value):
    if os.environ.get("MCP_HUB_FAKE_KEYCHAIN"):
        f = Path(os.environ["MCP_HUB_FAKE_KEYCHAIN"])
        data = json.loads(f.read_text()) if f.exists() else {}
        data[account] = value
        f.write_text(json.dumps(data))
        return True
    r = subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
                        "-a", account, "-w", value], capture_output=True)
    return r.returncode == 0


def keychain_get(account):
    if os.environ.get("MCP_HUB_FAKE_KEYCHAIN"):
        f = Path(os.environ["MCP_HUB_FAKE_KEYCHAIN"])
        return (json.loads(f.read_text()) if f.exists() else {}).get(account, "")
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def unseal(value):
    if isinstance(value, str) and value.startswith("keychain:"):
        return keychain_get(value[9:])
    return value


def sealed_original(entry, spec):
    """The entry undo puts back, with each secret as its Keychain reference:
    keeping the plaintext here for undo would just move the leak."""
    original = json.loads(json.dumps(entry))
    original["env"] = {k: spec["env"].get(k, v) for k, v in (entry.get("env") or {}).items()}
    original["args"] = spec["args"]
    return original


def to_hub_spec(name, entry):
    """A Claude stdio entry as a hub entry, credentials moved to the Keychain.
    Returns (spec, number of secrets moved) or (None, why)."""
    if entry.get("type") not in (None, "stdio") or not entry.get("command"):
        return None, "only local (stdio) servers go in the hub; a hosted one already runs once"
    moved = 0
    env = {}
    for k, v in (entry.get("env") or {}).items():
        if v and SECRET_ENV.search(k):
            if not keychain_put(f"{name}.{k}", v):
                return None, f"couldn't save {k} to the Keychain"
            env[k] = f"keychain:{name}.{k}"
            moved += 1
        else:
            env[k] = v
    args = list(entry.get("args") or [])
    for i, a in enumerate(args[:-1]):
        flag = a.split("=")[0]
        if flag in SECRET_FLAGS and not args[i + 1].startswith("keychain:"):
            account = f"{name}.{flag.lstrip('-')}"
            if not keychain_put(account, args[i + 1]):
                return None, f"couldn't save {flag} to the Keychain"
            args[i + 1] = f"keychain:{account}"
            moved += 1
    return {"command": entry["command"], "args": args, "env": env}, moved


def cmd_hub(args):
    if args.action == "status":
        return subprocess.run(["node", str(ROOT / "bin/mcp-hub"), "status"]).returncode
    if args.action == "start":
        daemon = ROOT / "bin/chewbacca-daemon"
        port = hub_config().get("port", HUB_PORT)
        node = shutil.which("node") or "node"
        r = subprocess.run([node, str(daemon), "register", "mcp-hub", "--keepalive", "--listen", str(port),
                            "--health-http", "/health", "--", node, str(ROOT / "bin/mcp-hub"), "serve"],
                           capture_output=True, text=True)
        print((r.stdout + r.stderr).strip() or "registered mcp-hub")
        return r.returncode
    if args.action == "stop":
        r = subprocess.run(["node", str(ROOT / "bin/chewbacca-daemon"), "unregister", "mcp-hub"],
                           capture_output=True, text=True)
        print((r.stdout + r.stderr).strip())
        return r.returncode
    if not args.names:
        print("name the servers: chewbacca mcp hub move git fetch time", file=sys.stderr)
        return 2
    cfg = hub_config()
    cfg.setdefault("servers", {})
    cfg.setdefault("originals", {})
    entries = claude_entries()
    claude = claude_bin() or "claude"
    port = cfg.get("port", HUB_PORT)
    bad = 0
    for name in args.names:
        if args.action == "undo":
            original = cfg["originals"].get(name)
            if original is None:
                print(f"  {name}: not moved by the hub, left alone")
                continue
            original = dict(original, args=[unseal(a) for a in original.get("args", [])],
                            env={k: unseal(v) for k, v in (original.get("env") or {}).items()})
            run([claude, "mcp", "remove", name, "--scope", "user"])
            ok, out = run([claude, "mcp", "add-json", name, json.dumps(original), "--scope", "user"])
            if not ok:
                print(f"  {name}: FAILED to restore: {out[-200:]}")
                bad += 1
                continue
            cfg["servers"].pop(name, None)
            cfg["originals"].pop(name, None)
            save_hub_config(cfg)
            print(f"  {name}: back to its own process in every tab")
            continue
        if name in UNSHAREABLE:
            print(f"  {name}: stays per tab, {UNSHAREABLE[name]}")
            continue
        entry = entries.get(name)
        if entry is None:
            print(f"  {name}: not in Claude's config")
            bad += 1
            continue
        if entry.get("url", "").startswith(f"http://127.0.0.1:{port}/s/"):
            print(f"  {name}: already in the hub")
            continue
        spec, moved = to_hub_spec(name, entry)
        if spec is None:
            print(f"  {name}: {moved}")
            bad += 1
            continue
        cfg["servers"][name] = spec
        cfg["originals"][name] = sealed_original(entry, spec)
        save_hub_config(cfg)
        url = f"http://127.0.0.1:{port}/s/{name}/mcp"
        run([claude, "mcp", "remove", name, "--scope", "user"])
        ok, out = run([claude, "mcp", "add", "--transport", "http", name, "--scope", "user",
                       "--header", f"Authorization: Bearer {hub_token()}", "--", url])
        if not ok:
            run([claude, "mcp", "add-json", name, json.dumps(entry), "--scope", "user"])
            cfg["servers"].pop(name, None)
            cfg["originals"].pop(name, None)
            save_hub_config(cfg)
            print(f"  {name}: FAILED, put back as it was: {out[-200:]}")
            bad += 1
            continue
        extra = f", {moved} secret{'s' if moved != 1 else ''} moved to the Keychain" if moved else ""
        print(f"  {name}: one shared copy now{extra}")
    if args.action == "move":
        print("\nNew tabs use the hub. Make sure it's running: chewbacca mcp hub start")
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
    p.add_argument("--no-others", dest="others", action="store_false", help="skip Cursor and Claude Desktop")
    p.add_argument("--as", dest="as_name", help="the name for a pasted server")
    p = sub.add_parser("search")
    p.add_argument("words", nargs="+")
    p = sub.add_parser("test")
    p.add_argument("name")
    p = sub.add_parser("hub")
    p.add_argument("action", choices=["move", "undo", "start", "stop", "status"])
    p.add_argument("names", nargs="*")
    p = sub.add_parser("login")
    p.add_argument("name")
    p = sub.add_parser("remove")
    p.add_argument("names", nargs="+")
    sub.add_parser("status")
    p = sub.add_parser("verify")
    p.add_argument("--verbose", action="store_true")
    argv = list(sys.argv[1:] if argv is None else argv)
    # `chewbacca mcp add npx -y some-mcp` unquoted: everything after add is
    # one pasted command, not flags for this tool.
    if len(argv) > 2 and argv[0] == "add" and (os.path.basename(argv[1]) in RUNNERS or argv[1] == "claude"
                                                or argv[1] in ("node", "python3", "docker", "uv")):
        argv = ["add", shlex.join(argv[1:])]
    args = ap.parse_args(argv)
    if not args.cmd:
        args = ap.parse_args(["list"] + (argv or []))
    return {"list": cmd_list, "add": cmd_add, "login": cmd_login, "remove": cmd_remove,
            "status": cmd_status, "verify": cmd_verify, "search": cmd_search, "test": cmd_test,
            "hub": cmd_hub}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
