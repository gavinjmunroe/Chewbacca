#!/usr/bin/env python3
"""Send approval: nothing reaches another person without a person's press.

Every sink (people send, mac-db's iMessage path, Mail.app via email_reader,
gmail, slack, matrix, a plan's send step) calls take(channel, to, text) right
before it hands the message over. take() returns the kind of press that
approved this exact message, or raises NoApproval and nothing is sent. An
approval is bound to the channel, the address and the text, works once, and
dies after 15 minutes. The plan is docs/plans/send-approval.md.

What counts as a press, checked in this order:

1. A token a press handler already minted for this exact message. Only press
   handlers mint: kit_confirm in bin/lib/mcp-writes.js after the six-digit
   code it showed checks out, and this module after 2 to 4 below. There is
   no mint command, so no flag an agent passes makes one.
2. A HUD button press. Until the HUD surfaces mint tokens themselves (the
   HUD lane), a send whose process tree runs up to the `kyber-surfaces run`
   press handler, with no agent and no job runner above it, counts.
3. CHEWBACCA_SEND_CODE set to the six-digit code this module put on the
   person's screen for this exact message. The person reads it out only if
   they want it sent.
4. `send` typed at a real terminal that no agent's process tree owns.

Otherwise take() puts a code on the person's screen (a HUD toast, or a macOS
notification when the HUD is down; neither takes focus) and refuses.

What this does not stop: a process running as the same user can write a
token file by hand, or drive the screen to read the code. Both are deliberate
circumvention, not a flag or a habit, and both are named in the plan.

    send_approval.py take --channel C --to T      the text on stdin; exit 0
                                                  prints the press, exit 3 refuses
    send_approval.py status                       pending codes and live tokens

Runs on /usr/bin/python3 3.9.
"""
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
# hud-listen (the voice agent) and realm-engine (the agents IDE) are agents
# that run under Kyber, so Kyber above them proves no press.
AGENT = re.compile(r"(^|/)(claude|codex)(\s|$)|claude-code|@anthropic-ai/|/Claude\.app/|/Codex\.app/"
                   r"|chewbacca-jobs|(^|/)hud-listen(\s|$)|(^|/)realm-engine(\s|$)|/realm/")
# The HUD's press handlers, as `ps` showed them on 2026-10-12: Kyber.app,
# which runs `kyber-surfaces home --send <id>` when the home panel's Send is
# pressed, and the surfaces daemon (.../bin/kyber-surfaces run) that takes
# button presses over hud.sock.
HUD_HANDLER = re.compile(r"/Kyber\.app/Contents/MacOS/Kyber(\s|$)|(^|/)kyber-surfaces run(\s|$)")


class NoApproval(Exception):
    """Nothing was sent: no press approved this exact message."""


def root():
    return os.environ.get("CHEWBACCA_SEND_APPROVALS") or os.path.expanduser("~/.chewbacca/send-approvals")


def _dir(name):
    path = os.path.join(root(), name)
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(root(), 0o700)
    os.chmod(path, 0o700)
    return path


def binding(channel, to, text):
    """The one key an approval is good for: this channel, this address, this text."""
    raw = "\0".join((str(channel), str(to), str(text)))
    return hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest()


def _text_sha(text):
    return hashlib.sha256(str(text).encode("utf-8", "surrogatepass")).hexdigest()


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
        fd = os.open(os.path.join(root(), "log.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a") as f:
            f.write(json.dumps(row) + "\n")
    except OSError:
        pass


def mint(channel, to, text, press):
    """For press handlers only: approve this exact message once."""
    b = binding(channel, to, text)
    _write_private(os.path.join(_dir("tokens"), b + ".json"),
                   {"channel": channel, "to": to, "text_sha": _text_sha(text),
                    "press": press, "at": time.time()})
    _log("mint", channel, to, press)
    return b


def _take_token(channel, to, text):
    b = binding(channel, to, text)
    path = os.path.join(_dir("tokens"), b + ".json")
    claim = "%s.taken.%d" % (path, os.getpid())
    try:
        # The rename is the single use: two sinks racing for one token can't
        # both win it.
        os.rename(path, claim)
    except OSError:
        return None
    try:
        with open(claim) as f:
            tok = json.load(f)
    except (OSError, ValueError):
        tok = None
    finally:
        try:
            os.unlink(claim)
        except OSError:
            pass
    if not isinstance(tok, dict):
        return None
    if time.time() - float(tok.get("at") or 0) > TOKEN_LIFE:
        return None
    if (tok.get("channel"), tok.get("to"), tok.get("text_sha")) != (channel, to, _text_sha(text)):
        return None
    return str(tok.get("press") or "token")


def ancestry(pid=None, ps_out=None):
    """Command lines from this process up to launchd, or None when ps fails."""
    if ps_out is None:
        try:
            ps_out = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,command="],
                                    capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            return None
    procs = {}
    for line in ps_out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            procs[int(parts[0])] = (int(parts[1]), parts[2] if len(parts) > 2 else "")
    pid = os.getpid() if pid is None else pid
    if pid not in procs:
        return None
    chain, seen = [], set()
    while pid in procs and pid not in seen and pid > 1:
        seen.add(pid)
        ppid, cmd = procs[pid]
        chain.append(cmd)
        pid = ppid
    return chain


def agent_above(chain):
    # Fail closed: no process tree means we can't rule an agent out.
    return chain is None or any(AGENT.search(cmd) for cmd in chain)


def hud_press(chain):
    return chain is not None and not agent_above(chain) and any(HUD_HANDLER.search(cmd) for cmd in chain)


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


def _check_code(channel, to, text, given):
    b = binding(channel, to, text)
    path = _pending_path(b)
    pend = _read(path)
    if not pend or time.time() - float(pend.get("at") or 0) > TOKEN_LIFE:
        raise NoApproval(
            "CHEWBACCA_SEND_CODE doesn't match a code shown for this exact message (a different text or "
            "address, or it expired). Run it again without the code to put a new one on the person's screen. "
            "Nothing was sent.")
    if re.fullmatch(r"\d{6}", given or "") and hmac.compare_digest(_code_hash(given, pend["salt"]), pend["hash"]):
        os.unlink(path)
        return "code"
    pend["tries"] = int(pend.get("tries") or 0) + 1
    if pend["tries"] >= MAX_CODE_TRIES:
        os.unlink(path)
        raise NoApproval("Wrong send code three times, so that code is gone. Nothing was sent.")
    _write_private(path, pend)
    raise NoApproval("That isn't the send code on the person's screen; only they can read it to you. Nothing was sent.")


def _kit_root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


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


def _request_code(channel, to, text, show):
    b = binding(channel, to, text)
    path = _pending_path(b)
    pend = _read(path)
    if pend and time.time() - float(pend.get("shown_at") or 0) < RESHOW_AFTER:
        raise NoApproval(
            "No press for this send yet. A six-digit send code for it is on the person's screen; if they "
            "want it sent they'll read it to you, then run the same command with CHEWBACCA_SEND_CODE=<code>. "
            "Nothing was sent.")
    code = "%06d" % secrets.randbelow(1000000)
    salt = secrets.token_hex(16)
    what = "%s to %s: %s" % (channel, to, " ".join(str(text).split()))
    if not show(code, what):
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


def tty_press(channel, to, text):
    """True when someone typed `send` at the controlling terminal, False when
    they typed anything else, None when there's no terminal to ask."""
    try:
        fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
    except OSError:
        return None
    with os.fdopen(fd, "r+", buffering=1) as tty:
        tty.write("\nSend this %s message to %s?\n  %s\nType send to send it, anything else cancels: "
                  % (channel, to, str(text)[:400]))
        tty.flush()
        answer = tty.readline()
    return answer.strip().lower() == "send"


def take(channel, to, text, show=None, tty=None, env=None, chain=False):
    """Consume the approval for this exact message, or raise NoApproval.
    Returns which press approved it: a minted token's press, hud, code or tty."""
    channel, to, text = str(channel), str(to), str(text)
    env = os.environ if env is None else env
    press = _take_token(channel, to, text)
    if press:
        _log("take", channel, to, press)
        return press
    chain = ancestry() if chain is False else chain
    if hud_press(chain):
        _log("take", channel, to, "hud")
        return "hud"
    given = (env.get("CHEWBACCA_SEND_CODE") or "").strip()
    if given:
        try:
            press = _check_code(channel, to, text, given)
        except NoApproval as e:
            _log("refused", channel, to, reason=str(e)[:120])
            raise
        _log("take", channel, to, press)
        return press
    if not agent_above(chain):
        typed = (tty or tty_press)(channel, to, text)
        if typed:
            _log("take", channel, to, "tty")
            return "tty"
        if typed is False:
            _log("refused", channel, to, reason="cancelled at the terminal")
            raise NoApproval("Cancelled at the terminal. Nothing was sent.")
    _request_code(channel, to, text, show or show_code)


def refusal(channel, to, text):
    """take() for callers that report errors as strings: None when approved."""
    try:
        take(channel, to, text)
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
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0
    text = sys.stdin.read()
    try:
        print(take(a.channel, a.to, text))
        return 0
    except NoApproval as e:
        print(str(e), file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
