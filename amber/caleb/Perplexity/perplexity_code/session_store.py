from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def get_sessions_dir(root: Path) -> Path:
    path = root / ".perplexity" / "sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _state_payload(history, mode, recent_files, summary):
    return {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "recent_files": list(recent_files),
        "summary": list(summary),
        "history": history,
    }


def save_current(root: Path, history, mode, recent_files, summary) -> Path:
    path = get_sessions_dir(root) / "current.json"
    path.write_text(
        json.dumps(_state_payload(history, mode, recent_files, summary), indent=2),
        encoding="utf-8",
    )
    return path


def save_snapshot(root: Path, history, mode, recent_files, summary) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = get_sessions_dir(root) / f"session-{stamp}.json"
    path.write_text(
        json.dumps(_state_payload(history, mode, recent_files, summary), indent=2),
        encoding="utf-8",
    )
    return path


def list_sessions(root: Path) -> list[str]:
    sessions = get_sessions_dir(root)
    items = sorted(
        [p.name for p in sessions.glob("session-*.json")],
        reverse=True,
    )
    return items


def load_session(root: Path, name: str = "latest") -> dict:
    sessions = get_sessions_dir(root)

    if name == "current":
        path = sessions / "current.json"
    elif name == "latest":
        items = sorted(sessions.glob("session-*.json"), reverse=True)
        if items:
            path = items[0]
        else:
            path = sessions / "current.json"
    else:
        path = sessions / name

    if not path.exists():
        raise FileNotFoundError(f"Session not found: {name}")

    return json.loads(path.read_text(encoding="utf-8"))
