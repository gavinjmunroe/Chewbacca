"""Last foreground Chewbacca runtime, shared by the HUD and lifecycle adapters."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time


def state_path():
    home = Path(os.environ.get('CHEWBACCA_HOME', str(Path.home() / '.chewbacca')))
    return Path(os.environ.get('CHEWBACCA_HUD_RUNTIME_STATE',
                               str(home / 'hud-runtime.json')))


def claim(runtime):
    if runtime not in ('codex', 'claude'):
        raise ValueError('unsupported HUD runtime')
    if os.environ.get('CHEWBACCA_HUD_CHILD') == '1':
        return
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = {'runtime': runtime, 'claimed_at_ns': time.time_ns()}
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.hud-runtime-')
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(record, stream)
                stream.write('\n')
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def current():
    try:
        runtime = json.loads(state_path().read_text())['runtime']
    except FileNotFoundError:
        return 'claude'
    if runtime not in ('codex', 'claude'):
        raise ValueError('unsupported saved HUD runtime')
    return runtime


def model_command():
    if current() == 'codex':
        import shlex
        return shlex.quote(str(Path(__file__).resolve().parents[1] / 'bin/hud-codex'))
    return 'claude -p --strict-mcp-config'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', choices=('codex', 'claude'))
    claim(parser.parse_args().runtime)
