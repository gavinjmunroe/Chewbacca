"""Read explicit launch consent from native Desktop composer provenance.

No approval files are created. CLI, agent, automation and unknown turn sources
cannot authorize a launch through this reader.
"""
import datetime as dt
import json
import os
import pwd
from pathlib import Path
import re
import stat
import sys
import time

# The observed Desktop session header is 164 KiB; allow its instruction data,
# but refuse oversized records instead of parsing arbitrary files unbounded.
MAX_RECORD = 1024 * 1024
MAX_TAIL = 8 * MAX_RECORD
TTL = 2 * 3600  # Same two-hour sitting as the existing human approval reader.
SID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
LAUNCH = re.compile(r"(?:(?:bro|please|plz)\s+)*(?:launch(?:\s+the\s+campaigns)?|go|just do it|do it)"
                    r"(?:\s+(?:now|fix it|bro|please|plz))*[!.]*", re.I)
STOP = re.compile(r"^\s*(?:no|nope|nah)\s*[!.]*\s*$|"
                  r"\b(?:stop|pause|cancel|hold|wait|not yet|don['’]?t|do not)\b|"
                  r"\bnever\s+(?:send|launch|relaunch|resume|start|email|do|run|execute|act|"
                  r"proceed|continue|go\s+ahead)\b", re.I)
REPAIR_LAUNCH = re.compile(r"(?:then\s+)?(?:relaunch|launch)\s+(?:them|the campaigns)(?:\s+now)?", re.I)


def explicit_launch(text):
    if LAUNCH.fullmatch(text):
        return True
    # The 10/15 incident instruction included a repair sentence, an explicit
    # 'Then launch them', and 'never make ... again'. Only an imperative
    # sentence in the trusted composer input counts, never a quoted request.
    if any(mark in text for mark in ('?', '"', '`', '<', '\n')):
        return False
    return any(REPAIR_LAUNCH.fullmatch(part.strip())
               for part in re.split(r'[!.]+', text) if part.strip())


def consent_from_records(header, records, session, now):
    meta = header.get("payload", {})
    if (header.get("type") != "session_meta" or meta.get("id") != session
            or meta.get("originator") != "Codex Desktop" or meta.get("source") != "vscode"):
        return None
    turn = None
    result = None
    for record in records:
        p = record.get("payload", {})
        if record.get("type") == "event_msg" and p.get("type") == "task_started":
            a = p.get("turn_attribution") or {}
            turn = (a.get("turn_id") if a.get("turn_trigger") == "composer"
                    and a.get("parent_turn_id") is None and a.get("initiating_agent_path") is None
                    and a.get("turn_id") and a.get("root_turn_id") == a.get("turn_id")
                    and p.get("turn_id") == a.get("turn_id") else None)
        if record.get("type") != "response_item" or p.get("type") != "message" or p.get("role") != "user":
            continue
        content = p.get("content") or []
        text = "\n".join(c.get("text", "") for c in content if c.get("type") == "input_text").strip()
        # Revocation is conservative, including steering inputs in an existing
        # turn. Formatting must never hide a later stop behind an old launch.
        if STOP.search(text):
            result = None
            turn = None
            continue
        if not turn:
            continue
        # Only the first user input in a composer turn is user-authored. Later
        # injected context and tool messages cannot renew or cancel consent.
        turn = None
        if not content or any(c.get("type") != "input_text" for c in content):
            continue
        # An ambiguous longer instruction needs normal attended approval.
        # The actual failing prompts were LAUNCH and BRO LAUNCH FIX IT.
        if len(text) > 300 or "\n" in text or "<" in text:
            continue
        if not explicit_launch(text):
            continue
        try:
            stamp = dt.datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                continue
            at = stamp.timestamp()
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= now - at < TTL:
            result = {"v": 3, "at": int(at), "session_id": session,
                      "interactive": True, "excerpt": text[:200],
                      "source": "native Desktop composer"}
    return result


def read_consent(session):
    if not SID.fullmatch(session):
        return None
    root = session_root()
    candidates = list(root.glob(f"*/*/*/rollout-*-{session}.jsonl"))
    if len(candidates) != 1:
        return None
    path = candidates[0]
    if path.resolve() != path or path.is_symlink():
        return None
    with path.open("rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            return None
        first = stream.readline(MAX_RECORD + 1)
        if len(first) > MAX_RECORD:
            return None
        header = json.loads(first)
        offset = max(stream.tell(), info.st_size - MAX_TAIL)
        stream.seek(offset)
        if offset > len(first):
            stream.readline(MAX_RECORD + 1)  # discard a partial first tail record
        records = []
        remaining = MAX_TAIL
        while remaining > 0:
            line = stream.readline(min(MAX_RECORD, remaining) + 1)
            if not line:
                break
            remaining -= len(line)
            if len(line) > MAX_RECORD:
                return None
            try:
                records.append(json.loads(line))
            except ValueError:
                return None
    return consent_from_records(header, records, session, time.time())


def session_root():
    """Use the OS account, as the sender does; HOME is caller-controlled."""
    return Path(pwd.getpwuid(os.getuid()).pw_dir) / ".codex/sessions"


if __name__ == "__main__":
    try:
        session = os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID") or ""
        if (os.environ.get("CODEX_THREAD_ID") and os.environ.get("CODEX_SESSION_ID")
                and os.environ["CODEX_THREAD_ID"] != os.environ["CODEX_SESSION_ID"]):
            raise ValueError("session identities disagree")
        result = read_consent(session)
    except (OSError, ValueError, TypeError, AttributeError, RecursionError):
        result = None
    print(json.dumps(result))
    sys.exit(0 if result else 1)
