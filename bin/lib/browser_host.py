"""The decision half of the browser native host: a closed tool table, verdicts, the log.

Everything a chat page sends arrives here as untrusted input. The contract is
docs/reference/BROWSER-CHEWB.md, "The boundary", and every rule in it is
enforced in this file rather than in the extension, because the extension runs
next to the page and the page can defeat anything that lives there.

    handle(message, origin) -> reply dict, always; never raises

A message is {"id": str, "tool": str, "args": {...}}. Every other key is
ignored, which is how a forged "approved": true or "confirm": true dies: it is
never read.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import time

HOME = pathlib.Path.home()

# Fixed by the "key" in apps/extensions/chewbacca/manifest.json. An unpacked
# load and every copy of this repo get the same id, so the host manifest can
# name exactly one extension.
EXTENSION_ID = "jedodajajfjoikfajbnpfmbmocicbecn"
HOST_NAME = "com.chewbacca.browser"
VERSION = "1.0.0"

# Chrome caps host-to-extension messages at 1 MB. 48 KB of tool output is about
# 12K tokens, more than a chat composer comfortably takes in one paste.
MAX_OUT = 48_000
# A tool call is a name and a few fields. 64 KB leaves room for file_write's
# text and nothing like a payload.
MAX_IN = 64_000
# One Allow on texts covers that tool for this long, then it asks again.
GRANT_S = 600
# Two settings panes a second would be a page spamming the screen, not a person
# walking through setup.
OPEN_GAP_S = 3.0

PATH = f"{HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

PANES = {
    "automation": "Privacy_Automation",
    "full_disk": "Privacy_AllFiles",
    "accessibility": "Privacy_Accessibility",
    "screen": "Privacy_ScreenCapture",
    "calendar": "Privacy_Calendars",
    "reminders": "Privacy_Reminders",
    "contacts": "Privacy_Contacts",
}


class Refused(ValueError):
    """The call is not allowed, whatever the person says."""


def shared_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("CHEWBACCA_BROWSER_SHARED", str(HOME / "Chewbacca Shared")))


def log_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("CHEWBACCA_BROWSER_LOG", str(HOME / ".chewbacca/logs/browser-host.jsonl")))


def skills_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("CHEWBACCA_SKILLS_DIR", str(HOME / ".chewbacca/skills")))


# --- argument validators: every field typed, bounded, or refused -------------

def _int(args, key, lo, hi, default):
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise Refused(f"{key} must be a whole number from {lo} to {hi}")
    return value


def _str(args, key, limit, pattern=None, required=True):
    value = args.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        raise Refused(f"{key} must be text, 1 to {limit} characters")
    if value.startswith("-"):
        raise Refused(f"{key} can't start with a dash")
    if pattern and not re.fullmatch(pattern, value):
        raise Refused(f"{key} is not in the accepted shape")
    return value


def _only(args, *keys):
    extra = sorted(set(args) - set(keys))
    if extra:
        raise Refused(f"unexpected argument: {', '.join(extra)}")


def _shared(rel: str, must_exist: bool) -> pathlib.Path:
    """A path inside the shared folder, by real path, symlinks followed."""
    if rel.startswith(("/", "~")) or "\\" in rel:
        raise Refused("paths are relative to the shared folder")
    root = shared_dir().resolve()
    target = (root / rel).resolve()
    if target != root and root not in target.parents:
        raise Refused("that path is outside the shared folder")
    if must_exist and not target.exists():
        raise Refused("no such file in the shared folder")
    return target


# --- the tools ---------------------------------------------------------------
# Each returns either ("argv", [...], timeout) to run without a shell, or
# ("text", str) computed here. Tiers: read runs; press asks a native dialog;
# open runs, rate limited; never is refused, always.

def t_due(a):
    _only(a, "days")
    return "argv", ["coursework", "due", "--days", str(_int(a, "days", 1, 60, 7)), "--json"], 30


def t_today(a):
    _only(a)
    return "argv", ["coursework", "today", "--json"], 30


def t_calendar(a):
    _only(a, "days")
    return "argv", ["mac", "calendar", "list", "--from", "today", "--to", f"+{_int(a, 'days', 1, 14, 2)}d", "--json"], 30


def t_people(a):
    _only(a, "name")
    # No leading dash: a name like "--delete" must never read as an option.
    return "argv", ["people", "show", _str(a, "name", 80, r"[\w][\w .'-]*")], 30


def t_jobs(a):
    _only(a)
    return "argv", ["chewbacca", "jobs", "list"], 30


def t_ledger(a):
    _only(a)
    return "argv", ["work-ledger", "list", "--scope", str(HOME)], 30


def t_skills(a):
    _only(a)
    root = skills_dir()
    names = sorted(p.parent.name for p in root.glob("*/SKILL.md")) if root.is_dir() else []
    return "text", "\n".join(names) or "no skills installed"


def t_skill(a):
    _only(a, "name")
    name = _str(a, "name", 60, r"[a-z0-9][a-z0-9-]*")
    path = skills_dir() / name / "SKILL.md"
    if not path.is_file():
        raise Refused(f"no skill named {name}")
    return "text", path.read_text(errors="replace")


def t_files_list(a):
    _only(a)
    root = shared_dir()
    root.mkdir(parents=True, exist_ok=True)
    rows = [str(p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()][:500]
    return "text", "\n".join(rows) or f"the shared folder is empty: {root}"


def t_file_read(a):
    _only(a, "path")
    target = _shared(_str(a, "path", 300), must_exist=True)
    if not target.is_file():
        raise Refused("that is not a file")
    with target.open("rb") as f:  # a 2 GB file must not be read whole to send 48 KB
        return "text", f.read(MAX_OUT + 1).decode("utf-8", errors="replace")


def t_texts(a):
    _only(a, "chat_id", "limit")
    limit = _int(a, "limit", 1, 50, 20)
    if "chat_id" in a:
        return "argv", ["imsg", "history", "--chat-id", str(_int(a, "chat_id", 1, 10**9, 1)),
                        "--limit", str(limit), "--json"], 30
    return "argv", ["imsg", "chats", "--limit", str(limit), "--json"], 30


def t_reminder_add(a):
    _only(a, "title", "due")
    argv = ["remindctl", "add", "--title", _str(a, "title", 200)]
    due = _str(a, "due", 20, r"\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?|today|tomorrow", required=False)
    return "argv", argv + (["--due", due] if due else []), 30


def t_ledger_add(a):
    _only(a, "title", "next_action")
    argv = ["work-ledger", "add", "--scope", str(HOME), "--title", _str(a, "title", 200)]
    nxt = _str(a, "next_action", 300, required=False)
    return "argv", argv + (["--next-action", nxt] if nxt else []), 30


def t_file_write(a):
    _only(a, "path", "text")
    target = _shared(_str(a, "path", 300), must_exist=False)
    text = a.get("text")
    if not isinstance(text, str) or len(text) > 60_000:
        raise Refused("text must be up to 60000 characters")
    return "write", (target, text)


def t_open_pane(a):
    _only(a, "pane")
    pane = a.get("pane")
    if pane not in PANES:
        raise Refused("pane must be one of: " + ", ".join(PANES))
    return "open", f"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{PANES[pane]}"


def t_never(a):
    raise Refused("this tool sends, spends or runs commands, and the browser can't reach it")


TOOLS = {
    # name: (tier, builder, what the person sees in the dialog)
    "due": ("read", t_due, "what's due"),
    "today": ("read", t_today, "today's classes"),
    "calendar": ("read", t_calendar, "your calendar"),
    "people": ("read", t_people, "what Chewbacca knows about a person"),
    "jobs": ("read", t_jobs, "the jobs queue"),
    "ledger": ("read", t_ledger, "your task ledger"),
    "skills": ("read", t_skills, "the list of skills"),
    "skill": ("read", t_skill, "a skill's instructions"),
    "files_list": ("read", t_files_list, "the shared folder's files"),
    "file_read": ("read", t_file_read, "a file in the shared folder"),
    "texts": ("press", t_texts, "READ YOUR TEXT MESSAGES and give them to the chat"),
    "reminder_add": ("press", t_reminder_add, "add a reminder"),
    "ledger_add": ("press", t_ledger_add, "add a task to your ledger"),
    "file_write": ("press", t_file_write, "write a file in the shared folder"),
    "open_pane": ("open", t_open_pane, "open a System Settings pane"),
    # Present so the refusal is tested and the shape is visible, never runnable.
    "text_send": ("never", t_never, ""), "email_send": ("never", t_never, ""),
    "shell": ("never", t_never, ""), "run": ("never", t_never, ""), "pay": ("never", t_never, ""),
}


def tool_list() -> list:
    return [{"tool": k, "tier": v[0]} for k, v in TOOLS.items() if v[0] != "never"]


# --- the press: a native dialog, drawn by this process, never by the page -----

def _osascript_confirm(summary: str) -> bool:
    text = summary.replace("\\", "\\\\").replace('"', '\\"')
    script = (f'display dialog "{text}" with title "Chewbacca in your browser" '
              'buttons {"Deny", "Allow"} default button "Deny" cancel button "Deny" '
              'with icon caution giving up after 60')
    try:
        out = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=75)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return out.returncode == 0 and "button returned:Allow" in out.stdout and "gave up:true" not in out.stdout


def confirm(tool: str, args: dict, plain: str) -> bool:
    shown = json.dumps(args, ensure_ascii=False)
    if len(shown) > 600:
        shown = shown[:600] + f"... ({len(shown)} characters in all)"
    summary = (f"A chat page in Chrome wants to {plain}.\n\nTool: {tool}\nExactly: {shown}\n\n"
               "Only allow it if you asked for this.")
    # Tests set this to a program that answers instead of a person. Chrome sets
    # the host's environment, so a page can never reach it.
    hook = os.environ.get("CHEWBACCA_BROWSER_CONFIRM")
    if hook:
        try:
            out = subprocess.run([hook], input=json.dumps({"tool": tool, "args": args, "summary": summary}),
                                 capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            return False
        return out.returncode == 0
    return _osascript_confirm(summary)


# --- running, logging, the one entry point -----------------------------------

class Host:
    def __init__(self, origin: str = ""):
        self.origin = origin
        self.grants = {}  # tool -> monotonic expiry
        self.last_open = None

    def _log(self, row: dict) -> None:
        path = log_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a") as f:
                f.write(json.dumps(row) + "\n")
        except OSError:
            pass  # a full disk must not turn a refusal into a crash

    def _run(self, kind, spec):
        if kind == "text":
            return spec[0] if isinstance(spec, tuple) else spec
        if kind == "write":
            target, text = spec
            # The dialog can sit open for 60 s; check the path again after the press.
            target = _shared(str(target.relative_to(shared_dir().resolve())), must_exist=False)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
            return f"wrote {len(text)} characters to {target.relative_to(shared_dir().resolve())}"
        if kind == "open":
            opener = os.environ.get("CHEWBACCA_BROWSER_OPEN", "/usr/bin/open")
            subprocess.run([opener, spec], capture_output=True, timeout=10)
            return "opened the pane in System Settings"
        argv, timeout = spec
        exe = shutil.which(argv[0], path=PATH)
        if not exe:
            raise RuntimeError(f"{argv[0]} isn't installed on this Mac")
        env = {"PATH": PATH, "HOME": str(HOME), "LANG": "en_US.UTF-8", "CHEWBACCA_NO_SEND": "1"}
        out = subprocess.run([exe, *argv[1:]], capture_output=True, text=True, timeout=timeout, env=env, stdin=subprocess.DEVNULL)
        body = out.stdout if out.returncode == 0 else (out.stdout + out.stderr)
        if out.returncode != 0:
            raise RuntimeError(body.strip()[-2000:] or f"{argv[0]} exited {out.returncode}")
        return body

    def handle(self, message) -> dict:
        start = time.monotonic()
        call_id = message.get("id") if isinstance(message, dict) and isinstance(message.get("id"), str) else ""
        tool = message.get("tool") if isinstance(message, dict) else None
        args = message.get("args", {}) if isinstance(message, dict) else None
        tier = TOOLS[tool][0] if isinstance(tool, str) and tool in TOOLS else ("meta" if tool == "hello" else "unknown")
        reply = {"id": call_id[:64], "tool": tool if isinstance(tool, str) else None, "tier": tier}
        try:
            if not isinstance(message, dict) or len(json.dumps(message)) > MAX_IN:
                raise Refused("the call is too large or not an object")
            if tool == "hello":
                reply.update(verdict="ran", ok=True, result={"version": VERSION, "tools": tool_list()})
                return reply
            if tier == "unknown":
                raise Refused(f"{tool!r} is not a Chewbacca browser tool")
            if not isinstance(args, dict):
                raise Refused("args must be an object")
            plain = TOOLS[tool][2]
            kind, *spec = TOOLS[tool][1](args)
            if tier == "never":
                raise Refused("refused")
            if tier == "open":
                now = time.monotonic()
                if self.last_open is not None and now - self.last_open < OPEN_GAP_S:
                    raise Refused("one settings pane at a time")
                self.last_open = now
            approved = False
            if tier == "press":
                if self.grants.get(tool, 0) > time.monotonic():
                    approved = True
                elif confirm(tool, args, plain):
                    approved = True
                    if tool == "texts":
                        self.grants[tool] = time.monotonic() + GRANT_S
                else:
                    reply.update(verdict="denied", ok=False, error="You pressed Deny (or nobody answered), so it didn't run.")
                    return reply
            out = self._run(kind, spec[0] if len(spec) == 1 else tuple(spec))
            text = out if isinstance(out, str) else json.dumps(out)
            if len(text) > MAX_OUT:
                text = text[:MAX_OUT] + f"\n[cut: {len(text)} characters in all]"
            reply.update(verdict="approved" if approved else "ran", ok=True, result=text)
        except Refused as e:
            reply.update(verdict="refused", ok=False, error=str(e))
        except subprocess.TimeoutExpired:
            reply.update(verdict="failed", ok=False, error="it took too long and was stopped")
        except Exception as e:  # noqa: BLE001  the host answers every call, whatever broke
            reply.update(verdict="failed", ok=False, error=str(e)[:500])
        finally:
            ms = round((time.monotonic() - start) * 1000, 1)
            reply["ms"] = ms
            keys = sorted(args) if isinstance(args, dict) else []
            self._log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "origin": self.origin, "tool": reply.get("tool"),
                       "tier": tier, "verdict": reply.get("verdict"), "ms": ms, "arg_keys": [str(k)[:40] for k in keys[:10]],
                       "arg_chars": len(json.dumps(args)) if isinstance(args, dict) else 0})
        return reply
