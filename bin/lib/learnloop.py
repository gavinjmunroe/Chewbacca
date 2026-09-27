"""What the learning loop reads, and the one ranking every step of it shares.

`bin/reflect` harvests, `tests/voice_cases.py` judges, `bin/propose` writes a
fix and `bin/learn` asks whether a lesson already existed. They all read
through here so the step that proposes a fix and the step that judges it can
never disagree about which failures were meant. Read `bin/reflect` first.

Everything here reads. Nothing here writes except `write_jsonl`, and only the
callers that were given `--write` call it.
"""
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import json
import os
import re
import statistics
import time
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent.parent
LEARN = Path(os.environ.get("CHEWBACCA_LEARN_DIR") or HOME / ".chewbacca" / "learn")
EPISODES = LEARN / "episodes.jsonl"
CASES = LEARN / "cases"
DECLINED = LEARN / "declined.jsonl"
PROPOSALS = LEARN / "proposals"
BOB = Path(os.environ.get("BOB_DIR") or HOME / ".bob")

# A request that took this long went and did something. quick.py measured the
# model at 1.2 s to first words with no tool call and 5.6 s with one, so 3 s
# sits between an answer from memory and a trip through tools. Guessed from
# that measurement, never tuned against the log.
SLOW_S = 3.0
# One slow request is an anecdote. The shape has to recur before a fix for it
# is worth a patch; SELF-LEARNING.md set three signals as the bar for a rule,
# and this uses the same bar for a verb. Guessed, never measured.
SHAPE_MIN = 3

# Pasted into chats more than once: on 2026-09-27 a transcript under
# ~/.claude-2 held a live sk-ant key and an ElevenLabs key in one message.
# Episodes are private, but a secret copied into a second file is a second
# place to leak it from, so every harvested sentence goes through this.
SECRET = re.compile(
    r"(sk-ant-[A-Za-z0-9_-]{8,}|sk[-_][A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}"
    r"|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
    r"|\b[A-Fa-f0-9]{40,}\b|\b[A-Za-z0-9+/]{48,}={0,2})")


def redact(text: str) -> str:
    return SECRET.sub("[redacted]", text or "")


def _epoch(at: str) -> float | None:
    for fmt in ("%Y-%m-%dT%H:%M:%S%z",):
        try:
            return dt.datetime.strptime(at, fmt).timestamp()
        except (TypeError, ValueError):
            pass
    try:
        return dt.datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _stamp(t: float) -> str:
    return dt.datetime.fromtimestamp(t).astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")


def episode_id(*parts: str) -> str:
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:12]


def read_jsonl(path: Path) -> list[dict]:
    out = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def write_jsonl(path: Path, rows: list[dict], append: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a" if append else "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- Claude Code

INTERRUPT = "[Request interrupted by user"
# Text that arrives as a user turn and was never typed by a person. Read off
# 400 transcripts on 2026-09-27: newer entries say so in `turnOrigin`, older
# ones only by how they start.
NOISE_PREFIX = ("<", "Caveat:", "Tool loaded", "This session is being continued",
                "[MESSAGE FROM NON-USER", "Base directory for this skill",
                "Stop hook", "SYSTEM NOTIFICATION")
IMAGE_TAG = re.compile(r"\[Image #\d+\]")


def transcript_roots() -> list[Path]:
    """Every Claude Code config dir's transcripts: ~/.claude, ~/.claude-2 and
    any other second subscription set up the same way."""
    env = os.environ.get("CHEWBACCA_TRANSCRIPTS")
    if env:
        return [Path(p) for p in env.split(os.pathsep) if p]
    return sorted(p for p in HOME.glob(".claude*/projects") if p.is_dir())


def _typed_text(content) -> str | None:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return None


def human_asks(days: float = 14, roots: list[Path] | None = None) -> list[dict]:
    """Every message a person typed into Claude Code, plus every interrupt.

    Rows have the shape `.claude/hooks/ask-capture.sh` writes (at, session,
    cwd, said), so `tools/mine_asks.py` reads them unchanged. That hook was
    never registered on Gavin's Mac and asks.jsonl did not exist there, while
    2,228 transcripts held every prompt he ever typed. Reading the transcripts
    is also retroactive, which a capture hook cannot be.
    """
    cut = time.time() - days * 86400
    rows = []
    for root in roots if roots is not None else transcript_roots():
        for path in root.rglob("*.jsonl"):
            if "subagents" in path.parts:
                continue
            try:
                if path.stat().st_mtime < cut:
                    continue
                fh = path.open(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            with fh:
                for n, line in enumerate(fh, 1):
                    # A cheap skip before parsing: most lines are tool output.
                    # Not '"type":"user"', which silently missed any writer
                    # that puts a space after the colon.
                    if '"user"' not in line:
                        continue
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if (e.get("type") != "user" or e.get("isSidechain") or e.get("isMeta")
                            or e.get("isCompactSummary")):
                        continue
                    origin = e.get("turnOrigin")
                    if origin not in (None, "human"):
                        continue
                    text = _typed_text((e.get("message") or {}).get("content"))
                    text = IMAGE_TAG.sub("", text or "").strip()
                    if not text:
                        continue
                    interrupt = text.startswith(INTERRUPT)
                    if not interrupt and text.startswith(NOISE_PREFIX):
                        continue
                    t = _epoch(e.get("timestamp", ""))
                    if t is None or t < cut:
                        continue
                    rows.append({
                        "at": _stamp(t), "t": t,
                        "session": (e.get("sessionId") or "")[:8],
                        "cwd": e.get("cwd") or "",
                        "said": redact(text)[:1200],
                        "interrupt": interrupt,
                        "origin": f"{path}:{n}",
                    })
    rows.sort(key=lambda r: (r["session"], r["t"]))
    return rows


def claude_episodes(rows: list[dict], mine_asks) -> list[dict]:
    """Interrupts, with what was asked before and said after, and corrections.

    Corrections use `mine_asks.repairs`, the kit's one detector for "the second
    ask is fixing the first", so reflect and learn cannot count differently.
    """
    out = []
    by_session = collections.defaultdict(list)
    for r in rows:
        by_session[r["session"]].append(r)
    for session, items in by_session.items():
        for i, r in enumerate(items):
            if not r["interrupt"]:
                continue
            asked = next((x["said"] for x in reversed(items[:i]) if not x["interrupt"]), "")
            after = next((x for x in items[i + 1:] if not x["interrupt"]), None)
            then_said = after["said"] if after and after["t"] - r["t"] <= 600 else ""
            out.append({"id": episode_id(r["origin"], "interrupt"), "source": "claude",
                        "kind": "interrupt", "at": r["at"], "session": session,
                        "cwd": r["cwd"], "asked": asked[:400], "then_said": then_said[:400],
                        "origin": r["origin"]})
        typed = [x for x in items if not x["interrupt"]]
        for rep in mine_asks.repairs(typed):
            origin = next((x["origin"] for x in typed if x["at"] == rep["at"]
                           and x["said"] == rep["then_said"]), f"{session}@{rep['at']}")
            out.append({"id": episode_id(origin, "correction"), "source": "claude",
                        "kind": "correction", "at": rep["at"], "session": session,
                        "cwd": next((x["cwd"] for x in typed if x["origin"] == origin), ""),
                        "asked": rep["asked"][:400], "then_said": rep["then_said"][:400],
                        "origin": origin})
    out.sort(key=lambda e: e["at"])
    return out


# ---------------------------------------------------------------------- voice

def voice_store() -> Path:
    """Where the voice keeps questions.jsonl. It is gitignored, so a worktree
    has none of its own and has to be pointed at the real checkout's."""
    env = os.environ.get("SUPERASSISTANT_DIR")
    if env:
        return Path(env)
    here = REPO / "superassistant"
    if (here / "questions.jsonl").exists():
        return here
    return HOME / "Chewbacca" / "superassistant"


def voice_rows() -> list[dict]:
    """Every request the voice logged, with how often it was muted.

    listen.log carries no timestamps, so a mute is attributed by the words
    alone, to every request with the same words. "Pause" muted once marks
    every "Pause", which is why a mute is a signal on a row and never an
    episode by itself.
    """
    store = voice_store() / "questions.jsonl"
    muted = collections.Counter()
    try:
        for line in (BOB / "listen.log").read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("muted: "):
                muted[line[7:].strip()] += 1
            elif line.startswith("interrupted: "):
                muted[line[13:].split(" for: ")[0].strip()] += 1
    except OSError:
        pass
    rows = []
    for n, row in enumerate(read_jsonl(store), 1):
        said = (row.get("said") or "").strip()
        if not said:
            continue
        usage = row.get("usage") or {}
        rows.append({
            "at": row.get("at", ""), "t": _epoch(row.get("at", "")) or 0.0,
            "said": redact(said), "answer": redact(row.get("answer") or "")[:300],
            "outcome": row.get("outcome", ""), "seconds": float(row.get("seconds") or 0),
            "model": bool(usage.get("output_tokens")), "typed": bool(row.get("typed")),
            "muted": muted.get(said, 0), "origin": f"{store}:{n}",
        })
    return rows


FILLERS = {"ok", "okay", "hey", "yo", "please", "um", "uh", "so", "and", "actually",
           "now", "just", "alright", "well", "also", "chewbacca", "kyber"}
POLITE = ("can you ", "could you ", "would you ", "will you ", "i want you to ",
          "i need you to ", "go ahead and ", "can u ", "i want to ", "lets ", "let's ")


def shape(said: str) -> str:
    """The verb a request starts with, once the politeness is off it.

    "Open up Google sheets", "Open a chrome window" and "can you open a new
    terminal window" are one shape, `open`, because one verb would serve all
    three. Two-word shapes split them into three groups too small to act on.
    """
    low = " ".join(re.sub(r"[^a-z' ]", " ", said.lower()).split())
    changed = True
    while changed and low:
        changed = False
        for p in POLITE:
            if low.startswith(p):
                low, changed = low[len(p):], True
        head, _, rest = low.partition(" ")
        if head in FILLERS and rest:
            low, changed = rest, True
    return low.split(" ", 1)[0] if low else ""


def voice_episodes(rows: list[dict], days: float = 14) -> list[dict]:
    cut = time.time() - days * 86400
    out = []
    for r in rows:
        if r["t"] and r["t"] < cut:
            continue
        kinds = []
        if r["outcome"] in ("failed", "cancelled"):
            kinds.append(r["outcome"])
        if r["model"] and r["seconds"] >= SLOW_S:
            kinds.append("slow")
        for kind in kinds:
            out.append({"id": episode_id(r["origin"], kind), "source": "voice", "kind": kind,
                        "at": r["at"], "said": r["said"], "answer": r["answer"],
                        "seconds": r["seconds"], "muted": r["muted"], "shape": shape(r["said"]),
                        "origin": r["origin"]})
    return out


# ---------------------------------------------------------------------- cases

def _declines(key: str) -> dict[str, dict]:
    out = {}
    for row in read_jsonl(DECLINED):
        k = row.get(key)
        if not k:
            continue
        if row.get("undo"):
            out.pop(k, None)
        else:
            out[k] = row
    return out


def declined() -> dict[str, dict]:
    """Shapes a proposer looked at and said no to, with why: "text" is
    outbound, "give" needs a model to write the answer. The latest word on a
    shape wins, so a decline is withdrawn by appending `"undo": true`."""
    return _declines("shape")


def declined_cases() -> dict[str, dict]:
    """Single sentences left to the model inside a shape that was fixed.

    Needed because a shape is not a spec. Of fifteen slow "open" requests,
    "Open up Google sheets" is a fast path and "Open up the Gavin Jay Monroe
    get hub Rea. We need..." is a task, and a judge that demanded both would
    reward a parser for grabbing sentences it should leave alone."""
    return _declines("case")


def voice_cases(episodes: list[dict], claims) -> tuple[list[dict], list[dict]]:
    """Slow requests of a recurring shape, split by whether today's code still
    sends them to the model.

    `claims(said)` is `fast_path` from bin/hud-listen: the name of the path
    that would answer with no model turn, or None. A failure it now claims was
    fixed after it was logged and is not a case. On 2026-09-27 the router's
    16 logged mistakes had all been fixed by hand, and replaying them was the
    only way to tell.
    """
    slow = [e for e in episodes if e["source"] == "voice" and e["kind"] == "slow"]
    counts = collections.Counter(e["shape"] for e in slow)
    live, fixed = [], []
    for e in slow:
        if not e["shape"] or counts[e["shape"]] < SHAPE_MIN:
            continue
        path = claims(e["said"])
        case = {"id": e["id"], "shape": e["shape"], "said": e["said"], "seconds": e["seconds"],
                "answer": e["answer"], "at": e["at"], "origin": e["origin"]}
        (fixed if path else live).append({**case, "path": path} if path else case)
    return live, fixed


def rank(cases: list[dict], skip: dict | None = None) -> list[dict]:
    """Shapes, most model time first: the time a fix would give back.

    Count times median, not a sum, so one request that hung for four minutes
    cannot outrank a shape asked for every day.
    """
    skip = declined() if skip is None else skip
    groups = collections.defaultdict(list)
    for c in cases:
        if c["shape"] not in skip:
            groups[c["shape"]].append(c)
    ranked = []
    for s, items in groups.items():
        med = statistics.median(c["seconds"] for c in items)
        ranked.append({"shape": s, "count": len(items), "median_s": round(med, 1),
                       "cost_s": round(med * len(items), 1), "cases": items})
    ranked.sort(key=lambda g: (-g["cost_s"], g["shape"]))
    return ranked


def select(surface: str = "voice", top: int = 3, shapes: list[str] | None = None) -> list[dict]:
    """The groups a proposal will be asked to fix and judged on. The proposer
    and the judge both call this with the same arguments, which is the whole
    reason it lives here."""
    ranked = rank(read_jsonl(CASES / f"{surface}.jsonl"))
    if shapes:
        return [g for g in ranked if g["shape"] in shapes]
    return ranked[:top]
