#!/usr/bin/env python3
"""CHW-206: the consent line is on the glass before any audio is written.

A fake Kyber listens on a temp socket: it logs every line it reads, in order,
answers `listen` with a version line the way Kyber does, and can push an
event to whoever drew the surface. `room-capture start` runs in this process
with its helper and watcher replaced by a recorder whose helper "writes
audio" (a chunk file and a log entry) the moment it is spawned, so the one
log says which came first. Nothing records and nothing is played.

What is held: the consent surface is valid Kyber Lines with one line of text
and a Stop press; room-capture start draws it and waits for Kyber's answer
before the helper exists; with no glass the same line goes to the terminal
before the helper exists; Kyber refusing the drawing is not "drawn"; the
recording process that owns the surface hears only its own Stop press, and
takes the surface down when it ends; with --no-mic the line names only the
call audio; and room-listen announces before ffmpeg opens the mic.
"""
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_kyber_surfaces as tks  # noqa: E402  validate()

import capture_consent as CC  # noqa: E402
import meeting_capture as MC  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TOKEN = "ab" * 32

failed = 0
# Unix socket paths are capped near 104 bytes on macOS, so the sockets live
# in short /tmp dirs, removed at the end.
SOCKET_DIRS: list[str] = []


def sock_dir() -> str:
    d = tempfile.mkdtemp(prefix="cc", dir="/tmp")
    SOCKET_DIRS.append(d)
    return d


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


class FakeKyber:
    """A Kyber socket: logs lines, answers listen, can push an event."""

    def __init__(self, path: str, log: list, refuse: str = ""):
        self.path, self.log, self.refuse = path, log, refuse
        self.conns: list[socket.socket] = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen(8)
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            self.conns.append(conn)
            threading.Thread(target=self.serve, args=(conn,), daemon=True).start()

    def serve(self, conn):
        buffer = b""
        while True:
            try:
                chunk = conn.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                line = raw.decode()
                self.log.append(("kyber", line))
                if self.refuse and line.startswith("c ") and self.refuse in line:
                    conn.sendall(b'! "`c` needs an id and a type"\n')
                if line.startswith("listen"):
                    conn.sendall(b'v! "kyber/1 verbs=c,>,d,r,@,-,listen"\n')

    def push(self, line: str):
        for conn in self.conns:
            try:
                conn.sendall((line + "\n").encode())
            except OSError:
                pass

    def close(self):
        self.server.close()
        for conn in self.conns:
            conn.close()


def wait_for(cond, seconds=3.0):
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def load(name: str, path: Path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


LINE = re.compile(r"^c capture[A-Za-z0-9-]*-line ")


def drawing() -> None:
    lines = CC.lines(CC.capture_line(), name=CC.surface_name("20261010043000123"))
    check("the consent surface is valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    text = json.loads(next(x for x in lines if LINE.match(x)).split("value=", 1)[1])
    check("its one line names recording and transcribing on this Mac",
          text.startswith("Recording now:") and "transcribed on this Mac" in text, text)
    check("the owner's drawing carries a Stop press whose action hud-listen never hands to a model",
          any('action="ks-capture-stop"' in x for x in lines))
    check("a capture's surface name is its own and a Kyber id",
          CC.surface_name("a/b c‮1") == "capture-abc1" and CC.surface_name("") == "capture")
    check("with --no-mic the line names only the call audio",
          "mic" not in CC.capture_line(mic=False) and "call audio" in CC.capture_line(mic=False))
    check("with the summary off it says nothing leaves this Mac",
          "Nothing leaves this Mac" in CC.capture_line(summary=False))


def patched_rc(name: str, home: Path, log: list, err: io.StringIO, running: bool = False):
    rc = load(name, ROOT / "bin" / "room-capture")

    def spawn(argv, logfile):
        if "--out" in argv:
            # The helper: audio exists the moment it runs.
            out = Path(argv[argv.index("--out") + 1])
            out.mkdir(parents=True, exist_ok=True)
            (out / "c000001-1791129600000.wav").write_bytes(b"RIFF")
            log.append(("audio", "c000001"))
            log.append(("terminal-at-audio", err.getvalue()))
        else:
            log.append(("watcher", argv))
        return 4242

    rc.home = lambda: home
    rc.MC = type("MCShim", (), {k: getattr(rc.MC, k) for k in dir(rc.MC) if not k.startswith("__")})
    rc.MC.capture_state = staticmethod(lambda h: {"running": running, "helper_pid": 4242 if running else 0,
                                                  "watcher_running": running, "since": None, "status": {},
                                                  "stats": {}})
    rc.MC.pid_alive = staticmethod(lambda pid, needle: False)
    rc.build_helper = lambda: ""
    rc.probe = lambda: {"screen": "granted", "mic": "granted", "responsible_app": "Kyber.app"}
    rc.spawn = spawn
    rc.FIRST_STATUS_S = 0.0
    rc.os = type("OsShim", (), {"kill": staticmethod(lambda pid, sig: log.append(("kill", pid))),
                                "getpid": os.getpid, "unlink": os.unlink, "open": os.open, "close": os.close,
                                "fdopen": os.fdopen, "O_WRONLY": os.O_WRONLY, "O_CREAT": os.O_CREAT,
                                "O_TRUNC": os.O_TRUNC, "O_APPEND": os.O_APPEND, "environ": os.environ})
    return rc


def run_rc(rc, argv: list, sock: str) -> dict:
    old_sock = os.environ.get("BOB_HUD_SOCKET")
    os.environ["BOB_HUD_SOCKET"] = sock
    out = io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(io.StringIO()):
            rc.main(argv)
    finally:
        if old_sock is None:
            os.environ.pop("BOB_HUD_SOCKET", None)
        else:
            os.environ["BOB_HUD_SOCKET"] = old_sock
    return json.loads(out.getvalue().strip().splitlines()[-1])


def start_order(tmp: Path, sock: str, glass: bool) -> tuple[list, str, dict, Path]:
    """room-capture start with its helper replaced; returns the shared log."""
    log: list = []
    kyber = FakeKyber(sock, log) if glass else None
    home = tmp / ("home-glass" if glass else "home-none")
    home.mkdir()
    err = io.StringIO()
    rc = patched_rc(f"rc_{glass}", home, log, err)
    old_sock = os.environ.get("BOB_HUD_SOCKET")
    os.environ["BOB_HUD_SOCKET"] = sock
    out = io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            rc.main(["start", "--json"])
    finally:
        if old_sock is None:
            os.environ.pop("BOB_HUD_SOCKET", None)
        else:
            os.environ["BOB_HUD_SOCKET"] = old_sock
        if kyber:
            kyber.close()
    return log, err.getvalue(), json.loads(out.getvalue().strip().splitlines()[-1]), home


def starting(tmp: Path) -> None:
    sock = sock_dir() + "/hud.sock"
    Path(sock).with_name("hud.token").write_text(TOKEN)
    log, _, body, home = start_order(tmp, sock, glass=True)
    kinds = [k for k, _ in log]
    drawn = next((n for n, (k, line) in enumerate(log) if k == "kyber" and LINE.match(line)), None)
    audio = kinds.index("audio") if "audio" in kinds else None
    check("room-capture start draws the consent line before any audio is written",
          drawn is not None and audio is not None and drawn < audio, log)
    acked = [n for n, (k, line) in enumerate(log) if k == "kyber" and line.startswith("listen token=")]
    check("and waits for Kyber's answer to a listen sent after the drawing, also before the audio",
          len(acked) >= 2 and drawn < acked[1] < audio, log)
    check("the starter draws no Stop press, because nothing it leaves running would hear it",
          not any(k == "kyber" and "ks-capture-stop" in line for k, line in log), log)
    surface = (MC.capture_dir(home) / "consent.id").read_text().strip()
    watcher = next(v for k, v in log if k == "watcher")
    check("this capture's own surface is named, recorded, and handed to the watcher that owns Stop",
          surface.startswith("capture-") and any(line.startswith(f"@ {surface} ") for _, line in log)
          and watcher[watcher.index("--consent") + 1] == surface, (surface, watcher))
    check("its answer says the notice went to the glass", body.get("consent") == "glass", body)

    missing = sock_dir() + "/none.sock"
    log, err, body, _ = start_order(tmp, missing, glass=False)
    at_audio = next((v for k, v in log if k == "terminal-at-audio"), "")
    check("with no glass the same line is on the terminal before any audio is written",
          "Recording now:" in at_audio and "Kyber isn't running" in at_audio, at_audio)
    check("and the answer says so", body.get("consent") == "terminal" and "terminal" in body.get("message", ""), body)

    # Stop takes down this capture's line and no other.
    log = []
    sock = sock_dir() + "/hud.sock"
    kyber = FakeKyber(sock, log)
    stop_home = tmp / "home-stop"
    MC.private_dir(MC.capture_dir(stop_home))
    (MC.capture_dir(stop_home) / "consent.id").write_text("capture-mine")
    try:
        run_rc(patched_rc("rc_stop", stop_home, log, io.StringIO(), running=True), ["stop", "--wait", "0", "--json"],
               sock)
        wait_for(lambda: ("kyber", "- capture-mine") in log)
    finally:
        kyber.close()
    removed = [line for k, line in log if k == "kyber" and line.startswith("- ")]
    check("room-capture stop takes down only its own capture's line", removed == ["- capture-mine"], log)


def refused() -> None:
    log: list = []
    sock = sock_dir() + "/hud.sock"
    kyber = FakeKyber(sock, log, refuse="-line ")
    Path(sock).with_name("hud.token").write_text(TOKEN)
    try:
        shown = CC.show(CC.capture_line(), path=sock)
    finally:
        kyber.close()
    check("a drawing Kyber refuses is not counted as drawn", not shown["drawn"] and "refused" in shown["why"], shown)


def owning() -> None:
    log: list = []
    sock = sock_dir() + "/hud.sock"
    Path(sock).with_name("hud.token").write_text(TOKEN)
    kyber = FakeKyber(sock, log)
    stops, other = [], []
    glass = CC.Glass(path=sock, name="capture-a")
    second = CC.Glass(path=sock, name="capture-b")
    try:
        hears = glass.own(CC.capture_line(), lambda: stops.append(1))
        second.own(CC.capture_line(), lambda: other.append(1))
        wait_for(lambda: sum(line.startswith("r capture-") for _, line in log) >= 2)
        first_stop = next((n for n, (_, line) in enumerate(log) if "ks-capture-stop" in line), None)
        first_listen = next((n for n, (_, line) in enumerate(log) if line == f"listen token={TOKEN}"), None)
        check("Stop appears only on the owner's drawing, after it subscribed, so the first frame with Stop is heard",
              hears and first_listen is not None and first_stop is not None and first_listen < first_stop, log)
        kyber.push('e ks-act meetings-items surface="meetings"')
        kyber.push('e ks-capture-stop capture-b-stop surface="capture-b"')
        time.sleep(0.2)
        check("another capture's Stop never stops this one", stops == [] and other == [1], (stops, other))
        kyber.push('e ks-capture-stop capture-a-stop surface="capture-a"')
        check("its own Stop press stops it, once", wait_for(lambda: stops == [1]), stops)
        kyber.push('e ks-capture-stop capture-a-stop surface="capture-a"')
        time.sleep(0.2)
        check("a second Stop press does nothing more", stops == [1], stops)
        glass.close()
        check("ending takes down its own surface and not the other's",
              wait_for(lambda: ("kyber", "- capture-a") in log) and ("kyber", "- capture-b") not in log, log)
        check("close shuts the socket so the reader thread ends", glass.sock is None)
        second.close()
    finally:
        kyber.close()
    tokenless = sock_dir() + "/hud.sock"
    log2: list = []
    kyber = FakeKyber(tokenless, log2)
    try:
        glass = CC.Glass(path=tokenless)
        hears = glass.own(CC.capture_line(), lambda: None)
        wait_for(lambda: any(line.startswith("r capture") for _, line in log2))
        check("without the token there is no Stop button nobody would hear",
              not hears and not any("capture-stop" in line for _, line in log2), log2)
        glass.close()
    finally:
        kyber.close()


def leftovers(tmp: Path) -> None:
    home = tmp / "home-left"
    chunks = MC.private_dir(MC.chunks_dir(home))
    old = chunks / "c000009-1791129600000.wav.part"
    old.write_bytes(b"RIFF")
    cut = time.time() + 1
    fresh = chunks / "c000010-1791129700000.wav"
    fresh.write_bytes(b"RIFF")
    os.utime(fresh, (cut + 5, cut + 5))
    saved = MC.capture_state
    MC.capture_state = lambda h: {"running": True}
    try:
        kept = MC.discard_leftovers(home, cut)
    finally:
        MC.capture_state = saved
    check("nothing is discarded while a helper records", kept == 0 and old.exists())
    gone = MC.discard_leftovers(home, cut)
    check("after a stop, half-written audio from before it is deleted, and nothing newer",
          gone == 1 and not old.exists() and fresh.exists(), (gone, list(chunks.iterdir())))
    check("the watcher discards leftovers when it ends", "discard_leftovers(home, time.time())"
          in (ROOT / "bin" / "lib" / "meeting_capture.py").read_text())


def room_listen() -> None:
    log: list = []
    sock = sock_dir() + "/hud.sock"
    Path(sock).with_name("hud.token").write_text(TOKEN)
    kyber = FakeKyber(sock, log)
    rl = load("room_listen_cli", ROOT / "bin" / "room-listen")
    work = Path(sock_dir()) / "rl-tmp"
    work.mkdir()

    class Rec:
        def __init__(self, argv, **kw):
            log.append(("ffmpeg", argv[0]))
            for n in range(3):
                (work / f"c{n:06d}.wav").write_bytes(b"RIFF")
            self.code = None

        def poll(self):
            return self.code

        def terminate(self):
            self.code = 0

    fake_whisper = type(sys)("mlx_whisper")
    fake_whisper.transcribe = lambda path, **kw: {"text": "we said a thing"}
    old = (rl.subprocess.Popen, rl.tempfile.mkdtemp, sys.argv, os.environ.get("BOB_HUD_SOCKET"),
           sys.modules.get("mlx_whisper"))
    rl.subprocess.Popen = Rec
    rl.tempfile.mkdtemp = lambda prefix="": str(work)
    sys.modules["mlx_whisper"] = fake_whisper
    sys.argv = ["room-listen", "--out", str(work.parent / "live.txt")]
    os.environ["BOB_HUD_SOCKET"] = sock
    done = threading.Event()
    errors: list = []

    def go():
        try:
            rl.main()
        except BaseException as err:  # noqa: BLE001  SystemExit is the failure being looked for
            errors.append(err)
        done.set()

    try:
        threading.Thread(target=go, daemon=True).start()
        heard = wait_for(lambda: any("ks-capture-stop" in line for _, line in log), 5)
        surface = next((line.split()[1] for _, line in log if line.startswith("@ capture-l")), "")
        kyber.push(f'e ks-capture-stop {surface}-stop surface="{surface}"')
        done.wait(6)
    finally:
        rl.subprocess.Popen, rl.tempfile.mkdtemp, sys.argv = old[0], old[1], old[2]
        if old[3] is None:
            os.environ.pop("BOB_HUD_SOCKET", None)
        else:
            os.environ["BOB_HUD_SOCKET"] = old[3]
        if old[4] is None:
            sys.modules.pop("mlx_whisper", None)
        else:
            sys.modules["mlx_whisper"] = old[4]
        kyber.close()
    drawn = next((n for n, (k, line) in enumerate(log) if k == "kyber" and LINE.match(line)), None)
    opened = next((n for n, (k, _) in enumerate(log) if k == "ffmpeg"), None)
    check("room-listen draws the consent line before ffmpeg opens the mic",
          drawn is not None and opened is not None and drawn < opened, log)
    check("its Stop press on the glass ends the run cleanly", heard and done.is_set() and not errors, errors)
    check("after a Stop, the untranscribed segments and the temp folder are gone", not work.exists(),
          list(work.iterdir()) if work.exists() else [])


def main() -> int:
    drawing()
    with tempfile.TemporaryDirectory() as d:
        starting(Path(d))
        leftovers(Path(d))
    refused()
    owning()
    room_listen()
    for d in SOCKET_DIRS:
        shutil.rmtree(d, ignore_errors=True)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
