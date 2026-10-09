"""One clay-build at a time. Two runs would drive the same Clay tab and each
read the other's spend as its own.

The lock is bin/hud-listen's claim_socket: a flock the kernel drops when the
holder dies, so it cannot go stale the way a pid file can, with the pid inside
so a refusal can name who holds it.
"""
from __future__ import annotations

import fcntl
import os
from pathlib import Path


def lock_path(env=None) -> Path:
    env = os.environ if env is None else env
    home = env.get("CHEWBACCA_HOME") or str(Path.home() / ".chewbacca")
    return Path(home).expanduser() / "clay-build.lock"


def acquire(path) -> tuple[int | None, str]:
    """The open descriptor, kept open for the life of the run, or None and
    the holder's pid as text."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # O_RDWR without O_TRUNC: a loser must be able to read the holder's pid.
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        holder = os.read(fd, 32).decode("ascii", "replace").strip()
        os.close(fd)
        return None, holder
    os.ftruncate(fd, 0)
    os.write(fd, str(os.getpid()).encode("ascii"))
    return fd, ""
