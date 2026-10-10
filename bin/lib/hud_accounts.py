"""Which runtime, account and model answer the HUD, and the card that picks them.

The HUD answers through one of four command-line agents: Claude Code (one or
more subscriptions, one config directory each), Codex, Gemini and Ollama. This
module is the one place that knows them by name, remembers what Caleb picked,
remembers which of them ran out and until when, and draws the `accounts` card
on the glass. hud-listen and bin/hud-accounts (the menu bar's door) both read
and write the same store, `~/.bob/hud-accounts.json`.

Why it exists: on 2026-10-09 at 18:10 "Capital of Australia" was answered
with "You've hit your weekly limit · resets 9am (America/Los_Angeles)". Only
`~/.claude` was configured, so the listener's account failover had nowhere to
go and the notice went to the pill with nothing to press.

What it never does: read, print or copy a token. An account is named by the
`oauthAccount.emailAddress` in its own `.claude.json`; a runtime's signed-in
state comes from its own status command or the presence of a file, never its
contents beyond an email.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

RUNTIMES = ("claude", "codex", "gemini", "ollama")
RUNTIME_NAMES = {"claude": "Claude Code", "codex": "Codex", "gemini": "Gemini", "ollama": "Ollama"}
SURFACE = "accounts"
BIN = Path(__file__).resolve().parents[1]

# The aliases `claude --help` names ("Provide an alias for the latest model
# (e.g. 'fable', 'opus', or 'sonnet')"), plus haiku, which the same CLI takes.
CLAUDE_MODELS = (("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku"), ("fable", "Fable"))

LIMIT_RE = re.compile(
    r"hit your (?:weekly |session |daily |usage )?limit|usage limit reached", re.IGNORECASE)
RESET_RE = re.compile(
    r"resets\s+(?:(?P<mon>[A-Z][a-z]{2})\w*\s+(?P<day>\d{1,2})\s+at\s+)?"
    r"(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>am|pm)"
    r"(?:\s*\((?P<tz>[A-Za-z_]+/[A-Za-z_/]+)\))?", re.IGNORECASE)
# A limit line with no reset time in it. Guessed, never measured: every
# notice seen so far (9/22, 10/9) carried one. An hour means a wrong guess
# costs one more failover, not a day without the account.
UNKNOWN_RESET_S = 3600
# `codex login status` and `ollama list` are a process each; the card is
# drawn on a spoken request and the failover runs under one, so a minute of
# reuse keeps both inside a second. Guessed, never measured.
STATUS_TTL_S = 60.0
STATUS_TIMEOUT_S = 5.0
# How long an Add account waits for the new directory to be signed in.
# Ten minutes: a browser sign-in with a password manager takes one or two.
SIGNIN_WAIT_S = 600.0
# Ollama lists embedding models beside chat models; these cannot answer.
EMBED_RE = re.compile(r"embed|minilm|bge-|nomic", re.IGNORECASE)


# --- where things live ------------------------------------------------------

def home() -> Path:
    return Path(os.environ.get("HOME") or str(Path.home()))


def default_config() -> Path:
    return home() / ".claude"


def store_path() -> Path:
    override = os.environ.get("HUD_ACCOUNTS_STORE")
    return Path(override) if override else home() / ".bob" / "hud-accounts.json"


def load() -> dict:
    try:
        data = json.loads(store_path().read_text())
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    for key in ("pick", "models", "limits"):
        if not isinstance(data.get(key), dict):
            data[key] = {}
    return data


def save(data: dict) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".hud-accounts-")
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(data, out, indent=1, sort_keys=True)
            out.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def discover_accounts(accounts_file: Path | None = None) -> list[Path]:
    """The Claude config directories, in the order to try them.

    `~/.bob/accounts` (one directory per line) wins when it lists any.
    Otherwise `~/.claude` and every `~/.claude-<n>` that exists, so an
    account added from the glass is found without editing a file.
    """
    listed = accounts_file if accounts_file is not None else home() / ".bob" / "accounts"
    if listed.exists():
        found = [Path(line.strip()).expanduser() for line in listed.read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("#")]
        if found:
            return found
    extra = sorted((p for p in home().glob(".claude-*") if p.is_dir() and p.name[8:].isdigit()),
                   key=lambda p: int(p.name[8:]))
    return [default_config()] + extra


def same(a: Path, b: Path) -> bool:
    try:
        return a.expanduser().resolve() == b.expanduser().resolve()
    except OSError:
        return str(a) == str(b)


def email(config: Path) -> str | None:
    """The signed-in email for one config directory, or None when signed out.

    The default account keeps its state in `~/.claude.json` (Claude Code reads
    that when CLAUDE_CONFIG_DIR is unset); any other in `<dir>/.claude.json`.
    Only `oauthAccount.emailAddress` is read out.
    """
    candidates = [config / ".claude.json"]
    if same(config, default_config()):
        candidates.insert(0, home() / ".claude.json")
    for path in candidates:
        try:
            account = json.loads(path.read_text()).get("oauthAccount") or {}
        except (OSError, ValueError, AttributeError):
            continue
        value = account.get("emailAddress") if isinstance(account, dict) else None
        if isinstance(value, str) and "@" in value:
            return value
    return None


def short_path(config: Path) -> str:
    try:
        return "~/" + str(config.expanduser().relative_to(home()))
    except ValueError:
        return str(config)


def account_label(config: Path) -> str:
    return email(config) or short_path(config)


def settings_model() -> str | None:
    try:
        value = json.loads((default_config() / "settings.json").read_text()).get("model")
    except (OSError, ValueError, AttributeError):
        return None
    return value if isinstance(value, str) and value else None


# --- the other runtimes -----------------------------------------------------

@dataclass
class Status:
    state: str            # ok, signed out, missing, off, no model
    detail: str = ""
    models: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.state == "ok"


_status_cache: dict[str, tuple[float, Status]] = {}


def _exe(runtime: str) -> str | None:
    override = os.environ.get(f"HUD_{runtime.upper()}_BIN")
    return override or shutil.which(runtime)


def _probe(runtime: str) -> Status:
    exe = _exe(runtime)
    if runtime == "codex":
        if not exe:
            return Status("missing", "not installed")
        try:
            done = subprocess.run([exe, "login", "status"], capture_output=True, text=True,
                                  timeout=STATUS_TIMEOUT_S, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired):
            return Status("off", "status didn't answer")
        said = (done.stdout + done.stderr).lower()
        if done.returncode == 0 and "logged in" in said and "not logged in" not in said:
            return Status("ok", "ChatGPT" if "chatgpt" in said else "API key" if "api key" in said else "")
        return Status("signed out")
    if runtime == "gemini":
        if not exe:
            return Status("missing", "not installed")
        if os.environ.get("GEMINI_API_KEY"):
            return Status("ok", "API key")
        try:
            active = json.loads((home() / ".gemini" / "google_accounts.json").read_text()).get("active")
        except (OSError, ValueError, AttributeError):
            active = None
        if isinstance(active, str) and "@" in active:
            return Status("ok", active)
        return Status("signed out")
    if runtime == "ollama":
        if not exe:
            return Status("missing", "not installed")
        try:
            done = subprocess.run([exe, "list"], capture_output=True, text=True,
                                  timeout=STATUS_TIMEOUT_S, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired):
            return Status("off", "isn't running")
        if done.returncode != 0:
            return Status("off", "isn't running")
        names = [line.split()[0] for line in done.stdout.splitlines()[1:] if line.split()]
        chat = [n for n in names if not EMBED_RE.search(n)]
        if not chat:
            return Status("no model", "no chat model pulled")
        return Status("ok", f"{len(chat)} local model{'s' if len(chat) != 1 else ''}", chat)
    return Status("ok")


def runtime_status(runtime: str, fresh: bool = False) -> Status:
    now = time.monotonic()
    hit = _status_cache.get(runtime)
    if hit and not fresh and now - hit[0] < STATUS_TTL_S:
        return hit[1]
    status = _probe(runtime)
    _status_cache[runtime] = (now, status)
    return status


def runtime_command(runtime: str, model: str | None = None) -> str:
    """The model command for a runtime, as hud-listen runs it."""
    if runtime == "claude":
        return "claude -p --strict-mcp-config"
    argv = [str(BIN / f"hud-{runtime}")]
    if model:
        argv += ["--model", model]
    return shlex.join(argv)


def runtime_of(command: str) -> str | None:
    """Which runtime a model command is, or None for a hand-written one."""
    try:
        first = Path(shlex.split(command)[0]).name
    except (ValueError, IndexError):
        return None
    if first == "claude":
        return "claude"
    if first.startswith("hud-") and first[4:] in RUNTIMES:
        return first[4:]
    return None


def models_for(runtime: str, status: Status | None = None) -> list[tuple[str | None, str]]:
    """(value, label) choices for a runtime's model, the default first.

    None means the runtime's own default (its settings), which is the only
    honest choice for Codex and Gemini: their model names are theirs to
    configure and nothing here verified a list.
    """
    if runtime == "claude":
        configured = settings_model()
        out: list[tuple[str | None, str]] = []
        if configured and configured not in {v for v, _ in CLAUDE_MODELS}:
            base = configured.split("[")[0]
            label = dict(CLAUDE_MODELS).get(base, base.title())
            out.append((configured, label + (" 1M" if "[1m]" in configured else "")))
        return out + [(v, l) for v, l in CLAUDE_MODELS]
    if runtime == "ollama":
        names = (status or runtime_status("ollama")).models
        return [(n, n) for n in names[:6]]
    return [(None, "Default")]


def model_label(runtime: str, model: str | None) -> str:
    for value, label in models_for(runtime, Status("ok") if runtime != "ollama" else None):
        if value == model:
            return label
    if runtime == "claude" and model:
        return dict(CLAUDE_MODELS).get(model, model)
    return model or "default model"


# --- limits -----------------------------------------------------------------

def parse_reset(text: str, now: _dt.datetime | None = None) -> tuple[float, str]:
    """When a limit notice says the account comes back: (epoch, "9am")."""
    now = now or _dt.datetime.now().astimezone()
    found = RESET_RE.search(text or "")
    if not found:
        return now.timestamp() + UNKNOWN_RESET_S, ""
    zone = now.tzinfo
    if found.group("tz"):
        try:
            from zoneinfo import ZoneInfo
            zone = ZoneInfo(found.group("tz"))
        except Exception:  # noqa: BLE001  an unknown zone keeps local time
            zone = now.tzinfo
    local = now.astimezone(zone)
    hour = int(found.group("h")) % 12 + (12 if found.group("ap").lower() == "pm" else 0)
    minute = int(found.group("m") or 0)
    if found.group("mon"):
        try:
            month = _dt.datetime.strptime(found.group("mon")[:3].title(), "%b").month
            when = local.replace(month=month, day=int(found.group("day")), hour=hour, minute=minute,
                                 second=0, microsecond=0)
            if when < local - _dt.timedelta(days=1):
                when = when.replace(year=when.year + 1)
        except ValueError:
            when = local + _dt.timedelta(seconds=UNKNOWN_RESET_S)
    else:
        when = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if when <= local:
            when += _dt.timedelta(days=1)
    label = found.group(0)[len("resets"):].strip()
    label = re.sub(r"\s*\([^)]*\)$", "", label)
    return when.timestamp(), label


def account_key(config: Path) -> str:
    return "claude:" + str(config.expanduser())


def key_label(key: str) -> str:
    if key.startswith("claude:"):
        return account_label(Path(key[7:]))
    return RUNTIME_NAMES.get(key, key)


def mark_limited(data: dict, key: str, text: str, now: float | None = None) -> dict:
    until, label = parse_reset(text, _dt.datetime.fromtimestamp(now).astimezone() if now else None)
    data["limits"][key] = {"until": until, "reset": label}
    return data["limits"][key]


def limited(data: dict, key: str, now: float | None = None) -> dict | None:
    entry = data.get("limits", {}).get(key)
    if not isinstance(entry, dict):
        return None
    if float(entry.get("until") or 0) <= (now or time.time()):
        return None
    return entry


def back_at(entry: dict | None) -> str:
    if not entry:
        return ""
    return f"until {entry['reset']}" if entry.get("reset") else "for now"


# --- what answers -----------------------------------------------------------

@dataclass(frozen=True)
class Target:
    runtime: str
    account: Path | None = None
    model: str | None = None

    @property
    def key(self) -> str:
        return account_key(self.account) if self.runtime == "claude" and self.account else self.runtime

    def label(self) -> str:
        if self.runtime == "claude" and self.account:
            return account_label(self.account)
        name = RUNTIME_NAMES[self.runtime]
        return f"{name} ({self.model})" if self.runtime == "ollama" and self.model else name


def preferred(data: dict, accounts: list[Path], auto_runtime: str) -> Target:
    """What Caleb picked, before any limit is considered. An unset runtime
    follows the last foreground session (tools/hud_runtime.py)."""
    pick = data.get("pick", {})
    runtime = pick.get("runtime") if pick.get("runtime") in RUNTIMES else auto_runtime
    if runtime not in RUNTIMES:
        runtime = "claude"
    account = None
    if runtime == "claude" and accounts:
        saved = pick.get("account")
        account = next((a for a in accounts if saved and same(a, Path(saved))), accounts[0])
    # A Claude model left unpicked stays None: hud-listen then passes the
    # person's own settings model, as it always has.
    model = data.get("models", {}).get(runtime)
    if runtime == "ollama" and not model:
        models = runtime_status("ollama").models
        model = models[0] if models else None
    return Target(runtime, account, model)


def candidates(data: dict, accounts: list[Path], start: Target) -> list[Target]:
    """Everything that could answer, in the order to try: the pick, the other
    Claude accounts, then the other runtimes."""
    out = [start]
    for account in accounts:
        if start.runtime != "claude" or not same(account, start.account or Path("/")):
            out.append(Target("claude", account, data["models"].get("claude")))
    for runtime in RUNTIMES[1:]:
        if runtime != start.runtime:
            model = data["models"].get(runtime)
            out.append(Target(runtime, None, model))
    return out


def usable(target: Target, data: dict, now: float | None = None) -> bool:
    if limited(data, target.key, now):
        return False
    if target.runtime == "claude":
        return target.account is not None and email(target.account) is not None
    return runtime_status(target.runtime).ok


def effective(data: dict, accounts: list[Path], auto_runtime: str,
              now: float | None = None) -> tuple[Target | None, Target]:
    """(what answers now, what was picked). None when everything is out.

    The pick answers unless it is marked limited; it is not probed, so an
    ordinary request costs a file read. Only a failover asks the others.
    """
    start = preferred(data, accounts, auto_runtime)
    if not limited(data, start.key, now):
        return start, start
    for target in candidates(data, accounts, start)[1:]:
        if usable(target, data, now):
            if target.runtime == "ollama" and not target.model:
                models = runtime_status("ollama").models
                target = Target("ollama", None, models[0] if models else None)
            return target, start
    return None, start


# --- what was said ----------------------------------------------------------

@dataclass(frozen=True)
class Intent:
    verb: str             # show, next, runtime, model, account, add, close
    value: str = ""


SHOW = {
    "which account", "what account", "which account am i on", "what account am i on",
    "which account am i using", "what account am i using", "accounts", "my accounts",
    "show accounts", "show my accounts", "account", "which model", "what model",
    "which model am i on", "what model am i on", "what model am i using", "which model am i using",
    "models", "show models", "switch model", "change model", "change account", "pick a model",
    "which runtime", "what runtime", "switch runtime", "model", "accounts and models",
}
NEXT = {
    "switch account", "switch accounts", "use my other account", "use the other account",
    "use other account", "other account", "next account", "switch to my other account",
    "switch to the other account", "use another account",
}
ADD = {
    "add an account", "add account", "add another account", "add a new account", "new account",
    "sign in another account", "sign into another account", "add a claude account",
}
CLOSE = {"close accounts", "close the accounts", "hide accounts", "close models", "close that", "close it",
         "close", "done", "dismiss"}
RUNTIME_WORDS = {
    "claude": "claude", "claude code": "claude", "anthropic": "claude",
    "codex": "codex", "chatgpt": "codex", "openai": "codex", "gpt": "codex",
    "gemini": "gemini", "google": "gemini",
    "ollama": "ollama", "local": "ollama", "a local model": "ollama", "the local model": "ollama",
    "auto": "auto", "automatic": "auto",
}
USE = re.compile(r"^(?:use|switch to|change to|go to|answer (?:on|with)|swap to)\s+(?:my\s+)?(.+?)"
                 r"(?:\s+(?:account|model|instead|please|now))*$")


def _plain(said: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9@._:+ -]", "", said.lower()).split()).strip(" .")


def parse(said: str, accounts: list[Path], ollama_models: list[str] | None = None) -> Intent | None:
    """A switcher sentence, or None. Whole utterances only, so "use sonnet to
    summarise this" stays a request."""
    words = _plain(said)
    if not words:
        return None
    bare = re.sub(r"[^a-z ]", "", words)
    bare = " ".join(bare.split())
    if bare in SHOW:
        return Intent("show")
    if bare in NEXT:
        return Intent("next")
    if bare in ADD:
        return Intent("add")
    if bare in CLOSE:
        return Intent("close")
    found = USE.match(words)
    if not found:
        return None
    what = found.group(1).strip()
    what = re.sub(r"^(?:the|a)\s+", "", what)
    if what in RUNTIME_WORDS:
        return Intent("runtime", RUNTIME_WORDS[what])
    for value, _ in CLAUDE_MODELS:
        if what in {value, f"claude {value}", f"{value} model"}:
            return Intent("model", "claude|" + value)
    match = re.fullmatch(r"(?:account|acc)\s*(\d+)", what)
    if match and 1 <= int(match.group(1)) <= len(accounts):
        return Intent("account", str(accounts[int(match.group(1)) - 1]))
    for account in accounts:
        mail = (email(account) or "").lower()
        if mail and what in {mail, mail.split("@")[0]}:
            return Intent("account", str(account))
        if what in {short_path(account).lower(), account.name.lower()}:
            return Intent("account", str(account))
    for name in ollama_models or []:
        if what in {name.lower(), name.split(":")[0].lower()}:
            return Intent("model", "ollama|" + name)
    return None


# --- picking ----------------------------------------------------------------

def pick_runtime(data: dict, runtime: str) -> None:
    if runtime == "auto":
        data["pick"].pop("runtime", None)
    else:
        data["pick"]["runtime"] = runtime


def pick_account(data: dict, config: Path) -> None:
    data["pick"]["runtime"] = "claude"
    data["pick"]["account"] = str(config)
    # An explicit pick means try it now, even if it was marked out.
    data["limits"].pop(account_key(config), None)


def pick_model(data: dict, runtime: str, model: str | None) -> None:
    if model is None:
        data["models"].pop(runtime, None)
    else:
        data["models"][runtime] = model


def next_account(data: dict, accounts: list[Path], current: Path | None, now: float | None = None) -> Path | None:
    if not accounts:
        return None
    start = next((i for i, a in enumerate(accounts) if current and same(a, current)), -1)
    for step in range(1, len(accounts) + 1):
        account = accounts[(start + step) % len(accounts)]
        if current and same(account, current):
            continue
        if email(account) and not limited(data, account_key(account), now):
            return account
    return None


def new_account_dir(accounts: list[Path]) -> Path:
    n = 2
    taken = {str(a.expanduser()) for a in accounts}
    while (home() / f".claude-{n}").exists() or str(home() / f".claude-{n}") in taken:
        n += 1
    return home() / f".claude-{n}"


def signin_command(runtime: str, config: Path | None = None) -> str:
    """The shell line that signs one runtime in, for a Terminal Caleb types in."""
    if runtime == "claude":
        assert config is not None
        return f"CLAUDE_CONFIG_DIR={shlex.quote(str(config))} claude auth login"
    if runtime == "codex":
        return "codex login"
    if runtime == "gemini":
        return "gemini"
    return ""


def open_signin(runtime: str, config: Path | None = None) -> bool:
    """Open the runtime's own sign-in where Caleb can finish it.

    A Terminal tab rather than a background process, because Claude Code's
    login may ask for a pasted code and Gemini signs in from its first
    interactive run. HUD_SIGNIN_CMD replaces the opener in tests; it gets the
    shell line as its last argument.
    """
    line = signin_command(runtime, config)
    if not line:
        return False
    override = os.environ.get("HUD_SIGNIN_CMD")
    if override:
        argv = shlex.split(override) + [line]
    else:
        script = json.dumps(line)
        argv = ["osascript", "-e", f'tell application "Terminal" to do script {script}',
                "-e", 'tell application "Terminal" to activate']
    try:
        return subprocess.run(argv, capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


# --- the card ---------------------------------------------------------------

def _prop(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _data(pointer: str, value) -> str:
    return f"d {pointer} {json.dumps(value, separators=(',', ':'), ensure_ascii=False)}"


@dataclass
class Card:
    """What the listener drew, so a press acts only on a row it put there."""
    rows: dict[str, tuple[str, str]] = field(default_factory=dict)      # id -> (kind, value)
    buttons: dict[str, tuple[str, str]] = field(default_factory=dict)   # component -> (kind, value)
    lines: list[str] = field(default_factory=list)


def card(data: dict, accounts: list[Path], answering: Target | None, picked: Target,
         auto_runtime: str, note: str = "", now: float | None = None, probe: bool = True) -> Card:
    out = Card()
    now = now or time.time()
    current = answering or picked
    head = f"{RUNTIME_NAMES[current.runtime]} · "
    head += (account_label(current.account) + " · " + model_label("claude", current.model)
             if current.runtime == "claude" and current.account else model_label(current.runtime, current.model))
    if answering is None:
        head = "Nothing can answer right now"
    use_rows, signin_rows = [], []
    for i, account in enumerate(accounts):
        mail = email(account)
        entry = limited(data, account_key(account), now)
        here = current.runtime == "claude" and current.account is not None and same(account, current.account)
        if not mail:
            rid = f"in-{i}"
            signin_rows.append({"id": rid, "text": f"{short_path(account)} · signed out"})
            out.rows[rid] = ("signin-claude", str(account))
            continue
        state = (f"limit hit, back {back_at(entry)[6:]}" if entry and entry.get("reset")
                 else "limit hit" if entry else "in use" if here else "ok")
        rid = f"acct-{i}"
        use_rows.append({"id": rid, "text": f"Claude · {mail} · {state}"})
        out.rows[rid] = ("account", str(account))
    for runtime in RUNTIMES[1:]:
        status = runtime_status(runtime) if probe else Status("unknown")
        if status.state == "missing":
            continue
        entry = limited(data, runtime, now)
        here = current.runtime == runtime
        if status.state == "signed out":
            rid = f"in-{runtime}"
            signin_rows.append({"id": rid, "text": f"{RUNTIME_NAMES[runtime]} · signed out"})
            out.rows[rid] = ("signin", runtime)
            continue
        # A runtime's signed-in detail is a plan or a model count, never the
        # address: the Claude rows already name whose subscription is whose.
        signed = "signed in" + (f" with {status.detail}" if status.detail and "@" not in status.detail
                                and runtime != "ollama" else "")
        state = ("limit hit" + (f", back {entry['reset']}" if entry.get("reset") else "") if entry
                 else "in use" if here else status.detail if runtime == "ollama" and status.ok
                 else signed if status.ok else status.detail or status.state)
        rid = f"rt-{runtime}"
        use_rows.append({"id": rid, "text": f"{RUNTIME_NAMES[runtime]} · {state}"})
        out.rows[rid] = ("runtime", runtime)
    pinned = data["pick"].get("runtime") in RUNTIMES
    auto_text = (f"Follow my last session · {RUNTIME_NAMES.get(auto_runtime, auto_runtime)}"
                 + (" · picked" if not pinned else ""))
    use_rows.append({"id": "rt-auto", "text": auto_text})
    out.rows["rt-auto"] = ("runtime", "auto")

    models = models_for(current.runtime)
    out.lines = [
        f"@ {SURFACE} at=topRight w=440",
        f"glance {SURFACE}",
        'c s Screen title="MODEL"',
        "c now Text value=@/now",
        "c note Text value=@/note tone=muted",
        'c use List items=@/use action=acct-use actionLabel="Use"',
    ]
    children = ["now", "note", "use"]
    if signin_rows:
        out.lines.append('c signin List items=@/signin action=acct-signin actionLabel="Sign in"')
        children.append("signin")
    model_ids = []
    # One choice is no choice: Codex and Gemini keep their own default.
    for j, (value, label) in enumerate(models if len(models) > 1 else []):
        cid = f"m-{j}"
        variant = " variant=primary" if value == current.model or (value is None and not current.model) else ""
        out.lines.append(f"c {cid} Button label={_prop(label)} action=acct-model{variant}")
        out.buttons[cid] = ("model", f"{current.runtime}|{value or ''}")
        model_ids.append(cid)
    if len(model_ids) > 1:
        out.lines.append("c models Stack direction=grid cols=3 gap=2")
        out.lines.append("> models " + " ".join(model_ids))
        children.append("models")
    out.lines.append('c add Button label="Add account" action=acct-add')
    out.buttons["add"] = ("add", "")
    children.append("add")
    out.lines.append("> s " + " ".join(children))
    out.lines.append("r s")
    if not note and answering is not None and answering.key != picked.key:
        entry = limited(data, picked.key, now)
        note = f"Answering on {answering.label()}: {picked.label()} is out {back_at(entry) or 'for now'}."
    if not note:
        note = ("Press Use on a row, or say \"use sonnet\", \"use codex\", \"use my other account\"."
                if answering is not None else "Every account and runtime is out or signed out. Sign one in below.")
    out.lines += [_data("/now", head), _data("/note", note), _data("/use", use_rows)]
    if signin_rows:
        out.lines.append(_data("/signin", signin_rows))
    return out


def close_line() -> str:
    return f"- {SURFACE}"
