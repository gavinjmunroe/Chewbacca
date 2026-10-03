"""Read native execution metadata; command stdout is never execution evidence.

Only the native hook's transcript_path is read. At most the final 4 MiB is
examined, with individual JSONL records limited to 256 KiB. Missing, truncated,
rotated, oversized, or ephemeral transcripts yield unknown rather than success.
The transcript is trusted as host-generated metadata, not an adversary-proof
log: an actor able to edit the native transcript can forge its records.
"""
import json
import os
from pathlib import Path
import stat

MAX_TAIL_BYTES = 4 * 1024 * 1024
MAX_RECORD_BYTES = 256 * 1024


def _identity_matches(record, hook):
    for name, expected in (('session_id', hook.get('session_id')),
                           ('thread_id', hook.get('session_id')),
                           ('turn_id', hook.get('turn_id'))):
        if name in record and record[name] != expected:
            return False
    return True


def native_exit_code(payload):
    """Return an integer exit status for the exact hook call, or None.

    Supports current item_completed/CommandExecution records and legacy
    exec_command_end events. Never searches command output or response items.
    Present native session/turn identifiers must agree with the hook payload.
    """
    path = payload.get('transcript_path')
    call_id = payload.get('tool_use_id')
    if not isinstance(path, str) or not path or not isinstance(call_id, str) or not call_id:
        return None
    try:
        # NONBLOCK prevents a supplied FIFO from hanging the hook before fstat.
        fd = os.open(Path(path), os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                return None
            offset = max(0, info.st_size - MAX_TAIL_BYTES)
            stream.seek(offset)
            data = stream.read(MAX_TAIL_BYTES)
        if offset:
            _, _, data = data.partition(b'\n')
    except (OSError, ValueError):
        return None
    for line in reversed(data.splitlines()):
        if len(line) > MAX_RECORD_BYTES:
            continue
        try:
            envelope = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            continue
        if not isinstance(envelope, dict) or envelope.get('type') != 'event_msg':
            continue
        event = envelope.get('payload')
        if not isinstance(event, dict) or not _identity_matches(event, payload):
            continue
        if event.get('type') == 'item_completed':
            item = event.get('item')
            if not isinstance(item, dict) or item.get('type') != 'CommandExecution':
                continue
            if item.get('id') != call_id or not _identity_matches(item, payload):
                continue
            if item.get('status') not in ('completed', 'failed'):
                return None
            code = item.get('exit_code')
        elif event.get('type') == 'exec_command_end':
            if event.get('call_id') != call_id:
                continue
            code = event.get('exit_code')
        else:
            continue
        return code if type(code) is int else None
    return None
