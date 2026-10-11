"""Register a background job with chewbacca-daemon instead of its own LaunchAgent.

Every installer used to write one plist per job, and Login Items listed each
as whatever binary it ran (python3, bash, node, kyber-sessions). Caleb,
2026-10-11: "Chewb should aim to be only 1 thing". Now a job is a JSON file in
~/.chewbacca/daemon/services/ and the one com.chewbacca agent runs it.

Stock /usr/bin/python3 is 3.9 on this Mac, so no `X | None` here.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

HOME = Path.home()
DAEMON_DIR = Path(os.environ.get("CHEWBACCA_DAEMON_DIR", str(HOME / ".chewbacca" / "daemon")))
AGENTS = Path(os.environ.get("CHEWBACCA_LAUNCH_AGENTS", str(HOME / "Library" / "LaunchAgents")))
ROOT = Path(__file__).resolve().parents[2]


def _node() -> Optional[str]:
    runtime = HOME / ".chewbacca" / "runtime" / "Chewbacca.app" / "Contents" / "MacOS" / "Chewbacca"
    if runtime.exists():
        return str(runtime)
    return shutil.which("node")


def register(name: str, argv: Optional[List[str]] = None, every: Optional[int] = None,
             keepalive: bool = False, at: Optional[List[str]] = None, app: Optional[str] = None,
             env: Optional[Dict[str, str]] = None, nice: Optional[int] = None,
             legacy_label: Optional[str] = None, ensure_daemon: bool = True) -> str:
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
    services = DAEMON_DIR / "services"
    services.mkdir(parents=True, exist_ok=True)
    tmp = services / ".{}.{}.tmp".format(name, os.getpid())
    tmp.write_text(json.dumps(svc, indent=2) + "\n")
    os.chmod(str(tmp), 0o600)
    tmp.replace(services / "{}.json".format(name))
    if legacy_label:
        retire(legacy_label)
    if ensure_daemon and not (AGENTS / "com.chewbacca.plist").exists():
        return install()
    return "registered {} with the Chewbacca background item".format(name)


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
