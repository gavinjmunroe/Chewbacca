"""Register a background job with chewbacca-daemon instead of its own LaunchAgent.

Every installer used to write one plist per job, and Login Items listed each
as whatever binary it ran (python3, bash, node, kyber-sessions). Caleb,
2026-10-11: "Chewb should aim to be only 1 thing". Now a job is a JSON file in
~/.chewbacca/daemon/services/ and the one com.chewbacca agent runs it.

Stock /usr/bin/python3 is 3.9 on this Mac, so no `X | None` here.
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

HOME = Path.home()
DAEMON_DIR = Path(os.environ.get("CHEWBACCA_DAEMON_DIR", str(HOME / ".chewbacca" / "daemon")))
AGENTS = Path(os.environ.get("CHEWBACCA_LAUNCH_AGENTS", str(HOME / "Library" / "LaunchAgents")))
ROOT = Path(__file__).resolve().parents[2]


NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SLOT = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate(svc: dict) -> Optional[str]:
    """The same rules chewbacca-daemon applies when it loads a service. A file
    it would skip must never be written, because the old plist is retired right
    after and the job would be gone while the installer said "installed"."""
    if not NAME.match(svc.get("name", "")):
        return "name must be lowercase letters, digits, . _ or -"
    modes = [k for k in ("every", "at", "keepalive", "app") if svc.get(k) not in (None, False)]
    if len(modes) != 1:
        return "give exactly one of every, at, keepalive, app"
    if "every" in svc and not (isinstance(svc["every"], int) and svc["every"] >= 5):
        return "every needs whole seconds, at least 5"
    if "at" in svc and not (svc["at"] and all(SLOT.match(t) for t in svc["at"])):
        return "at needs HH:MM times"
    if svc.get("swap") not in (None, "overlap", "stop-start", "self"):
        return "swap is overlap, stop-start or self"
    if svc.get("swap") == "self" and not svc.get("keepalive"):
        return "swap self needs keepalive"
    if svc.get("swap") == "overlap" and not svc.get("keepalive"):
        return "swap overlap needs keepalive"
    if "listen" in svc and not (isinstance(svc["listen"], int) and 0 < svc["listen"] < 65536):
        return "listen needs a port"
    if "health" in svc and not (isinstance(svc["health"].get("http"), str) and svc["health"]["http"].startswith("/") and "listen" in svc):
        return "health needs an http path starting with / and listen"
    if "app" in svc:
        return None if str(svc["app"]).endswith(".app") else "app needs a .app path"
    if not svc.get("argv") or not all(isinstance(a, str) for a in svc["argv"]):
        return "give the command"
    return None


def _node() -> Optional[str]:
    runtime = HOME / ".chewbacca" / "runtime" / "Chewbacca.app" / "Contents" / "MacOS" / "Chewbacca"
    if runtime.exists():
        return str(runtime)
    return shutil.which("node")


def register(name: str, argv: Optional[List[str]] = None, every: Optional[int] = None,
             keepalive: bool = False, at: Optional[List[str]] = None, app: Optional[str] = None,
             env: Optional[Dict[str, str]] = None, nice: Optional[int] = None,
             legacy_label: Optional[str] = None, ensure_daemon: bool = True,
             swap: Optional[str] = None, listen: Optional[int] = None, health_http: Optional[str] = None) -> str:
    svc = {"name": name}
    if app:
        svc["app"] = app
    else:
        svc["argv"] = list(argv or [])
    if every is not None:
        svc["every"] = int(every)
    if keepalive:
        svc["keepalive"] = True
    if at:
        svc["at"] = list(at)
    if env:
        svc["env"] = dict(env)
    if nice is not None:
        svc["nice"] = int(nice)
    if swap:
        svc["swap"] = swap
    if listen is not None:
        svc["listen"] = int(listen)
    if health_http:
        svc["health"] = {"http": health_http}
    bad = validate(svc)
    if bad:
        raise ValueError("chewbacca-daemon would skip {}: {}".format(name, bad))
    services = DAEMON_DIR / "services"
    services.mkdir(parents=True, exist_ok=True)
    tmp = services / ".{}.{}.tmp".format(name, os.getpid())
    tmp.write_text(json.dumps(svc, indent=2) + "\n")
    os.chmod(str(tmp), 0o600)
    tmp.replace(services / "{}.json".format(name))
    if legacy_label:
        retire(legacy_label)
    if ensure_daemon and not _loaded():
        return install()
    return "registered {} with the Chewbacca background item".format(name)


def _loaded() -> bool:
    if not (AGENTS / "com.chewbacca.plist").exists():
        return False
    r = subprocess.run(["launchctl", "print", "gui/{}/com.chewbacca".format(os.getuid())], capture_output=True)
    return r.returncode == 0


def unregister(name: str) -> None:
    try:
        (DAEMON_DIR / "services" / "{}.json".format(name)).unlink()
    except FileNotFoundError:
        pass


def retire(label: str) -> None:
    """Unload an old per-job LaunchAgent and move its plist out of LaunchAgents."""
    plist = AGENTS / "{}.plist".format(label)
    subprocess.run(["launchctl", "bootout", "gui/{}/{}".format(os.getuid(), label)], capture_output=True)
    if plist.exists():
        legacy = DAEMON_DIR / "legacy"
        legacy.mkdir(parents=True, exist_ok=True)
        plist.replace(legacy / plist.name)


def install() -> str:
    node = _node()
    if not node:
        return "registered, but no node to run the Chewbacca background item"
    r = subprocess.run([node, str(ROOT / "bin" / "chewbacca-daemon"), "install"],
                       capture_output=True, text=True)
    return (r.stdout or r.stderr).strip().splitlines()[0] if (r.stdout or r.stderr) else "installed"
