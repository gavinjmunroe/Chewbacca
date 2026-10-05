"""Outcomes observed after the fact, joined to the decisions that predicted them.

skill-route rows (tools/skill_route_shadow.py) name a session and a prompt. The
session's transcript says which skill was actually loaded before the next
prompt, which is the outcome: right when Jev named that skill, wrong when it
named another, unknown when nothing was loaded (no load does not prove "none"
was right; the session may simply have skipped a skill it needed). The note
keeps the loaded skill and the keyword router's pick, so both routers score
from the same rows.

calibrate() turns joined outcomes into a floor per decision: the lowest
confidence at which everything at or above it was right at least `target` of
the time, over at least `min_n` labelled rows. Floors are written to
~/.bob/decision-floors.json, never into a repo (TypeSafe 2.3(f)), and read back
with floor().
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import decision_log

PROJECTS = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"
FLOORS = Path(os.environ.get("BOB_DECISION_FLOORS", str(Path.home() / ".bob" / "decision-floors.json")))
# A turn is over well before this; joining sooner would mark a skill load that
# has not happened yet as "nothing loaded". Guessed, never measured.
SETTLE_S = 600
STEPS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)


def _user_text(row: dict) -> str | None:
    m = row.get("message")
    if row.get("type") != "user" or not isinstance(m, dict) or row.get("isMeta"):
        return None
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        texts = [x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"]
        return "\n".join(texts) if texts else None
    return None


def skills_loaded(transcript: Path, prompt: str) -> list[str] | None:
    """Skills loaded between `prompt` and the next typed prompt; None if the prompt is not found."""
    found, loaded = False, []
    with open(transcript, errors="ignore") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            text = _user_text(row)
            if text is not None:
                if found:
                    break
                found = text.strip() == prompt.strip()
                continue
            if not found or row.get("type") != "assistant":
                continue
            for c in (row.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "Skill":
                    name = (c.get("input") or {}).get("skill", "")
                    loaded.append(name.split(":", 1)[-1])
    return loaded if found else None


def _transcript(session: str) -> Path | None:
    hits = list(PROJECTS.glob(f"*/{session}.jsonl"))
    return hits[0] if hits else None


def join_skill_routes(now: float | None = None, write: bool = True) -> dict:
    now = now or time.time()
    counts = {"right": 0, "wrong": 0, "unknown": 0, "pending": 0, "no transcript": 0}
    for d in decision_log.joined():
        if d.get("decision") != "skill-route" or d.get("outcome") or d.get("error"):
            continue
        if now - d["t"] < SETTLE_S:
            counts["pending"] += 1
            continue
        try:
            state = json.loads(d["state"])
        except ValueError:  # state cut at 300 characters: a long prompt cannot be matched
            counts["no transcript"] += 1
            continue
        path = _transcript(str(state.get("session") or ""))
        loaded = skills_loaded(path, state.get("prompt", "")) if path else None
        if loaded is None:
            counts["no transcript"] += 1
            continue
        jev = (d.get("answers") or {}).get("jev", {}).get("choice")
        kw = (d.get("answers") or {}).get("kw", {}).get("choice")
        if not loaded:
            result = "unknown"
        else:
            result = "right" if jev in loaded else "wrong"
        counts[result] += 1
        if write:
            decision_log.outcome(d["id"], result, f"loaded={','.join(loaded) or 'none'} kw={kw}")
    return counts


def calibrate(target: float = 0.9, min_n: int = 30) -> dict:
    """Per decision: cumulative accuracy at each confidence step, and the floor."""
    by: dict[str, list[tuple[float, bool]]] = {}
    for d in decision_log.joined():
        if d.get("outcome") not in ("right", "wrong"):
            continue
        p = decision_log.top_p(d)
        if p is not None:
            by.setdefault(d["decision"], []).append((p, d["outcome"] == "right"))
    out = {}
    for name, pts in by.items():
        steps, floor = [], None
        for t in STEPS:
            sel = [ok for p, ok in pts if p >= t]
            if not sel:
                continue
            acc = sum(sel) / len(sel)
            steps.append({"at_least": t, "n": len(sel), "accuracy": round(acc, 3)})
            if floor is None and len(sel) >= min_n and acc >= target:
                floor = t
        out[name] = {"labelled": len(pts), "target": target, "min_n": min_n, "floor": floor,
                     "steps": steps}
    return out


def save_floors(table: dict) -> None:
    FLOORS.parent.mkdir(parents=True, exist_ok=True)
    data = {name: {"floor": t["floor"], "labelled": t["labelled"], "target": t["target"],
                   "set": time.strftime("%Y-%m-%d")} for name, t in table.items()}
    FLOORS.write_text(json.dumps(data, indent=2) + "\n")


def floor(name: str, default: float) -> float:
    """The calibrated floor for a decision, or the call site's own default when
    calibration found none (too few labels, or no confidence meets the target)."""
    try:
        value = json.loads(FLOORS.read_text()).get(name, {}).get("floor")
    except (OSError, ValueError, AttributeError):
        return default
    return float(value) if isinstance(value, (int, float)) else default
