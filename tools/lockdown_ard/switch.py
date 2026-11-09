#!/usr/bin/python3
"""Pause Apple's remote management while LockDown Browser runs."""
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import sys
import time

BASE = Path('/Library/Application Support/LockDown ARD Switch')
APPLE = Path('/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents')
ENABLED = Path('/Library/Application Support/Apple/Remote Desktop/RemoteManagement.launchd')
PENDING = BASE / 'restore-pending'
SOCKET = '/var/run/chewbacca-lockdown-ard.sock'


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): '
                           f'{result.stderr.decode(errors="replace").strip()}')
    return result.stdout


def browser_running():
    result = subprocess.run(['/usr/bin/pgrep', '-x', 'LockDown Browser'],
                            capture_output=True, timeout=5)
    if result.returncode not in (0, 1):
        raise RuntimeError('Could not determine whether LockDown Browser is running')
    return result.returncode == 0


def permissions():
    state = plistlib.loads(run(str(APPLE / 'Support/tccstate')))
    if not isinstance(state, dict):
        raise RuntimeError('Unrecognized Apple permission status')
    return {key: state.get(key) for key in ('screenCapture', 'postEvent')}


def ready(state):
    return all(state.get(key) == 1 for key in ('screenCapture', 'postEvent'))


class Switch:
    def __init__(self, pending=PENDING, enabled=ENABLED, command=run,
                 trust=permissions, active=browser_running):
        self.pending, self.enabled = pending, enabled
        self.command, self.trust, self.active = command, trust, active
        self.prepare_until = 0

    def step(self):
        if self.active() or time.monotonic() < self.prepare_until:
            if self.enabled.exists():
                if not self.pending.exists():
                    baseline = self.trust()
                    if not ready(baseline):
                        raise RuntimeError('ARD needs screen recording and control permission '
                                           'before automatic restoration can be verified')
                    # Persist the original state before stopping ARD, including on a crash.
                    temporary = self.pending.with_suffix('.tmp')
                    temporary.write_text(json.dumps(baseline))
                    temporary.chmod(0o600)
                    temporary.replace(self.pending)
                self.command(str(APPLE / 'Resources/kickstart'), '-deactivate', '-stop')
                if self.enabled.exists():
                    raise RuntimeError('Apple did not deactivate Remote Management')
                print('ARD paused for LockDown Browser', flush=True)
        elif self.pending.exists():
            baseline = json.loads(self.pending.read_text())
            if not self.enabled.exists() or self.trust() != baseline:
                self.command(str(APPLE / 'Resources/kickstart'), '-activate', '-restart', '-agent')
            if not self.enabled.exists() or self.trust() != baseline:
                raise RuntimeError('ARD restore did not match original permissions; retrying')
            self.pending.unlink()
            print('ARD restored after LockDown Browser', flush=True)

    def prepare(self):
        # LaunchServices started this app within a second in the live launch check.
        # Fifteen seconds gives the user launcher time to open it, then rolls back.
        self.prepare_until = time.monotonic() + 15
        self.step()
        check = subprocess.run(['/usr/bin/pgrep', '-x', 'ARDAgent'],
                               capture_output=True, timeout=5)
        if check.returncode != 1:
            self.prepare_until = 0
            raise RuntimeError('ARD has not stopped; browser was not launched')


def open_browser():
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(45)
        client.connect(SOCKET)
        client.sendall(b'prepare\n')
        if client.recv(16) != b'ready\n':
            raise SystemExit('ARD could not be paused; check chewbacca lockdown status')
    subprocess.run(['/usr/bin/open', '-a', '/Applications/LockDown Browser.app'], check=True)


def main():
    if sys.argv[1:] == ['--open']:
        open_browser()
        return
    if os.geteuid() != 0:
        raise SystemExit('This watcher must be installed with administrator approval')
    switch = Switch()
    if sys.argv[1:] == ['--check']:
        if browser_running():
            raise SystemExit('Close LockDown Browser before installing')
        if not ENABLED.exists() or not ready(permissions()):
            raise SystemExit('Enable Remote Management in Sharing settings first')
        print('Existing ARD screen and control permissions verified')
        return
    if sys.argv[1:] == ['--restore']:
        if browser_running():
            raise SystemExit('Close LockDown Browser before uninstalling')
        switch.step()
        return
    if sys.argv[1:]:
        raise SystemExit('Unknown argument')
    # /var/run is root owned, so the user cannot replace the socket with a symlink.
    if os.path.lexists(SOCKET):
        os.unlink(SOCKET)
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(SOCKET)
        # Only the installing user may ask to pause ARD; no commands are accepted.
        os.chown(SOCKET, int((BASE / 'owner').read_text().strip()), -1)
        os.chmod(SOCKET, 0o600)
        server.listen(1)
        server.settimeout(1)
        while True:
            try:
                switch.step()
                try:
                    connection, _ = server.accept()
                except socket.timeout:
                    continue
                with connection:
                    connection.settimeout(1)
                    if connection.recv(16) == b'prepare\n':
                        switch.prepare()
                        connection.sendall(b'ready\n')
            except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                print(f'ARD switch needs attention: {error}', file=sys.stderr, flush=True)
                # Failed permission restoration must not flood logs or busy-loop.
                time.sleep(5)


if __name__ == '__main__':
    main()
