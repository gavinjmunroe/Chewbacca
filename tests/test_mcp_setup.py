#!/usr/bin/env python3
"""chewbacca mcp: the catalog is well formed, and add/remove call each agent's
CLI with the right arguments and never print a key. claude, codex and gh are
fakes that log their argv; HOME is a temp dir. No network."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
TOOL = ROOT / "tools/mcp_setup.py"
sys.path.insert(0, str(ROOT / "tools"))
import mcp_setup  # noqa: E402

fails = []


def no(msg):
    fails.append(msg)
    print("FAIL:", msg)


# The catalog.
servers = mcp_setup.load_catalog()
for name, s in servers.items():
    if s.get("group") not in mcp_setup.GROUPS:
        no(f"{name}: group {s.get('group')!r} is not one of {mcp_setup.GROUPS}")
    if s.get("auth") not in mcp_setup.AUTH_WORDS:
        no(f"{name}: auth {s.get('auth')!r} unknown")
    if not s.get("what") or len(s["what"]) > 70:
        no(f"{name}: 'what' missing or over 70 chars, the list wraps")
    if s.get("transport") in ("http", "sse") and not str(s.get("url", "")).startswith("https://"):
        no(f"{name}: an http server needs an https url")
    if s.get("transport") == "stdio" and not (s.get("command") or s.get("add_with")):
        no(f"{name}: a stdio server needs a command or add_with")
    if s.get("auth") == "key" and not (s.get("env") and s.get("signup")):
        no(f"{name}: a keyed server needs env and a signup link")
    if chr(0x2014) in json.dumps(s, ensure_ascii=False):
        no(f"{name}: em dash in the catalog")

with tempfile.TemporaryDirectory() as t:
    t = Path(t)
    home, bindir, log = t / "home", t / "bin", t / "calls"
    (home / ".claude").mkdir(parents=True)
    bindir.mkdir()
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"linear": {"type": "http", "url": "x"}}}))
    fake = (
        "#!/bin/bash\n"
        'printf "%s %s\\n" "$(basename "$0")" "$*" >> "$FAKE_LOG"\n'
        'if [ "$1 $2" = "plugin list" ]; then printf "  ❯ figma@synced\\n    Status: ✔ loaded\\n"; fi\n'
        'if [ "$1 $2" = "auth token" ]; then echo gho_FAKETOKEN123; fi\n'
    )
    for b in ("claude", "codex", "gh"):
        (bindir / b).write_text(fake)
        (bindir / b).chmod(0o755)
    env = dict(os.environ, HOME=str(home), FAKE_LOG=str(log),
               PATH=f"{bindir}:/usr/bin:/bin", CHEWBACCA_ROOT=str(ROOT))
    env.pop("BRAVE_API_KEY", None)

    def mcp(*args, extra=None):
        log.write_text("")
        e = dict(env, **(extra or {}))
        r = subprocess.run([sys.executable, str(TOOL), *args], env=e, capture_output=True,
                           text=True, stdin=subprocess.DEVNULL, timeout=60)
        calls = [c for c in log.read_text().splitlines() if not c.startswith("claude plugin list")]
        return r, calls

    r, calls = mcp("add", "notion")
    want = f"claude mcp add --transport http notion --scope user -- https://mcp.notion.com/mcp"
    if want not in calls:
        no(f"notion: expected `{want}`, got {calls}")
    if "codex mcp add notion --url https://mcp.notion.com/mcp" not in calls:
        no(f"notion: Codex not added: {calls}")
    if any(c.startswith("claude mcp login") for c in calls):
        no("a login ran with no terminal attached; it would hang on the browser redirect")
    if "chewbacca mcp login notion" not in r.stdout:
        no("no terminal, but the reply did not say how to sign in later")

    r, calls = mcp("add", "linear")
    if any("mcp add" in c for c in calls):
        no(f"linear was already in ~/.claude.json and got re-added: {calls}")

    r, calls = mcp("add", "figma")
    if any("mcp add" in c for c in calls):
        no(f"figma is loaded as a plugin and a second copy was added: {calls}")

    r, calls = mcp("add", "brave-search", "--no-prompt")
    if calls or r.returncode == 0 or "BRAVE_API_KEY" not in r.stdout:
        no(f"brave-search with no key should skip, naming the variable: rc={r.returncode} {r.stdout!r} {calls}")

    r, calls = mcp("add", "brave-search", extra={"BRAVE_API_KEY": "SECRETKEY999"})
    if not any("--env BRAVE_API_KEY=SECRETKEY999" in c for c in calls if c.startswith("claude")):
        no(f"brave-search key was not passed to Claude: {calls}")
    if "SECRETKEY999" in r.stdout + r.stderr:
        no("a key was printed")

    r, calls = mcp("add", "github")
    if not any("--header Authorization: Bearer gho_FAKETOKEN123 -- https://api.githubcopilot.com/mcp/" in c for c in calls):
        no(f"github did not get the gh token as a header: {calls}")
    if any(c.startswith("codex mcp add github") for c in calls):
        no("github's token header was handed to Codex, which stores no headers")
    if "gho_FAKETOKEN123" in r.stdout + r.stderr:
        no("the GitHub token was printed")

    r, calls = mcp("add", "magic", extra={"TWENTY_FIRST_API_KEY": "k1"})
    if not any("--env API_KEY=k1" in c for c in calls if c.startswith("claude")):
        no(f"magic's key should land as API_KEY, the name the server reads: {calls}")

    r, calls = mcp("add", "nonsense")
    if r.returncode != 2:
        no(f"an unknown name should exit 2, got {r.returncode}")

    r, calls = mcp("add", "--group", "design", "--no-login")
    added = [c.split()[5] for c in calls if c.startswith("claude mcp add --transport")]
    if sorted(added) != ["canva", "webflow", "wix"]:
        no(f"--group design should add canva, webflow and wix (figma is the plugin): {added}")

    r, calls = mcp("remove", "notion")
    if "claude mcp remove notion --scope user" not in calls:
        no(f"remove did not reach Claude: {calls}")

parsed = mcp_setup.parse_status(
    "Checking MCP server health…\n\n"
    "plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication\n"
    "git: uvx mcp-server-git - ✔ Connected\n"
    "medha: https://x/mcp (HTTP) - ✘ Failed to connect\n")
if parsed != {"plugin:figma:figma": "needs sign-in", "git": "connected", "medha": "failing"}:
    no(f"parse_status read {parsed}")

# Paste-to-add, the shapes mcp-manager's SmartPasteParser reads.
cases = {
    "https://mcp.notion.com/mcp": ("notion", "http"),
    "https://mcp.asana.com/sse": ("asana", "sse"),
    "npx -y @upstash/context7-mcp": ("context7", "stdio"),
    "uvx mcp-server-git": ("git", "stdio"),
    "npx -y mcp-remote https://mcp.linear.app/sse": ("linear", "sse"),
    "claude mcp add --transport http sentry https://mcp.sentry.dev/mcp": ("sentry", "http"),
    '{"mcpServers":{"fs":{"command":"npx","args":["-y","x"]}}}': ("fs", "stdio"),
}
for text, (want_name, want_transport) in cases.items():
    got = mcp_setup.parse_paste(text)
    if list(got) != [want_name] or got[want_name]["transport"] != want_transport:
        no(f"paste {text!r} read as {got}")
if mcp_setup.parse_paste("notion-ish"):
    no("a single misspelled word should not read as a server command")
env_paste = mcp_setup.parse_paste("claude mcp add brave -e BRAVE_API_KEY=x -- npx -y @brave/brave-search-mcp-server")
if env_paste.get("brave", {}).get("env_values") != {"BRAVE_API_KEY": "x"}:
    no(f"a pasted -e value was dropped: {env_paste}")

print("ok" if not fails else f"{len(fails)} failed")
sys.exit(1 if fails else 0)
