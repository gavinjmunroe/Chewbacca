#!/usr/bin/env python3
"""listen_exec.py PORT -- ARGV...: bind 127.0.0.1:PORT, then exec ARGV holding it as fd 3.

chewbacca-daemon runs a service registered with --listen through this, so a
kit move can start the new copy while the old one still serves (reengineer
step 10, blue/green). Node has no SO_REUSEPORT on macOS (`reusePort: true`
throws ENOTSUP on 22.20), and Python does. Measured on this Mac 2026-10-12:
with two SO_REUSEPORT sockets on one port, every new connection goes to the
one bound last, so the new copy takes over the moment it binds and the old
one can stop with nothing waiting on it.

The cost: any process of any user on this Mac that also sets SO_REUSEPORT
can bind the same loopback port (BSD has no uid check for it). Same-user
processes can read the data directly anyway; on a one-person Mac that leaves
no new reader.

The service reads CHEWBACCA_LISTEN_FD and listens on that fd instead of
binding its own port. Stock /usr/bin/python3 is 3.9, so nothing newer here.
"""
import os
import socket
import sys

FD = 3


def answers(port):
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        probe.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def main(argv):
    if len(argv) < 3 or argv[1] != "--" or not argv[0].isdigit():
        print("usage: listen_exec.py PORT -- ARGV...", file=sys.stderr)
        return 2
    port = int(argv[0])
    # SO_REUSEPORT means a second bind no longer fails, so a copy the daemon
    # lost track of (a state write on a full disk) would serve beside the new
    # one for good. Only the new half of a swap may share the port; any other
    # start refuses one that already answers, the way EADDRINUSE used to.
    if os.environ.pop("CHEWBACCA_LISTEN_OVERLAP", "") != "1" and answers(port):
        print("listen_exec: 127.0.0.1:{} already answers; not starting a second copy".format(port), file=sys.stderr)
        return 1
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError as err:
        # The old copy bound without SO_REUSEPORT (the code before this
        # existed): exit like a failed bind would, and the daemon backs off.
        print("listen_exec: 127.0.0.1:{} is held: {}".format(port, err), file=sys.stderr)
        return 1
    # Node's net.Server needs it listening already before it is handed over.
    sock.listen(511)
    if sock.fileno() != FD:
        os.dup2(sock.fileno(), FD)
        sock.close()
    os.set_inheritable(FD, True)
    os.environ["CHEWBACCA_LISTEN_FD"] = str(FD)
    try:
        os.execvp(argv[2], argv[2:])
    except OSError as err:
        print("listen_exec: cannot run {}: {}".format(argv[2], err), file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
