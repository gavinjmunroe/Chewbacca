"""A process's argv and environment, read from the kernel, without `ps`.

`ps` is setuid root on macOS, and a sandboxed process (sandbox-exec, Codex's
seatbelt sandbox) may not exec a setuid binary: on 10/13 the stranger rig's
`realm-ui start` waited 10 s and said the page server "did not come up" while
it was serving, because `ps` failed with EPERM and identity came back false.
The kernel answers the same question for a process this user owns through
sysctl KERN_PROCARGS2 on macOS and /proc on Linux, with no exec at all.

    args(pid) -> (argv, env) or None when the kernel won't say

Stdlib only, runs on /usr/bin/python3 3.9.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import struct
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

CTL_KERN = 1
KERN_ARGMAX = 8
KERN_PROCARGS2 = 49


def _darwin(pid: int) -> Optional[Tuple[List[str], Dict[str, str]]]:
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    except OSError:
        return None
    argmax = ctypes.c_int(0)
    size = ctypes.c_size_t(ctypes.sizeof(argmax))
    mib = (ctypes.c_int * 2)(CTL_KERN, KERN_ARGMAX)
    if libc.sysctl(mib, 2, ctypes.byref(argmax), ctypes.byref(size), None, 0) != 0:
        return None
    buf = ctypes.create_string_buffer(argmax.value)
    size = ctypes.c_size_t(argmax.value)
    mib3 = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, pid)
    if libc.sysctl(mib3, 3, buf, ctypes.byref(size), None, 0) != 0:
        return None
    raw = buf.raw[: size.value]
    if len(raw) < 4:
        return None
    argc = struct.unpack("i", raw[:4])[0]
    rest = raw[4:]
    # The exec path, then NUL padding, then argc args, then the environment.
    end = rest.find(b"\0")
    if end < 0:
        return None
    i = end
    while i < len(rest) and rest[i] == 0:
        i += 1
    parts = rest[i:].split(b"\0")
    argv = [p.decode("utf-8", "replace") for p in parts[:argc]]
    env: Dict[str, str] = {}
    for p in parts[argc:]:
        if not p:
            break
        k, sep, v = p.decode("utf-8", "replace").partition("=")
        if sep:
            env[k] = v
    return argv, env


def _linux(pid: int) -> Optional[Tuple[List[str], Dict[str, str]]]:
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes()
        environ = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return None
    argv = [p.decode("utf-8", "replace") for p in cmd.split(b"\0") if p]
    env = {}
    for p in environ.split(b"\0"):
        k, sep, v = p.decode("utf-8", "replace").partition("=")
        if sep:
            env[k] = v
    return argv, env


def args(pid: int) -> Optional[Tuple[List[str], Dict[str, str]]]:
    if not isinstance(pid, int) or pid <= 0:
        return None
    if sys.platform == "darwin":
        return _darwin(pid)
    if sys.platform.startswith("linux"):
        return _linux(pid)
    return None
