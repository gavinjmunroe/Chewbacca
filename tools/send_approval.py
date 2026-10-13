#!/usr/bin/env python3
"""Send approval: nothing reaches another person without a person's press.

Every sink (people send, mac-db's iMessage path, Mail.app via email_reader,
gmail, slack, matrix, a plan's send step) calls take(channel, to, text,
subject) right before it hands the message over. take() returns the kind of
press that approved this exact message, or raises NoApproval and nothing is
sent. An approval is bound to the channel, the address, the text and an
email's subject, works once, and dies after 15 minutes. The plan is
docs/plans/send-approval.md.

What counts as a press, checked in this order:

1. A token a press handler already minted for this exact message. Only press
   handlers mint: kit_confirm in bin/lib/mcp-writes.js after the six-digit
   code it showed checks out, and this module after 2 to 4 below. There is
   no mint command, so no flag an agent passes makes one.
2. A press in Kyber, the HUD app. Until the HUD mints tokens at its own
   buttons (the HUD lane), a send whose process tree runs up to the Kyber
   executable (checked by its real path, never its argv), with no agent and
   no job runner in between, counts. The home panel's Send runs
   `kyber-surfaces home --send <id>` this way.
3. CHEWBACCA_SEND_CODE set to the six-digit code this module put on the
   person's screen for this exact message. The person reads it out only if
   they want it sent.
4. `send` typed at a real terminal that no agent's process tree owns: the
   process tree runs up to a terminal app (checked by its real path), and this
   process's terminal is the one that app opened, so a pty made on the way
   (`script`, a reparented pipe) is no press.

Before any of those, take() asks config/send-policy.cedar (tools/send_policy.py)
and refuses whatever a rule there forbids, CHEWBACCA_NO_SEND included.

Otherwise take() puts a code on the person's screen (a HUD toast, or a macOS
notification when the HUD is down; neither takes focus) and refuses.

What this does not stop: a process running as the same user can write a
token file by hand, or drive the screen to read the code. Both are deliberate
circumvention, not a flag or a habit, and both are named in the plan.

    send_approval.py take --channel C --to T [--subject S]
                          the text on stdin; exit 0 prints the press, exit 3 refuses
    send_approval.py status   pending codes and live tokens

Runs on /usr/bin/python3 3.9.
"""
import ctypes
import ctypes.util
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import time

# The same life as kit_confirm's drafts (bin/lib/mcp-writes.js). Guessed,
# never measured: long enough to read a draft aloud, short enough that a
# forgotten approval dies.
TOKEN_LIFE = 15 * 60
# A refused retry inside this window reuses the code already on screen
# instead of drawing a new one. 120 s is the HUD toast's own life
# (`life=120` in the draw below and in mcp-writes.js).
RESHOW_AFTER = 120
# Three wrong codes burn the pending one, the same line kit_confirm draws: a
# six-digit code against unlimited guesses is no gate. Guessed, never measured.
MAX_CODE_TRIES = 3
# 200,000 rounds took 0.12 s on this Mac (/usr/bin/python3 3.9, 2026-10-12),
# so walking all 10^6 codes from the stored hash is ~33 CPU hours, far past
# TOKEN_LIFE. It only has to make reading the pending file useless.
CODE_ROUNDS = 200000

# An agent or the job queue above us means no terminal press and no HUD
# bridge. Matched on the full command line of every ancestor: the CLI and
# VS Code binaries are named `claude`, Codex is `codex`, the desktop apps
# run from their .app bundles, chewbacca-jobs runs what agents submit, and
# hud-listen (the voice agent) and realm (the agents IDE) are agents that run
# under Kyber, so Kyber above them proves no press. Spoofing this only makes
# a send refuse.
AGENT = re.compile(r"(^|/)(claude|codex)(\s|$)|claude-code|@anthropic-ai/|/Claude\.app/|/Codex\.app/"
                   r"|chewbacca-jobs|(^|/)hud-listen(\s|$)|(^|/)realm-engine(\s|$)|/realm/")
# The HUD app's executable, as proc_pidpath reported it on 2026-10-12. Read
# from the kernel, not from argv, which `exec -a` sets to anything.
KYBER_EXE = "/Applications/Kyber.app/Contents/MacOS/Kyber"
# Terminal apps a person types into, by each main executable's exact path
# (Terminal's is under /System/Applications/Utilities on this Mac). Not VS
# Code, Cursor or sshd: their helpers run any code they're handed
# (ELECTRON_RUN_AS_NODE=1), so an agent could start one as a fake terminal.
# A terminal missing here only gets the six-digit code instead of the prompt.
TERMINAL_HOSTS = frozenset((
    "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
    "/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
    "/Applications/iTerm.app/Contents/MacOS/iTerm2",
    "/Applications/Ghostty.app/Contents/MacOS/ghostty",
    "/Applications/kitty.app/Contents/MacOS/kitty",
    "/Applications/Alacritty.app/Contents/MacOS/alacritty",
    "/Applications/WezTerm.app/Contents/MacOS/wezterm-gui",
    "/Applications/Warp.app/Contents/MacOS/stable",
))
# Every wrong code counts against one hourly budget, whichever code it was
# for, so guessing can't reset by waiting out a code or asking for a new one.
# 9 an hour against 10^6 codes. Guessed, never measured: a person mistypes a
# code a few times, not nine.
MAX_MISSES_PER_HOUR = 9
# Codes waiting at once. Each is a separate target to guess against, and a
# person reads one draft at a time. Guessed, never measured.
MAX_PENDING = 5


class NoApproval(Exception):
    """Nothing was sent: no press approved this exact message."""


def root():
    return os.environ.get("CHEWBACCA_SEND_APPROVALS") or os.path.expanduser("~/.chewbacca/send-approvals")


# Caleb, 2026-10-12 9:54am, on hearing step 12 made every send wait on a
# press: "Wait wtf of course it should be able to send texts or emails???"
# His standing rulings say the same ("text me X" is one call, 10/10; a reply
# in a lead's own thread goes out with no confirmation step, 10/11). So the
# press is opt-in: off unless this file says "press". Off, take() still logs
# every send as a verdict row and returns "agent".
def mode():
    try:
        with open(os.path.join(root(), "mode"), encoding="utf-8") as fh:
            return fh.read().strip() or "agent"
    except OSError:
        return "agent"


def _dir(name):
    path = os.path.join(root(), name)
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(root(), 0o700)
    os.chmod(path, 0o700)
    return path


def _sha(text):
    return hashlib.sha256(str(text).encode("utf-8", "surrogatepass")).hexdigest()


def binding(channel, to, text, subject=""):
    """The one key an approval is good for: this channel, this address, this
    text and, for email, this subject."""
    return _sha("\0".join((str(channel), str(to), str(text), str(subject or ""))))


def _write_private(path, obj):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def _log(op, channel, to, press="", reason=""):
    row = {"at": int(time.time()), "op": op, "channel": channel, "to": to,
           "press": press, "reason": reason, "pid": os.getpid()}
    try:
        fd = os.open(os.path.join(_dir("."), "log.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a") as f:
            f.write(json.dumps(row) + "\n")
    except OSError:
        pass


def _claim(path):
    """Take a file for this process alone, or None when another has it. The
    rename is the single use: two processes racing for one file can't both
    win it."""
    claim = "%s.claim.%d" % (path, os.getpid())
    try:
        os.rename(path, claim)
    except OSError:
        return None, None
    try:
        with open(claim) as f:
            got = json.load(f)
    except (OSError, ValueError):
        got = None
    return (got if isinstance(got, dict) else None), claim


def _drop(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def mint(channel, to, text, press, subject=""):
    """For press handlers only: approve this exact message once."""
    b = binding(channel, to, text, subject)
    _write_private(os.path.join(_dir("tokens"), b + ".json"),
                   {"channel": channel, "to": to, "text_sha": _sha(text), "subject_sha": _sha(subject or ""),
                    "press": press, "at": time.time()})
    _log("mint", channel, to, press)
    return b


def _take_token(channel, to, text, subject):
    tok, claim = _claim(os.path.join(_dir("tokens"), binding(channel, to, text, subject) + ".json"))
    if claim:
        _drop(claim)
    if not tok or time.time() - float(tok.get("at") or 0) > TOKEN_LIFE:
        return None
    if (tok.get("channel"), tok.get("to"), tok.get("text_sha"), tok.get("subject_sha")) != \
            (channel, to, _sha(text), _sha(subject or "")):
        return None
    return str(tok.get("press") or "token")


def ancestry(pid=None, ps_out=None):
    """(pid, command line, controlling tty) from this process up to launchd,
    or None when ps fails. A process reparented to launchd ends the chain
    there."""
    if ps_out is None:
        try:
            ps_out = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,tty=,command="],
                                    capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            return None
    procs = {}
    for line in ps_out.splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit():
            procs[int(parts[0])] = (int(parts[1]), parts[3] if len(parts) > 3 else "", parts[2])
    pid = os.getpid() if pid is None else pid
    if pid not in procs:
        return None
    chain, seen = [], set()
    while pid in procs and pid not in seen and pid > 1:
        seen.add(pid)
        ppid, cmd, tty = procs[pid]
        chain.append((pid, cmd, tty))
        pid = ppid
    return chain


def _tty(item):
    tty = item[2] if len(item) > 2 else None
    return None if tty in (None, "", "??", "-") else tty


def exe_path(pid):
    """The executable the kernel started for pid (libproc's proc_pidpath), or
    None. Unlike argv, a process can't choose what this says."""
    try:
        lib = ctypes.CDLL(ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib")
        buf = ctypes.create_string_buffer(4096)
        n = lib.proc_pidpath(ctypes.c_int(pid), buf, ctypes.c_uint32(4096))
        return buf.value.decode("utf-8", "replace") if n > 0 else None
    except (OSError, AttributeError, ValueError):
        return None


def agent_above(chain):
    # Fail closed: no process tree means we can't rule an agent out.
    return chain is None or any(AGENT.search(item[1]) for item in chain)


def hud_press(chain, exe=exe_path):
    if chain is None or agent_above(chain):
        return False
    return any(exe(item[0]) == KYBER_EXE for item in chain)


def terminal_owned(chain, exe=exe_path):
    """True when a terminal app is above us and our terminal is the one it
    opened: the process just under that app has the same controlling tty as
    this one. A pty made in between (`script`, `expect`) is a different tty,
    and a chain cut off at launchd has no terminal app in it."""
    if not chain or agent_above(chain):
        return False
    own = _tty(chain[0])
    if not own:
        return False
    for i, item in enumerate(chain):
        if i and exe(item[0]) in TERMINAL_HOSTS:
            return _tty(chain[i - 1]) == own
    return False


def _code_hash(code, salt):
    return hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), CODE_ROUNDS).hex()


def _pending_path(b):
    return os.path.join(_dir("pending"), b + ".json")


def _read(path):
    try:
        with open(path) as f:
            got = json.load(f)
        return got if isinstance(got, dict) else None
    except (OSError, ValueError):
        return None


def _misses():
    d = _dir("misses")
    return sum(1 for n in os.listdir(d) if (_read(os.path.join(d, n)) or {}).get("at", 0) > time.time() - 3600)


def _miss(channel):
    path = os.path.join(_dir("misses"), "%d-%s.json" % (time.time() * 1000, secrets.token_hex(8)))
    _write_private(path, {"at": time.time(), "channel": channel})
    return path


TOO_MANY = ("Too many wrong send codes in the last hour, so no code is checked or shown for a while. "
            "Send it from a terminal or the HUD. Nothing was sent.")


def _check_code(channel, to, text, subject, given):
    # The miss is written before the check and taken back only on a match, so
    # guesses run side by side all count before any of them is checked.
    reserved = _miss(channel)
    if _misses() > MAX_MISSES_PER_HOUR:
        raise NoApproval(TOO_MANY)
    path = _pending_path(binding(channel, to, text, subject))
    pend, claim = _claim(path)
    if claim:
        _drop(claim)
    if not pend or time.time() - float(pend.get("at") or 0) > TOKEN_LIFE:
        _drop(reserved)
        raise NoApproval(
            "CHEWBACCA_SEND_CODE doesn't match a code shown for this exact message (a different text or "
            "address, it expired, or another check has it right now). Run it again without the code to put "
            "a new one on the person's screen. Nothing was sent.")
    if re.fullmatch(r"\d{6}", given or "") and hmac.compare_digest(_code_hash(given, pend["salt"]), pend["hash"]):
        _drop(reserved)
        return "code"
    pend["tries"] = int(pend.get("tries") or 0) + 1
    if pend["tries"] >= MAX_CODE_TRIES:
        raise NoApproval("Wrong send code three times, so that code is gone. Nothing was sent.")
    # Put back only while claimed, so a guess racing this one finds no file
    # and is refused rather than spending a try nobody counted.
    _write_private(path, pend)
    raise NoApproval("That isn't the send code on the person's screen; only they can read it to you. Nothing was sent.")


def _kit_root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def _what(channel, to, text, subject):
    line = " ".join(str(text).split())
    return "%s to %s: %s%s" % (channel, to, ("[%s] " % subject) if subject else "", line)


def show_code(code, what):
    """Put the code in front of the person and nowhere else. True when some
    surface took it. CHEWBACCA_SEND_CODE_SHOW=off shows nothing (the tests);
    it can only hide a code, never reveal one."""
    if os.environ.get("CHEWBACCA_SEND_CODE_SHOW") == "off":
        return False
    q = json.dumps
    lines = [
        "@ send-code at=top w=440 life=%d" % RESHOW_AFTER,
        'c s Screen title="SEND CODE"',
        "r s",
        "c code Text value=%s tone=accent" % q(code),
        "c what Text value=%s tone=muted" % q(what[:140]),
        "c how Text value=%s tone=muted" % q("Read this code to the assistant only if you want it sent."),
        "> s code what how",
    ]
    env = dict(os.environ, KYBER_LIVE_OK="1")
    try:
        drawn = subprocess.run([os.path.join(_kit_root(), "bin", "hud"), "draw"], input="\n".join(lines) + "\n",
                               env=env, capture_output=True, text=True, timeout=10)
        if drawn.returncode == 0:
            return True
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        note = subprocess.run(["/usr/bin/osascript", "-e", "display notification %s with title %s"
                               % (q(what[:140]), q("Chewbacca send code " + code))],
                              capture_output=True, timeout=10)
        return note.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _request_code(channel, to, text, subject, show):
    path = _pending_path(binding(channel, to, text, subject))
    pend = _read(path)
    if pend and time.time() - float(pend.get("shown_at") or 0) < RESHOW_AFTER:
        raise NoApproval(
            "No press for this send yet. A six-digit send code for it is on the person's screen; if they "
            "want it sent they'll read it to you, then run the same command with CHEWBACCA_SEND_CODE=<code>. "
            "Nothing was sent.")
    if _misses() >= MAX_MISSES_PER_HOUR:
        _log("refused", channel, to, reason="too many wrong codes")
        raise NoApproval(TOO_MANY)
    live = [n for n in os.listdir(_dir("pending"))
            if time.time() - float((_read(os.path.join(_dir("pending"), n)) or {}).get("at") or 0) <= TOKEN_LIFE]
    if len(live) >= MAX_PENDING:
        _log("refused", channel, to, reason="too many codes waiting")
        raise NoApproval(
            "%d send codes are already waiting on the person's screen. Let those finish or expire first. "
            "Nothing was sent." % len(live))
    code = "%06d" % secrets.randbelow(1000000)
    salt = secrets.token_hex(16)
    if not show(code, _what(channel, to, text, subject)):
        _log("refused", channel, to, reason="no screen for the code")
        raise NoApproval(
            "No press for this send, and no way to show the person a send code here (no HUD, no "
            "notifications). Send it from a terminal, or from the HUD. Nothing was sent.")
    _write_private(path, {"salt": salt, "hash": _code_hash(code, salt), "tries": 0,
                          "at": time.time(), "shown_at": time.time(), "channel": channel, "to": to})
    _log("code-shown", channel, to)
    raise NoApproval(
        "No press for this send yet. A six-digit send code is on the person's screen now, and only there. "
        "Show them the message; if they want it sent they'll read you the code, then run the same command "
        "with CHEWBACCA_SEND_CODE=<code>. Never guess it. Nothing was sent.")


def tty_press(channel, to, text, subject=""):
    """True when someone typed `send` at the controlling terminal, False when
    they typed anything else, None when there's no terminal to ask."""
    try:
        fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
    except OSError:
        return None
    # Raw reads and writes: a text-mode "r+" file on a tty raises "not
    # seekable" on 3.9.
    prompt = "\nSend this %s message to %s?\n%s  %s\nType send to send it, anything else cancels: " % (
        channel, to, ("  Subject: %s\n" % subject) if subject else "", str(text)[:400])
    answer = b""
    try:
        os.write(fd, prompt.encode("utf-8", "replace"))
        while len(answer) < 64:
            ch = os.read(fd, 1)
            if not ch or ch == b"\n":
                break
            answer += ch
    except OSError:
        return None
    finally:
        os.close(fd)
    return answer.decode("utf-8", "replace").strip().lower() == "send"


def _policy_refusal(channel, env):
    here = os.path.dirname(os.path.realpath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    try:
        import send_policy
        answer = send_policy.ask_raw("text", send_policy.text_context(channel, env=env))
    except Exception as e:  # a module that won't load is no answer, logged, never a crash
        _log("policy-error", channel, "", reason=str(e)[:200])
        return None
    # Only a named rule refuses. A reader that broke is no answer, and the
    # sink's inline checks stand: agents send by default (Caleb, 2026-10-12).
    if not send_policy.refuses(answer):
        if answer.get("decision") == "deny":
            _log("policy-error", channel, "", reason="; ".join(answer.get("errors") or [])[:200])
        return None
    return send_policy.why_not(answer)


def take(channel, to, text, subject="", show=None, tty=None, env=None, chain=False, exe=exe_path,
         always_press=False):
    """Consume the approval for this exact message, or raise NoApproval.
    Returns which press approved it: a minted token's press, hud, code or tty.

    always_press is for spending money (a USC mobile order): agents send
    messages by default, but spending is a press whatever the mode file says
    (Caleb's brief for USC mobile order, 2026-10-13)."""
    channel, to, text, subject = str(channel), str(to), str(text), str(subject or "")
    env = os.environ if env is None else env
    # The rules (config/send-policy.cedar) come before any press: a send the
    # policy refuses is refused even with a token in hand, and the token stays
    # unspent. No binary built here means no answer, and the sink's own inline
    # checks stand exactly as before.
    refused = _policy_refusal(channel, env)
    if refused:
        _log("refused", channel, to, reason="send policy")
        raise NoApproval(refused)
    if mode() != "press" and not always_press:
        _log("take", channel, to, "agent")
        return "agent"
    press = _take_token(channel, to, text, subject)
    if press:
        _log("take", channel, to, press)
        return press
    chain = ancestry() if chain is False else chain
    if hud_press(chain, exe):
        _log("take", channel, to, "hud")
        return "hud"
    given = (env.get("CHEWBACCA_SEND_CODE") or "").strip()
    if given:
        try:
            press = _check_code(channel, to, text, subject, given)
        except NoApproval as e:
            _log("refused", channel, to, reason=str(e)[:120])
            raise
        _log("take", channel, to, press)
        return press
    if terminal_owned(chain, exe):
        typed = (tty or tty_press)(channel, to, text, subject)
        if typed:
            _log("take", channel, to, "tty")
            return "tty"
        if typed is False:
            _log("refused", channel, to, reason="cancelled at the terminal")
            raise NoApproval("Cancelled at the terminal. Nothing was sent.")
    _request_code(channel, to, text, subject, show or show_code)


def refusal(channel, to, text, subject=""):
    """take() for callers that report errors as strings: None when approved."""
    try:
        take(channel, to, text, subject)
        return None
    except NoApproval as e:
        return str(e)


def status():
    out = {"pending": [], "tokens": []}
    for kind in ("pending", "tokens"):
        d = os.path.join(root(), kind)
        for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            got = _read(os.path.join(d, name))
            if got and time.time() - float(got.get("at") or 0) <= TOKEN_LIFE:
                out[kind].append({"channel": got.get("channel"), "to": got.get("to"),
                                  "age_s": int(time.time() - float(got.get("at") or 0))})
    return out


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog="send_approval.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("take", help="consume the approval for one message; the text is on stdin")
    t.add_argument("--channel", required=True)
    t.add_argument("--to", required=True)
    t.add_argument("--subject", default="")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0
    # Bytes, decoded once: text mode would turn \r\n into \n, and the
    # approval minted for the raw text would never match.
    text = sys.stdin.buffer.read().decode("utf-8", "replace")
    try:
        print(take(a.channel, a.to, text, a.subject))
        return 0
    except NoApproval as e:
        print(str(e), file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
