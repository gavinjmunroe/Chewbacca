#!/usr/bin/env python3
"""Whether the two memory indexes load whole, or brain-recall stands in for them.

WHY. The team index and the brain's memory/MEMORY.md were 16,304 tokens of
the first turn on 2026-10-12 (9,762 and 6,542 of 126,449, context-budget on
session 378e4bfd), and brain-recall already brings matching notes in by
meaning on every prompt. Step 14 of docs/plans/reengineer-flat-plan.md stops
loading them whole, but only while recall is as good as when that trade was
judged: the sealed set in ~/second-brain/.bench/brain-retrieval decides.

  recall_gate.py check     run the shipped retriever on the sealed set, write the stamp
  recall_gate.py mode      print recall or whole, from the stamp and the pin
  recall_gate.py apply     make this machine match the mode (team index, auto memory,
                           the Claude startup block); writes only what it owns
  recall_gate.py pin whole|auto   force whole, or hand the choice back to the gate

The check prints only the aggregate. The sealed questions and their misses
never reach a terminal, so the set stays sealed for whoever tunes recall next.

In recall mode:
  - ~/.chewbacca/team-memory-index.md becomes a short stub (tools/team_index.py)
  - settings.json env CLAUDE_CODE_DISABLE_AUTO_MEMORY=1, so the host stops
    loading memory/MEMORY.md (checked 2026-10-12: a `claude -p` with it set had
    no MEMORY.md in its transcript)
  - the Claude startup block stops asking for memory/MEMORY.md
  - brain-recall shows up to 5 notes a prompt instead of 3
Whole mode puts every one of those back. Files and pointers on disk never change.
"""
import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "apps/brain-retrieval/bench"
SEALED_SET = "queries_independent.json"

# The shipped retriever's recall@5 on the sealed set (n=65) against the frozen
# index of 2026-10-10 (bench/frozen/rerank_A.json.sealed-run: "shipped r@5
# 55.4%"). That is the recall the plan's trade was judged on. On 2026-10-12 the
# live index (834 files, was 729) gave 47.7% with the same code, so the gate is
# a real line, not a formality.
FLOOR = 55.4

# A stamp older than this decides nothing. The live index grew 105 files in
# two days (10/10 to 10/12) and lost 7.7 points of recall@5 doing it, so a
# day-old reading is the most that can stand for today's index.
MAX_AGE_S = 24 * 3600

# The floor was set on 65 sealed questions. bench.prepare drops any question
# whose gold note no longer resolves (a rename, a move to ARCHIVE), so a stamp
# from a set that has shrunk says nothing about the floor: 3 questions with 2
# hits read as 66.7% and passed in review. 60 allows a few renames.
MIN_N = 60

ENV_KEY = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"


def home():
    return Path(os.environ.get("CHEWBACCA_HOME", str(Path.home() / ".chewbacca"))).expanduser()


def stamp_path():
    return home() / "state" / "recall-gate.json"


def mode_path():
    """Written by apply, read by brain-recall.sh: recall or whole, plus what apply owns."""
    return home() / "state" / "context-mode.json"


def pin_path():
    return home() / "context-mode.pin"


def claude_home():
    sys.path.insert(0, str(ROOT / "tools"))
    import agent_context
    return agent_context.claude_home()


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path, data):
    """Atomic, and the file keeps its permissions: settings.json is 0600 and
    holds tokens, and a plain temp file would have come back 0644."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        perms = path.stat().st_mode & 0o777
    except OSError:
        perms = 0o600
    tmp = path.with_name(path.name + ".recall-gate.tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, perms)
    try:
        os.write(fd, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(str(tmp), perms)
    tmp.replace(path)


def decide(stamp, pin=None, now=None):
    """recall only for a fresh, passing stamp with no pin forcing whole."""
    if (pin or "").strip() == "whole":
        return "whole"
    if not isinstance(stamp, dict) or stamp.get("pass") is not True:
        return "whole"
    r5, n, at = stamp.get("r5"), stamp.get("n"), stamp.get("checked_at")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
               for v in (r5, n, at)):
        return "whole"
    if r5 < FLOOR or n < MIN_N:
        return "whole"
    age = (now if now is not None else time.time()) - at
    if age < 0 or age > MAX_AGE_S:
        return "whole"
    return "recall"


def mode(now=None):
    try:
        pin = pin_path().read_text(encoding="utf-8")
    except OSError:
        pin = None
    return decide(_read_json(stamp_path()), pin, now)


def measure():
    """recall@5 and n of the shipped retriever on the sealed set, live index."""
    sys.path.insert(0, str(BENCH))
    import rerank as bench  # apps/brain-retrieval/bench/rerank.py
    db, rows, emb = bench.load_index()
    prepped = bench.prepare(bench.goldset.load(SEALED_SET), db, rows, emb)
    if not prepped:
        raise SystemExit("recall-gate: no sealed question resolves against the index")
    r5, _, _ = bench.score(prepped, [names for _, _, names, _ in prepped])
    built = dict(db.execute("SELECT k,v FROM meta")).get("built_at")
    return round(r5, 1), len(prepped), {"index": bench.IDX, "index_built_at": built}


def check(measure_fn=measure, now=None):
    r5, n, extra = measure_fn()
    stamp = {"r5": r5, "n": n, "floor": FLOOR, "pass": r5 >= FLOOR and n >= MIN_N,
             "checked_at": now if now is not None else time.time(), **extra}
    _write_json(stamp_path(), stamp)
    return stamp


def _settings_env(settings_file, want_on, owned, record):
    """Set or clear CLAUDE_CODE_DISABLE_AUTO_MEMORY; returns whether apply owns it now.

    Clears it only when an earlier apply set it, so a value the person set by
    hand survives whole mode. Ownership is recorded (record(True)) before the
    write, so a run that dies after setting the key still knows to clear it.
    """
    data = _read_json(settings_file)
    if not isinstance(data, dict):
        return owned
    env = data.get("env") if isinstance(data.get("env"), dict) else {}
    if want_on:
        if env.get(ENV_KEY) == "1":
            return owned
        record(True)
        env[ENV_KEY] = "1"
        data["env"] = env
        _write_json(settings_file, data)
        return True
    if owned and ENV_KEY in env:
        env.pop(ENV_KEY)
        data["env"] = env
        _write_json(settings_file, data)
    return False


MEMORY_SOURCE = "`memory/MEMORY.md`"


def _toggle_startup_block(claude_md, want):
    """Drop or restore memory/MEMORY.md in CLAUDE.md's shared-context block.

    An edit in place, never a regenerate: install_claude writes its own script
    path into the block, and run from the kit runtime that path is a snapshot
    the pruner deletes. Both sources lists (core/ and flat) end with
    memory/MEMORY.md, so whole mode puts it back at the end. True on a change.
    """
    import re
    try:
        text = Path(claude_md).read_text(encoding="utf-8")
    except OSError:
        return False
    begin, end = "<!-- CHEWBACCA SHARED CONTEXT BEGIN -->", "<!-- CHEWBACCA SHARED CONTEXT END -->"
    i, j = text.find(begin), text.find(end)
    if i < 0 or j < i:
        return False
    block = text[i:j]
    if want == "recall":
        new = re.sub(r",\s*" + re.escape(MEMORY_SOURCE), "", block, count=1)
    elif MEMORY_SOURCE in block:
        return False
    else:
        new = re.sub(r"(imported: (?:`[^`]+`,\s*)*`[^`]+`)\.", lambda m: m.group(1) + ", " + MEMORY_SOURCE + ".",
                     block, count=1)
    if new == block:
        return False
    tmp = Path(claude_md).with_name(Path(claude_md).name + ".recall-gate.tmp")
    tmp.write_text(text[:i] + new + text[j:], encoding="utf-8")
    tmp.replace(claude_md)
    return True


def apply(now=None, src=None):
    """Make the team index, settings env and startup block match mode().

    src is the full team index to point at. kit-autopull passes the checkout's,
    the same one its own rebuild uses, so the two never flip the file between
    a checkout path and a kit snapshot path the pruner later deletes.
    """
    want = mode(now)
    prev = _read_json(mode_path()) or {}
    sys.path.insert(0, str(ROOT / "tools"))
    import team_index

    changed = []
    dst = team_index.default_dst()
    if dst.is_file() and team_index.write(src=Path(src) if src else team_index.SRC, dst=dst, mode=want):
        changed.append("team index")
    settings = claude_home() / "settings.json"
    def record(owns):
        _write_json(mode_path(), dict(prev, owns_env=owns))
    owned = _settings_env(settings, want == "recall", bool(prev.get("owns_env")), record)
    if owned != bool(prev.get("owns_env")):
        changed.append("auto memory " + ("off" if owned else "on"))
    if _toggle_startup_block(claude_home() / "CLAUDE.md", want):
        changed.append("startup block")
    _write_json(mode_path(), {"mode": want, "owns_env": owned, "applied_at": now or time.time()})
    return want, changed


def main(argv=None):
    ap = argparse.ArgumentParser(description="Memory indexes whole, or recall in their place.")
    ap.add_argument("cmd", choices=("check", "mode", "apply", "pin"))
    ap.add_argument("value", nargs="?", choices=("whole", "auto"))
    ap.add_argument("--src", help="apply: the full team index (default: this kit's)")
    a = ap.parse_args(argv)
    if a.cmd == "check":
        s = check()
        print(f"sealed recall@5 {s['r5']}% (n={s['n']}), floor {FLOOR}%: "
              + ("pass, the indexes may stop loading" if s["pass"] else "below the floor, indexes load whole"))
        return 0
    if a.cmd == "mode":
        print(mode())
        return 0
    if a.cmd == "pin":
        if a.value == "whole":
            pin_path().parent.mkdir(parents=True, exist_ok=True)
            pin_path().write_text("whole\n", encoding="utf-8")
        else:
            try:
                pin_path().unlink()
            except OSError:
                pass
        print("pinned whole" if a.value == "whole" else "the gate decides")
        return 0
    want, changed = apply(src=a.src)
    print(want + (": " + ", ".join(changed) if changed else ", nothing to change"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
