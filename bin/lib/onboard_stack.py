"""What was built on 2026-10-10, made one tap each for a new person.

    stack(env)            every piece, its state and the one line to say: reads only
    connect(id, env, yes) does that one piece

The pieces: Google (gogcli), Granola's past meetings, meeting recording, the
agent engine (realm), the HUD's agents and meetings panels, and the kit's MCP
server inside the person's own Claude, Cursor, Codex and ChatGPT.

Caleb's ask, 2026-10-11 1:13am: "each piece one tap or approval, permission
panes opened for them, no terminal, no config files". So `connect` never asks
the person to type anything: it runs the tool, opens the browser page or the
Settings pane itself, and comes back with one plain line.

Two lines this file holds:

- `stack` writes nothing (review-discipline: scanning must not write). It
  reads files and runs only status commands.
- Anything that opens a window, a browser, a Settings pane, or runs for
  minutes goes through `spawn`, the one place it happens. Tests set
  CHEWBACCA_ONBOARD_SPAWN to a recorder, so a scratch-HOME run proves every
  step end to end and nothing real ever opens.

Recording is the one step that needs `yes`: it records other people, so it
ships OFF (team/memory/feedback_recording_off_until_reviews_pass.md) and only
a person's explicit approval turns it on.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "bin"

# A status command that takes longer than this is treated as unknown rather
# than holding the welcome. Guessed, never measured; `realm-engine status`
# answered in 0.3 s on Caleb's Mac 2026-10-11.
STATUS_TIMEOUT_S = 20

GOG_SERVICES = "gmail,calendar,drive,docs,sheets,contacts"
GOOGLE_CONSOLE = "https://console.cloud.google.com/apis/credentials"

ORDER = ["mcp", "google", "granola", "engine", "hud", "recording"]


def home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def apps_dirs() -> list[Path]:
    dirs = [Path(d) for d in (os.environ.get("CHEWBACCA_APPS_DIR") or "/Applications").split(":") if d]
    return dirs + [home() / "Applications"]


def has_app(name: str) -> bool:
    return any((d / name).exists() for d in apps_dirs())


def tool(name: str) -> str:
    """A kit tool from this checkout, so a scratch HOME tests this tree."""
    return str(BIN / name)


def gog() -> str | None:
    return os.environ.get("CHEWBACCA_GOG") or shutil.which("gog") or (
        "/opt/homebrew/bin/gog" if Path("/opt/homebrew/bin/gog").exists() else None)


def run(argv: list[str]) -> tuple[int, str]:
    """A short, local, read-or-flag command. Never one that opens anything."""
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=STATUS_TIMEOUT_S,
                              stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as err:
        return 127, str(err)
    return done.returncode, done.stdout


def py(name: str, *args: str) -> list[str]:
    return [sys.executable, tool(name), *args]


def as_json(text: str) -> dict:
    try:
        got = json.loads(text)
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def spawn(argv: list[str], name: str) -> str:
    """Start something that opens a window or runs long, detached, logged to
    ~/.chewbacca/logs/onboard-<name>.log. Returns what was started, in words."""
    recorder = os.environ.get("CHEWBACCA_ONBOARD_SPAWN")
    logs = home() / ".chewbacca" / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / f"onboard-{name}.log"
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        subprocess.Popen(([recorder, name] if recorder else []) + argv, stdin=subprocess.DEVNULL,
                         stdout=fd, stderr=fd, start_new_session=True)
    finally:
        os.close(fd)
    return name


def open_url(url: str, name: str) -> str:
    return spawn(["/usr/bin/open", url], name)


def permissions_guide(only: list[str], name: str) -> str:
    return spawn(py("chewbacca-permissions", "guide", "--only", ",".join(only)), name)


# ── each piece: status (reads only) ─────────────────────────────────────────


def step(id_: str, label: str, state: str, say: str, tap: str = "", **extra) -> dict:
    """state: done | ready | blocked | absent (the app it needs is not on this Mac)."""
    return {"id": id_, "label": label, "state": state, "say": say, "tap": tap, **extra}


def mcp_hosts() -> dict:
    """Which apps have the kit's MCP server, read from their configs."""
    h = home()
    claude_dir = h / "Library" / "Application Support" / "Claude"
    hosts = {}
    for label, path, present in (
            ("Claude", claude_dir / "claude_desktop_config.json", has_app("Claude.app") or claude_dir.exists()),
            ("Claude Code", h / ".claude.json", (h / ".claude.json").exists()),
            ("Cursor", h / ".cursor" / "mcp.json", has_app("Cursor.app") or (h / ".cursor").exists())):
        if not present:
            continue
        try:
            servers = json.loads(path.read_text()).get("mcpServers") or {}
        except (OSError, ValueError, AttributeError):
            servers = {}
        hosts[label] = "chewbacca" in servers
    if (h / ".codex").exists() or has_app("Codex.app") or has_app("ChatGPT.app"):
        try:
            hosts["Codex"] = "[mcp_servers.chewbacca]" in (h / ".codex" / "config.toml").read_text()
        except OSError:
            hosts["Codex"] = False
    return hosts


def status_mcp() -> dict:
    hosts = mcp_hosts()
    label = "Chewbacca inside your Claude, Cursor, Codex and ChatGPT"
    chatgpt = has_app("ChatGPT.app")
    if not hosts:
        return step("mcp", label, "absent", "None of Claude, Cursor, Codex or ChatGPT is on this Mac yet.")
    missing = [k for k, v in hosts.items() if not v]
    if not missing:
        return step("mcp", label, "done", f"Already in {', '.join(hosts)}.", hosts=hosts)
    return step("mcp", label, "ready",
                f"I can put your people, deadlines and notes inside {', '.join(missing)}, so you can ask "
                "about them there too. Nothing to paste; restart the app after."
                + (" ChatGPT's own chat can't reach your Mac, so it gets them through Codex." if chatgpt else ""),
                "Add Chewbacca to my apps", hosts=hosts)


def status_google() -> dict:
    label = "Google: Gmail, Calendar, Drive, Docs and Sheets"
    exe = gog()
    if not exe:
        return step("google", label, "ready", "I'll install the Google connector first, about a minute.",
                    "Connect my Google account", tool_missing=True)
    _, out = run([exe, "auth", "list", "--json"])
    accounts = [a.get("email") or a.get("account") for a in as_json(out).get("accounts") or [] if isinstance(a, dict)]
    if accounts:
        return step("google", label, "done", f"Connected as {', '.join(a for a in accounts if a)}.")
    if not google_client(exe):
        return step("google", label, "blocked",
                    "Google needs a sign-in app before anyone can connect, and this Mac doesn't have one yet. "
                    "I'll open the Google Cloud page where it's made.", "Open the Google page",
                    blocked="no Google OAuth client on this Mac")
    return step("google", label, "ready",
                "A Google page opens. Pick your account and click Allow, and I can read your mail, "
                "calendar and docs.", "Connect my Google account")


def google_client(exe: str) -> str | None:
    """A Desktop OAuth client gog can use: gog's own, else gws's client_secret
    (the kit's other Google path), else one shipped in config/data/google/."""
    _, out = run([exe, "auth", "credentials", "list", "--json"])
    if as_json(out).get("clients"):
        return "gog"
    for path in [home() / ".config" / "gws" / "client_secret.json",
                 *sorted((home() / ".chewbacca" / "email").glob("*/client_secret.json")),
                 ROOT / "config" / "data" / "google" / "oauth-client.json"]:
        if path.is_file():
            return str(path)
    return None


def status_granola() -> dict:
    label = "Granola: your past meeting notes"
    if not has_app("Granola.app"):
        return step("granola", label, "absent", "Granola isn't on this Mac.")
    # granola-import's own files, read here: its `status` creates its folder,
    # and stack writes nothing.
    folder = home() / ".chewbacca" / "granola"
    def read(name):
        try:
            return json.loads((folder / name).read_text())
        except (OSError, ValueError):
            return None
    if (read("token.json") or {}).get("access_token"):
        return step("granola", label, "done", f"Connected. {len(read('imported.json') or {})} meetings brought in.")
    if (read("pending.json") or {}).get("url"):
        return step("granola", label, "ready", "Granola's page is open and waiting for you to click Allow.",
                    "Open it again", waiting=True)
    return step("granola", label, "ready",
                "A Granola page opens. Click Allow and I'll bring every past meeting in, read only.",
                "Bring in my Granola meetings")


def status_engine() -> dict:
    label = "The agent engine (Claude, Codex and Cursor agents with no window)"
    _, out = run(py("realm-engine", "status", "--json"))
    body = as_json(out)
    agent = (Path(os.environ.get("CHEWBACCA_LAUNCH_AGENTS_DIR") or home() / "Library" / "LaunchAgents")
             / "com.chewbacca.realm.plist")
    if body.get("running") and agent.exists():
        return step("engine", label, "done", "Running, and it starts by itself when you log in.")
    if body.get("built"):
        return step("engine", label, "ready", "It's built. One tap starts it now and at every login.",
                    "Start the agent engine")
    node = os.environ.get("CHEWBACCA_NODE") or shutil.which("node")
    if not node:
        return step("engine", label, "blocked", "It needs Node, which setup installs. Run setup again first.",
                    blocked="node missing")
    return step("engine", label, "ready",
                "It downloads and builds once, a few minutes in the background, then starts at every login.",
                "Set up the agent engine")


def kyber_installed() -> bool:
    return has_app("Kyber.app")


def status_hud() -> dict:
    label = "The agents and meetings panels on your screen"
    if not kyber_installed():
        return step("hud", label, "blocked", "The display app isn't installed yet; setup builds it.",
                    blocked="Kyber.app missing")
    _, out = run(py("realm-engine", "status", "--json"))
    engine = as_json(out).get("running")
    return step("hud", label, "done" if engine else "ready",
                "Say \"show my agents\" or \"show my meetings\" and they open."
                + ("" if engine else " The agents panel fills in once the agent engine is running."),
                "" if engine else "Set up the agent engine")


def status_recording() -> dict:
    label = "Record my meetings on their own"
    # The flags themselves: meeting-autopilot's `status` creates its folder.
    flags = home() / ".chewbacca" / "meeting-autopilot"
    on = (flags / "on").exists() and not (flags / "off").exists()
    if on:
        return step("recording", label, "done",
                    "On. A work call (Zoom, Meet, Teams) starts a recording and its end stops it.")
    return step("recording", label, "ready",
                "Off until you turn it on. When a work call app like Zoom uses your mic, I'd record your side "
                "and theirs, transcribe it on this Mac, and pull out the to-dos. Tell everyone on the call: "
                "in California everyone has to agree to be recorded.",
                "Turn on recording", needs_yes=True)


STATUS = {"mcp": status_mcp, "google": status_google, "granola": status_granola,
          "engine": status_engine, "hud": status_hud, "recording": status_recording}


def stack() -> dict:
    steps = [STATUS[k]() for k in ORDER]
    todo = [s["id"] for s in steps if s["state"] in ("ready", "blocked")]
    return {"steps": steps, "next": todo[0] if todo else None}


# ── each piece: connect (does it) ───────────────────────────────────────────


def result(id_: str, ok: bool, say: str, started=(), blocked: str = "", **extra) -> dict:
    return {"id": id_, "ok": ok, "say": say, "started": list(started), "blocked": blocked or None, **extra}


def connect_mcp(yes: bool) -> dict:
    code, out = run([tool("chewbacca-mcp"), "--register", "--json"])
    body = as_json(out)
    if code or not body:
        return result("mcp", False, "I couldn't add it to your apps; nothing was changed.", detail=out[-300:])
    hosts = body.get("hosts") or []
    added = [h["host"] for h in hosts if h.get("state") in ("registered", "already")]
    said = f"Added to {', '.join(added)}. Quit and reopen them and Chewbacca is there." if added else \
        "None of Claude, Cursor or Codex is on this Mac yet."
    if any(h.get("state") == "not-possible" for h in hosts):
        said += " ChatGPT's own chat can't reach a Mac, so ask it through Codex in the ChatGPT app."
    return result("mcp", bool(added), said, hosts=hosts)


def connect_google(yes: bool) -> dict:
    exe = gog()
    if not exe:
        if not shutil.which("brew"):
            return result("google", False, "", blocked="Homebrew is missing, which setup installs first.")
        return result("google", True, "Installing the Google connector; tap Connect again in a minute.",
                      [spawn(["brew", "install", "gogcli"], "google-install")])
    client = google_client(exe)
    if not client:
        return result("google", False, "I opened the Google Cloud page. Create a Desktop app sign-in there, "
                      "download it, and I'll take it from Downloads.",
                      [open_url(GOOGLE_CONSOLE, "google-console")],
                      blocked="Google needs an OAuth client, made once in Google Cloud by its owner")
    if client != "gog":
        code, out = run([exe, "auth", "credentials", "set", client])
        if code:
            return result("google", False, "Google's sign-in app on this Mac didn't load; nothing was changed.",
                          detail=out[-300:])
    return result("google", True, "A Google page is opening. Pick your account and click Allow.",
                  [spawn([exe, "auth", "manage", "--services", GOG_SERVICES], "google-signin")])


def connect_granola(yes: bool) -> dict:
    if not has_app("Granola.app"):
        return result("granola", False, "Granola isn't on this Mac.")
    return result("granola", True, "Granola's page is opening. Click Allow, and your meetings come in "
                  "on their own after that.",
                  [spawn(py("granola-import", "connect", "--open"), "granola")])


def connect_engine(yes: bool) -> dict:
    _, out = run(py("realm-engine", "status", "--json"))
    if as_json(out).get("built"):
        code, text = run(py("realm-engine", "install"))
        if code:
            return result("engine", False, "The agent engine didn't start.", detail=text[-300:])
        return result("engine", True, "The agent engine is running, and starts by itself at every login.")
    engine = tool("realm-engine")
    return result("engine", True, "Building the agent engine in the background, a few minutes. It starts "
                  "by itself when it's done.",
                  [spawn(["/bin/sh", "-c", f'"{sys.executable}" "{engine}" build && '
                                            f'"{sys.executable}" "{engine}" install'], "engine")])


def connect_hud(yes: bool) -> dict:
    if not kyber_installed():
        return result("hud", False, "", blocked="The display app isn't installed; setup builds it.")
    _, out = run(py("realm-engine", "status", "--json"))
    if not as_json(out).get("running"):
        return connect_engine(yes) | {"id": "hud"}
    return result("hud", True, "Say \"show my agents\" or \"show my meetings\".")


def connect_recording(yes: bool) -> dict:
    if not yes:
        return result("recording", False, "", blocked="Recording records other people, so it turns on only "
                      "when the person says yes; pass --yes after they do")
    code, out = run(py("meeting-autopilot", "on"))
    if code:
        return result("recording", False, "Recording didn't turn on.", detail=out[-300:])
    started = []
    # Kyber starts the watcher and holds the grants (bin/meeting-autopilot's
    # own note), so the panes are Kyber's. Only the ones still missing.
    _, plan = run(py("chewbacca-permissions", "plan"))
    missing = [m.split(".", 1)[1] for m in as_json(plan).get("missing") or []
               if m in ("kyber.screen-recording-and-system-audio", "kyber.microphone")]
    if missing:
        started.append(permissions_guide(missing, "recording-permissions"))
    said = "On. A work call now records on its own, and its end stops it."
    if missing:
        said += " Your Mac needs to allow it once: the Settings screen is open with a card showing where to click."
    if not kyber_installed():
        said += " It starts once the display app is installed."
    return result("recording", True, said, started, permissions=missing)


CONNECT = {"mcp": connect_mcp, "google": connect_google, "granola": connect_granola,
           "engine": connect_engine, "hud": connect_hud, "recording": connect_recording}


def connect(id_: str, yes: bool = False) -> dict:
    if id_ not in CONNECT:
        raise SystemExit(f"welcome: no step {id_!r}; one of {', '.join(ORDER)}")
    return CONNECT[id_](yes)
